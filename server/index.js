import cors from 'cors';
import ExcelJS from 'exceljs';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getExerciseTranslation, hashPassword, importHasaneyldrmDataset, migrate, publicExercise, rootDir, uploadDir, verifyPassword } from './db.js';

const app = express();
const port = process.env.PORT || 3001;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

migrate();
if (db.prepare('SELECT COUNT(*) AS total FROM exercises').get().total === 0) {
  const count = importHasaneyldrmDataset();
  console.log(`Imported ${count} exercises from hasaneyldrm dataset.`);
}

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use('/media', express.static(path.join(rootDir, 'hasaneyldrm-exercises-dataset')));
app.use('/uploads', express.static(uploadDir));

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
    groups: all('SELECT * FROM custom_groups WHERE user_id = ? ORDER BY id', [userId]),
    groupExercises: all('SELECT ge.* FROM group_exercises ge JOIN custom_groups cg ON cg.id = ge.group_id WHERE cg.user_id = ? ORDER BY ge.group_id, ge.order_index', [userId]),
    routines: all('SELECT * FROM routines WHERE user_id = ? ORDER BY id', [userId]),
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
    bodyWeights: all('SELECT * FROM body_weight_logs WHERE user_id = ? ORDER BY logged_at', [userId])
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
        db.prepare('INSERT OR REPLACE INTO custom_groups (id, user_id, name, icon, color_hex, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(data.id, userId, data.name, data.icon, data.color_hex, data.created_at);
        bump(type);
      } else if (type === 'Bài trong group') {
        db.prepare('INSERT OR REPLACE INTO group_exercises (id, group_id, exercise_id, icon, order_index) VALUES (?, ?, ?, ?, ?)').run(data.id, data.group_id, data.exercise_id, data.icon, data.order_index);
        bump(type);
      } else if (type === 'Group buổi tập') {
        db.prepare('INSERT OR REPLACE INTO routines (id, user_id, name, color_hex, created_at) VALUES (?, ?, ?, ?, ?)').run(data.id, userId, data.name, data.color_hex, data.created_at);
        bump(type);
      } else if (type === 'Group bài trong buổi') {
        db.prepare('INSERT OR REPLACE INTO routine_groups (id, routine_id, group_id, order_index) VALUES (?, ?, ?, ?)').run(data.id, data.routine_id, data.group_id, data.order_index);
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
    SELECT cg.*, rg.order_index
    FROM routine_groups rg
    JOIN custom_groups cg ON cg.id = rg.group_id
    WHERE rg.routine_id = ?
    ORDER BY rg.order_index, cg.name
  `, [routineId]).map((group) => ({
    ...group,
    exercises: getGroupExercises(group.id)
  }));

  return {
    id: routine.id,
    userId: routine.user_id,
    name: routine.name,
    colorHex: routine.color_hex,
    groups,
    exercises: groups.flatMap((group) => group.exercises.map((exercise) => ({ ...exercise, groupName: group.name })))
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

function publicUser(user) {
  return user ? { id: user.id, name: user.name, username: user.username, avatar: user.avatar, role: user.role } : null;
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
        if (session.schedule_mode === 'ROLLING') advanceRollingSchedule(userId);
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
  if (!settings || settings.schedule_mode === 'FREE') {
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

  return {
    mode: 'ROLLING',
    rollingIndex: settings.current_rolling_index,
    title: rule ? `Buổi ${settings.current_rolling_index} trong chu kỳ` : 'Chu kỳ chưa hoàn tất',
    routine: rule ? getRoutine(rule.routine_id, userId) : null
  };
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/bootstrap', (req, res) => {
  const userId = getUserId(req);
  cleanupStaleActiveSessions(userId);
  const users = all('SELECT id, name, username, avatar, role FROM users ORDER BY id');
  const settings = one('SELECT * FROM user_settings WHERE user_id = ?', [userId]);
  const exerciseCount = one('SELECT COUNT(*) AS total FROM exercises').total;
  res.json({
    users: users.map(publicUser),
    activeUser: publicUser(users.find((user) => user.id === userId) || users[0]),
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

  if (req.body.scheduleMode !== undefined) {
    if (!['FREE', 'FIXED', 'ROLLING'].includes(req.body.scheduleMode)) {
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
  if (req.body.distanceUnit !== undefined && ['km', 'mile'].includes(req.body.distanceUnit)) addUpdate('distance_unit', req.body.distanceUnit);
  if (req.body.energyUnit !== undefined && ['kcal', 'kJ'].includes(req.body.energyUnit)) addUpdate('energy_unit', req.body.energyUnit);
  if (req.body.clockFormat !== undefined && ['12h', '24h'].includes(req.body.clockFormat)) addUpdate('clock_format', req.body.clockFormat);
  if (req.body.defaultSets !== undefined) addUpdate('default_sets', Math.max(1, Math.min(20, Number(req.body.defaultSets || 3))));
  if (req.body.defaultReps !== undefined) addUpdate('default_reps', Math.max(1, Math.min(100, Number(req.body.defaultReps || 12))));
  if (req.body.restSeconds !== undefined) addUpdate('rest_seconds', Math.max(10, Math.min(600, Number(req.body.restSeconds || 60))));
  const booleanMap = {
    progressiveOverload: 'progressive_overload',
    soundRestDone: 'sound_rest_done',
    vibrateRestDone: 'vibrate_rest_done',
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
  const groups = all('SELECT * FROM custom_groups WHERE user_id = ? ORDER BY created_at DESC', [userId]).map((group) => ({
    id: group.id,
    name: group.name,
    icon: group.icon,
    colorHex: group.color_hex,
    exercises: getGroupExercises(group.id)
  }));
  res.json(groups);
});

app.post('/api/groups', (req, res) => {
  const userId = getUserId(req);
  requireBody(['name'], req.body);
  const result = db.prepare('INSERT INTO custom_groups (user_id, name, icon, color_hex) VALUES (?, ?, ?, ?)').run(userId, req.body.name.trim(), req.body.icon || '💪', req.body.colorHex || '#78e0a6');
  res.status(201).json({ id: result.lastInsertRowid });
});

app.patch('/api/groups/:id', (req, res) => {
  const userId = getUserId(req);
  const groupId = Number(req.params.id);
  const group = one('SELECT * FROM custom_groups WHERE id = ? AND user_id = ?', [groupId, userId]);
  if (!group) return res.status(404).json({ error: 'Không tìm thấy Group Bài tập' });
  db.prepare('UPDATE custom_groups SET name = ?, icon = ? WHERE id = ?').run(req.body.name || group.name, req.body.icon || group.icon, groupId);
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
  const groupId = Number(req.params.groupId);
  const exerciseId = req.params.exerciseId;
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
  db.prepare('DELETE FROM group_exercises WHERE group_id = ? AND exercise_id = ?').run(Number(req.params.groupId), req.params.exerciseId);
  res.json({ ok: true });
});

app.get('/api/routines', (req, res) => {
  const userId = getUserId(req);
  const routines = all('SELECT id FROM routines WHERE user_id = ? ORDER BY created_at DESC', [userId]).map((row) => getRoutine(row.id, userId));
  const rules = all(`
    SELECT rsr.*, r.name AS routine_name
    FROM routine_schedule_rules rsr
    JOIN routines r ON r.id = rsr.routine_id
    WHERE rsr.user_id = ?
    ORDER BY mode, COALESCE(day_of_week, order_index)
  `, [userId]);
  res.json({ routines, rules });
});

app.post('/api/routines', (req, res) => {
  const userId = getUserId(req);
  requireBody(['name'], req.body);
  const result = db.prepare('INSERT INTO routines (user_id, name, color_hex) VALUES (?, ?, ?)').run(userId, req.body.name.trim(), req.body.colorHex || '#c8ff2e');
  const addGroup = db.prepare('INSERT OR IGNORE INTO routine_groups (routine_id, group_id, order_index) VALUES (?, ?, ?)');
  (req.body.groupIds || []).forEach((groupId, index) => addGroup.run(result.lastInsertRowid, groupId, index + 1));
  res.status(201).json(getRoutine(result.lastInsertRowid, userId));
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
  db.prepare('INSERT OR IGNORE INTO routine_groups (routine_id, group_id, order_index) VALUES (?, ?, ?)').run(routineId, groupId, nextOrder);
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
  if (!['FIXED', 'ROLLING'].includes(mode)) return res.status(400).json({ error: 'Invalid mode' });
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
      ws.schedule_mode,
      ws.started_at,
      ws.completed_at,
      CAST((julianday(ws.completed_at) - julianday(ws.started_at)) * 86400 AS INTEGER) AS duration_seconds,
      r.name AS routine_name,
      cg.name AS group_name,
      COUNT(wl.id) AS sets,
      COUNT(DISTINCT wl.exercise_id) AS exercises,
      (
        SELECT e.image_path
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
    imageUrl: assetUrl(row.image_path),
    duration_minutes: formatMinutes(row.duration_seconds)
  }));
}

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

  res.json({ suggestion: smartSuggestion(userId), activityCalendar: calendar, recentHistory, todaySummary });
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
  const scheduleMode = ['FREE', 'FIXED', 'ROLLING'].includes(req.body.scheduleMode) ? req.body.scheduleMode : settings.schedule_mode;
  const result = db.prepare(`
    INSERT INTO workout_sessions (user_id, routine_id, group_id, schedule_mode)
    VALUES (?, ?, ?, ?)
  `).run(userId, req.body.routineId || null, req.body.groupId || null, scheduleMode);
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
    const group = session.group_id ? {
      id: session.group_id,
      name: one('SELECT name FROM custom_groups WHERE id = ? AND user_id = ?', [session.group_id, userId])?.name,
      exercises: getGroupExercises(session.group_id)
    } : null;
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
  const group = session.group_id ? { exercises: getGroupExercises(session.group_id) } : null;
  const counts = all('SELECT exercise_id, COUNT(*) AS completed_sets FROM workout_logs WHERE session_id = ? AND user_id = ? GROUP BY exercise_id', [session.id, userId]);
  const countByExercise = new Map(counts.map((row) => [row.exercise_id, row.completed_sets]));
  const exercises = (routine?.exercises || group?.exercises || []).map((exercise) => ({ ...exercise, completedSets: countByExercise.get(exercise.id) || 0 }));
  res.json({ session, routine, exercises });
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
    const volume = exercise.sets.reduce((sum, set) => sum + Number(set.weightKg || 0) * Number(set.reps || 0), 0);
    const previousVolume = exercise.previous.reduce((sum, set) => sum + Number(set.weightKg || 0) * Number(set.reps || 0), 0);
    const maxWeight = Math.max(...exercise.sets.map((set) => Number(set.weightKg || 0)), 0);
    const previousMaxWeight = Math.max(...exercise.previous.map((set) => Number(set.weightKg || 0)), 0);
    return { ...exercise, volume, previousVolume, maxWeight, previousMaxWeight };
  });

  const totalSets = exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
  const totalVolume = exercises.reduce((sum, exercise) => sum + exercise.volume, 0);
  const improvedCount = exercises.filter((exercise) => exercise.volume > exercise.previousVolume || exercise.maxWeight > exercise.previousMaxWeight).length;
  res.json({
    session: { ...session, duration_minutes: formatMinutes(session.duration_seconds) },
    exercises,
    summary: {
      totalSets,
      totalVolume,
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
  res.status(201).json({ id: result.lastInsertRowid, setIndex });
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
  const preference = one('SELECT note, target_sets, weight_mode, manual_weight_kg, default_reps, default_weight_kg FROM exercise_notes WHERE user_id = ? AND exercise_id = ?', [userId, exerciseId]);
  const settings = one('SELECT default_sets, default_reps FROM user_settings WHERE user_id = ?', [userId]) || {};
  res.json({
    current,
    previous,
    note: preference?.note || '',
    targetSets: preference?.target_sets || settings.default_sets || 3,
    defaultReps: preference?.default_reps || settings.default_reps || 12,
    defaultWeightKg: preference?.default_weight_kg ?? null,
    weightMode: preference?.weight_mode || 'KG',
    manualWeightKg: preference?.manual_weight_kg ?? null
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
  const previous = one('SELECT note, target_sets, weight_mode, manual_weight_kg, default_reps, default_weight_kg FROM exercise_notes WHERE user_id = ? AND exercise_id = ?', [userId, req.params.id]) || {};
  const targetSets = req.body.targetSets === undefined ? Number(previous.target_sets || 3) : Math.max(1, Math.min(20, Number(req.body.targetSets || 3)));
  const requestedMode = String(req.body.weightMode || previous.weight_mode || 'KG').toUpperCase();
  const weightMode = ['KG', 'LB', 'MANUAL'].includes(requestedMode) ? requestedMode : 'KG';
  const manualWeightKg = req.body.manualWeightKg === undefined
    ? previous.manual_weight_kg ?? null
    : (req.body.manualWeightKg === null || req.body.manualWeightKg === '' ? null : Number(req.body.manualWeightKg));
  const defaultReps = req.body.defaultReps === undefined
    ? (previous.default_reps ?? null)
    : Math.max(1, Math.min(100, Number(req.body.defaultReps || 12)));
  const defaultWeightKg = req.body.defaultWeightKg === undefined
    ? (previous.default_weight_kg ?? null)
    : (req.body.defaultWeightKg === null || req.body.defaultWeightKg === '' ? null : Number(req.body.defaultWeightKg));
  db.prepare(`
    INSERT INTO exercise_notes (user_id, exercise_id, note, target_sets, weight_mode, manual_weight_kg, default_reps, default_weight_kg, updated_at)
    VALUES (?, ?, COALESCE(?, ''), ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, exercise_id) DO UPDATE SET
      target_sets = excluded.target_sets,
      weight_mode = excluded.weight_mode,
      manual_weight_kg = excluded.manual_weight_kg,
      default_reps = excluded.default_reps,
      default_weight_kg = excluded.default_weight_kg,
      updated_at = CURRENT_TIMESTAMP
  `).run(userId, req.params.id, previous.note || '', targetSets, weightMode, manualWeightKg, defaultReps, defaultWeightKg);
  res.json({ ok: true, targetSets, weightMode, manualWeightKg, defaultReps, defaultWeightKg });
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
    if (session.schedule_mode === 'ROLLING') {
      advanceRollingSchedule(userId);
    }
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
  // Chỉ THÊM training data, không xóa dữ liệu cũ (INSERT OR IGNORE)
  const tx = db.transaction(() => {
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
      db.prepare('INSERT OR IGNORE INTO custom_groups (id, user_id, name, icon, color_hex, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(group.id, userId, group.name, group.icon || '💪', group.color_hex || '#78e0a6', group.created_at);
    }
    for (const item of data.groupExercises || []) {
      db.prepare('INSERT OR IGNORE INTO group_exercises (id, group_id, exercise_id, icon, order_index) VALUES (?, ?, ?, ?, ?)').run(item.id, item.group_id, item.exercise_id, item.icon || '🏋️', item.order_index || 1);
    }
    for (const routine of data.routines || []) {
      db.prepare('INSERT OR IGNORE INTO routines (id, user_id, name, color_hex, created_at) VALUES (?, ?, ?, ?, ?)').run(routine.id, userId, routine.name, routine.color_hex || '#c8ff2e', routine.created_at);
    }
    for (const item of data.routineGroups || []) {
      db.prepare('INSERT OR IGNORE INTO routine_groups (id, routine_id, group_id, order_index) VALUES (?, ?, ?, ?)').run(item.id, item.routine_id, item.group_id, item.order_index || 1);
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

app.get('/api/backup', (req, res) => {
  const userId = getUserId(req);
  const today = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="gym-app-backup-${userId}-${today}.json"`);
  res.json({ app: 'Gym App', version: 1, userId, exportedAt: new Date().toISOString(), data: readExportTables(userId) });
});

app.post('/api/backup/import', (req, res) => {
  const userId = getUserId(req);
  requireBody(['backup'], req.body);
  importBackupData(userId, req.body.backup);
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
  console.error(error);
  res.status(error.status || 500).json({ error: error.message || 'Server error' });
});

app.listen(port, () => {
  console.log(`Family Gym API listening on http://localhost:${port}`);
});
