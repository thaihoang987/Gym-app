import cors from 'cors';
import ExcelJS from 'exceljs';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authVersion, db, getExerciseTranslation, hashPassword, importHasaneyldrmDataset, migrate, publicExercise, rootDir, uploadDir, verifyPassword } from './db.js';

const app = express();
const port = process.env.PORT || 3001;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.join(rootDir, 'data', 'logs');
const serverLogPath = path.join(logDir, 'server.log');
app.set('trust proxy', true);

fs.mkdirSync(logDir, { recursive: true });

function writeServerLog(level, message, meta = {}) {
  const entry = {
    time: new Date().toISOString(),
    level,
    message,
    ...meta
  };
  fs.appendFile(serverLogPath, `${JSON.stringify(entry)}\n`, (error) => {
    if (error) console.error('Failed to write server log', error);
  });
}

process.on('uncaughtException', (error) => {
  writeServerLog('fatal', error.message, { stack: error.stack });
  console.error(error);
});

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  writeServerLog('error', error.message, { stack: error.stack, type: 'unhandledRejection' });
  console.error(error);
});

migrate();
if (db.prepare('SELECT COUNT(*) AS total FROM exercises').get().total === 0) {
  const count = importHasaneyldrmDataset();
  console.log(`Imported ${count} exercises from hasaneyldrm dataset.`);
}

app.use(cors());
app.use(express.json({ limit: '200mb' }));
app.use('/media', express.static(path.join(rootDir, 'hasaneyldrm-exercises-dataset')));
app.use('/uploads', express.static(uploadDir));

// ── SSE live sync ─────────────────────────────────────────────────────────────
const sseClients = new Map(); // userId -> Set<res>

function broadcastToUser(userId, event) {
  const clients = sseClients.get(Number(userId));
  if (!clients || clients.size === 0) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) { try { res.write(data); } catch {} }
}

// Middleware: broadcast 'refresh' sau mọi write API thành công
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'OPTIONS') return next();
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    originalJson(body);
    if (res.statusCode < 400) {
      const userId = getUserId(req);
      broadcastToUser(userId, { type: 'refresh', method: req.method, path: req.path });
    }
  };
  next();
});
// ─────────────────────────────────────────────────────────────────────────────

function getUserId(req) {
  return Number(req.query.userId || req.body?.userId || req.headers['x-user-id'] || 1);
}

function one(sql, params = []) {
  return db.prepare(sql).get(...params);
}

function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

function assetUrl(value) {
  if (!value) return null;
  if (String(value).startsWith('/')) return value;
  return `/media/${value}`;
}

function publicUserWithSettings(userId) {
  const user = one('SELECT * FROM users WHERE id = ?', [userId]);
  return publicUser(user);
}

function requireBody(fields, body) {
  for (const field of fields) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      const error = new Error(`Missing field: ${field}`);
      error.status = 400;
      throw error;
    }
  }
}

function saveUploadedDataUrl(dataUrl, prefix) {
  if (!dataUrl) return null;
  if (typeof dataUrl === 'string' && dataUrl.startsWith('/uploads/')) return dataUrl;
  const match = String(dataUrl).match(/^data:(image\/(?:png|jpe?g|gif|webp));base64,(.+)$/i);
  if (!match) {
    const error = new Error('File upload không hợp lệ');
    error.status = 400;
    throw error;
  }
  const ext = match[1].split('/')[1].replace('jpeg', 'jpg');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 8 * 1024 * 1024) {
    const error = new Error('Ảnh/GIF tối đa 8MB');
    error.status = 400;
    throw error;
  }
  const dir = path.join(uploadDir, 'exercises');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), bytes);
  return `/uploads/exercises/${filename}`;
}

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStored(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function buildXlsx(headers, rows) {
  const sheetRows = [headers.map(([, label]) => label), ...rows.map((row) => headers.map(([key]) => row[key] ?? ''))];
  const cell = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return `<c><v>${value}</v></c>`;
    return `<c t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
  };
  const sheetData = sheetRows.map((row, index) => `<row r="${index + 1}">${row.map(cell).join('')}</row>`).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Workout Log" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
  return zipStored([
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: rootRels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { name: 'xl/worksheets/sheet1.xml', data: sheet }
  ]);
}

function htmlUnescape(value) {
  return String(value ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function splitDateTime(value) {
  if (!value) return { date: '', time: '' };
  const text = String(value).replace('T', ' ');
  const [date, time = ''] = text.split(' ');
  return { date, time: time.slice(0, 8) };
}

function makeExcelRow(index, type, title, detail, dateTime, data = {}, fields = {}) {
  const { date, time } = splitDateTime(dateTime);
  return {
    stt: index,
    date,
    time,
    type,
    title,
    detail,
    ...fields,
    json: JSON.stringify(data)
  };
}

function readExportTables(userId) {
  return {
    user: one('SELECT id, username, name, avatar, role, created_at FROM users WHERE id = ?', [userId]),
    settings: one('SELECT * FROM user_settings WHERE user_id = ?', [userId]),
    customExercises: all('SELECT * FROM exercises WHERE custom_user_id = ? AND is_custom = 1 ORDER BY name', [userId]),
    groups: all('SELECT * FROM custom_groups WHERE user_id = ? ORDER BY order_index, id', [userId]),
    groupExercises: all('SELECT ge.* FROM group_exercises ge JOIN custom_groups cg ON cg.id = ge.group_id WHERE cg.user_id = ? ORDER BY ge.group_id, ge.order_index', [userId]),
    routines: all('SELECT * FROM routines WHERE user_id = ? ORDER BY order_index, id', [userId]),
    routineGroups: all('SELECT rg.* FROM routine_groups rg JOIN routines r ON r.id = rg.routine_id WHERE r.user_id = ? ORDER BY rg.routine_id, rg.order_index', [userId]),
    scheduleRules: all('SELECT * FROM routine_schedule_rules WHERE user_id = ? ORDER BY mode, day_of_week, order_index', [userId]),
    sessions: all(`
      SELECT ws.*, r.name AS routine_name, cg.name AS group_name
      FROM workout_sessions ws
      LEFT JOIN routines r ON r.id = ws.routine_id
      LEFT JOIN custom_groups cg ON cg.id = ws.group_id
      WHERE ws.user_id = ?
      ORDER BY ws.started_at
    `, [userId]),
    logs: all(`
      SELECT wl.*, e.name AS exercise_name
      FROM workout_logs wl
      JOIN exercises e ON e.id = wl.exercise_id
      WHERE wl.user_id = ?
      ORDER BY wl.completed_at, wl.session_id, wl.set_index
    `, [userId]),
    exerciseNotes: all('SELECT * FROM exercise_notes WHERE user_id = ? ORDER BY exercise_id', [userId]),
    bodyWeights: all('SELECT * FROM body_weight_logs WHERE user_id = ? ORDER BY logged_at', [userId]),
    uploads: readUserUploadedFiles(userId)
  };
}

function tableRows(table, where = '', params = []) {
  return all(`SELECT * FROM ${table}${where ? ` ${where}` : ''}`, params);
}

function tableColumns(table) {
  return all(`PRAGMA table_info(${table})`).map((column) => column.name);
}

function insertRows(table, rows = []) {
  const columns = tableColumns(table);
  for (const row of rows || []) {
    const keys = Object.keys(row || {}).filter((key) => columns.includes(key) && /^[a-z0-9_]+$/i.test(key));
    if (!keys.length) continue;
    db.prepare(`INSERT OR REPLACE INTO ${table} (${keys.map((key) => `"${key}"`).join(', ')}) VALUES (${keys.map((key) => `@${key}`).join(', ')})`).run(row);
  }
}

function mimeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function readUploadedFiles() {
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        walk(fullPath);
      } else if (item.isFile()) {
        const relativePath = path.relative(uploadDir, fullPath).replace(/\\/g, '/');
        files.push({
          path: relativePath,
          mime: mimeForFile(fullPath),
          base64: fs.readFileSync(fullPath).toString('base64')
        });
      }
    }
  };
  walk(uploadDir);
  return files;
}

function uploadedPathFromUrl(value) {
  const text = String(value || '');
  if (!text.startsWith('/uploads/')) return null;
  return text.slice('/uploads/'.length).replace(/\\/g, '/');
}

function readUploadFileByRelativePath(relativePath) {
  const clean = String(relativePath || '').replace(/\\/g, '/');
  if (!clean || clean.includes('..') || path.isAbsolute(clean)) return null;
  const fullPath = path.join(uploadDir, clean);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return null;
  return {
    path: clean,
    mime: mimeForFile(fullPath),
    base64: fs.readFileSync(fullPath).toString('base64')
  };
}

function readUserUploadedFiles(userId) {
  const paths = new Set();
  const user = one('SELECT avatar FROM users WHERE id = ?', [userId]);
  const avatarPath = uploadedPathFromUrl(user?.avatar);
  if (avatarPath) paths.add(avatarPath);
  for (const exercise of all('SELECT image_path, gif_path FROM exercises WHERE custom_user_id = ? AND is_custom = 1', [userId])) {
    const imagePath = uploadedPathFromUrl(exercise.image_path);
    const gifPath = uploadedPathFromUrl(exercise.gif_path);
    if (imagePath) paths.add(imagePath);
    if (gifPath) paths.add(gifPath);
  }
  return [...paths].map(readUploadFileByRelativePath).filter(Boolean);
}

function restoreUploadedFiles(files = []) {
  for (const file of files || []) {
    const relativePath = String(file.path || '').replace(/\\/g, '/');
    if (!relativePath || relativePath.includes('..') || path.isAbsolute(relativePath)) continue;
    const targetPath = path.join(uploadDir, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, Buffer.from(String(file.base64 || ''), 'base64'));
  }
}

function readAdminExportTables() {
  const adminIds = all("SELECT id FROM users WHERE role = 'ADMIN' ORDER BY id").map((user) => user.id);
  const adminData = adminIds.map((adminId) => ({ userId: adminId, data: readExportTables(adminId) }));
  return {
    users: all('SELECT id, username, name, password_hash, role, created_at FROM users ORDER BY id'),
    adminData,
    uploads: [...new Map(adminData.flatMap((item) => item.data.uploads || []).map((file) => [file.path, file])).values()]
  };
}

function excelRowsForUser(userId) {
  return all(`
    SELECT
      e.name AS exercise_name,
      COALESCE(e.target, e.body_part, e.muscle_group, 'Khác') AS muscle_group,
      date(wl.completed_at) AS log_date,
      wl.set_index,
      wl.weight_kg AS kg,
      wl.weight_kg * 2.2046226218 AS lb,
      wl.reps AS reps,
      COALESCE(en.note, '') AS note
    FROM workout_logs wl
    JOIN exercises e ON e.id = wl.exercise_id
    LEFT JOIN exercise_notes en ON en.user_id = wl.user_id AND en.exercise_id = wl.exercise_id
    WHERE wl.user_id = ?
    ORDER BY muscle_group, e.name, log_date, wl.set_index, wl.id
  `, [userId]).map((row) => ({
    exerciseName: row.exercise_name,
    date: row.log_date,
    sets: row.set_index,
    kg: row.kg === null ? '' : Number(row.kg).toFixed(1),
    lb: row.lb === null ? '' : Number(row.lb).toFixed(1),
    reps: row.reps,
    note: row.note,
    muscleGroup: row.muscle_group
  }));
}

function parseExcelHtmlRows(content) {
  const rowMatches = [...String(content || '').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (rowMatches.length < 2) return [];
  const headerCells = [...rowMatches[0][1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => htmlUnescape(match[1].replace(/<[^>]+>/g, '')).trim());
  return rowMatches.slice(1).map((row) => {
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => htmlUnescape(match[1].replace(/<[^>]+>/g, '')).trim());
    return Object.fromEntries(headerCells.map((header, index) => [header, cells[index] || '']));
  });
}

function importExcelRows(userId, rows) {
  const settingColumns = new Set(all('PRAGMA table_info(user_settings)').map((column) => column.name));
  const payloads = rows.map((row) => {
    try {
      return row['Dữ liệu JSON'] ? { type: row['Loại dữ liệu'], data: JSON.parse(row['Dữ liệu JSON']) } : null;
    } catch {
      return null;
    }
  }).filter(Boolean);
  const counts = {};
  const bump = (key) => { counts[key] = (counts[key] || 0) + 1; };
  const tx = db.transaction(() => {
    for (const { type, data } of payloads) {
      if (type === 'Cài đặt') {
        const columns = Object.keys(data).filter((key) => key !== 'user_id' && settingColumns.has(key) && /^[a-z0-9_]+$/i.test(key));
        if (columns.length) {
          db.prepare(`UPDATE user_settings SET ${columns.map((key) => `"${key}" = ?`).join(', ')} WHERE user_id = ?`).run(...columns.map((key) => data[key]), userId);
          bump(type);
        }
      } else if (type === 'Người dùng') {
        db.prepare('UPDATE users SET name = ?, username = COALESCE(?, username), avatar = COALESCE(?, avatar) WHERE id = ?').run(data.name || data.username || 'User', data.username || null, data.avatar || null, userId);
        bump(type);
      } else if (type === 'Bài tập riêng') {
        db.prepare(`
          INSERT OR REPLACE INTO exercises (
            id, name, category, body_part, equipment, target, muscle_group,
            secondary_muscles_json, instructions_en, instruction_steps_json,
            image_path, gif_path, custom_user_id, is_custom, is_hidden, custom_icon, display_media, source_created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
        `).run(
          data.id, data.name, data.category || 'custom', data.body_part, data.equipment, data.target, data.muscle_group,
          data.secondary_muscles_json || '[]', data.instructions_en || '', data.instruction_steps_json || '[]',
          data.image_path || null, data.gif_path || null, userId, data.is_hidden ? 1 : 0, data.custom_icon || '🏋️', data.display_media || 'auto', data.source_created_at || null
        );
        bump(type);
      } else if (type === 'Group bài tập') {
        db.prepare('INSERT OR REPLACE INTO custom_groups (id, user_id, name, icon, color_hex, order_index, is_superset, superset_rounds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(data.id, userId, data.name, data.icon, data.color_hex, data.order_index || data.id || 1, data.is_superset || 0, data.superset_rounds || 1, data.created_at);
        bump(type);
      } else if (type === 'Bài trong group') {
        db.prepare('INSERT OR REPLACE INTO group_exercises (id, group_id, exercise_id, icon, order_index) VALUES (?, ?, ?, ?, ?)').run(data.id, data.group_id, data.exercise_id, data.icon, data.order_index);
        bump(type);
      } else if (type === 'Group buổi tập') {
        db.prepare('INSERT OR REPLACE INTO routines (id, user_id, name, color_hex, order_index, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(data.id, userId, data.name, data.color_hex, data.order_index || data.id || 1, data.created_at);
        bump(type);
      } else if (type === 'Group bài trong buổi') {
        db.prepare('INSERT OR REPLACE INTO routine_groups (id, routine_id, group_id, order_index, is_superset, superset_rounds) VALUES (?, ?, ?, ?, ?, ?)').run(data.id, data.routine_id, data.group_id, data.order_index, data.is_superset || 0, data.superset_rounds || 1);
        bump(type);
      } else if (type === 'Lịch tập') {
        db.prepare('INSERT OR REPLACE INTO routine_schedule_rules (id, user_id, routine_id, mode, day_of_week, order_index) VALUES (?, ?, ?, ?, ?, ?)').run(data.id, userId, data.routine_id, data.mode, data.day_of_week, data.order_index);
        bump(type);
      } else if (type === 'Buổi tập') {
        db.prepare('INSERT OR REPLACE INTO workout_sessions (id, user_id, routine_id, group_id, schedule_mode, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(data.id, userId, data.routine_id, data.group_id, data.schedule_mode, data.status, data.started_at, data.completed_at);
        bump(type);
      } else if (type === 'Set tập') {
        db.prepare('INSERT OR REPLACE INTO workout_logs (id, session_id, user_id, exercise_id, set_index, weight_kg, weight_unit, reps, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(data.id, data.session_id, userId, data.exercise_id, data.set_index, data.weight_kg, data.weight_unit || 'kg', data.reps, data.completed_at);
        bump(type);
      } else if (type === 'Ghi chú bài tập') {
        db.prepare('INSERT OR REPLACE INTO exercise_notes (user_id, exercise_id, note, target_sets, weight_mode, manual_weight_kg, default_reps, default_weight_kg, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(userId, data.exercise_id, data.note || '', data.target_sets || 3, data.weight_mode || 'KG', data.manual_weight_kg ?? null, data.default_reps ?? null, data.default_weight_kg ?? null, data.updated_at);
        bump(type);
      } else if (type === 'Cân nặng cơ thể') {
        db.prepare('INSERT OR REPLACE INTO body_weight_logs (id, user_id, weight, unit, logged_at) VALUES (?, ?, ?, ?, ?)').run(data.id, userId, data.weight, data.unit || 'kg', data.logged_at);
        bump(type);
      }
    }
  });
  tx();
  return counts;
}

function getRoutine(routineId, userId) {
  const routine = one('SELECT * FROM routines WHERE id = ? AND user_id = ?', [routineId, userId]);
  if (!routine) return null;

  const groups = all(`
    SELECT cg.*, rg.id AS routine_group_id, rg.order_index AS routine_group_order, rg.is_superset AS routine_is_superset, rg.superset_rounds AS routine_superset_rounds
    FROM routine_groups rg
    JOIN custom_groups cg ON cg.id = rg.group_id
    WHERE rg.routine_id = ?
    ORDER BY rg.order_index, cg.name
  `, [routineId]).map((group) => ({
    ...group,
    routineGroupId: group.routine_group_id,
    isSuperset: Boolean(group.routine_is_superset || group.is_superset),
    supersetRounds: Math.max(1, Number((group.routine_is_superset ? group.routine_superset_rounds : group.superset_rounds) || group.routine_superset_rounds || 1)),
    exercises: getGroupExercises(group.id)
  }));

  return {
    id: routine.id,
    userId: routine.user_id,
    name: routine.name,
    colorHex: routine.color_hex,
    groups,
    exercises: groups.flatMap((group) => group.exercises.map((exercise) => ({
      ...exercise,
      groupName: group.name,
      groupId: group.id,
      routineGroupId: group.routineGroupId,
      isSuperset: group.isSuperset,
      supersetRounds: group.supersetRounds
    })))
  };
}

function getGroupExercises(groupId) {
  return all(`
    SELECT e.*, ge.order_index, ge.icon AS group_icon
    FROM group_exercises ge
    JOIN exercises e ON e.id = ge.exercise_id
    WHERE ge.group_id = ?
    ORDER BY ge.order_index, e.name
  `, [groupId]).map((row) => ({ ...publicExercise(row), icon: row.group_icon || '🏋️' }));
}

function cleanupEmptyRoutines(userId) {
  db.prepare(`
    DELETE FROM routine_schedule_rules
    WHERE user_id = ?
      AND routine_id IN (
        SELECT id
        FROM routines
        WHERE user_id = ?
          AND id NOT IN (SELECT DISTINCT routine_id FROM routine_groups)
      )
  `).run(userId, userId);
  db.prepare(`
    DELETE FROM routines
    WHERE user_id = ?
      AND id NOT IN (SELECT DISTINCT routine_id FROM routine_groups)
  `).run(userId);
}

function getTodayDow() {
  const jsDay = new Date().getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

// Tính ISO date của ngày đầu chu kỳ tuần hiện tại theo resetDay (0=Mon..6=Sun)
function getWeekStartIso(resetDay = 0) {
  const today = new Date();
  const dow = getTodayDow(); // 0=Mon..6=Sun
  const reset = Math.max(0, Math.min(6, Number(resetDay) || 0));
  // diff = số ngày từ resetDay đến hôm nay (mod 7)
  const diff = (dow - reset + 7) % 7;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - diff);
  return start.toISOString().slice(0, 10);
}

function addDaysIso(value, days) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

// Lấy danh sách routine + count completed trong tuần hiện tại
function getRollingWeeklyStatus(userId) {
  const settings = one('SELECT * FROM user_settings WHERE user_id = ?', [userId]);
  const resetDay = Number(settings?.weekly_reset_day || 0);
  const naturalStart = getWeekStartIso(resetDay);
  const manualReset = settings?.weekly_last_reset_at || null;
  // Lấy mốc gần nhất (manual reset luôn ưu tiên nếu đứng sau natural week start)
  const weekStartIso = manualReset && String(manualReset) > naturalStart ? String(manualReset) : naturalStart;
  const weekEndIso = addDaysIso(weekStartIso, 7);
  // Lấy list routine_ids từ rolling rules (giữ ngữ nghĩa cũ)
  const rules = all(`
    SELECT routine_id FROM routine_schedule_rules
    WHERE user_id = ? AND mode = 'ROLLING'
    ORDER BY order_index
  `, [userId]);
  return rules.map((rule) => {
    const routine = getRoutine(rule.routine_id, userId);
    if (!routine) return null;
    // 1) Sessions tập trực tiếp routine này (routine_id match)
    const directRow = one(`
      SELECT COUNT(*) AS n FROM workout_sessions
      WHERE user_id = ? AND routine_id = ? AND status = 'COMPLETED'
        AND completed_at >= ?
        AND completed_at < ?
    `, [userId, rule.routine_id, weekStartIso, weekEndIso]);
    const directCount = Number(directRow?.n || 0);
    // 2) Coverage qua group sessions: với mỗi group thuộc routine,
    //    đếm số session COMPLETED có group_id đó trong tuần.
    //    Số "bouts" routine được cover = min(các group count).
    let groupCoverage = 0;
    const groups = routine.groups || [];
    if (groups.length > 0) {
      const counts = groups.map((g) => {
        const r = one(`
          SELECT COUNT(*) AS n FROM workout_sessions
          WHERE user_id = ? AND group_id = ? AND status = 'COMPLETED'
            AND completed_at >= ?
            AND completed_at < ?
        `, [userId, g.id, weekStartIso, weekEndIso]);
        return Number(r?.n || 0);
      });
      groupCoverage = Math.min(...counts);
    }
    // 3) Stats buổi tập trong tuần này (sets, volume)
    const thisWeekStats = one(`
      SELECT
        COUNT(DISTINCT ws.id) AS sessions,
        COALESCE(SUM(wl.reps), 0) AS total_reps,
        COALESCE(COUNT(wl.id), 0) AS total_sets,
        COALESCE(SUM(wl.weight_kg * wl.reps), 0) AS volume_kg,
        COALESCE(MAX(wl.weight_kg), 0) AS max_weight
      FROM workout_sessions ws
      LEFT JOIN workout_logs wl ON wl.session_id = ws.id AND wl.user_id = ws.user_id
      WHERE ws.user_id = ? AND ws.routine_id = ? AND ws.status = 'COMPLETED'
        AND ws.completed_at >= ? AND ws.completed_at < ?
    `, [userId, rule.routine_id, weekStartIso, weekEndIso]);

    // 4) Stats tuần trước để tính tăng/giảm
    const prevWeekStart = addDaysIso(weekStartIso, -7);
    const prevWeekStats = one(`
      SELECT
        COALESCE(SUM(wl.weight_kg * wl.reps), 0) AS volume_kg,
        COALESCE(COUNT(wl.id), 0) AS total_sets
      FROM workout_sessions ws
      LEFT JOIN workout_logs wl ON wl.session_id = ws.id AND wl.user_id = ws.user_id
      WHERE ws.user_id = ? AND ws.routine_id = ? AND ws.status = 'COMPLETED'
        AND ws.completed_at >= ? AND ws.completed_at < ?
    `, [userId, rule.routine_id, prevWeekStart, weekStartIso]);

    const thisVolume = Number(thisWeekStats?.volume_kg || 0);
    const prevVolume = Number(prevWeekStats?.volume_kg || 0);
    const volumeDiff = prevVolume > 0 ? Math.round(((thisVolume - prevVolume) / prevVolume) * 100) : null;

    // 5) Per-exercise breakdown trong tuần này
    const exerciseBreakdown = all(`
      SELECT
        e.id AS exercise_id,
        e.name AS exercise_name,
        COALESCE(e.gif_path, e.image_path) AS image_path,
        COUNT(wl.id) AS total_sets,
        COALESCE(SUM(wl.reps), 0) AS total_reps,
        COALESCE(SUM(wl.weight_kg * wl.reps), 0) AS volume_kg,
        COALESCE(MAX(wl.weight_kg), 0) AS max_weight
      FROM workout_logs wl
      JOIN exercises e ON e.id = wl.exercise_id
      JOIN workout_sessions ws ON ws.id = wl.session_id
      WHERE wl.user_id = ? AND ws.routine_id = ? AND ws.status = 'COMPLETED'
        AND ws.completed_at >= ? AND ws.completed_at < ?
      GROUP BY e.id
      ORDER BY volume_kg DESC
    `, [userId, rule.routine_id, weekStartIso, weekEndIso]).map((row) => ({
      id: row.exercise_id,
      name: row.exercise_name,
      imageUrl: row.image_path ? `/media/${row.image_path}` : null,
      totalSets: Number(row.total_sets || 0),
      totalReps: Number(row.total_reps || 0),
      volumeKg: Math.round(Number(row.volume_kg || 0)),
      maxWeight: Number(row.max_weight || 0)
    }));

    return {
      ...routine,
      completedCount: directCount + groupCoverage,
      directCount,
      groupCoverage,
      weekStartIso,
      weekEndIso,
      weekStats: {
        sessions: Number(thisWeekStats?.sessions || 0),
        totalSets: Number(thisWeekStats?.total_sets || 0),
        totalReps: Number(thisWeekStats?.total_reps || 0),
        volumeKg: Math.round(thisVolume),
        maxWeight: Number(thisWeekStats?.max_weight || 0),
        volumeDiffPct: volumeDiff,
        prevVolumeKg: Math.round(prevVolume),
        exercises: exerciseBreakdown
      }
    };
  }).filter(Boolean);
}

function getWeeklyWindow(userId) {
  const settings = one('SELECT * FROM user_settings WHERE user_id = ?', [userId]);
  const resetDay = Number(settings?.weekly_reset_day || 0);
  const weekStartIso = getWeekStartIso(resetDay);
  const weekEndIso = addDaysIso(weekStartIso, 7);
  return { weekStartIso, weekEndIso, resetDay };
}

function getWeeklyStats(userId) {
  const week = getWeeklyWindow(userId);
  const rows = all(`
    SELECT
      ws.id,
      ws.routine_id,
      ws.group_id,
      ws.schedule_mode,
      ws.started_at,
      ws.completed_at,
      CAST((julianday(ws.completed_at) - julianday(ws.started_at)) * 86400 AS INTEGER) AS duration_seconds,
      COALESCE(r.name, cg.name, 'Free workout') AS activity_name,
      r.name AS routine_name,
      cg.name AS group_name,
      COUNT(wl.id) AS sets,
      COUNT(DISTINCT wl.exercise_id) AS exercises,
      COALESCE(SUM(wl.reps), 0) AS reps,
      COALESCE(SUM(wl.weight_kg * wl.reps), 0) AS volume,
      (
        SELECT COALESCE(e.gif_path, e.image_path)
        FROM workout_logs wl2
        JOIN exercises e ON e.id = wl2.exercise_id
        WHERE wl2.session_id = ws.id
        ORDER BY wl2.set_index ASC, wl2.id ASC
        LIMIT 1
      ) AS image_path
    FROM workout_sessions ws
    LEFT JOIN routines r ON r.id = ws.routine_id
    LEFT JOIN custom_groups cg ON cg.id = ws.group_id
    LEFT JOIN workout_logs wl ON wl.session_id = ws.id
    WHERE ws.user_id = ? AND ws.status = 'COMPLETED'
      AND ws.completed_at >= ?
      AND ws.completed_at < ?
    GROUP BY ws.id
    ORDER BY ws.completed_at DESC
  `, [userId, week.weekStartIso, week.weekEndIso]).map((row) => ({
    ...row,
    imageUrl: assetUrl(row.image_path),
    duration_minutes: formatMinutes(row.duration_seconds)
  }));

  const byActivityMap = new Map();
  for (const row of rows) {
    const name = row.activity_name || row.routine_name || row.group_name || 'Free workout';
    const current = byActivityMap.get(name) || {
      name,
      sessions: 0,
      sets: 0,
      exercises: 0,
      minutes: 0,
      reps: 0,
      volume: 0,
      imageUrl: row.imageUrl || ''
    };
    current.sessions += 1;
    current.sets += Number(row.sets || 0);
    current.exercises += Number(row.exercises || 0);
    current.minutes += Number(row.duration_minutes || 0);
    current.reps += Number(row.reps || 0);
    current.volume += Number(row.volume || 0);
    if (!current.imageUrl && row.imageUrl) current.imageUrl = row.imageUrl;
    if (!current.sessionIds) current.sessionIds = [];
    current.sessionIds.push(row.id);
    byActivityMap.set(name, current);
  }

  // Per-exercise breakdown per activity
  for (const [, item] of byActivityMap) {
    if (!item.sessionIds?.length) continue;
    const placeholders = item.sessionIds.map(() => '?').join(',');
    const exRows = all(`
      SELECT e.id, e.name, e.target, e.muscle_group, e.secondary_muscles_json,
        COALESCE(e.gif_path, e.image_path) AS image_path,
        COUNT(wl.id) AS total_sets,
        COALESCE(SUM(wl.reps), 0) AS total_reps,
        COALESCE(SUM(wl.weight_kg * wl.reps), 0) AS volume_kg,
        COALESCE(MAX(wl.weight_kg), 0) AS max_weight
      FROM workout_logs wl
      JOIN exercises e ON e.id = wl.exercise_id
      WHERE wl.session_id IN (${placeholders}) AND wl.user_id = ?
      GROUP BY e.id
      ORDER BY volume_kg DESC
    `, [...item.sessionIds, userId]).map((r) => ({
      id: r.id, name: r.name,
      target: r.target,
      muscleGroup: r.muscle_group,
      secondaryMuscles: JSON.parse(r.secondary_muscles_json || '[]'),
      imageUrl: assetUrl(r.image_path),
      totalSets: Number(r.total_sets || 0),
      totalReps: Number(r.total_reps || 0),
      volumeKg: Math.round(Number(r.volume_kg || 0)),
      maxWeight: Number(r.max_weight || 0)
    }));
    item.exercises_detail = exRows;
    item.volume = Math.round(item.volume || 0);
    delete item.sessionIds;
  }

  const byDay = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(week.weekStartIso);
    date.setDate(date.getDate() + index);
    const day = date.toISOString().slice(0, 10);
    const dayRows = rows.filter((row) => String(row.completed_at || '').slice(0, 10) === day);
    return {
      day,
      sessions: dayRows.length,
      sets: dayRows.reduce((sum, row) => sum + Number(row.sets || 0), 0),
      exercises: dayRows.reduce((sum, row) => sum + Number(row.exercises || 0), 0),
      minutes: dayRows.reduce((sum, row) => sum + Number(row.duration_minutes || 0), 0),
      images: dayRows.map((row) => row.imageUrl).filter(Boolean).slice(0, 4)
    };
  });

  return {
    ...week,
    totalSessions: rows.length,
    totalSets: rows.reduce((sum, row) => sum + Number(row.sets || 0), 0),
    totalExercises: rows.reduce((sum, row) => sum + Number(row.exercises || 0), 0),
    totalMinutes: rows.reduce((sum, row) => sum + Number(row.duration_minutes || 0), 0),
    totalReps: rows.reduce((sum, row) => sum + Number(row.reps || 0), 0),
    totalVolume: Math.round(rows.reduce((sum, row) => sum + Number(row.volume || 0), 0)),
    activities: rows.slice(0, 12),
    byActivity: [...byActivityMap.values()].sort((a, b) => b.sessions - a.sessions || b.sets - a.sets).slice(0, 8),
    byDay
  };
}

function publicUser(user) {
  return user ? { id: user.id, name: user.name, username: user.username, avatar: user.avatar, role: user.role, authVersion: authVersion(user.password_hash) } : null;
}

function assertAdmin(userId) {
  const user = one('SELECT role FROM users WHERE id = ?', [userId]);
  if (!user || user.role !== 'ADMIN') {
    const error = new Error('Chỉ admin mới được thực hiện thao tác này');
    error.status = 403;
    throw error;
  }
}

function formatMinutes(seconds) {
  return Math.max(1, Math.round(Number(seconds || 0) / 60));
}

function advanceRollingSchedule(userId) {
  const settings = one('SELECT * FROM user_settings WHERE user_id = ?', [userId]);
  const maxIndex = one("SELECT COALESCE(MAX(order_index), 0) AS max_index FROM routine_schedule_rules WHERE user_id = ? AND mode = 'ROLLING'", [userId]).max_index;
  if (settings && maxIndex > 0) {
    const nextIndex = settings.current_rolling_index >= maxIndex ? 1 : settings.current_rolling_index + 1;
    db.prepare('UPDATE user_settings SET current_rolling_index = ? WHERE user_id = ?').run(nextIndex, userId);
  }
}

function cleanupStaleActiveSessions(userId) {
  const staleSessions = all(`
    SELECT ws.*, COUNT(wl.id) AS log_count, MAX(wl.completed_at) AS last_log_at
    FROM workout_sessions ws
    LEFT JOIN workout_logs wl ON wl.session_id = ws.id AND wl.user_id = ws.user_id
    WHERE ws.user_id = ?
      AND ws.status = 'ACTIVE'
      AND date(ws.started_at, 'localtime') < date('now', 'localtime')
    GROUP BY ws.id
    ORDER BY ws.started_at ASC
  `, [userId]);

  if (!staleSessions.length) return { completed: 0, deleted: 0 };

  const summary = { completed: 0, deleted: 0 };
  const tx = db.transaction(() => {
    for (const session of staleSessions) {
      if (Number(session.log_count || 0) > 0 && session.last_log_at) {
        db.prepare(`
          UPDATE workout_sessions
          SET status = 'COMPLETED', completed_at = ?
          WHERE id = ? AND user_id = ? AND status = 'ACTIVE'
        `).run(session.last_log_at, session.id, userId);
        // Weekly Goal: không advance, chỉ đếm completed_at trong tuần
        summary.completed += 1;
      } else {
        db.prepare('DELETE FROM workout_sessions WHERE id = ? AND user_id = ? AND status = \'ACTIVE\'').run(session.id, userId);
        summary.deleted += 1;
      }
    }
  });
  tx();
  return summary;
}

function smartSuggestion(userId) {
  const settings = one('SELECT * FROM user_settings WHERE user_id = ?', [userId]);
  if (!settings || settings.schedule_mode !== 'FIXED') {
    return { mode: 'FREE', title: 'Tập tự do', routine: null };
  }

  if (settings.schedule_mode === 'FIXED') {
    const dow = getTodayDow();
    const rule = one(`
      SELECT * FROM routine_schedule_rules
      WHERE user_id = ? AND mode = 'FIXED' AND day_of_week = ?
    `, [userId, dow]);
    return {
      mode: 'FIXED',
      dayOfWeek: dow,
      title: rule ? 'Buổi tập hôm nay' : 'Hôm nay chưa gán lịch',
      routine: rule ? getRoutine(rule.routine_id, userId) : null
    };
  }

  const rule = one(`
    SELECT * FROM routine_schedule_rules
    WHERE user_id = ? AND mode = 'ROLLING' AND order_index = ?
  `, [userId, settings.current_rolling_index]);

  // Weekly Goal mode: trả về danh sách routines + completedCount
  const weekly = getRollingWeeklyStatus(userId);
  const total = weekly.length;
  const done = weekly.filter((r) => r.completedCount > 0).length;
  return {
    mode: 'ROLLING',
    weekly,
    weeklyResetDay: Number(settings.weekly_reset_day || 0),
    title: total === 0 ? 'Chưa có buổi nào trong tuần' : `${done}/${total} buổi tập tuần này`,
    // Backward compat
    rollingIndex: settings.current_rolling_index,
    routine: rule ? getRoutine(rule.routine_id, userId) : null
  };
}

function healthResponse(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  if (req.method === 'HEAD') return res.status(204).end();
  res.json({ ok: true, serverTime: new Date().toISOString() });
}

app.head('/api/health', healthResponse);
app.get('/api/health', healthResponse);

app.get('/api/events', (req, res) => {
  const userId = getUserId(req);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx buffering
  res.flushHeaders();
  res.write(':connected\n\n');

  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId).add(res);

  const heartbeat = setInterval(() => { try { res.write(':heartbeat\n\n'); } catch {} }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.get(userId)?.delete(res);
    if (sseClients.get(userId)?.size === 0) sseClients.delete(userId);
  });
});

app.get('/api/bootstrap', (req, res) => {
  const userId = getUserId(req);
  cleanupStaleActiveSessions(userId);
  const users = all('SELECT id, name, username, avatar, role, password_hash FROM users ORDER BY id');
  const activeUser = users.find((user) => user.id === userId);
  if (!activeUser) return res.status(404).json({ error: 'User not found' });
  const settings = one('SELECT * FROM user_settings WHERE user_id = ?', [userId]);
  const exerciseCount = one('SELECT COUNT(*) AS total FROM exercises').total;
  res.json({
    users: users.map(publicUser),
    activeUser: publicUser(activeUser),
    settings,
    exerciseCount,
    suggestion: smartSuggestion(userId)
  });
});

app.post('/api/login', (req, res) => {
  requireBody(['username', 'password'], req.body);
  const user = one('SELECT * FROM users WHERE username = ?', [req.body.username.trim()]);
  if (!user || !verifyPassword(req.body.password, user.password_hash)) {
    return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
  }
  res.json({ user: publicUser(user) });
});

app.post('/api/users', (req, res) => {
  assertAdmin(getUserId(req));
  requireBody(['name', 'username', 'password'], req.body);
  const initials = req.body.name.trim().slice(0, 2).toUpperCase();
  try {
    const result = db.prepare('INSERT INTO users (name, username, password_hash, role, avatar) VALUES (?, ?, ?, ?, ?)').run(
      req.body.name.trim(),
      req.body.username.trim(),
      hashPassword(req.body.password),
      'MEMBER',
      initials
    );
    db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(result.lastInsertRowid);
    res.status(201).json({ id: result.lastInsertRowid, name: req.body.name.trim(), username: req.body.username.trim(), avatar: initials });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'Tên đăng nhập đã tồn tại' });
    throw error;
  }
});

app.delete('/api/users/:id', (req, res) => {
  const requesterId = getUserId(req);
  const targetId = Number(req.params.id);
  assertAdmin(requesterId);
  if (requesterId === targetId) return res.status(400).json({ error: 'Admin không thể tự xoá chính mình' });
  db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  res.json({ ok: true });
});

app.patch('/api/users/:id', (req, res) => {
  const requesterId = getUserId(req);
  const targetId = Number(req.params.id);
  if (requesterId !== targetId) assertAdmin(requesterId);

  if (req.body.name) {
    const initials = req.body.name.trim().slice(0, 2).toUpperCase();
    const current = one('SELECT avatar FROM users WHERE id = ?', [targetId]);
    const nextAvatar = current?.avatar?.startsWith('data:') || current?.avatar?.startsWith('/uploads/') ? current.avatar : initials;
    db.prepare('UPDATE users SET name = ?, avatar = ? WHERE id = ?').run(req.body.name.trim(), nextAvatar, targetId);
  }
  if (req.body.password) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.password), targetId);
  }
  if (req.body.avatar !== undefined) {
    if (typeof req.body.avatar !== 'string' || req.body.avatar.length > 2_000_000) {
      return res.status(400).json({ error: 'Avatar không hợp lệ hoặc quá lớn' });
    }
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(req.body.avatar || null, targetId);
  }
  res.json(publicUser(one('SELECT * FROM users WHERE id = ?', [targetId])));
});

app.patch('/api/settings', (req, res) => {
  const userId = getUserId(req);
  const updates = [];
  const params = [];
  const addUpdate = (column, value) => {
    updates.push(`${column} = ?`);
    params.push(value);
  };
  const normalizeWeightSteps = (value, unit) => {
    const source = Array.isArray(value) ? value : [];
    const max = unit === 'lb' ? 1000 : 500;
    const step = unit === 'lb' ? 0.5 : 0.25;
    const list = [...new Set(source
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item >= 0 && item <= max)
      .map((item) => Number((Math.round(item / step) * step).toFixed(2))))].sort((a, b) => a - b);
    if (!list.includes(0)) list.unshift(0);
    return JSON.stringify(list.slice(0, 250));
  };

  if (req.body.scheduleMode !== undefined) {
    if (!['FREE', 'FIXED'].includes(req.body.scheduleMode)) {
      return res.status(400).json({ error: 'Invalid scheduleMode' });
    }
    addUpdate('schedule_mode', req.body.scheduleMode);
  }

  if (req.body.timezone !== undefined) {
    if (typeof req.body.timezone !== 'string' || req.body.timezone.length > 80) {
      return res.status(400).json({ error: 'Invalid timezone' });
    }
    addUpdate('timezone', req.body.timezone);
  }

  if (req.body.locale !== undefined) {
    if (typeof req.body.locale !== 'string' || req.body.locale.length > 20) {
      return res.status(400).json({ error: 'Invalid locale' });
    }
    addUpdate('locale', req.body.locale);
  }

  if (req.body.heightCm !== undefined) {
    const heightCm = req.body.heightCm === null || req.body.heightCm === '' ? null : Number(req.body.heightCm);
    if (heightCm !== null && (!Number.isFinite(heightCm) || heightCm < 50 || heightCm > 260)) {
      return res.status(400).json({ error: 'Invalid heightCm' });
    }
    addUpdate('height_cm', heightCm);
  }

  if (req.body.defaultWeightUnit !== undefined) {
    if (!['kg', 'lb'].includes(req.body.defaultWeightUnit)) {
      return res.status(400).json({ error: 'Invalid defaultWeightUnit' });
    }
    addUpdate('default_weight_unit', req.body.defaultWeightUnit);
  }

  if (req.body.gender !== undefined) addUpdate('gender', req.body.gender || null);
  if (req.body.birthDate !== undefined) addUpdate('birth_date', req.body.birthDate || null);
  if (req.body.heightUnit !== undefined && ['cm', 'ft-in'].includes(req.body.heightUnit)) addUpdate('height_unit', req.body.heightUnit);
  if (req.body.weeklyResetDay !== undefined) addUpdate('weekly_reset_day', Math.max(0, Math.min(6, Number(req.body.weeklyResetDay || 0))));
  if (req.body.distanceUnit !== undefined && ['km', 'mile'].includes(req.body.distanceUnit)) addUpdate('distance_unit', req.body.distanceUnit);
  if (req.body.energyUnit !== undefined && ['kcal', 'kJ'].includes(req.body.energyUnit)) addUpdate('energy_unit', req.body.energyUnit);
  if (req.body.clockFormat !== undefined && ['12h', '24h'].includes(req.body.clockFormat)) addUpdate('clock_format', req.body.clockFormat);
  if (req.body.defaultSets !== undefined) addUpdate('default_sets', Math.max(1, Math.min(20, Number(req.body.defaultSets || 3))));
  if (req.body.defaultReps !== undefined) addUpdate('default_reps', Math.max(1, Math.min(100, Number(req.body.defaultReps || 12))));
  if (req.body.weightStepsKg !== undefined) addUpdate('weight_steps_kg', normalizeWeightSteps(req.body.weightStepsKg, 'kg'));
  if (req.body.weightStepsLb !== undefined) addUpdate('weight_steps_lb', normalizeWeightSteps(req.body.weightStepsLb, 'lb'));
  if (req.body.restSeconds !== undefined) addUpdate('rest_seconds', Math.max(10, Math.min(600, Number(req.body.restSeconds || 60))));
  if (req.body.notifyWorkoutTime !== undefined && /^\d{2}:\d{2}$/.test(req.body.notifyWorkoutTime)) addUpdate('notify_workout_time', req.body.notifyWorkoutTime);
  if (req.body.notifyMissedWorkoutTime !== undefined && /^\d{2}:\d{2}$/.test(req.body.notifyMissedWorkoutTime)) addUpdate('notify_missed_workout_time', req.body.notifyMissedWorkoutTime);
  if (req.body.notifyUnfinishedAfterMinutes !== undefined) addUpdate('notify_unfinished_after_minutes', Math.max(15, Math.min(720, Number(req.body.notifyUnfinishedAfterMinutes || 180))));
  if (req.body.notifyWeighFrequency !== undefined && ['off', 'daily', 'weekly'].includes(req.body.notifyWeighFrequency)) addUpdate('notify_weigh_frequency', req.body.notifyWeighFrequency);
  if (req.body.notifyWeighTime !== undefined && /^\d{2}:\d{2}$/.test(req.body.notifyWeighTime)) addUpdate('notify_weigh_time', req.body.notifyWeighTime);
  if (req.body.notifyProgressPhotoFrequency !== undefined && ['off', 'weekly', 'monthly'].includes(req.body.notifyProgressPhotoFrequency)) addUpdate('notify_progress_photo_frequency', req.body.notifyProgressPhotoFrequency);
  const booleanMap = {
    progressiveOverload: 'progressive_overload',
    soundRestDone: 'sound_rest_done',
    vibrateRestDone: 'vibrate_rest_done',
    notifyRestDone: 'notify_rest_done',
    countdown3s: 'countdown_3s',
    autoNextSet: 'auto_next_set',
    keepScreenAwake: 'keep_screen_awake',
    notifyWorkout: 'notify_workout',
    notifyWeigh: 'notify_weigh',
    notifyProgressPhoto: 'notify_progress_photo',
    notifyWater: 'notify_water',
    notifyRecovery: 'notify_recovery',
    notifyMissedWorkout: 'notify_missed_workout',
    privacyPinLock: 'privacy_pin_lock',
    privacyHideProgressPhotos: 'privacy_hide_progress_photos'
  };
  for (const [bodyKey, column] of Object.entries(booleanMap)) {
    if (req.body[bodyKey] !== undefined) addUpdate(column, req.body[bodyKey] ? 1 : 0);
  }
  if (req.body.themeMode !== undefined && ['light', 'dark'].includes(req.body.themeMode)) addUpdate('theme_mode', req.body.themeMode);
  if (req.body.primaryColor !== undefined && /^#[0-9a-fA-F]{6}$/.test(req.body.primaryColor)) addUpdate('primary_color', req.body.primaryColor);

  if (updates.length) {
    params.push(userId);
    db.prepare(`UPDATE user_settings SET ${updates.join(', ')} WHERE user_id = ?`).run(...params);
  }
  res.json(one('SELECT * FROM user_settings WHERE user_id = ?', [userId]));
});

app.get('/api/exercises', (req, res) => {
  const userId = getUserId(req);
  const rawSearch = String(req.query.q || '').trim();
  const search = `%${rawSearch}%`;
  const normalizedSearch = rawSearch.toLocaleLowerCase('vi-VN');
  const target = req.query.target;
  const params = [userId];
  const where = ['COALESCE(is_hidden, 0) = 0', '(custom_user_id IS NULL OR custom_user_id = ?)'];
  if (req.query.q && /^[\x00-\x7F]+$/.test(rawSearch)) {
    where.push('(name LIKE ? OR equipment LIKE ? OR target LIKE ? OR body_part LIKE ?)');
    params.push(search, search, search, search);
  }
  if (target) {
    where.push('target = ?');
    params.push(target);
  }
  const rows = all(`
    SELECT * FROM exercises
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY is_custom DESC, name
  `, params);
  const filteredRows = rawSearch
    ? rows.filter((row) => {
        const translation = getExerciseTranslation(row.id);
        const text = [
          row.name,
          row.equipment,
          row.target,
          row.body_part,
          translation?.nameVi,
          translation?.bodyPartVi,
          translation?.equipmentVi,
          translation?.targetVi,
          translation?.muscleGroupVi,
          translation?.searchVi,
          ...(translation?.quickSearchVi || [])
        ].join(' ').toLocaleLowerCase('vi-VN');
        return text.includes(normalizedSearch);
      })
    : rows;
  res.json(filteredRows.map(publicExercise));
});

app.get('/api/exercises/meta', (req, res) => {
  const userId = getUserId(req);
  const visibleRows = all('SELECT id, target, equipment, body_part FROM exercises WHERE COALESCE(is_hidden, 0) = 0 AND (custom_user_id IS NULL OR custom_user_id = ?) ORDER BY name', [userId]);
  const translated = visibleRows.map((row) => ({ row, translation: getExerciseTranslation(row.id) }));
  res.json({
    targets: [...new Set(visibleRows.map((r) => r.target).filter(Boolean))].sort(),
    equipment: [...new Set(visibleRows.map((r) => r.equipment).filter(Boolean))].sort(),
    bodyParts: [...new Set(visibleRows.map((r) => r.body_part).filter(Boolean))].sort(),
    targetsVi: [...new Set(translated.map(({ translation }) => translation?.targetVi).filter(Boolean))].sort(),
    equipmentVi: [...new Set(translated.map(({ translation }) => translation?.equipmentVi).filter(Boolean))].sort(),
    bodyPartsVi: [...new Set(translated.map(({ translation }) => translation?.bodyPartVi).filter(Boolean))].sort(),
    quickSearchVi: [
      'ngực',
      'lưng',
      'xô',
      'vai',
      'tay trước',
      'tay sau',
      'cẳng tay',
      'chân',
      'đùi trước',
      'đùi sau',
      'mông',
      'bắp chân',
      'bụng',
      'tim mạch',
      'giãn cơ',
      'thanh đòn',
      'tạ đơn',
      'cáp',
      'máy',
      'dây kháng lực',
      'trọng lượng cơ thể'
    ]
  });
});

function normalizeCustomExerciseBody(req, existing = {}) {
  requireBody(['name', 'target', 'equipment'], req.body);
  const steps = Array.isArray(req.body.steps)
    ? req.body.steps.map((step) => String(step || '').trim()).filter(Boolean)
    : String(req.body.instructions || '').split(/\n+/).map((step) => step.trim()).filter(Boolean);
  const secondary = Array.isArray(req.body.secondaryMuscles)
    ? req.body.secondaryMuscles
    : String(req.body.secondaryMuscles || '').split(',').map((item) => item.trim()).filter(Boolean);
  return {
    name: String(req.body.name).trim(),
    category: 'custom',
    body_part: String(req.body.bodyPart || req.body.target || '').trim(),
    equipment: String(req.body.equipment || '').trim(),
    target: String(req.body.target || '').trim(),
    muscle_group: String(req.body.muscleGroup || req.body.target || '').trim(),
    secondary_muscles_json: JSON.stringify(secondary),
    instructions_en: String(req.body.instructions || steps.join('\n') || '').trim(),
    instruction_steps_json: JSON.stringify(steps),
    custom_icon: String(req.body.customIcon || existing.custom_icon || '🏋️').slice(0, 8),
    display_media: ['auto', 'image', 'gif', 'icon'].includes(req.body.displayMedia) ? req.body.displayMedia : (existing.display_media || 'auto'),
    image_path: req.body.imageDataUrl !== undefined ? saveUploadedDataUrl(req.body.imageDataUrl, 'image') : existing.image_path,
    gif_path: req.body.gifDataUrl !== undefined ? saveUploadedDataUrl(req.body.gifDataUrl, 'gif') : existing.gif_path
  };
}

app.post('/api/exercises/custom', (req, res) => {
  const userId = getUserId(req);
  const data = normalizeCustomExerciseBody(req);
  const id = `custom-${userId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  db.prepare(`
    INSERT INTO exercises (
      id, name, category, body_part, equipment, target, muscle_group,
      secondary_muscles_json, instructions_en, instruction_steps_json,
      image_path, gif_path, custom_user_id, is_custom, is_hidden, custom_icon, display_media
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
  `).run(
    id, data.name, data.category, data.body_part, data.equipment, data.target, data.muscle_group,
    data.secondary_muscles_json, data.instructions_en, data.instruction_steps_json,
    data.image_path, data.gif_path, userId, data.custom_icon, data.display_media
  );
  res.status(201).json(publicExercise(one('SELECT * FROM exercises WHERE id = ?', [id])));
});

app.patch('/api/exercises/:id/custom', (req, res) => {
  const userId = getUserId(req);
  const current = one('SELECT * FROM exercises WHERE id = ? AND custom_user_id = ? AND is_custom = 1', [req.params.id, userId]);
  if (!current) return res.status(404).json({ error: 'Không tìm thấy bài tập tự tạo' });
  const data = normalizeCustomExerciseBody(req, current);
  db.prepare(`
    UPDATE exercises
    SET name = ?, body_part = ?, equipment = ?, target = ?, muscle_group = ?,
        secondary_muscles_json = ?, instructions_en = ?, instruction_steps_json = ?,
        image_path = ?, gif_path = ?, custom_icon = ?, display_media = ?
    WHERE id = ? AND custom_user_id = ?
  `).run(
    data.name, data.body_part, data.equipment, data.target, data.muscle_group,
    data.secondary_muscles_json, data.instructions_en, data.instruction_steps_json,
    data.image_path, data.gif_path, data.custom_icon, data.display_media, req.params.id, userId
  );
  res.json(publicExercise(one('SELECT * FROM exercises WHERE id = ?', [req.params.id])));
});

app.delete('/api/exercises/:id/custom', (req, res) => {
  const userId = getUserId(req);
  const current = one('SELECT * FROM exercises WHERE id = ? AND custom_user_id = ? AND is_custom = 1', [req.params.id, userId]);
  if (!current) return res.status(404).json({ error: 'Không tìm thấy bài tập tự tạo' });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM group_exercises WHERE exercise_id = ? AND group_id IN (SELECT id FROM custom_groups WHERE user_id = ?)').run(req.params.id, userId);
    db.prepare('UPDATE exercises SET is_hidden = 1 WHERE id = ? AND custom_user_id = ?').run(req.params.id, userId);
  });
  tx();
  res.json({ ok: true });
});

app.get('/api/groups', (req, res) => {
  const userId = getUserId(req);
  const groups = all('SELECT * FROM custom_groups WHERE user_id = ? ORDER BY order_index, id', [userId]).map((group) => ({
    id: group.id,
    name: group.name,
    icon: group.icon,
    colorHex: group.color_hex,
    isSuperset: Boolean(group.is_superset),
    supersetRounds: Math.max(1, Number(group.superset_rounds || 1)),
    exercises: getGroupExercises(group.id)
  }));
  res.json(groups);
});

app.post('/api/groups', (req, res) => {
  const userId = getUserId(req);
  requireBody(['name'], req.body);
  const result = db.prepare('INSERT INTO custom_groups (user_id, name, icon, color_hex, is_superset, superset_rounds) VALUES (?, ?, ?, ?, ?, ?)').run(userId, req.body.name.trim(), req.body.icon || '\u{1F4AA}', req.body.colorHex || '#78e0a6', req.body.isSuperset ? 1 : 0, Math.max(1, Math.min(20, Number(req.body.supersetRounds || 1))));
  const nextOrder = one('SELECT COALESCE(MAX(order_index), 0) + 1 AS next_order FROM custom_groups WHERE user_id = ? AND id <> ?', [userId, result.lastInsertRowid]).next_order;
  db.prepare('UPDATE custom_groups SET order_index = ? WHERE id = ? AND user_id = ?').run(nextOrder, result.lastInsertRowid, userId);
  res.status(201).json({ id: result.lastInsertRowid });
});

app.patch('/api/groups-order', (req, res) => {
  const userId = getUserId(req);
  const groupIds = Array.isArray(req.body.groupIds) ? req.body.groupIds.map(Number).filter(Boolean) : [];
  if (!groupIds.length) return res.status(400).json({ error: 'Missing groupIds' });
  const owned = new Set(all('SELECT id FROM custom_groups WHERE user_id = ?', [userId]).map((row) => Number(row.id)));
  if (groupIds.some((groupId) => !owned.has(groupId))) return res.status(404).json({ error: 'Group not found' });
  const update = db.prepare('UPDATE custom_groups SET order_index = ? WHERE id = ? AND user_id = ?');
  const tx = db.transaction(() => {
    groupIds.forEach((groupId, index) => update.run(index + 1, groupId, userId));
  });
  tx();
  res.json({ ok: true });
});

app.patch('/api/groups/:id', (req, res) => {
  const userId = getUserId(req);
  const groupId = Number(req.params.id);
  const group = one('SELECT * FROM custom_groups WHERE id = ? AND user_id = ?', [groupId, userId]);
  if (!group) return res.status(404).json({ error: 'Không tìm thấy Group Bài tập' });
  const name = req.body.name === undefined ? group.name : (req.body.name || group.name);
  const icon = req.body.icon === undefined ? group.icon : (req.body.icon || group.icon);
  const isSuperset = req.body.isSuperset === undefined ? group.is_superset : (req.body.isSuperset ? 1 : 0);
  const rounds = req.body.supersetRounds === undefined ? group.superset_rounds : Math.max(1, Math.min(20, Number(req.body.supersetRounds || 1)));
  const tx = db.transaction(() => {
    db.prepare('UPDATE custom_groups SET name = ?, icon = ?, is_superset = ?, superset_rounds = ? WHERE id = ? AND user_id = ?').run(name, icon, isSuperset, rounds, groupId, userId);
    db.prepare('UPDATE routine_groups SET is_superset = ?, superset_rounds = ? WHERE group_id = ? AND routine_id IN (SELECT id FROM routines WHERE user_id = ?)').run(isSuperset, rounds, groupId, userId);
  });
  tx();
  res.json({ ok: true });
});

app.delete('/api/groups/:id', (req, res) => {
  const userId = getUserId(req);
  const groupId = Number(req.params.id);
  const group = one('SELECT id FROM custom_groups WHERE id = ? AND user_id = ?', [groupId, userId]);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM group_exercises WHERE group_id = ?').run(groupId);
    db.prepare('DELETE FROM routine_groups WHERE group_id = ?').run(groupId);
    db.prepare('DELETE FROM custom_groups WHERE id = ? AND user_id = ?').run(groupId, userId);
    cleanupEmptyRoutines(userId);
  });
  tx();
  res.json({ ok: true });
});

app.post('/api/groups/:id/exercises', (req, res) => {
  requireBody(['exerciseId'], req.body);
  const groupId = Number(req.params.id);
  const nextOrder = one('SELECT COALESCE(MAX(order_index), 0) + 1 AS next_order FROM group_exercises WHERE group_id = ?', [groupId]).next_order;
  db.prepare('INSERT OR IGNORE INTO group_exercises (group_id, exercise_id, icon, order_index) VALUES (?, ?, ?, ?)').run(groupId, req.body.exerciseId, req.body.icon || '🏋️', nextOrder);
  res.status(201).json({ ok: true });
});

app.patch('/api/groups/:id/exercises-order', (req, res) => {
  const userId = getUserId(req);
  const groupId = Number(req.params.id);
  const exerciseIds = Array.isArray(req.body.exerciseIds) ? req.body.exerciseIds.map(String) : [];
  const group = one('SELECT id FROM custom_groups WHERE id = ? AND user_id = ?', [groupId, userId]);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!exerciseIds.length) return res.status(400).json({ error: 'Missing exerciseIds' });

  const update = db.prepare('UPDATE group_exercises SET order_index = ? WHERE group_id = ? AND exercise_id = ?');
  const tx = db.transaction(() => {
    exerciseIds.forEach((exerciseId, index) => update.run(index + 1, groupId, exerciseId));
  });
  tx();
  res.json({ ok: true });
});

app.patch('/api/groups/:groupId/exercises/:exerciseId', (req, res) => {
  const userId = getUserId(req);
  const groupId = Number(req.params.groupId);
  const exerciseId = req.params.exerciseId;
  const group = one('SELECT id FROM custom_groups WHERE id = ? AND user_id = ?', [groupId, userId]);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (req.body.icon !== undefined) {
    db.prepare('UPDATE group_exercises SET icon = ? WHERE group_id = ? AND exercise_id = ?').run(req.body.icon || '🏋️', groupId, exerciseId);
  }
  if (req.body.direction) {
    const current = one('SELECT * FROM group_exercises WHERE group_id = ? AND exercise_id = ?', [groupId, exerciseId]);
    if (current) {
      const op = req.body.direction === 'up' ? '<' : '>';
      const sort = req.body.direction === 'up' ? 'DESC' : 'ASC';
      const other = one(`SELECT * FROM group_exercises WHERE group_id = ? AND order_index ${op} ? ORDER BY order_index ${sort} LIMIT 1`, [groupId, current.order_index]);
      if (other) {
        const tx = db.transaction(() => {
          db.prepare('UPDATE group_exercises SET order_index = ? WHERE id = ?').run(other.order_index, current.id);
          db.prepare('UPDATE group_exercises SET order_index = ? WHERE id = ?').run(current.order_index, other.id);
        });
        tx();
      }
    }
  }
  res.json({ ok: true });
});

app.delete('/api/groups/:groupId/exercises/:exerciseId', (req, res) => {
  const userId = getUserId(req);
  const groupId = Number(req.params.groupId);
  const group = one('SELECT id FROM custom_groups WHERE id = ? AND user_id = ?', [groupId, userId]);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  db.prepare('DELETE FROM group_exercises WHERE group_id = ? AND exercise_id = ?').run(groupId, req.params.exerciseId);
  res.json({ ok: true });
});

app.get('/api/routines', (req, res) => {
  const userId = getUserId(req);
  const routines = all('SELECT id FROM routines WHERE user_id = ? ORDER BY order_index, id', [userId]).map((row) => getRoutine(row.id, userId));
  const rules = all(`
    SELECT rsr.*, r.name AS routine_name
    FROM routine_schedule_rules rsr
    JOIN routines r ON r.id = rsr.routine_id
    WHERE rsr.user_id = ?
    ORDER BY rsr.mode, COALESCE(rsr.day_of_week, rsr.order_index)
  `, [userId]);
  res.json({ routines, rules });
});

app.post('/api/routines', (req, res) => {
  const userId = getUserId(req);
  requireBody(['name'], req.body);
  const result = db.prepare('INSERT INTO routines (user_id, name, color_hex) VALUES (?, ?, ?)').run(userId, req.body.name.trim(), req.body.colorHex || '#c8ff2e');
  const nextOrder = one('SELECT COALESCE(MAX(order_index), 0) + 1 AS next_order FROM routines WHERE user_id = ? AND id <> ?', [userId, result.lastInsertRowid]).next_order;
  db.prepare('UPDATE routines SET order_index = ? WHERE id = ? AND user_id = ?').run(nextOrder, result.lastInsertRowid, userId);
  const addGroup = db.prepare('INSERT OR IGNORE INTO routine_groups (routine_id, group_id, order_index, is_superset, superset_rounds) VALUES (?, ?, ?, ?, ?)');
  (req.body.groupIds || []).forEach((groupId, index) => addGroup.run(result.lastInsertRowid, groupId, index + 1, 0, 1));
  res.status(201).json(getRoutine(result.lastInsertRowid, userId));
});

app.patch('/api/routines-order', (req, res) => {
  const userId = getUserId(req);
  const routineIds = Array.isArray(req.body.routineIds) ? req.body.routineIds.map(Number).filter(Boolean) : [];
  if (!routineIds.length) return res.status(400).json({ error: 'Missing routineIds' });
  const owned = new Set(all('SELECT id FROM routines WHERE user_id = ?', [userId]).map((row) => Number(row.id)));
  if (routineIds.some((routineId) => !owned.has(routineId))) return res.status(404).json({ error: 'Routine not found' });
  const update = db.prepare('UPDATE routines SET order_index = ? WHERE id = ? AND user_id = ?');
  const tx = db.transaction(() => {
    routineIds.forEach((routineId, index) => update.run(index + 1, routineId, userId));
  });
  tx();
  res.json({ ok: true });
});

app.delete('/api/routines/:id', (req, res) => {
  const userId = getUserId(req);
  const routineId = Number(req.params.id);
  const routine = one('SELECT id FROM routines WHERE id = ? AND user_id = ?', [routineId, userId]);
  if (!routine) return res.status(404).json({ error: 'Routine not found' });

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM routine_schedule_rules WHERE routine_id = ? AND user_id = ?').run(routineId, userId);
    db.prepare('DELETE FROM routine_groups WHERE routine_id = ?').run(routineId);
    db.prepare('DELETE FROM routines WHERE id = ? AND user_id = ?').run(routineId, userId);
  });
  tx();
  res.json({ ok: true });
});

app.post('/api/routines/:id/groups', (req, res) => {
  const userId = getUserId(req);
  const routineId = Number(req.params.id);
  const groupId = Number(req.body.groupId);
  const routine = one('SELECT id FROM routines WHERE id = ? AND user_id = ?', [routineId, userId]);
  const group = one('SELECT id FROM custom_groups WHERE id = ? AND user_id = ?', [groupId, userId]);
  if (!routine) return res.status(404).json({ error: 'Routine not found' });
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const nextOrder = one('SELECT COALESCE(MAX(order_index), 0) + 1 AS next_order FROM routine_groups WHERE routine_id = ?', [routineId]).next_order;
  db.prepare('INSERT OR IGNORE INTO routine_groups (routine_id, group_id, order_index, is_superset, superset_rounds) VALUES (?, ?, ?, ?, ?)').run(routineId, groupId, nextOrder, req.body.isSuperset ? 1 : 0, Math.max(1, Math.min(20, Number(req.body.supersetRounds || 1))));
  res.status(201).json(getRoutine(routineId, userId));
});

app.delete('/api/routines/:routineId/groups/:groupId', (req, res) => {
  const userId = getUserId(req);
  const routineId = Number(req.params.routineId);
  const groupId = Number(req.params.groupId);
  const routine = one('SELECT id FROM routines WHERE id = ? AND user_id = ?', [routineId, userId]);
  if (!routine) return res.status(404).json({ error: 'Routine not found' });

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM routine_groups WHERE routine_id = ? AND group_id = ?').run(routineId, groupId);
    cleanupEmptyRoutines(userId);
  });
  tx();
  res.json({ ok: true });
});

app.patch('/api/routines/:routineId/groups/:groupId', (req, res) => {
  const userId = getUserId(req);
  const routineId = Number(req.params.routineId);
  const groupId = Number(req.params.groupId);
  const routine = one('SELECT id FROM routines WHERE id = ? AND user_id = ?', [routineId, userId]);
  if (!routine) return res.status(404).json({ error: 'Routine not found' });
  const row = one('SELECT id FROM routine_groups WHERE routine_id = ? AND group_id = ?', [routineId, groupId]);
  if (!row) return res.status(404).json({ error: 'Group not found in routine' });
  const isSuperset = req.body.isSuperset === undefined ? undefined : (req.body.isSuperset ? 1 : 0);
  const rounds = req.body.supersetRounds === undefined ? undefined : Math.max(1, Math.min(20, Number(req.body.supersetRounds || 1)));
  if (isSuperset === undefined && rounds === undefined) return res.json({ ok: true, routine: getRoutine(routineId, userId) });
  const updates = [];
  const values = [];
  if (isSuperset !== undefined) {
    updates.push('is_superset = ?');
    values.push(isSuperset);
  }
  if (rounds !== undefined) {
    updates.push('superset_rounds = ?');
    values.push(rounds);
  }
  values.push(routineId, groupId);
  db.prepare(`UPDATE routine_groups SET ${updates.join(', ')} WHERE routine_id = ? AND group_id = ?`).run(...values);
  res.json({ ok: true, routine: getRoutine(routineId, userId) });
});

app.patch('/api/routines/:id', (req, res) => {
  const userId = getUserId(req);
  const routineId = Number(req.params.id);
  const routine = one('SELECT * FROM routines WHERE id = ? AND user_id = ?', [routineId, userId]);
  if (!routine) return res.status(404).json({ error: 'Routine not found' });
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Tên không được để trống' });
  db.prepare('UPDATE routines SET name = ? WHERE id = ? AND user_id = ?').run(name, routineId, userId);
  res.json({ ok: true });
});

app.patch('/api/routines/:id/groups-order', (req, res) => {
  const userId = getUserId(req);
  const routineId = Number(req.params.id);
  const groupIds = Array.isArray(req.body.groupIds) ? req.body.groupIds.map(Number) : [];
  const routine = one('SELECT id FROM routines WHERE id = ? AND user_id = ?', [routineId, userId]);
  if (!routine) return res.status(404).json({ error: 'Routine not found' });
  if (!groupIds.length) return res.status(400).json({ error: 'Missing groupIds' });

  const update = db.prepare('UPDATE routine_groups SET order_index = ? WHERE routine_id = ? AND group_id = ?');
  const tx = db.transaction(() => {
    groupIds.forEach((groupId, index) => update.run(index + 1, routineId, groupId));
  });
  tx();
  res.json({ ok: true });
});

app.post('/api/schedule-rules', (req, res) => {
  const userId = getUserId(req);
  requireBody(['routineId', 'mode'], req.body);
  const mode = req.body.mode;
  if (!['FIXED'].includes(mode)) return res.status(400).json({ error: 'Invalid mode' });
  if (mode === 'FIXED') requireBody(['dayOfWeek'], req.body);
  if (mode === 'ROLLING') requireBody(['orderIndex'], req.body);

  if (mode === 'ROLLING') {
    db.prepare('DELETE FROM routine_schedule_rules WHERE user_id = ? AND mode = ? AND order_index = ?').run(userId, mode, req.body.orderIndex);
    db.prepare('INSERT INTO routine_schedule_rules (user_id, routine_id, mode, order_index) VALUES (?, ?, ?, ?)').run(userId, req.body.routineId, mode, req.body.orderIndex);
  } else {
    db.prepare('DELETE FROM routine_schedule_rules WHERE user_id = ? AND mode = ? AND day_of_week = ?').run(userId, mode, req.body.dayOfWeek);
    db.prepare('INSERT INTO routine_schedule_rules (user_id, routine_id, mode, day_of_week) VALUES (?, ?, ?, ?)').run(userId, req.body.routineId, mode, req.body.dayOfWeek);
  }

  res.status(201).json({ ok: true });
});

app.delete('/api/schedule-rules/:id', (req, res) => {
  const userId = getUserId(req);
  db.prepare('DELETE FROM routine_schedule_rules WHERE id = ? AND user_id = ?').run(Number(req.params.id), userId);
  res.json({ ok: true });
});

function getRecentHistory(userId, limit = 20, offset = 0) {
  return all(`
    SELECT
      ws.id,
      ws.routine_id,
      ws.group_id,
      ws.schedule_mode,
      ws.started_at,
      ws.completed_at,
      CAST((julianday(ws.completed_at) - julianday(ws.started_at)) * 86400 AS INTEGER) AS duration_seconds,
      r.name AS routine_name,
      cg.name AS group_name,
      ws.used_superset AS is_superset,
      COUNT(wl.id) AS sets,
      COUNT(DISTINCT wl.exercise_id) AS exercises,
      (
        SELECT COALESCE(e.gif_path, e.image_path)
        FROM workout_logs wl2
        JOIN exercises e ON e.id = wl2.exercise_id
        WHERE wl2.session_id = ws.id
        ORDER BY wl2.set_index ASC, wl2.id ASC
        LIMIT 1
      ) AS image_path
    FROM workout_sessions ws
    LEFT JOIN routines r ON r.id = ws.routine_id
    LEFT JOIN custom_groups cg ON cg.id = ws.group_id
    LEFT JOIN workout_logs wl ON wl.session_id = ws.id
    WHERE ws.user_id = ? AND ws.status = 'COMPLETED'
    GROUP BY ws.id
    ORDER BY ws.completed_at DESC
    LIMIT ? OFFSET ?
  `, [userId, limit, offset]).map((row) => ({
    ...row,
    isSuperset: Boolean(row.is_superset),
    imageUrl: assetUrl(row.image_path),
    duration_minutes: formatMinutes(row.duration_seconds)
  }));
}

app.post('/api/weekly/reset', (req, res) => {
  const userId = getUserId(req);
  const nowIso = new Date().toISOString();
  db.prepare('UPDATE user_settings SET weekly_last_reset_at = ? WHERE user_id = ?').run(nowIso, userId);
  res.json({ ok: true, weeklyLastResetAt: nowIso, suggestion: smartSuggestion(userId) });
});

app.get('/api/dashboard', (req, res) => {
  const userId = getUserId(req);
  cleanupStaleActiveSessions(userId);
  const calendar = all(`
    SELECT
      date(completed_at) AS day,
      COUNT(*) AS total,
      CAST(SUM((julianday(completed_at) - julianday(started_at)) * 86400) AS INTEGER) AS duration_seconds
    FROM workout_sessions
    WHERE user_id = ? AND status = 'COMPLETED' AND completed_at >= date('now', '-27 days')
    GROUP BY date(completed_at)
    ORDER BY day ASC
  `, [userId]);

  const recentHistory = getRecentHistory(userId, 20, 0);

  const todaySummary = all(`
    SELECT
      l.exercise_id,
      e.name,
      COUNT(*) AS sets,
      MAX(l.weight_kg) AS max_weight,
      SUM(l.reps) AS total_reps,
      (
        SELECT printf('%g kg x %d', wl2.weight_kg, wl2.reps)
        FROM workout_logs wl2
        WHERE wl2.user_id = l.user_id
          AND wl2.exercise_id = l.exercise_id
          AND date(wl2.completed_at) < date('now')
        ORDER BY wl2.completed_at DESC
        LIMIT 1
      ) AS previous_best
    FROM workout_logs l
    JOIN exercises e ON e.id = l.exercise_id
    WHERE l.user_id = ? AND date(l.completed_at) = date('now')
    GROUP BY l.exercise_id
  `, [userId]);

  res.json({ suggestion: smartSuggestion(userId), weeklyStats: getWeeklyStats(userId), activityCalendar: calendar, recentHistory, todaySummary });
});

app.get('/api/history', (req, res) => {
  const userId = getUserId(req);
  cleanupStaleActiveSessions(userId);
  const limit = Math.max(1, Math.min(50, Number(req.query.limit || 20)));
  const offset = Math.max(0, Number(req.query.offset || 0));
  const rows = getRecentHistory(userId, limit, offset);
  res.json({ rows, hasMore: rows.length === limit });
});

app.post('/api/sessions', (req, res) => {
  const userId = getUserId(req);
  cleanupStaleActiveSessions(userId);
  const settings = one('SELECT * FROM user_settings WHERE user_id = ?', [userId]);
  const scheduleMode = ['FREE', 'FIXED'].includes(req.body.scheduleMode) ? req.body.scheduleMode : (settings.schedule_mode === 'FIXED' ? 'FIXED' : 'FREE');
  const routineId = req.body.routineId ? Number(req.body.routineId) : null;
  const groupId = req.body.groupId ? Number(req.body.groupId) : null;
  const existing = routineId
    ? one(`
        SELECT id
        FROM workout_sessions
        WHERE user_id = ?
          AND status = 'ACTIVE'
          AND routine_id = ?
          AND date(started_at, 'localtime') = date('now', 'localtime')
        ORDER BY started_at DESC
        LIMIT 1
      `, [userId, routineId])
    : groupId
      ? one(`
          SELECT id
          FROM workout_sessions
          WHERE user_id = ?
            AND status = 'ACTIVE'
            AND group_id = ?
            AND date(started_at, 'localtime') = date('now', 'localtime')
          ORDER BY started_at DESC
          LIMIT 1
        `, [userId, groupId])
      : null;
  if (existing) {
    res.json({ id: existing.id, reused: true });
    return;
  }
  const result = db.prepare(`
    INSERT INTO workout_sessions (user_id, routine_id, group_id, schedule_mode)
    VALUES (?, ?, ?, ?)
  `).run(userId, routineId, groupId, scheduleMode);
  res.status(201).json({ id: result.lastInsertRowid });
});

app.get('/api/sessions/active', (req, res) => {
  const userId = getUserId(req);
  cleanupStaleActiveSessions(userId);
  const sessions = all(`
    SELECT *
    FROM workout_sessions
    WHERE user_id = ? AND status = 'ACTIVE' AND date(started_at) = date('now')
    ORDER BY started_at DESC
  `, [userId]);
  if (!sessions.length) return res.json(null);
  const payload = sessions.map((session) => {
    const routine = session.routine_id ? getRoutine(session.routine_id, userId) : null;
    const group = session.group_id ? (() => {
      const row = one('SELECT name, is_superset, superset_rounds FROM custom_groups WHERE id = ? AND user_id = ?', [session.group_id, userId]);
      return {
        id: session.group_id,
        name: row?.name,
        isSuperset: Boolean(row?.is_superset),
        supersetRounds: Math.max(1, Number(row?.superset_rounds || 1)),
        exercises: getGroupExercises(session.group_id)
      };
    })() : null;
    const counts = all('SELECT exercise_id, COUNT(*) AS completed_sets FROM workout_logs WHERE session_id = ? AND user_id = ? GROUP BY exercise_id', [session.id, userId]);
    const countByExercise = new Map(counts.map((row) => [row.exercise_id, row.completed_sets]));
    const exercises = (routine?.exercises || group?.exercises || []).map((exercise) => ({ ...exercise, completedSets: countByExercise.get(exercise.id) || 0 }));
    return { session, routine, group, exercises };
  });
  res.json({ session: payload[0].session, routine: payload[0].routine, group: payload[0].group, exercises: payload[0].exercises, sessions: payload });
});

app.get('/api/sessions/:id', (req, res) => {
  const userId = getUserId(req);
  const session = one('SELECT * FROM workout_sessions WHERE id = ? AND user_id = ?', [Number(req.params.id), userId]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const routine = session.routine_id ? getRoutine(session.routine_id, userId) : null;
  const groupRow = session.group_id ? one('SELECT id, name, is_superset, superset_rounds FROM custom_groups WHERE id = ? AND user_id = ?', [session.group_id, userId]) : null;
  const group = groupRow ? {
    id: groupRow.id,
    name: groupRow.name,
    isSuperset: Boolean(groupRow.is_superset),
    supersetRounds: Math.max(1, Number(groupRow.superset_rounds || 1)),
    exercises: getGroupExercises(session.group_id)
  } : null;
  const counts = all('SELECT exercise_id, COUNT(*) AS completed_sets FROM workout_logs WHERE session_id = ? AND user_id = ? GROUP BY exercise_id', [session.id, userId]);
  const countByExercise = new Map(counts.map((row) => [row.exercise_id, row.completed_sets]));
  const exercises = (routine?.exercises || group?.exercises || []).map((exercise) => ({ ...exercise, completedSets: countByExercise.get(exercise.id) || 0 }));
  res.json({ session, routine, group, exercises });
});

app.get('/api/sessions/:id/detail', (req, res) => {
  const userId = getUserId(req);
  const sessionId = Number(req.params.id);
  const session = one(`
    SELECT
      ws.*,
      CAST((julianday(ws.completed_at) - julianday(ws.started_at)) * 86400 AS INTEGER) AS duration_seconds,
      r.name AS routine_name,
      cg.name AS group_name
    FROM workout_sessions ws
    LEFT JOIN routines r ON r.id = ws.routine_id
    LEFT JOIN custom_groups cg ON cg.id = ws.group_id
    WHERE ws.id = ? AND ws.user_id = ?
  `, [sessionId, userId]);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const rows = all(`
    SELECT
      wl.*,
      e.name,
      e.target,
      e.equipment,
      e.image_path,
      e.gif_path
    FROM workout_logs wl
    JOIN exercises e ON e.id = wl.exercise_id
    WHERE wl.session_id = ? AND wl.user_id = ?
    ORDER BY wl.completed_at, wl.exercise_id, wl.set_index
  `, [sessionId, userId]);

  const byExercise = new Map();
  for (const row of rows) {
    if (!byExercise.has(row.exercise_id)) {
      const previousSession = one(`
        SELECT ws.id, ws.completed_at
        FROM workout_sessions ws
        JOIN workout_logs wl ON wl.session_id = ws.id
        WHERE wl.user_id = ?
          AND wl.exercise_id = ?
          AND ws.status = 'COMPLETED'
          AND ws.completed_at < ?
        ORDER BY ws.completed_at DESC
        LIMIT 1
      `, [userId, row.exercise_id, session.completed_at || session.started_at]);
      const previous = all(`
        SELECT wl.id, wl.set_index, wl.weight_kg, wl.reps, wl.completed_at
        FROM workout_logs wl
        WHERE wl.user_id = ?
          AND wl.exercise_id = ?
          AND wl.session_id = ?
        ORDER BY wl.set_index ASC
      `, [userId, row.exercise_id, previousSession?.id || 0]).map((set) => ({
        id: set.id,
        setIndex: set.set_index,
        weightKg: set.weight_kg,
        reps: set.reps,
        completedAt: set.completed_at
      }));
      byExercise.set(row.exercise_id, {
        id: row.exercise_id,
        name: row.name,
        target: row.target,
        equipment: row.equipment,
        imageUrl: assetUrl(row.image_path),
        gifUrl: assetUrl(row.gif_path),
        sets: [],
        previous,
        previousCompletedAt: previousSession?.completed_at || null
      });
    }
    byExercise.get(row.exercise_id).sets.push({
      id: row.id,
      setIndex: row.set_index,
      weightKg: row.weight_kg,
      reps: row.reps,
      completedAt: row.completed_at
    });
  }

  const exercises = Array.from(byExercise.values()).map((exercise) => {
    const volume = Math.round(exercise.sets.reduce((sum, set) => sum + Number(set.weightKg || 0) * Number(set.reps || 0), 0) * 100) / 100;
    const previousVolume = Math.round(exercise.previous.reduce((sum, set) => sum + Number(set.weightKg || 0) * Number(set.reps || 0), 0) * 100) / 100;
    const maxWeight = Math.max(...exercise.sets.map((set) => Number(set.weightKg || 0)), 0);
    const previousMaxWeight = Math.max(...exercise.previous.map((set) => Number(set.weightKg || 0)), 0);
    return { ...exercise, volume, previousVolume, maxWeight, previousMaxWeight };
  });

  const totalSets = exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
  const totalVolume = exercises.reduce((sum, exercise) => sum + exercise.volume, 0);
  const previousTotalVolume = exercises.reduce((sum, exercise) => sum + exercise.previousVolume, 0);
  const improvedCount = exercises.filter((exercise) => exercise.volume > exercise.previousVolume || exercise.maxWeight > exercise.previousMaxWeight).length;
  res.json({
    session: { ...session, duration_minutes: formatMinutes(session.duration_seconds) },
    exercises,
    summary: {
      totalSets,
      totalVolume,
      previousTotalVolume,
      improvedCount,
      exerciseCount: exercises.length,
      effectiveness: exercises.length ? Math.round((improvedCount / exercises.length) * 100) : 0
    }
  });
});

app.delete('/api/sessions/:id', (req, res) => {
  const userId = getUserId(req);
  const sessionId = Number(req.params.id);
  const session = one('SELECT id FROM workout_sessions WHERE id = ? AND user_id = ?', [sessionId, userId]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM workout_logs WHERE session_id = ? AND user_id = ?').run(sessionId, userId);
    db.prepare('DELETE FROM workout_sessions WHERE id = ? AND user_id = ?').run(sessionId, userId);
  });
  tx();
  res.json({ ok: true });
});

app.post('/api/sessions/:id/logs', (req, res) => {
  const userId = getUserId(req);
  requireBody(['exerciseId', 'weightKg', 'reps'], req.body);
  const sessionId = Number(req.params.id);
  const weightUnit = ['kg', 'lb'].includes(req.body.weightUnit) ? req.body.weightUnit : 'kg';
  const setIndex = one('SELECT COALESCE(MAX(set_index), 0) + 1 AS next_set FROM workout_logs WHERE session_id = ? AND exercise_id = ?', [sessionId, req.body.exerciseId]).next_set;
  const result = db.prepare(`
    INSERT INTO workout_logs (session_id, user_id, exercise_id, set_index, weight_kg, weight_unit, reps)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, userId, req.body.exerciseId, setIndex, Number(req.body.weightKg), weightUnit, Number(req.body.reps));
  if (req.body.isSuperset) {
    db.prepare('UPDATE workout_sessions SET used_superset = 1 WHERE id = ? AND user_id = ?').run(sessionId, userId);
  }
  res.status(201).json({ id: result.lastInsertRowid, setIndex });
});

app.delete('/api/logs/:id', (req, res) => {
  const userId = getUserId(req);
  const logId = Number(req.params.id);
  const log = one('SELECT * FROM workout_logs WHERE id = ? AND user_id = ?', [logId, userId]);
  if (!log) return res.status(404).json({ error: 'Không tìm thấy set' });

  db.transaction(() => {
    // 1. Xoá log
    db.prepare('DELETE FROM workout_logs WHERE id = ? AND user_id = ?').run(logId, userId);

    // 2. Re-number set_index cho các log còn lại của exercise trong session (tránh gap)
    const remaining = all(
      'SELECT id FROM workout_logs WHERE session_id = ? AND exercise_id = ? AND user_id = ? ORDER BY set_index ASC',
      [log.session_id, log.exercise_id, userId]
    );
    remaining.forEach((row, i) => {
      db.prepare('UPDATE workout_logs SET set_index = ? WHERE id = ?').run(i + 1, row.id);
    });

    // 3. Revert exercise_notes default_reps/default_weight_kg về set liền trước (nếu còn)
    const prevSet = remaining.length > 0
      ? one('SELECT weight_kg, reps FROM workout_logs WHERE id = ?', [remaining[remaining.length - 1].id])
      : null;

    if (prevSet) {
      db.prepare(`
        UPDATE exercise_notes SET default_reps = ?, default_weight_kg = ?
        WHERE user_id = ? AND exercise_id = ?
      `).run(prevSet.reps, prevSet.weight_kg, userId, log.exercise_id);
    } else {
      // Không còn set nào trong bài này — clear default về null
      db.prepare(`
        UPDATE exercise_notes SET default_reps = NULL, default_weight_kg = NULL
        WHERE user_id = ? AND exercise_id = ?
      `).run(userId, log.exercise_id);
    }
  })();

  res.json({ ok: true });
});

app.patch('/api/logs/:id', (req, res) => {
  const userId = getUserId(req);
  requireBody(['weightKg', 'reps'], req.body);
  const logId = Number(req.params.id);
  const log = one('SELECT * FROM workout_logs WHERE id = ? AND user_id = ?', [logId, userId]);
  if (!log) return res.status(404).json({ error: 'Không tìm thấy set' });
  const weightUnit = ['kg', 'lb'].includes(req.body.weightUnit) ? req.body.weightUnit : log.weight_unit || 'kg';
  db.prepare('UPDATE workout_logs SET weight_kg = ?, weight_unit = ?, reps = ? WHERE id = ? AND user_id = ?').run(Number(req.body.weightKg), weightUnit, Number(req.body.reps), logId, userId);
  res.json({ ok: true });
});

app.get('/api/sessions/:id/exercises/:exerciseId/sets', (req, res) => {
  const userId = getUserId(req);
  const sessionId = Number(req.params.id);
  const exerciseId = req.params.exerciseId;
  const current = all(`
    SELECT id, set_index, weight_kg, weight_unit, reps, completed_at
    FROM workout_logs
    WHERE user_id = ? AND session_id = ? AND exercise_id = ?
    ORDER BY set_index
  `, [userId, sessionId, exerciseId]);
  const previous = all(`
    SELECT wl.set_index, wl.weight_kg, wl.weight_unit, wl.reps, wl.completed_at
    FROM workout_logs wl
    JOIN workout_sessions ws ON ws.id = wl.session_id
    WHERE wl.user_id = ?
      AND wl.exercise_id = ?
      AND wl.session_id <> ?
      AND ws.status = 'COMPLETED'
      AND ws.completed_at = (
        SELECT MAX(ws2.completed_at)
        FROM workout_logs wl2
        JOIN workout_sessions ws2 ON ws2.id = wl2.session_id
        WHERE wl2.user_id = wl.user_id
          AND wl2.exercise_id = wl.exercise_id
          AND wl2.session_id <> ?
          AND ws2.status = 'COMPLETED'
      )
    ORDER BY wl.set_index
  `, [userId, exerciseId, sessionId, sessionId]);
  const preference = one('SELECT note, target_sets, weight_mode, manual_weight_kg, manual_weight_lb, manual_unit, default_reps, default_weight_kg FROM exercise_notes WHERE user_id = ? AND exercise_id = ?', [userId, exerciseId]);
  const settings = one('SELECT default_sets, default_reps FROM user_settings WHERE user_id = ?', [userId]) || {};
  // All-time PR: max weight đã từng log cho bài này
  const prRow = one(`
    SELECT COALESCE(MAX(wl.weight_kg), 0) AS all_time_max
    FROM workout_logs wl
    JOIN workout_sessions ws ON ws.id = wl.session_id
    WHERE wl.user_id = ? AND wl.exercise_id = ? AND ws.status = 'COMPLETED'
  `, [userId, exerciseId]);
  const allTimePR = Number(prRow?.all_time_max || 0);

  res.json({
    current,
    previous,
    allTimePR,
    note: preference?.note || '',
    targetSets: preference?.target_sets || settings.default_sets || 3,
    defaultReps: preference?.default_reps || settings.default_reps || 12,
    defaultWeightKg: preference?.default_weight_kg ?? null,
    weightMode: preference?.weight_mode || 'KG',
    manualWeightKg: preference?.manual_weight_kg ?? null,
    manualWeightLb: preference?.manual_weight_lb ?? null,
    manualUnit: preference?.manual_unit || 'kg'
  });
});

app.put('/api/exercises/:id/note', (req, res) => {
  const userId = getUserId(req);
  db.prepare(`
    INSERT INTO exercise_notes (user_id, exercise_id, note, target_sets, weight_mode, manual_weight_kg, default_reps, default_weight_kg, updated_at)
    VALUES (
      ?, ?, ?,
      COALESCE((SELECT target_sets FROM exercise_notes WHERE user_id = ? AND exercise_id = ?), 3),
      COALESCE((SELECT weight_mode FROM exercise_notes WHERE user_id = ? AND exercise_id = ?), 'KG'),
      (SELECT manual_weight_kg FROM exercise_notes WHERE user_id = ? AND exercise_id = ?),
      (SELECT default_reps FROM exercise_notes WHERE user_id = ? AND exercise_id = ?),
      (SELECT default_weight_kg FROM exercise_notes WHERE user_id = ? AND exercise_id = ?),
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(user_id, exercise_id) DO UPDATE SET note = excluded.note, updated_at = CURRENT_TIMESTAMP
  `).run(userId, req.params.id, req.body.note || '', userId, req.params.id, userId, req.params.id, userId, req.params.id, userId, req.params.id, userId, req.params.id);
  res.json({ ok: true });
});

app.put('/api/exercises/:id/preferences', (req, res) => {
  const userId = getUserId(req);
  const previous = one('SELECT note, target_sets, weight_mode, manual_weight_kg, manual_weight_lb, manual_unit, default_reps, default_weight_kg FROM exercise_notes WHERE user_id = ? AND exercise_id = ?', [userId, req.params.id]) || {};
  const targetSets = req.body.targetSets === undefined ? Number(previous.target_sets || 3) : Math.max(1, Math.min(20, Number(req.body.targetSets || 3)));
  const requestedMode = String(req.body.weightMode || previous.weight_mode || 'KG').toUpperCase();
  const weightMode = ['KG', 'LB', 'MANUAL'].includes(requestedMode) ? requestedMode : 'KG';
  const manualWeightKg = req.body.manualWeightKg === undefined
    ? previous.manual_weight_kg ?? null
    : (req.body.manualWeightKg === null || req.body.manualWeightKg === '' ? null : Number(req.body.manualWeightKg));
  const manualWeightLb = req.body.manualWeightLb === undefined
    ? previous.manual_weight_lb ?? null
    : (req.body.manualWeightLb === null || req.body.manualWeightLb === '' ? null : Number(req.body.manualWeightLb));
  const requestedUnit = String(req.body.manualUnit || previous.manual_unit || 'kg').toLowerCase();
  const manualUnit = ['kg', 'lb'].includes(requestedUnit) ? requestedUnit : 'kg';
  const defaultReps = req.body.defaultReps === undefined
    ? (previous.default_reps ?? null)
    : Math.max(1, Math.min(100, Number(req.body.defaultReps || 12)));
  const defaultWeightKg = req.body.defaultWeightKg === undefined
    ? (previous.default_weight_kg ?? null)
    : (req.body.defaultWeightKg === null || req.body.defaultWeightKg === '' ? null : Number(req.body.defaultWeightKg));
  db.prepare(`
    INSERT INTO exercise_notes (user_id, exercise_id, note, target_sets, weight_mode, manual_weight_kg, manual_weight_lb, manual_unit, default_reps, default_weight_kg, updated_at)
    VALUES (?, ?, COALESCE(?, ''), ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, exercise_id) DO UPDATE SET
      target_sets = excluded.target_sets,
      weight_mode = excluded.weight_mode,
      manual_weight_kg = excluded.manual_weight_kg,
      manual_weight_lb = excluded.manual_weight_lb,
      manual_unit = excluded.manual_unit,
      default_reps = excluded.default_reps,
      default_weight_kg = excluded.default_weight_kg,
      updated_at = CURRENT_TIMESTAMP
  `).run(userId, req.params.id, previous.note || '', targetSets, weightMode, manualWeightKg, manualWeightLb, manualUnit, defaultReps, defaultWeightKg);
  res.json({ ok: true, targetSets, weightMode, manualWeightKg, manualWeightLb, manualUnit, defaultReps, defaultWeightKg });
});

app.get('/api/exercises/:id/last-log', (req, res) => {
  const userId = getUserId(req);
  const row = one(`
    SELECT weight_kg, reps, completed_at
    FROM workout_logs
    WHERE user_id = ? AND exercise_id = ?
    ORDER BY completed_at DESC
    LIMIT 1
  `, [userId, req.params.id]);
  res.json(row || null);
});

app.post('/api/sessions/:id/complete', (req, res) => {
  const userId = getUserId(req);
  const session = one('SELECT * FROM workout_sessions WHERE id = ? AND user_id = ?', [Number(req.params.id), userId]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const logCount = one('SELECT COUNT(*) AS total FROM workout_logs WHERE session_id = ? AND user_id = ?', [session.id, userId]).total;
  if (logCount === 0) {
    db.prepare('DELETE FROM workout_sessions WHERE id = ? AND user_id = ?').run(session.id, userId);
    res.json({ ok: true, discarded: true, suggestion: smartSuggestion(userId) });
    return;
  }

  const tx = db.transaction(() => {
    db.prepare("UPDATE workout_sessions SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(session.id);
    // Weekly Goal mode: không advance, đếm theo completed_at trong tuần
  });
  tx();
  res.json({ ok: true, suggestion: smartSuggestion(userId) });
});

app.get('/api/analytics', (req, res) => {
  const userId = getUserId(req);
  cleanupStaleActiveSessions(userId);
  const exerciseRows = all(`
    SELECT
      e.name,
      l.exercise_id,
      date(l.completed_at) AS day,
      MAX(l.weight_kg) AS max_weight,
      GROUP_CONCAT(DISTINCT COALESCE(l.weight_unit, 'kg')) AS weight_units,
      SUM(l.weight_kg * l.reps) AS volume,
      COUNT(*) AS sets,
      SUM(l.reps) AS reps
    FROM workout_logs l
    JOIN exercises e ON e.id = l.exercise_id
    WHERE l.user_id = ?
    GROUP BY l.exercise_id, date(l.completed_at)
    ORDER BY day ASC, e.name ASC
  `, [userId]);
  const sessionRows = all(`
    SELECT
      ws.id,
      COALESCE(r.name, cg.name, 'Buổi tập tự do') AS name,
      ws.completed_at,
        date(ws.completed_at) AS day,
        CAST((julianday(ws.completed_at) - julianday(ws.started_at)) * 86400 AS INTEGER) AS duration_seconds,
        COUNT(wl.id) AS sets,
        COALESCE(SUM(wl.reps), 0) AS reps,
        COALESCE(MAX(wl.weight_kg), 0) AS max_weight,
        COALESCE(SUM(wl.weight_kg * wl.reps), 0) AS volume
    FROM workout_sessions ws
    LEFT JOIN routines r ON r.id = ws.routine_id
    LEFT JOIN custom_groups cg ON cg.id = ws.group_id
    LEFT JOIN workout_logs wl ON wl.session_id = ws.id
    WHERE ws.user_id = ? AND ws.status = 'COMPLETED'
    GROUP BY ws.id
    ORDER BY ws.completed_at ASC
  `, [userId]).map((row) => ({
    ...row,
    duration_minutes: formatMinutes(row.duration_seconds)
  }));
  const exercises = all(`
    SELECT DISTINCT e.id, e.name, e.image_path
    FROM workout_logs wl
    JOIN exercises e ON e.id = wl.exercise_id
    WHERE wl.user_id = ?
    ORDER BY e.name
  `, [userId]).map((row) => ({ id: row.id, name: row.name, imageUrl: assetUrl(row.image_path) }));
  const routines = all(`
    SELECT DISTINCT COALESCE(r.id, -ws.group_id, 0) AS id, COALESCE(r.name, cg.name, 'Buổi tập tự do') AS name
    FROM workout_sessions ws
    LEFT JOIN routines r ON r.id = ws.routine_id
    LEFT JOIN custom_groups cg ON cg.id = ws.group_id
    WHERE ws.user_id = ? AND ws.status = 'COMPLETED'
    ORDER BY name
  `, [userId]);
  res.json({ exercises, exerciseRows, routines, sessionRows });
});

app.get('/api/body-weight', (req, res) => {
  const userId = getUserId(req);
  res.json(all('SELECT * FROM body_weight_logs WHERE user_id = ? ORDER BY logged_at ASC', [userId]));
});

app.get('/api/body-weight/recent', (req, res) => {
  const userId = getUserId(req);
  res.json(all(`
    SELECT bw.*
    FROM body_weight_logs bw
    JOIN (
      SELECT date(logged_at) AS day, MAX(logged_at) AS latest_at
      FROM body_weight_logs
      WHERE user_id = ?
      GROUP BY date(logged_at)
      ORDER BY day DESC
      LIMIT 5
    ) recent ON date(bw.logged_at) = recent.day AND bw.logged_at = recent.latest_at
    WHERE bw.user_id = ?
    ORDER BY bw.logged_at DESC
  `, [userId, userId]));
});

app.post('/api/body-weight', (req, res) => {
  const userId = getUserId(req);
  requireBody(['weight', 'unit'], req.body);
  const result = db.prepare('INSERT INTO body_weight_logs (user_id, weight, unit) VALUES (?, ?, ?)').run(userId, Number(req.body.weight), req.body.unit);
  res.status(201).json({ id: result.lastInsertRowid });
});

function importBackupData(userId, backup) {
  const data = backup?.data || backup;
  if (!data || typeof data !== 'object') {
    const error = new Error('File backup không hợp lệ');
    error.status = 400;
    throw error;
  }
  // Bỏ qua data.user (tên/avatar/pass) — giữ nguyên thông tin user hiện tại
  const settingColumns = new Set(all('PRAGMA table_info(user_settings)').map((col) => col.name));
  const tx = db.transaction(() => {
    restoreUploadedFiles(data.uploads);
    if (data.user) {
      db.prepare('UPDATE users SET name = COALESCE(?, name), avatar = COALESCE(?, avatar) WHERE id = ?').run(data.user.name || null, data.user.avatar || null, userId);
    }
    if (data.settings) {
      const columns = Object.keys(data.settings).filter((key) =>
        key !== 'user_id' && settingColumns.has(key) && /^[a-z0-9_]+$/i.test(key)
      );
      if (columns.length) {
        db.prepare(`UPDATE user_settings SET ${columns.map((key) => `"${key}" = ?`).join(', ')} WHERE user_id = ?`)
          .run(...columns.map((key) => data.settings[key]), userId);
      }
    }
    for (const exercise of data.customExercises || []) {
      db.prepare(`
        INSERT OR IGNORE INTO exercises (
          id, name, category, body_part, equipment, target, muscle_group,
          secondary_muscles_json, instructions_en, instruction_steps_json,
          image_path, gif_path, custom_user_id, is_custom, is_hidden, custom_icon, display_media, source_created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
      `).run(
        exercise.id, exercise.name, exercise.category || 'custom', exercise.body_part, exercise.equipment, exercise.target, exercise.muscle_group,
        exercise.secondary_muscles_json || '[]', exercise.instructions_en || '', exercise.instruction_steps_json || '[]',
        exercise.image_path || null, exercise.gif_path || null, userId, exercise.is_hidden ? 1 : 0, exercise.custom_icon || '🏋️', exercise.display_media || 'auto', exercise.source_created_at || null
      );
    }
    for (const group of data.groups || []) {
      db.prepare('INSERT OR IGNORE INTO custom_groups (id, user_id, name, icon, color_hex, created_at, order_index, is_superset, superset_rounds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(group.id, userId, group.name, group.icon || '\u{1F4AA}', group.color_hex || '#78e0a6', group.created_at, group.order_index ?? 1, group.is_superset || 0, group.superset_rounds || 1);
    }
    for (const item of data.groupExercises || []) {
      db.prepare('INSERT OR IGNORE INTO group_exercises (id, group_id, exercise_id, icon, order_index) VALUES (?, ?, ?, ?, ?)').run(item.id, item.group_id, item.exercise_id, item.icon || '🏋️', item.order_index || 1);
    }
    for (const routine of data.routines || []) {
      db.prepare('INSERT OR IGNORE INTO routines (id, user_id, name, color_hex, created_at, order_index) VALUES (?, ?, ?, ?, ?, ?)').run(routine.id, userId, routine.name, routine.color_hex || '#c8ff2e', routine.created_at, routine.order_index ?? 1);
    }
    for (const item of data.routineGroups || []) {
      db.prepare('INSERT OR IGNORE INTO routine_groups (id, routine_id, group_id, order_index, is_superset, superset_rounds) VALUES (?, ?, ?, ?, ?, ?)').run(item.id, item.routine_id, item.group_id, item.order_index || 1, item.is_superset || 0, item.superset_rounds || 1);
    }
    for (const rule of data.scheduleRules || []) {
      db.prepare('INSERT OR IGNORE INTO routine_schedule_rules (id, user_id, routine_id, mode, day_of_week, order_index) VALUES (?, ?, ?, ?, ?, ?)').run(rule.id, userId, rule.routine_id, rule.mode, rule.day_of_week, rule.order_index);
    }
    for (const session of data.sessions || []) {
      db.prepare('INSERT OR IGNORE INTO workout_sessions (id, user_id, routine_id, group_id, schedule_mode, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(session.id, userId, session.routine_id, session.group_id, session.schedule_mode, session.status, session.started_at, session.completed_at);
    }
    for (const log of data.logs || []) {
      db.prepare('INSERT OR IGNORE INTO workout_logs (id, session_id, user_id, exercise_id, set_index, weight_kg, weight_unit, reps, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(log.id, log.session_id, userId, log.exercise_id, log.set_index, log.weight_kg, log.weight_unit || 'kg', log.reps, log.completed_at);
    }
    for (const note of data.exerciseNotes || []) {
      db.prepare('INSERT OR IGNORE INTO exercise_notes (user_id, exercise_id, note, target_sets, weight_mode, manual_weight_kg, default_reps, default_weight_kg, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(userId, note.exercise_id, note.note || '', note.target_sets || 3, note.weight_mode || 'KG', note.manual_weight_kg ?? null, note.default_reps ?? null, note.default_weight_kg ?? null, note.updated_at);
    }
    for (const weight of data.bodyWeights || []) {
      db.prepare('INSERT OR IGNORE INTO body_weight_logs (id, user_id, weight, unit, logged_at) VALUES (?, ?, ?, ?, ?)').run(weight.id, userId, weight.weight, weight.unit || 'kg', weight.logged_at);
    }
  });
  tx();
}

function restoreAdminBackup(requesterId, backup) {
  assertAdmin(requesterId);
  const data = backup?.data || backup;
  if (!data || typeof data !== 'object' || !Array.isArray(data.users)) {
    const error = new Error('Invalid admin backup file');
    error.status = 400;
    throw error;
  }
  const tx = db.transaction(() => {
    db.pragma('foreign_keys = OFF');
    try {
      for (const table of [
        'body_weight_logs',
        'exercise_notes',
        'workout_logs',
        'workout_sessions',
        'routine_schedule_rules',
        'routine_groups',
        'routines',
        'group_exercises',
        'custom_groups',
        'user_settings',
        'users'
      ]) {
        db.prepare(`DELETE FROM ${table}`).run();
      }
      db.prepare('DELETE FROM exercises WHERE is_custom = 1').run();

      insertRows('users', data.users);
      db.prepare('INSERT OR IGNORE INTO user_settings (user_id) SELECT id FROM users').run();
      restoreUploadedFiles(data.uploads);
      for (const adminItem of data.adminData || []) {
        importBackupData(Number(adminItem.userId), { data: adminItem.data });
      }
    } finally {
      db.pragma('foreign_keys = ON');
    }
  });
  tx();
}

app.get('/api/backup', (req, res) => {
  const userId = getUserId(req);
  const scope = req.query.scope === 'admin' ? 'admin' : 'user';
  const today = new Date().toISOString().slice(0, 10);
  if (scope === 'admin') {
    assertAdmin(userId);
    res.setHeader('Content-Disposition', `attachment; filename="gym-app-admin-backup-${today}.json"`);
    res.json({
      app: 'Gym App',
      version: 2,
      scope: 'admin',
      exportedAt: new Date().toISOString(),
      note: 'Admin backup includes login records and password_hash values for all users, plus admin-owned training data/uploads only. Other users must export their own backups. Passwords are not decrypted; hashes are restored directly.',
      data: readAdminExportTables()
    });
    return;
  }
  res.setHeader('Content-Disposition', `attachment; filename="gym-app-user-backup-${userId}-${today}.json"`);
  res.json({ app: 'Gym App', version: 2, scope: 'user', userId, exportedAt: new Date().toISOString(), data: readExportTables(userId) });
});

app.post('/api/backup/import', (req, res) => {
  const userId = getUserId(req);
  requireBody(['backup'], req.body);
  const scope = req.body.scope || req.body.backup?.scope || 'user';
  if (scope === 'admin') restoreAdminBackup(userId, req.body.backup);
  else importBackupData(userId, req.body.backup);
  res.json({ ok: true });
});

app.get('/api/export/excel', async (req, res) => {
  const userId = getUserId(req);
  const rows = excelRowsForUser(userId);
  const today = new Date().toISOString().slice(0, 10);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Workout Log');

  // Columns: Nhóm cơ | Bài tập | Ngày | Set# | Kg | Lb | Reps | Ghi chú
  ws.columns = [
    { key: 'muscleGroup', width: 22 },
    { key: 'exerciseName', width: 30 },
    { key: 'date', width: 14 },
    { key: 'sets', width: 8 },
    { key: 'kg', width: 8 },
    { key: 'lb', width: 8 },
    { key: 'reps', width: 8 },
    { key: 'note', width: 35 },
  ];

  const fullBorder = (color = 'FF000000', style = 'thin') => ({
    top: { style, color: { argb: color } },
    left: { style, color: { argb: color } },
    bottom: { style, color: { argb: color } },
    right: { style, color: { argb: color } },
  });

  // Header row
  const headerRow = ws.addRow(['Nhóm cơ', 'Bài tập', 'Ngày', 'Set #', 'Kg', 'Lb', 'Reps', 'Ghi chú']);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D6A4F' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = fullBorder('FF1B4332', 'medium');
  });
  ws.getRow(1).height = 22;

  // Colors: alternating light blue / white per (exercise+date) block
  const COLOR_A = 'FFE8F4FD'; // xanh dương nhạt
  const COLOR_B = 'FFFFFFFF'; // trắng

  let colorToggle = false;
  let lastGroupKey = null;

  const dataStartRow = 2;
  rows.forEach((row) => {
    const groupKey = row.exerciseName + '||' + row.date;
    if (groupKey !== lastGroupKey) {
      colorToggle = !colorToggle;
      lastGroupKey = groupKey;
    }
    const bgColor = colorToggle ? COLOR_A : COLOR_B;
    const excelRow = ws.addRow([row.muscleGroup, row.exerciseName, row.date, row.sets, row.kg === '' ? null : Number(row.kg), row.lb === '' ? null : Number(row.lb), row.reps, row.note]);
    excelRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
      cell.border = fullBorder('FFAAAAAA', 'thin');
    });
    // note left-align
    excelRow.getCell(8).alignment = { vertical: 'middle', horizontal: 'left' };
  });

  // Merge same consecutive values for muscleGroup (col 1), exerciseName (col 2), date (col 3)
  const totalRows = rows.length;
  const mergeCols = [
    { colIdx: 1, keyFn: (r) => r.muscleGroup },
    { colIdx: 2, keyFn: (r) => r.muscleGroup + '||' + r.exerciseName },
    { colIdx: 3, keyFn: (r) => r.muscleGroup + '||' + r.exerciseName + '||' + r.date },
  ];
  for (const { colIdx, keyFn } of mergeCols) {
    let startRow = dataStartRow;
    let currentKey = rows.length ? keyFn(rows[0]) : null;
    for (let i = 1; i <= totalRows; i++) {
      const key = i < totalRows ? keyFn(rows[i]) : null;
      if (key !== currentKey) {
        const endRow = startRow + (i - 1 - (startRow - dataStartRow));
        if (endRow > startRow) {
          ws.mergeCells(startRow, colIdx, endRow, colIdx);
        }
        const cell = ws.getCell(startRow, colIdx);
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = fullBorder('FFAAAAAA', 'thin');
        startRow = dataStartRow + i;
        currentKey = key;
      }
    }
  }

  // Freeze header
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="gym-workout-${today}.xlsx"`);
  res.send(buf);
});

app.use(express.static(path.join(rootDir, 'dist')));
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(rootDir, 'dist', 'index.html'));
});

app.use((error, req, res, next) => {
  writeServerLog('error', error.message || 'Server error', {
    method: req.method,
    path: req.originalUrl,
    status: error.status || 500,
    stack: error.stack
  });
  console.error(error);
  res.status(error.status || 500).json({ error: error.message || 'Server error' });
});

app.listen(port, () => {
  writeServerLog('info', `Gym App listening on http://localhost:${port}`);
  console.log(`Gym App listening on http://localhost:${port}`);
});
