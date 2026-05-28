import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const dbPath = path.join(dataDir, 'gym.sqlite');

fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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
      timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
      locale TEXT NOT NULL DEFAULT 'vi-VN',
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
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS routine_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      routine_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 1,
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
  if (!hasColumn('group_exercises', 'icon')) {
    db.exec('ALTER TABLE group_exercises ADD COLUMN icon TEXT');
  }
  if (!hasColumn('exercise_notes', 'target_sets')) {
    db.exec('ALTER TABLE exercise_notes ADD COLUMN target_sets INTEGER NOT NULL DEFAULT 3');
  }
  if (!hasColumn('user_settings', 'timezone')) {
    db.exec("ALTER TABLE user_settings ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh'");
  }
  if (!hasColumn('user_settings', 'locale')) {
    db.exec("ALTER TABLE user_settings ADD COLUMN locale TEXT NOT NULL DEFAULT 'vi-VN'");
  }
  if (!hasColumn('user_settings', 'height_cm')) {
    db.exec('ALTER TABLE user_settings ADD COLUMN height_cm REAL');
  }
  db.prepare('UPDATE user_settings SET rest_seconds = 60 WHERE rest_seconds = 90').run();
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)');

  const userCount = db.prepare('SELECT COUNT(*) AS total FROM users').get().total;
  if (userCount === 0) {
    const result = db.prepare('INSERT INTO users (name, username, password_hash, role, avatar) VALUES (?, ?, ?, ?, ?)').run('admin', 'admin', hashPassword('admin123'), 'ADMIN', 'AD');
    db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(result.lastInsertRowid);
  } else {
    const missingLogin = db.prepare('SELECT id, name FROM users WHERE username IS NULL OR password_hash IS NULL').all();
    const update = db.prepare('UPDATE users SET username = ?, password_hash = ?, avatar = COALESCE(avatar, ?) WHERE id = ?');
    for (const user of missingLogin) {
      const username = user.id === 1 ? 'admin' : `user${user.id}`;
      update.run(username, hashPassword(user.id === 1 ? 'admin123' : 'family123'), username.slice(0, 2).toUpperCase(), user.id);
    }
    db.prepare("UPDATE users SET name = 'admin', username = 'admin', password_hash = ?, avatar = 'AD', role = 'ADMIN' WHERE id = 1 AND (username = 'family' OR username = 'admin')").run(hashPassword('admin123'));
  }
}

export function publicExercise(row) {
  if (!row) return null;
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
    imageUrl: row.image_path ? `/media/${row.image_path}` : null,
    gifUrl: row.gif_path ? `/media/${row.gif_path}` : null
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
