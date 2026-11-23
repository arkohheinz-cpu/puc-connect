import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs, { type Database as SqlDatabase } from 'sql.js';

const databasePath = resolve(
  process.env.DATABASE_PATH ?? resolve('data', 'students.sqlite'),
);
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

  const save = async (): Promise<void> => {
    const temporaryPath = `${databasePath}.tmp`;
    await writeFile(temporaryPath, Buffer.from(db.export()));
    await rename(temporaryPath, databasePath);
  };

  await save();
  return { db, save };
}
