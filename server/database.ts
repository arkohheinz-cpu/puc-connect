import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs, { type Database as SqlDatabase } from 'sql.js';

const databasePath = resolve(
  process.env.DATABASE_PATH ?? resolve('data', 'students.sqlite'),
);
export const studyResourceStorageDir = resolve(dirname(databasePath), 'study-resources');
const wasmPath = fileURLToPath(
  new URL('../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url),
);

export async function openDatabase(): Promise<{
  db: SqlDatabase;
  save: () => Promise<void>;
}> {
  const SQL = await initSqlJs({
    locateFile: () => wasmPath,
    useOldExtensionFunctions: true,
  });
  let db: SqlDatabase;

  if (existsSync(databasePath)) {
    db = new SQL.Database(new Uint8Array(await readFile(databasePath)));
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      email_verified_at TEXT
    )
  `);
  const userColumns = db.exec('PRAGMA table_info(users)')[0]?.values ?? [];
  if (!userColumns.some((column) => column[1] === 'email_verified_at')) {
    db.run('ALTER TABLE users ADD COLUMN email_verified_at TEXT');
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      whatsapp TEXT,
      linkedin TEXT,
      program TEXT NOT NULL,
      department TEXT NOT NULL,
      year TEXT NOT NULL,
      bio TEXT,
      photo_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      owner_id INTEGER REFERENCES users(id)
    )
  `);
  const studentColumns = db.exec('PRAGMA table_info(students)')[0]?.values ?? [];
  if (!studentColumns.some((column) => column[1] === 'owner_id')) {
    db.run('ALTER TABLE students ADD COLUMN owner_id INTEGER REFERENCES users(id)');
  }
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS students_owner_idx ON students(owner_id) WHERE owner_id IS NOT NULL');
  db.run('CREATE INDEX IF NOT EXISTS students_name_idx ON students(name)');
  db.run(`
    CREATE TABLE IF NOT EXISTS study_resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      program TEXT NOT NULL,
      file_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      file_data TEXT NOT NULL DEFAULT '',
      storage_key TEXT,
      file_size INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'file',
      announcement_body TEXT NOT NULL DEFAULT '',
      clip_start_seconds INTEGER,
      clip_end_seconds INTEGER,
      audience TEXT NOT NULL CHECK (audience IN ('program', 'all')),
      created_at TEXT NOT NULL
    )
  `);
  const resourceColumns = db.exec('PRAGMA table_info(study_resources)')[0]?.values ?? [];
  if (!resourceColumns.some((column) => column[1] === 'storage_key')) {
    db.run('ALTER TABLE study_resources ADD COLUMN storage_key TEXT');
  }
  if (!resourceColumns.some((column) => column[1] === 'kind')) {
    db.run("ALTER TABLE study_resources ADD COLUMN kind TEXT NOT NULL DEFAULT 'file'");
  }
  if (!resourceColumns.some((column) => column[1] === 'announcement_body')) {
    db.run("ALTER TABLE study_resources ADD COLUMN announcement_body TEXT NOT NULL DEFAULT ''");
  }
  if (!resourceColumns.some((column) => column[1] === 'clip_start_seconds')) {
    db.run('ALTER TABLE study_resources ADD COLUMN clip_start_seconds INTEGER');
  }
  if (!resourceColumns.some((column) => column[1] === 'clip_end_seconds')) {
    db.run('ALTER TABLE study_resources ADD COLUMN clip_end_seconds INTEGER');
  }
  db.run('CREATE INDEX IF NOT EXISTS study_resources_program_idx ON study_resources(program, audience, created_at)');
  db.run('CREATE INDEX IF NOT EXISTS study_resources_owner_idx ON study_resources(owner_id, created_at)');
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      csrf_token TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at)');
  db.run(`
    CREATE TABLE IF NOT EXISTS email_verifications (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS email_verifications_user_idx ON email_verifications(user_id)');
  db.run(`
    DELETE FROM sessions
    WHERE user_id IN (SELECT id FROM users WHERE email_verified_at IS NULL)
  `);
  await mkdir(dirname(databasePath), { recursive: true });
  await mkdir(studyResourceStorageDir, { recursive: true });

  const save = async (): Promise<void> => {
    const temporaryPath = `${databasePath}.tmp`;
    await writeFile(temporaryPath, Buffer.from(db.export()));
    await rename(temporaryPath, databasePath);
  };

  await save();
  return { db, save };
}
