import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, hashPassword, importHasaneyldrmDataset, migrate, publicExercise, rootDir, verifyPassword } from './db.js';

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

function getUserId(req) {
  return Number(req.query.userId || req.body?.userId || req.headers['x-user-id'] || 1);
}

function one(sql, params = []) {
  return db.prepare(sql).get(...params);
}

function all(sql, params = []) {
  return db.prepare(sql).all(...params);
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

  if (req.body.scheduleMode !== undefined) {
    if (!['FREE', 'FIXED', 'ROLLING'].includes(req.body.scheduleMode)) {
      return res.status(400).json({ error: 'Invalid scheduleMode' });
    }
    updates.push('schedule_mode = ?');
    params.push(req.body.scheduleMode);
  }

  if (req.body.timezone !== undefined) {
    if (typeof req.body.timezone !== 'string' || req.body.timezone.length > 80) {
      return res.status(400).json({ error: 'Invalid timezone' });
    }
    updates.push('timezone = ?');
    params.push(req.body.timezone);
  }

  if (req.body.locale !== undefined) {
    if (typeof req.body.locale !== 'string' || req.body.locale.length > 20) {
      return res.status(400).json({ error: 'Invalid locale' });
    }
    updates.push('locale = ?');
    params.push(req.body.locale);
  }

  if (req.body.heightCm !== undefined) {
    const heightCm = req.body.heightCm === null || req.body.heightCm === '' ? null : Number(req.body.heightCm);
    if (heightCm !== null && (!Number.isFinite(heightCm) || heightCm < 50 || heightCm > 260)) {
      return res.status(400).json({ error: 'Invalid heightCm' });
    }
    updates.push('height_cm = ?');
    params.push(heightCm);
  }

  if (updates.length) {
    params.push(userId);
    db.prepare(`UPDATE user_settings SET ${updates.join(', ')} WHERE user_id = ?`).run(...params);
  }
  res.json(one('SELECT * FROM user_settings WHERE user_id = ?', [userId]));
});

app.get('/api/exercises', (req, res) => {
  const search = `%${String(req.query.q || '').trim()}%`;
  const target = req.query.target;
  const params = [];
  const where = [];
  if (req.query.q) {
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
    ORDER BY name
  `, params);
  res.json(rows.map(publicExercise));
});

app.get('/api/exercises/meta', (req, res) => {
  res.json({
    targets: all('SELECT DISTINCT target AS value FROM exercises WHERE target IS NOT NULL ORDER BY target').map((r) => r.value),
    equipment: all('SELECT DISTINCT equipment AS value FROM exercises WHERE equipment IS NOT NULL ORDER BY equipment').map((r) => r.value),
    bodyParts: all('SELECT DISTINCT body_part AS value FROM exercises WHERE body_part IS NOT NULL ORDER BY body_part').map((r) => r.value)
  });
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

app.get('/api/dashboard', (req, res) => {
  const userId = getUserId(req);
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

  const recentHistory = all(`
    SELECT
      ws.id,
      ws.schedule_mode,
      ws.started_at,
      ws.completed_at,
      CAST((julianday(ws.completed_at) - julianday(ws.started_at)) * 86400 AS INTEGER) AS duration_seconds,
      r.name AS routine_name,
      cg.name AS group_name,
      COUNT(wl.id) AS sets,
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
    LIMIT 30
  `, [userId]).map((row) => ({
    ...row,
    imageUrl: row.image_path ? `/media/${row.image_path}` : null,
    duration_minutes: formatMinutes(row.duration_seconds)
  }));

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

app.post('/api/sessions', (req, res) => {
  const userId = getUserId(req);
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
  const session = one(`
    SELECT *
    FROM workout_sessions
    WHERE user_id = ? AND status = 'ACTIVE' AND date(started_at) = date('now')
    ORDER BY started_at DESC
    LIMIT 1
  `, [userId]);
  if (!session) return res.json(null);
  const routine = session.routine_id ? getRoutine(session.routine_id, userId) : null;
  const group = session.group_id ? { exercises: getGroupExercises(session.group_id) } : null;
  res.json({ session, routine, exercises: routine?.exercises || group?.exercises || [] });
});

app.get('/api/sessions/:id', (req, res) => {
  const userId = getUserId(req);
  const session = one('SELECT * FROM workout_sessions WHERE id = ? AND user_id = ?', [Number(req.params.id), userId]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const routine = session.routine_id ? getRoutine(session.routine_id, userId) : null;
  const group = session.group_id ? { exercises: getGroupExercises(session.group_id) } : null;
  res.json({ session, routine, exercises: routine?.exercises || group?.exercises || [] });
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
        imageUrl: row.image_path ? `/media/${row.image_path}` : null,
        gifUrl: row.gif_path ? `/media/${row.gif_path}` : null,
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
  const setIndex = one('SELECT COALESCE(MAX(set_index), 0) + 1 AS next_set FROM workout_logs WHERE session_id = ? AND exercise_id = ?', [sessionId, req.body.exerciseId]).next_set;
  const result = db.prepare(`
    INSERT INTO workout_logs (session_id, user_id, exercise_id, set_index, weight_kg, reps)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessionId, userId, req.body.exerciseId, setIndex, Number(req.body.weightKg), Number(req.body.reps));
  res.status(201).json({ id: result.lastInsertRowid, setIndex });
});

app.patch('/api/logs/:id', (req, res) => {
  const userId = getUserId(req);
  requireBody(['weightKg', 'reps'], req.body);
  const logId = Number(req.params.id);
  const log = one('SELECT * FROM workout_logs WHERE id = ? AND user_id = ?', [logId, userId]);
  if (!log) return res.status(404).json({ error: 'Không tìm thấy set' });
  db.prepare('UPDATE workout_logs SET weight_kg = ?, reps = ? WHERE id = ? AND user_id = ?').run(Number(req.body.weightKg), Number(req.body.reps), logId, userId);
  res.json({ ok: true });
});

app.get('/api/sessions/:id/exercises/:exerciseId/sets', (req, res) => {
  const userId = getUserId(req);
  const sessionId = Number(req.params.id);
  const exerciseId = req.params.exerciseId;
  const current = all(`
    SELECT id, set_index, weight_kg, reps, completed_at
    FROM workout_logs
    WHERE user_id = ? AND session_id = ? AND exercise_id = ?
    ORDER BY set_index
  `, [userId, sessionId, exerciseId]);
  const previous = all(`
    SELECT wl.set_index, wl.weight_kg, wl.reps, wl.completed_at
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
  const preference = one('SELECT note, target_sets FROM exercise_notes WHERE user_id = ? AND exercise_id = ?', [userId, exerciseId]);
  res.json({ current, previous, note: preference?.note || '', targetSets: preference?.target_sets || 3 });
});

app.put('/api/exercises/:id/note', (req, res) => {
  const userId = getUserId(req);
  db.prepare(`
    INSERT INTO exercise_notes (user_id, exercise_id, note, target_sets, updated_at)
    VALUES (?, ?, ?, COALESCE((SELECT target_sets FROM exercise_notes WHERE user_id = ? AND exercise_id = ?), 3), CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, exercise_id) DO UPDATE SET note = excluded.note, updated_at = CURRENT_TIMESTAMP
  `).run(userId, req.params.id, req.body.note || '', userId, req.params.id);
  res.json({ ok: true });
});

app.put('/api/exercises/:id/preferences', (req, res) => {
  const userId = getUserId(req);
  const targetSets = Math.max(1, Math.min(20, Number(req.body.targetSets || 3)));
  db.prepare(`
    INSERT INTO exercise_notes (user_id, exercise_id, note, target_sets, updated_at)
    VALUES (?, ?, COALESCE((SELECT note FROM exercise_notes WHERE user_id = ? AND exercise_id = ?), ''), ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, exercise_id) DO UPDATE SET target_sets = excluded.target_sets, updated_at = CURRENT_TIMESTAMP
  `).run(userId, req.params.id, userId, req.params.id, targetSets);
  res.json({ ok: true });
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

  const tx = db.transaction(() => {
    db.prepare("UPDATE workout_sessions SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(session.id);
    if (session.schedule_mode === 'ROLLING') {
      const settings = one('SELECT * FROM user_settings WHERE user_id = ?', [userId]);
      const maxIndex = one("SELECT COALESCE(MAX(order_index), 0) AS max_index FROM routine_schedule_rules WHERE user_id = ? AND mode = 'ROLLING'", [userId]).max_index;
      if (maxIndex > 0) {
        const nextIndex = settings.current_rolling_index >= maxIndex ? 1 : settings.current_rolling_index + 1;
        db.prepare('UPDATE user_settings SET current_rolling_index = ? WHERE user_id = ?').run(nextIndex, userId);
      }
    }
  });
  tx();
  res.json({ ok: true, suggestion: smartSuggestion(userId) });
});

app.get('/api/analytics', (req, res) => {
  const userId = getUserId(req);
  const exerciseRows = all(`
    SELECT
      e.name,
      l.exercise_id,
      date(l.completed_at) AS day,
      MAX(l.weight_kg) AS max_weight,
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
  `, [userId]).map((row) => ({ id: row.id, name: row.name, imageUrl: row.image_path ? `/media/${row.image_path}` : null }));
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

app.get('/api/export', (req, res) => {
  const userId = getUserId(req);
  res.json({
    user: one('SELECT * FROM users WHERE id = ?', [userId]),
    settings: one('SELECT * FROM user_settings WHERE user_id = ?', [userId]),
    groups: all('SELECT * FROM custom_groups WHERE user_id = ?', [userId]),
    groupExercises: all('SELECT ge.* FROM group_exercises ge JOIN custom_groups cg ON cg.id = ge.group_id WHERE cg.user_id = ?', [userId]),
    routines: all('SELECT * FROM routines WHERE user_id = ?', [userId]),
    routineGroups: all('SELECT rg.* FROM routine_groups rg JOIN routines r ON r.id = rg.routine_id WHERE r.user_id = ?', [userId]),
    scheduleRules: all('SELECT * FROM routine_schedule_rules WHERE user_id = ?', [userId]),
    sessions: all('SELECT * FROM workout_sessions WHERE user_id = ?', [userId]),
    logs: all('SELECT * FROM workout_logs WHERE user_id = ?', [userId])
  });
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
