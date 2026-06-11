import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
export const uploadDir = path.join(dataDir, 'uploads');
const translationsDir = path.join(dataDir, 'exercise-translations');
const viTranslationsPath = path.join(translationsDir, 'vi.json');
const dbPath = path.join(dataDir, 'gym.sqlite');

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(translationsDir, { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

let viExerciseTranslationsCache = null;
let viExerciseTranslationsMtime = 0;

function readViExerciseTranslations() {
  try {
    const stat = fs.statSync(viTranslationsPath);
    if (!viExerciseTranslationsCache || stat.mtimeMs !== viExerciseTranslationsMtime) {
      const parsed = JSON.parse(fs.readFileSync(viTranslationsPath, 'utf8'));
      viExerciseTranslationsCache = parsed.translations || {};
      viExerciseTranslationsMtime = stat.mtimeMs;
    }
    return viExerciseTranslationsCache;
  } catch {
    return {};
  }
}

export function getExerciseTranslation(id) {
  return readViExerciseTranslations()[id] || null;
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, hash] = storedHash.split(':');
  const candidate = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), candidate);
}

export function authVersion(storedHash) {
  return storedHash ? crypto.createHash('sha256').update(storedHash).digest('hex').slice(0, 24) : null;
}

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'MEMBER',
      avatar TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY,
      schedule_mode TEXT NOT NULL DEFAULT 'FREE' CHECK (schedule_mode IN ('FREE', 'FIXED', 'ROLLING')),
      current_rolling_index INTEGER NOT NULL DEFAULT 1,
      rest_seconds INTEGER NOT NULL DEFAULT 60,
      timezone TEXT NOT NULL DEFAULT 'America/New_York',
      locale TEXT NOT NULL DEFAULT 'en-US',
      default_weight_unit TEXT NOT NULL DEFAULT 'kg',
      weight_steps_kg TEXT,
      weight_steps_lb TEXT,
      gender TEXT,
      birth_date TEXT,
      height_unit TEXT NOT NULL DEFAULT 'cm',
      distance_unit TEXT NOT NULL DEFAULT 'km',
      energy_unit TEXT NOT NULL DEFAULT 'kcal',
      clock_format TEXT NOT NULL DEFAULT '24h',
      default_sets INTEGER NOT NULL DEFAULT 3,
      default_reps INTEGER NOT NULL DEFAULT 12,
      progressive_overload INTEGER NOT NULL DEFAULT 0,
      sound_rest_done INTEGER NOT NULL DEFAULT 1,
      vibrate_rest_done INTEGER NOT NULL DEFAULT 1,
      notify_rest_done INTEGER NOT NULL DEFAULT 1,
      countdown_3s INTEGER NOT NULL DEFAULT 0,
      auto_next_set INTEGER NOT NULL DEFAULT 1,
      keep_screen_awake INTEGER NOT NULL DEFAULT 0,
      theme_mode TEXT NOT NULL DEFAULT 'light',
      primary_color TEXT NOT NULL DEFAULT '#f05a28',
      notify_workout INTEGER NOT NULL DEFAULT 0,
      notify_workout_time TEXT NOT NULL DEFAULT '18:30',
      notify_weigh INTEGER NOT NULL DEFAULT 0,
      notify_weigh_frequency TEXT NOT NULL DEFAULT 'off',
      notify_weigh_time TEXT NOT NULL DEFAULT '07:00',
      notify_progress_photo INTEGER NOT NULL DEFAULT 0,
      notify_progress_photo_frequency TEXT NOT NULL DEFAULT 'off',
      notify_water INTEGER NOT NULL DEFAULT 0,
      notify_recovery INTEGER NOT NULL DEFAULT 0,
      notify_unfinished_after_minutes INTEGER NOT NULL DEFAULT 180,
      notify_missed_workout INTEGER NOT NULL DEFAULT 0,
      notify_missed_workout_time TEXT NOT NULL DEFAULT '21:00',
      privacy_pin_lock INTEGER NOT NULL DEFAULT 0,
      privacy_hide_progress_photos INTEGER NOT NULL DEFAULT 0,
      height_cm REAL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS exercises (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      body_part TEXT,
      equipment TEXT,
      target TEXT,
      muscle_group TEXT,
      secondary_muscles_json TEXT NOT NULL DEFAULT '[]',
      instructions_en TEXT,
      instruction_steps_json TEXT NOT NULL DEFAULT '[]',
      image_path TEXT,
      gif_path TEXT,
      custom_user_id INTEGER,
      is_custom INTEGER NOT NULL DEFAULT 0,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      custom_icon TEXT,
      display_media TEXT NOT NULL DEFAULT 'auto',
      source_created_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_exercises_name ON exercises(name);
    CREATE INDEX IF NOT EXISTS idx_exercises_target ON exercises(target);
    CREATE INDEX IF NOT EXISTS idx_exercises_equipment ON exercises(equipment);
    CREATE INDEX IF NOT EXISTS idx_exercises_body_part ON exercises(body_part);

    CREATE TABLE IF NOT EXISTS custom_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '💪',
      color_hex TEXT NOT NULL DEFAULT '#78e0a6',
      order_index INTEGER NOT NULL DEFAULT 1,
      is_superset INTEGER NOT NULL DEFAULT 0,
      superset_rounds INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS group_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      exercise_id TEXT NOT NULL,
      icon TEXT,
      order_index INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (group_id) REFERENCES custom_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE,
      UNIQUE(group_id, exercise_id)
    );

    CREATE TABLE IF NOT EXISTS routines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      color_hex TEXT NOT NULL DEFAULT '#c8ff2e',
      order_index INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS routine_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      routine_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 1,
      is_superset INTEGER NOT NULL DEFAULT 0,
      superset_rounds INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (routine_id) REFERENCES routines(id) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES custom_groups(id) ON DELETE CASCADE,
      UNIQUE(routine_id, group_id)
    );

    CREATE TABLE IF NOT EXISTS routine_schedule_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      routine_id INTEGER NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('FIXED', 'ROLLING')),
      day_of_week INTEGER,
      order_index INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (routine_id) REFERENCES routines(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_fixed_day ON routine_schedule_rules(user_id, mode, day_of_week) WHERE mode = 'FIXED';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rolling_order ON routine_schedule_rules(user_id, mode, order_index) WHERE mode = 'ROLLING';

    CREATE TABLE IF NOT EXISTS workout_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      routine_id INTEGER,
      group_id INTEGER,
      schedule_mode TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (routine_id) REFERENCES routines(id) ON DELETE SET NULL,
      FOREIGN KEY (group_id) REFERENCES custom_groups(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS workout_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      exercise_id TEXT NOT NULL,
      set_index INTEGER NOT NULL,
      weight_kg REAL NOT NULL DEFAULT 0,
      weight_unit TEXT NOT NULL DEFAULT 'kg',
      reps INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES workout_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS exercise_notes (
      user_id INTEGER NOT NULL,
      exercise_id TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      target_sets INTEGER NOT NULL DEFAULT 3,
      weight_mode TEXT NOT NULL DEFAULT 'KG',
      manual_weight_kg REAL,
      default_reps INTEGER,
      default_weight_kg REAL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, exercise_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS body_weight_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      weight REAL NOT NULL,
      unit TEXT NOT NULL DEFAULT 'kg',
      logged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  if (!hasColumn('users', 'username')) {
    db.exec('ALTER TABLE users ADD COLUMN username TEXT');
  }
  if (!hasColumn('users', 'password_hash')) {
    db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
  }
  if (!hasColumn('users', 'role')) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'MEMBER'");
  }
  if (!hasColumn('custom_groups', 'icon')) {
    db.exec("ALTER TABLE custom_groups ADD COLUMN icon TEXT NOT NULL DEFAULT '💪'");
  }
  if (!hasColumn('custom_groups', 'order_index')) {
    db.exec('ALTER TABLE custom_groups ADD COLUMN order_index INTEGER NOT NULL DEFAULT 1');
    db.exec('UPDATE custom_groups SET order_index = id WHERE order_index IS NULL OR order_index = 1');
  }
  if (!hasColumn('custom_groups', 'is_superset')) {
    db.exec('ALTER TABLE custom_groups ADD COLUMN is_superset INTEGER NOT NULL DEFAULT 0');
  }
  if (!hasColumn('custom_groups', 'superset_rounds')) {
    db.exec('ALTER TABLE custom_groups ADD COLUMN superset_rounds INTEGER NOT NULL DEFAULT 1');
  }
  if (!hasColumn('routines', 'order_index')) {
    db.exec('ALTER TABLE routines ADD COLUMN order_index INTEGER NOT NULL DEFAULT 1');
    db.exec('UPDATE routines SET order_index = id WHERE order_index IS NULL OR order_index = 1');
  }
  if (!hasColumn('group_exercises', 'icon')) {
    db.exec('ALTER TABLE group_exercises ADD COLUMN icon TEXT');
  }
  if (!hasColumn('routine_groups', 'is_superset')) {
    db.exec('ALTER TABLE routine_groups ADD COLUMN is_superset INTEGER NOT NULL DEFAULT 0');
  }
  if (!hasColumn('routine_groups', 'superset_rounds')) {
    db.exec('ALTER TABLE routine_groups ADD COLUMN superset_rounds INTEGER NOT NULL DEFAULT 1');
  }
  if (!hasColumn('exercise_notes', 'target_sets')) {
    db.exec('ALTER TABLE exercise_notes ADD COLUMN target_sets INTEGER NOT NULL DEFAULT 3');
  }
  if (!hasColumn('workout_logs', 'weight_unit')) {
    db.exec("ALTER TABLE workout_logs ADD COLUMN weight_unit TEXT NOT NULL DEFAULT 'kg'");
  }
  if (!hasColumn('exercise_notes', 'weight_mode')) {
    db.exec("ALTER TABLE exercise_notes ADD COLUMN weight_mode TEXT NOT NULL DEFAULT 'KG'");
  }
  if (!hasColumn('exercise_notes', 'manual_weight_kg')) {
    db.exec('ALTER TABLE exercise_notes ADD COLUMN manual_weight_kg REAL');
  }
  if (!hasColumn('exercise_notes', 'default_reps')) {
    db.exec('ALTER TABLE exercise_notes ADD COLUMN default_reps INTEGER');
  }
  if (!hasColumn('exercise_notes', 'default_weight_kg')) {
    db.exec('ALTER TABLE exercise_notes ADD COLUMN default_weight_kg REAL');
  }
  const exerciseColumns = [
    ['custom_user_id', 'INTEGER'],
    ['is_custom', 'INTEGER NOT NULL DEFAULT 0'],
    ['is_hidden', 'INTEGER NOT NULL DEFAULT 0'],
    ['custom_icon', 'TEXT'],
    ['display_media', "TEXT NOT NULL DEFAULT 'auto'"]
  ];
  for (const [column, definition] of exerciseColumns) {
    if (!hasColumn('exercises', column)) {
      db.exec(`ALTER TABLE exercises ADD COLUMN ${column} ${definition}`);
    }
  }
  if (!hasColumn('user_settings', 'timezone')) {
    db.exec("ALTER TABLE user_settings ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/New_York'");
  }
  if (!hasColumn('user_settings', 'locale')) {
    db.exec("ALTER TABLE user_settings ADD COLUMN locale TEXT NOT NULL DEFAULT 'en-US'");
  }
  if (!hasColumn('user_settings', 'height_cm')) {
    db.exec('ALTER TABLE user_settings ADD COLUMN height_cm REAL');
  }
  if (!hasColumn('user_settings', 'default_weight_unit')) {
    db.exec("ALTER TABLE user_settings ADD COLUMN default_weight_unit TEXT NOT NULL DEFAULT 'kg'");
  }
  const userSettingColumns = [
    ['gender', "TEXT"],
    ['birth_date', "TEXT"],
    ['height_unit', "TEXT NOT NULL DEFAULT 'cm'"],
    ['distance_unit', "TEXT NOT NULL DEFAULT 'km'"],
    ['energy_unit', "TEXT NOT NULL DEFAULT 'kcal'"],
    ['clock_format', "TEXT NOT NULL DEFAULT '24h'"],
    ['default_sets', 'INTEGER NOT NULL DEFAULT 3'],
    ['default_reps', 'INTEGER NOT NULL DEFAULT 12'],
    ['weight_steps_kg', 'TEXT'],
    ['weight_steps_lb', 'TEXT'],
    ['progressive_overload', 'INTEGER NOT NULL DEFAULT 0'],
    ['sound_rest_done', 'INTEGER NOT NULL DEFAULT 1'],
    ['vibrate_rest_done', 'INTEGER NOT NULL DEFAULT 1'],
    ['notify_rest_done', 'INTEGER NOT NULL DEFAULT 1'],
    ['countdown_3s', 'INTEGER NOT NULL DEFAULT 0'],
    ['auto_next_set', 'INTEGER NOT NULL DEFAULT 1'],
    ['keep_screen_awake', 'INTEGER NOT NULL DEFAULT 0'],
    ['theme_mode', "TEXT NOT NULL DEFAULT 'light'"],
    ['primary_color', "TEXT NOT NULL DEFAULT '#f05a28'"],
    ['notify_workout', 'INTEGER NOT NULL DEFAULT 0'],
    ['notify_workout_time', "TEXT NOT NULL DEFAULT '18:30'"],
    ['notify_weigh', 'INTEGER NOT NULL DEFAULT 0'],
    ['notify_weigh_frequency', "TEXT NOT NULL DEFAULT 'off'"],
    ['notify_weigh_time', "TEXT NOT NULL DEFAULT '07:00'"],
    ['notify_progress_photo', 'INTEGER NOT NULL DEFAULT 0'],
    ['notify_progress_photo_frequency', "TEXT NOT NULL DEFAULT 'off'"],
    ['notify_water', 'INTEGER NOT NULL DEFAULT 0'],
    ['notify_recovery', 'INTEGER NOT NULL DEFAULT 0'],
    ['notify_unfinished_after_minutes', 'INTEGER NOT NULL DEFAULT 180'],
    ['notify_missed_workout', 'INTEGER NOT NULL DEFAULT 0'],
    ['notify_missed_workout_time', "TEXT NOT NULL DEFAULT '21:00'"],
    ['privacy_pin_lock', 'INTEGER NOT NULL DEFAULT 0'],
    ['privacy_hide_progress_photos', 'INTEGER NOT NULL DEFAULT 0'],
    // Weekly Goal mode: ngày reset chu kỳ (0=Mon, 6=Sun)
    ['weekly_reset_day', 'INTEGER NOT NULL DEFAULT 0'],
    // Mốc reset thủ công gần nhất (ISO string). Lấy max(naturalWeekStart, this) để tính tuần
    ['weekly_last_reset_at', 'TEXT']
  ];
  for (const [column, definition] of userSettingColumns) {
    if (!hasColumn('user_settings', column)) {
      db.exec(`ALTER TABLE user_settings ADD COLUMN ${column} ${definition}`);
    }
  }
  if (!hasColumn('workout_sessions', 'used_superset')) {
    db.exec('ALTER TABLE workout_sessions ADD COLUMN used_superset INTEGER NOT NULL DEFAULT 0');
  }
  db.prepare('UPDATE user_settings SET rest_seconds = 60 WHERE rest_seconds = 90').run();
  db.prepare('UPDATE user_settings SET auto_next_set = 1 WHERE auto_next_set = 0').run();
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)');

  const userCount = db.prepare('SELECT COUNT(*) AS total FROM users').get().total;
  const defaultAdminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  if (userCount === 0) {
    const result = db.prepare('INSERT INTO users (name, username, password_hash, role, avatar) VALUES (?, ?, ?, ?, ?)').run('admin', 'admin', hashPassword(defaultAdminPassword), 'ADMIN', 'AD');
    db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(result.lastInsertRowid);
  } else {
    const missingLogin = db.prepare('SELECT id, name FROM users WHERE username IS NULL OR password_hash IS NULL').all();
    const update = db.prepare('UPDATE users SET username = ?, password_hash = ?, avatar = COALESCE(avatar, ?) WHERE id = ?');
    for (const user of missingLogin) {
      const username = user.id === 1 ? 'admin' : `user${user.id}`;
      update.run(username, hashPassword(user.id === 1 ? 'admin123' : 'family123'), username.slice(0, 2).toUpperCase(), user.id);
    }
    db.prepare("UPDATE users SET name = 'admin', username = 'admin', password_hash = ?, avatar = 'AD', role = 'ADMIN' WHERE id = 1 AND username = 'family'").run(hashPassword('admin123'));
    db.prepare("UPDATE users SET role = 'ADMIN' WHERE id = 1").run();
  }
  db.prepare('INSERT OR IGNORE INTO user_settings (user_id) SELECT id FROM users').run();
}

export function publicExercise(row) {
  if (!row) return null;
  const translation = readViExerciseTranslations()[row.id] || null;
  const assetUrl = (value) => {
    if (!value) return null;
    if (String(value).startsWith('/')) return value;
    return `/media/${value}`;
  };
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    bodyPart: row.body_part,
    equipment: row.equipment,
    target: row.target,
    muscleGroup: row.muscle_group,
    secondaryMuscles: JSON.parse(row.secondary_muscles_json || '[]'),
    instructions: row.instructions_en,
    steps: JSON.parse(row.instruction_steps_json || '[]'),
    nameVi: translation?.nameVi || null,
    bodyPartVi: translation?.bodyPartVi || null,
    equipmentVi: translation?.equipmentVi || null,
    targetVi: translation?.targetVi || null,
    muscleGroupVi: translation?.muscleGroupVi || null,
    secondaryMusclesVi: translation?.secondaryMusclesVi || [],
    searchVi: translation?.searchVi || '',
    quickSearchVi: translation?.quickSearchVi || [],
    instructionsVi: translation?.instructionsVi || null,
    stepsVi: translation?.stepsVi || [],
    imageUrl: assetUrl(row.image_path),
    gifUrl: assetUrl(row.gif_path),
    isCustom: Boolean(row.is_custom),
    isHidden: Boolean(row.is_hidden),
    customUserId: row.custom_user_id,
    customIcon: row.custom_icon || '🏋️',
    displayMedia: row.display_media || 'auto'
  };
}

export function importHasaneyldrmDataset() {
  const sourcePath = path.join(rootDir, 'hasaneyldrm-exercises-dataset', 'data', 'exercises.json');
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing dataset file: ${sourcePath}`);
  }

  const exercises = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const upsert = db.prepare(`
    INSERT INTO exercises (
      id, name, category, body_part, equipment, target, muscle_group,
      secondary_muscles_json, instructions_en, instruction_steps_json,
      image_path, gif_path, source_created_at
    )
    VALUES (
      @id, @name, @category, @body_part, @equipment, @target, @muscle_group,
      @secondary_muscles_json, @instructions_en, @instruction_steps_json,
      @image_path, @gif_path, @source_created_at
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      category = excluded.category,
      body_part = excluded.body_part,
      equipment = excluded.equipment,
      target = excluded.target,
      muscle_group = excluded.muscle_group,
      secondary_muscles_json = excluded.secondary_muscles_json,
      instructions_en = excluded.instructions_en,
      instruction_steps_json = excluded.instruction_steps_json,
      image_path = excluded.image_path,
      gif_path = excluded.gif_path,
      source_created_at = excluded.source_created_at
  `);

  const tx = db.transaction((items) => {
    for (const item of items) {
      upsert.run({
        id: item.id,
        name: item.name,
        category: item.category || null,
        body_part: item.body_part || null,
        equipment: item.equipment || null,
        target: item.target || null,
        muscle_group: item.muscle_group || null,
        secondary_muscles_json: JSON.stringify(item.secondary_muscles || []),
        instructions_en: item.instructions?.en || null,
        instruction_steps_json: JSON.stringify(item.instruction_steps?.en || []),
        image_path: item.image || null,
        gif_path: item.gif_url || null,
        source_created_at: item.created_at || null
      });
    }
  });
  tx(exercises);
  return exercises.length;
}

export { rootDir };
