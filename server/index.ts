import express, {
  type ErrorRequestHandler,
  type Request,
  type Response,
} from 'express';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Database as SqlDatabase, SqlValue } from 'sql.js';
import { openDatabase, studyResourceStorageDir } from './database';
import {
  createDevelopmentVerificationUrl,
  sendVerificationEmail,
  validateEmailConfiguration,
} from './email';

type StudentRecord = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  linkedin: string | null;
  program: string;
  department: string;
  year: string;
  bio: string | null;
  photoUrl: string | null;
  createdAt: string;
  updatedAt: string;
  ownerId: number | null;
};

type Student = Omit<StudentRecord, 'ownerId'> & {
  isOwnedByCurrentUser: boolean;
};
type StudentInput = Omit<
  StudentRecord,
  'id' | 'createdAt' | 'updatedAt' | 'ownerId'
>;
type ResourceAudience = 'program' | 'all';
type StudyResourceKind = 'file' | 'video' | 'announcement';
type StudyResourceInput = {
  title: string;
  program: string;
  audience: ResourceAudience;
  kind: StudyResourceKind;
  fileName: string;
  mimeType: string;
  announcementBody: string;
  clipStartSeconds: number | null;
  clipEndSeconds: number | null;
};
type AuthenticatedUser = {
  id: number;
  email: string;
  studentId: number | null;
  csrfToken: string;
};

declare global {
  namespace Express {
    interface Request {
      authenticatedUser?: AuthenticatedUser;
    }
  }
}

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly verificationUrl?: string,
  ) {
    super(message);
  }
}

function studentFromRow(row: Record<string, SqlValue>): StudentRecord {
  return {
    id: Number(row.id),
    name: String(row.name),
    email: row.email == null ? null : String(row.email),
    phone: row.phone == null ? null : String(row.phone),
    whatsapp: row.whatsapp == null ? null : String(row.whatsapp),
    linkedin: row.linkedin == null ? null : String(row.linkedin),
    program: String(row.program),
    department: String(row.department),
    year: String(row.year),
    bio: row.bio == null ? null : String(row.bio),
    photoUrl: row.photo_url == null ? null : String(row.photo_url),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ownerId: row.owner_id == null ? null : Number(row.owner_id),
  };
}

function publicStudent(student: StudentRecord, userId: number): Student {
  const { ownerId, ...profile } = student;
  return { ...profile, isOwnedByCurrentUser: ownerId === userId };
}

function readStudent(db: SqlDatabase, id: number): StudentRecord | undefined {
  const statement = db.prepare('SELECT * FROM students WHERE id = ?');
  statement.bind([id]);
  const student = statement.step()
    ? studentFromRow(statement.getAsObject())
    : undefined;
  statement.free();
  return student;
}

const fieldLimits: Record<keyof StudentInput, number> = {
  name: 120,
  email: 254,
  phone: 40,
  whatsapp: 40,
  linkedin: 500,
  program: 120,
  department: 120,
  year: 32,
  bio: 1200,
  photoUrl: 2_800_000,
};

function stringField(
  body: Record<string, unknown>,
  key: keyof StudentInput,
  required: true,
): string;
function stringField(
  body: Record<string, unknown>,
  key: keyof StudentInput,
  required?: false,
): string | null;
function stringField(
  body: Record<string, unknown>,
  key: keyof StudentInput,
  required = false,
): string | null {
  const value = body[key];
  if (value == null || value === '') {
    if (required) {
      throw new HttpError(400, `${key} is required.`);
    }
    return null;
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, `${key} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > fieldLimits[key]) {
    throw new HttpError(400, `${key} is too long.`);
  }
  if (key === 'email' && trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new HttpError(400, 'email must be a valid email address.');
  }
  if (required && !trimmed) {
    throw new HttpError(400, `${key} is required.`);
  }
  if ((key === 'linkedin' || key === 'photoUrl') && trimmed) {
    try {
      const url = new URL(trimmed);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error();
      }
    } catch {
      if (
        key !== 'photoUrl' ||
        !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(trimmed)
      ) {
        throw new HttpError(400, `${key} must be a valid HTTP or HTTPS URL.`);
      }
    }
  }
  if (
    key === 'year' &&
    !['Level 100', 'Level 200', 'Level 300', 'Level 400', 'Postgraduate', 'Alumni'].includes(trimmed)
  ) {
    throw new HttpError(400, 'year must be a supported study level.');
  }
  return trimmed;
}

function parseStudentInput(body: unknown, current?: StudentRecord): StudentInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'A profile object is required.');
  }

  const values = body as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...current, ...values };
  return {
    name: stringField(merged, 'name', true),
    email: stringField(merged, 'email'),
    phone: stringField(merged, 'phone'),
    whatsapp: stringField(merged, 'whatsapp'),
    linkedin: stringField(merged, 'linkedin'),
    program: stringField(merged, 'program', true),
    department: stringField(merged, 'department', true),
    year: stringField(merged, 'year', true),
    bio: stringField(merged, 'bio'),
    photoUrl: stringField(merged, 'photoUrl'),
  };
}

const MAX_STUDY_RESOURCE_BYTES = 500 * 1024 * 1024;
const MAX_STUDY_RESOURCES_PER_USER = 25;
const studyResourceTypes: Record<string, { mimeType: string; kind: 'file' | 'video' }> = {
  '.pdf': { mimeType: 'application/pdf', kind: 'file' },
  '.ppt': { mimeType: 'application/vnd.ms-powerpoint', kind: 'file' },
  '.pptx': {
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    kind: 'file',
  },
  '.doc': { mimeType: 'application/msword', kind: 'file' },
  '.docx': {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind: 'file',
  },
  '.mp4': { mimeType: 'video/mp4', kind: 'video' },
  '.mov': { mimeType: 'video/quicktime', kind: 'video' },
  '.webm': { mimeType: 'video/webm', kind: 'video' },
};

function resourceBaseFields(values: Record<string, unknown>): {
  title: string;
  program: string;
  audience: ResourceAudience;
} {
  const title = typeof values.title === 'string' ? values.title.trim() : '';
  const program = typeof values.program === 'string' ? values.program.trim() : '';
  const audience = values.audience;
  if (!title || title.length > 120) {
    throw new HttpError(400, 'Title is required and must be 120 characters or fewer.');
  }
  if (!program || program.length > 120) {
    throw new HttpError(400, 'Choose a valid program.');
  }
  if (audience !== 'program' && audience !== 'all') {
    throw new HttpError(400, 'Choose who can view this resource.');
  }
  return { title, program, audience };
}

function parseStudyAnnouncement(body: unknown): StudyResourceInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'A resource object is required.');
  }
  const values = body as Record<string, unknown>;
  if (values.kind !== 'announcement') {
    throw new HttpError(400, 'Choose an announcement to post.');
  }
  const { title, program, audience } = resourceBaseFields(values);
  const announcementBody =
    typeof values.announcementBody === 'string' ? values.announcementBody.trim() : '';
  if (!announcementBody || announcementBody.length > 5000) {
    throw new HttpError(400, 'Announcement text is required and must be 5,000 characters or fewer.');
  }
  return {
    title,
    program,
    audience,
    kind: 'announcement',
    fileName: '',
    mimeType: '',
    announcementBody,
    clipStartSeconds: null,
    clipEndSeconds: null,
  };
}

function parseVideoTime(value: unknown, label: string, optional = false): number | null {
  if ((value == null || value === '') && optional) return null;
  if (typeof value !== 'string') {
    throw new HttpError(400, `${label} must use HH:MM:SS format.`);
  }
  const match = /^(\d{1,6}):([0-5]\d):([0-5]\d)$/.exec(value);
  if (!match) throw new HttpError(400, `${label} must use HH:MM:SS format.`);
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  if (!Number.isSafeInteger(seconds)) {
    throw new HttpError(400, `${label} is outside the supported range.`);
  }
  return seconds;
}

function parseStudyResourceUpload(query: unknown, mimeType: string): StudyResourceInput {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    throw new HttpError(400, 'Resource upload details are required.');
  }
  const values = query as Record<string, unknown>;
  const { title, program, audience } = resourceBaseFields(values);
  const rawFileName = typeof values.fileName === 'string' ? values.fileName : '';
  const fileName = rawFileName.replace(/\\/g, '/').split('/').pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, '').trim() ?? '';
  if (!fileName || fileName.length > 180) {
    throw new HttpError(400, 'Choose a file with a valid file name.');
  }
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  const type = studyResourceTypes[extension];
  if (!type || type.mimeType !== mimeType) {
    throw new HttpError(400, 'Use a supported PDF, PowerPoint, Word, MP4, MOV, or WebM file.');
  }
  const clipStartSeconds =
    type.kind === 'video' ? parseVideoTime(values.clipStart ?? '00:00:00', 'Clip start time') : null;
  const clipEndSeconds =
    type.kind === 'video' ? parseVideoTime(values.clipEnd, 'Clip end time', true) : null;
  if (
    clipStartSeconds !== null &&
    clipEndSeconds !== null &&
    clipEndSeconds <= clipStartSeconds
  ) {
    throw new HttpError(400, 'Clip end time must be after the start time.');
  }
  return {
    title,
    program,
    audience,
    kind: type.kind,
    fileName,
    mimeType,
    announcementBody: '',
    clipStartSeconds,
    clipEndSeconds,
  };
}

function hasValidResourceSignature(extension: string, signature: Buffer): boolean {
  if (extension === '.pdf') return signature.subarray(0, 5).toString('ascii') === '%PDF-';
  if (extension === '.doc' || extension === '.ppt') {
    return signature.subarray(0, 8).equals(
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    );
  }
  if (extension === '.docx' || extension === '.pptx') {
    return signature.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  }
  if (extension === '.webm') {
    return signature.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  }
  return signature.subarray(4, 8).toString('ascii') === 'ftyp';
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sessionCookieName =
  process.env.NODE_ENV === 'production' ? '__Host-puc_session' : 'puc_session';
const csrfCookieName =
  process.env.NODE_ENV === 'production' ? '__Host-puc_csrf' : 'puc_csrf';
const secureCookie = process.env.NODE_ENV === 'production';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function setCookie(
  res: Response,
  name: string,
  value: string,
  options: { httpOnly: boolean; maxAge?: number },
): void {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'SameSite=Lax',
    ...(options.httpOnly ? ['HttpOnly'] : []),
    ...(secureCookie ? ['Secure'] : []),
    ...(options.maxAge === undefined ? [] : [`Max-Age=${options.maxAge}`]),
  ];
  res.append('Set-Cookie', attributes.join('; '));
}

function clearCookie(res: Response, name: string, httpOnly: boolean): void {
  const attributes = [
    `${name}=`,
    'Path=/',
    'SameSite=Lax',
    'Max-Age=0',
    ...(httpOnly ? ['HttpOnly'] : []),
    ...(secureCookie ? ['Secure'] : []),
  ];
  res.append('Set-Cookie', attributes.join('; '));
}

function clearAuthCookies(res: Response): void {
  clearCookie(res, sessionCookieName, true);
  clearCookie(res, csrfCookieName, false);
}

function readAuthenticatedUser(
  db: SqlDatabase,
  req: Request,
): AuthenticatedUser | undefined {
  const token = readCookie(req, sessionCookieName);
  if (!token) return undefined;
  const statement = db.prepare(`
    SELECT users.id, users.email, sessions.csrf_token,
      (SELECT id FROM students WHERE owner_id = users.id) AS student_id
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
      AND users.email_verified_at IS NOT NULL
  `);
  statement.bind([hashToken(token), new Date().toISOString()]);
  const user = statement.step()
    ? statement.getAsObject()
    : undefined;
  statement.free();
  if (!user) return undefined;
  return {
    id: Number(user.id),
    email: String(user.email),
    csrfToken: String(user.csrf_token),
    studentId: user.student_id == null ? null : Number(user.student_id),
  };
}

function sameToken(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function isCsrfToken(token: string | undefined): token is string {
  return Boolean(token && /^[A-Za-z0-9_-]{43}$/.test(token));
}

function requireAuth(req: Request, res: Response, next: express.NextFunction): void {
  const user = req.authenticatedUser ?? readAuthenticatedUser(db, req);
  if (!user) {
    res.status(401).json({ error: 'Sign in to continue.' });
    return;
  }
  req.authenticatedUser = user;
  next();
}

function currentUser(req: Request): AuthenticatedUser {
  if (!req.authenticatedUser) {
    throw new HttpError(401, 'Sign in to continue.');
  }
  return req.authenticatedUser;
}

function currentStudentProgram(user: AuthenticatedUser): string {
  const statement = db.prepare(
    'SELECT program FROM students WHERE owner_id = ? AND id = ?',
  );
  statement.bind([user.id, user.studentId]);
  const program = statement.step()
    ? String(statement.getAsObject().program)
    : undefined;
  statement.free();
  if (!program) {
    throw new HttpError(403, 'Create your student profile before using study resources.');
  }
  return program;
}

function resourceStoragePath(storageKey: string): string {
  if (!/^[a-f0-9]{32}\.(?:pdf|ppt|pptx|doc|docx|mp4|mov|webm)$/.test(storageKey)) {
    throw new Error('Stored resource path is invalid.');
  }
  return join(studyResourceStorageDir, storageKey);
}

function storedResourceKeysForOwner(ownerId: number): string[] {
  const statement = db.prepare(
    'SELECT storage_key FROM study_resources WHERE owner_id = ? AND storage_key IS NOT NULL',
  );
  statement.bind([ownerId]);
  const keys: string[] = [];
  while (statement.step()) {
    keys.push(String(statement.getAsObject().storage_key));
  }
  statement.free();
  return keys;
}

async function removeStoredResources(storageKeys: string[]): Promise<void> {
  await Promise.all(
    storageKeys.map((storageKey) => rm(resourceStoragePath(storageKey), { force: true })),
  );
}

function validateResourceProgram(program: string): void {
  const statement = db.prepare('SELECT 1 FROM students WHERE program = ? LIMIT 1');
  statement.bind([program]);
  const exists = statement.step();
  statement.free();
  if (!exists) throw new HttpError(400, 'Choose a program in the directory.');
}

function assertStudyResourceCapacity(userId: number): void {
  const statement = db.prepare(
    'SELECT COUNT(*) AS count FROM study_resources WHERE owner_id = ?',
  );
  statement.bind([userId]);
  const count = statement.step() ? Number(statement.getAsObject().count) : 0;
  statement.free();
  if (count >= MAX_STUDY_RESOURCES_PER_USER) {
    throw new HttpError(409, 'You have reached the limit of 25 shared items.');
  }
}

function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

function parseCredentials(body: unknown): { email: string; password: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Email and password are required.');
  }
  const values = body as Record<string, unknown>;
  if (typeof values.email !== 'string' || typeof values.password !== 'string') {
    throw new HttpError(400, 'Email and password are required.');
  }
  const email = values.email.trim().toLowerCase();
  const password = values.password;
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    Array.from(password).length < 8 ||
    Array.from(password).length > 128 ||
    Buffer.byteLength(password, 'utf8') > 512
  ) {
    throw new HttpError(400, 'Enter a valid email and a password of 8 to 128 characters.');
  }
  return { email, password };
}

function parseEmail(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'A valid email address is required.');
  }
  const value = (body as Record<string, unknown>).email;
  if (
    typeof value !== 'string' ||
    value.trim().length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  ) {
    throw new HttpError(400, 'A valid email address is required.');
  }
  return value.trim().toLowerCase();
}

function createEmailVerification(userId: number): string {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.run('DELETE FROM email_verifications WHERE user_id = ?', [userId]);
  db.run(
    'INSERT INTO email_verifications (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
    [hashToken(token), userId, expiresAt],
  );
  return token;
}

async function deliverVerificationEmail(
  email: string,
  token: string,
  requestOrigin?: string,
): Promise<boolean> {
  try {
    return await sendVerificationEmail(email, token, requestOrigin);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown email delivery error.';
    console.error(`Verification email delivery failed: ${reason}`);
    if (process.env.NODE_ENV !== 'production') return false;
    throw new HttpError(
      503,
      'The account is saved, but the verification email could not be sent. Try resending later.',
    );
  }
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof HttpError) {
    res.status(error.status).json({
      error: error.message,
      ...(error.verificationUrl ? { verificationUrl: error.verificationUrl } : {}),
    });
    return;
  }
  if (
    error &&
    typeof error === 'object' &&
    'type' in error &&
    error.type === 'entity.too.large'
  ) {
    res.status(413).json({ error: 'Request body is too large.' });
    return;
  }
  if (error instanceof SyntaxError) {
    res.status(400).json({ error: 'Request body must contain valid JSON.' });
    return;
  }
  console.error(error);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
}

function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>,
): express.RequestHandler {
  return (req, res, next) => {
    void handler(req, res).catch(next);
  };
}

const host = process.env.HOST ?? '127.0.0.1';
if (host !== '127.0.0.1' && host !== 'localhost' && !secureCookie) {
  throw new Error('Set NODE_ENV=production before binding to a non-local host.');
}
if (secureCookie) validateEmailConfiguration();
const { db, save } = await openDatabase();
const app = express();
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) {
  throw new Error('TRUST_PROXY_HOPS must be a non-negative integer.');
}
app.set('trust proxy', trustProxyHops);
app.disable('x-powered-by');

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'",
  );
  if (secureCookie) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  if (_req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});
app.use(express.json({ limit: '3mb' }));

const authAttempts = new Map<string, { count: number; resetAt: number }>();
function limitAuthAttempts(req: Request, res: Response, next: express.NextFunction): void {
  const now = Date.now();
  const address = req.ip || req.socket.remoteAddress || 'unknown';
  const key = `${address}:${req.path}`;
  const attempt = authAttempts.get(key);
  if (!attempt || attempt.resetAt <= now) {
    authAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
  } else if (attempt.count >= 10) {
    res.status(429).json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' });
    return;
  } else {
    attempt.count += 1;
  }
  if (authAttempts.size > 10_000) {
    for (const [address, entry] of authAttempts) {
      if (entry.resetAt <= now) authAttempts.delete(address);
    }
  }
  next();
}

app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }
  const user = readAuthenticatedUser(db, req);
  const expectedToken = user?.csrfToken ?? readCookie(req, csrfCookieName);
  const suppliedToken = req.get('X-CSRF-Token');
  if (!sameToken(expectedToken, suppliedToken)) {
    res.status(403).json({ error: 'The security token is missing or expired. Refresh and try again.' });
    return;
  }
  if (user) req.authenticatedUser = user;
  next();
});

function createSession(userId: number): { token: string; csrfToken: string } {
  const token = randomToken();
  const csrfToken = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.run('DELETE FROM sessions WHERE expires_at <= ?', [new Date().toISOString()]);
  db.run(
    'INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)',
    [hashToken(token), userId, csrfToken, expiresAt],
  );
  return { token, csrfToken };
}

function setSessionCookies(
  res: Response,
  session: { token: string; csrfToken: string },
): void {
  setCookie(res, sessionCookieName, session.token, {
    httpOnly: true,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  setCookie(res, csrfCookieName, session.csrfToken, {
    httpOnly: false,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

app.get('/api/auth/session', (req, res) => {
  const user = readAuthenticatedUser(db, req);
  if (!user) {
    if (readCookie(req, sessionCookieName)) {
      clearCookie(res, sessionCookieName, true);
    }
    const cookieToken = readCookie(req, csrfCookieName);
    const csrfToken = isCsrfToken(cookieToken) ? cookieToken : randomToken();
    if (csrfToken !== cookieToken) {
      setCookie(res, csrfCookieName, csrfToken, { httpOnly: false });
    }
    res.json({ user: null, csrfToken });
    return;
  }
  setCookie(res, csrfCookieName, user.csrfToken, {
    httpOnly: false,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  res.json({
    user: { id: user.id, email: user.email, studentId: user.studentId },
    csrfToken: user.csrfToken,
  });
});

app.post(
  '/api/auth/register',
  limitAuthAttempts,
  asyncRoute(async (req, res) => {
    const { email, password } = parseCredentials(req.body);
    const salt = randomBytes(16);
    const passwordHash = await derivePassword(password, salt);
    let userId: number;
    try {
      db.run(
        `INSERT INTO users
          (email, password_salt, password_hash, created_at, email_verified_at)
         VALUES (?, ?, ?, ?, ?)`,
        [email, salt.toString('hex'), passwordHash.toString('hex'), new Date().toISOString(), new Date().toISOString()],
      );
      userId = Number(db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0]);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes('UNIQUE constraint failed: users.email')
      ) {
        throw error;
      }
      const existingStatement = db.prepare(
        'SELECT id, email_verified_at FROM users WHERE email = ?',
      );
      existingStatement.bind([email]);
      const existingAccount = existingStatement.step()
        ? existingStatement.getAsObject()
        : undefined;
      existingStatement.free();
      if (!existingAccount) throw error;
      if (existingAccount.email_verified_at == null) {
        const token = createEmailVerification(Number(existingAccount.id));
        await save();
        const delivered = await deliverVerificationEmail(email, token, req.get('origin'));
        if (!delivered) {
          res.status(202).json({
            message:
              'Email is unavailable in this development server. Sign in with your password to get a one-time verification link.',
          });
          return;
        }
      }
      res.status(202).json({
        message: 'If a verification message is needed, check your email.',
      });
      return;
    }
    const session = createSession(userId);
    await save();
    setSessionCookies(res, session);
    res.status(201).json({
      user: { id: userId, email, studentId: null },
      csrfToken: session.csrfToken,
    });
  }),
);

app.post(
  '/api/auth/login',
  limitAuthAttempts,
  asyncRoute(async (req, res) => {
    const { email, password } = parseCredentials(req.body);
    const statement = db.prepare(
      'SELECT id, email, password_salt, password_hash, email_verified_at FROM users WHERE email = ?',
    );
    statement.bind([email]);
    const account = statement.step() ? statement.getAsObject() : undefined;
    statement.free();
    const salt = account
      ? Buffer.from(String(account.password_salt), 'hex')
      : Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const passwordHash = await derivePassword(password, salt);
    const storedHash = account ? Buffer.from(String(account.password_hash), 'hex') : Buffer.alloc(0);
    if (
      !account ||
      storedHash.length !== passwordHash.length ||
      !timingSafeEqual(storedHash, passwordHash)
    ) {
      throw new HttpError(401, 'Email or password is incorrect.');
    }
    const userId = Number(account.id);
    if (false) {
      const token = createEmailVerification(userId);
      await save();
      const delivered = await deliverVerificationEmail(
        String(false),
        token,
        req.get('origin'),
      );
      const verificationUrl = delivered
        ? undefined
        : createDevelopmentVerificationUrl(token, req.get('origin'));
      throw new HttpError(
        403,
        delivered
          ? 'Verify your email address using the link we just sent.'
          : 'Your email is not verified yet. Use the development link below to verify and sign in.',
        verificationUrl,
      );
    }
    const session = createSession(userId);
    await save();
    setSessionCookies(res, session);
    const profileStatement = db.prepare('SELECT id FROM students WHERE owner_id = ?');
    profileStatement.bind([userId]);
    const studentId = profileStatement.step()
      ? Number(profileStatement.getAsObject().id)
      : null;
    profileStatement.free();
    res.json({
      user: { id: userId, email: String(account.email), studentId },
      csrfToken: session.csrfToken,
    });
  }),
);

app.post(
  '/api/auth/verification/resend',
  limitAuthAttempts,
  asyncRoute(async (req, res) => {
    const email = parseEmail(req.body);
    const statement = db.prepare(
      'SELECT id FROM users WHERE email = ? AND email_verified_at IS NULL',
    );
    statement.bind([email]);
    const account = statement.step() ? statement.getAsObject() : undefined;
    statement.free();
    if (account) {
      const token = createEmailVerification(Number(account.id));
      await save();
      const delivered = await deliverVerificationEmail(email, token, req.get('origin'));
      if (!delivered) {
        res.status(202).json({
          message:
            'If this account is unverified, sign in with its password to get a one-time local verification link.',
        });
        return;
      }
    }
    res.status(202).json({
      message: 'If that address has an unverified account, a new link has been sent.',
    });
  }),
);

app.post(
  '/api/auth/verify-email',
  limitAuthAttempts,
  asyncRoute(async (req, res) => {
    const token =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>).token
        : undefined;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new HttpError(400, 'A valid verification token is required.');
    }
    const statement = db.prepare(
      'SELECT user_id FROM email_verifications WHERE token_hash = ? AND expires_at > ?',
    );
    statement.bind([hashToken(token), new Date().toISOString()]);
    const verification = statement.step() ? statement.getAsObject() : undefined;
    statement.free();
    if (!verification) {
      throw new HttpError(400, 'This verification link is invalid or has expired.');
    }
    const userId = Number(verification.user_id);
    db.run('UPDATE users SET email_verified_at = ? WHERE id = ?', [
      new Date().toISOString(),
      userId,
    ]);
    db.run('DELETE FROM email_verifications WHERE user_id = ?', [userId]);
    const userStatement = db.prepare(`
      SELECT email, (SELECT id FROM students WHERE owner_id = users.id) AS student_id
      FROM users WHERE id = ?
    `);
    userStatement.bind([userId]);
    const user = userStatement.step() ? userStatement.getAsObject() : undefined;
    userStatement.free();
    if (!user) throw new Error('Verified user account could not be read.');
    const session = createSession(userId);
    await save();
    setSessionCookies(res, session);
    res.json({
      verified: true,
      user: {
        id: userId,
        email: String(user.email),
        studentId: user.student_id == null ? null : Number(user.student_id),
      },
      csrfToken: session.csrfToken,
    });
  }),
);

app.post(
  '/api/auth/logout',
  asyncRoute(async (req, res) => {
    const token = readCookie(req, sessionCookieName);
    if (token) {
      db.run('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
      await save();
    }
    clearAuthCookies(res);
    res.status(204).end();
  }),
);

app.get(
  '/api/students',
  requireAuth,
  (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const department =
      typeof req.query.department === 'string' ? req.query.department.trim() : '';
    const program =
      typeof req.query.program === 'string' ? req.query.program.trim() : '';
    const year = typeof req.query.year === 'string' ? req.query.year.trim() : '';
    const parsedLimit = Number(req.query.limit);
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 100)
      : 100;
    const filters: string[] = [];
    const parameters: SqlValue[] = [];

    if (search) {
      filters.push('(name LIKE ? OR program LIKE ? OR email LIKE ?)');
      const term = `%${search}%`;
      parameters.push(term, term, term);
    }
    if (department) {
      filters.push('department = ?');
      parameters.push(department);
    }
    if (program) {
      filters.push('program = ?');
      parameters.push(program);
    }
    if (year) {
      filters.push('year = ?');
      parameters.push(year);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const statement = db.prepare(
      `SELECT * FROM students ${where} ORDER BY created_at DESC LIMIT ?`,
    );
    statement.bind([...parameters, limit]);
    const students: StudentRecord[] = [];
    while (statement.step()) {
      students.push(studentFromRow(statement.getAsObject()));
    }
    statement.free();
    const user = currentUser(req);
    res.json(students.map((student) => publicStudent(student, user.id)));
  },
);

app.post(
  '/api/students',
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = currentUser(req);
    const existingProfile = db.prepare('SELECT id FROM students WHERE owner_id = ?');
    existingProfile.bind([user.id]);
    const alreadyHasProfile = existingProfile.step();
    existingProfile.free();
    if (alreadyHasProfile) {
      throw new HttpError(409, 'Your account already has a profile.');
    }
    const student = parseStudentInput(req.body);
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO students
        (name, email, phone, whatsapp, linkedin, program, department, year, bio, photo_url, created_at, updated_at, owner_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        student.name,
        student.email,
        student.phone,
        student.whatsapp,
        student.linkedin,
        student.program,
        student.department,
        student.year,
        student.bio,
        student.photoUrl,
        now,
        now,
        user.id,
      ],
    );
    const id = Number(db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0]);
    await save();
    const created = readStudent(db, id);
    if (!created) throw new Error('Created student profile could not be read.');
    res.status(201).json(publicStudent(created, user.id));
  }),
);

app.get('/api/students/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: 'A valid profile ID is required.' });
    return;
  }
  const student = readStudent(db, id);
  if (!student) {
    res.status(404).json({ error: 'Student profile not found.' });
    return;
  }
  res.json(publicStudent(student, currentUser(req).id));
});

app.patch(
  '/api/students/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      throw new HttpError(400, 'A valid profile ID is required.');
    }
    const current = readStudent(db, id);
    if (!current || current.ownerId !== user.id) {
      throw new HttpError(404, 'Student profile not found.');
    }
    const student = parseStudentInput(req.body, current);
    db.run(
      `UPDATE students SET name = ?, email = ?, phone = ?, whatsapp = ?,
       linkedin = ?, program = ?, department = ?, year = ?, bio = ?,
       photo_url = ?, updated_at = ? WHERE id = ?`,
      [
        student.name,
        student.email,
        student.phone,
        student.whatsapp,
        student.linkedin,
        student.program,
        student.department,
        student.year,
        student.bio,
        student.photoUrl,
        new Date().toISOString(),
        id,
      ],
    );
    await save();
    const updated = readStudent(db, id);
    if (!updated) throw new Error('Updated student profile could not be read.');
    res.json(publicStudent(updated, user.id));
  }),
);

app.delete(
  '/api/students/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      throw new HttpError(400, 'A valid profile ID is required.');
    }
    const student = readStudent(db, id);
    if (!student || student.ownerId !== user.id) {
      throw new HttpError(404, 'Student profile not found.');
    }
    const storedFiles = storedResourceKeysForOwner(user.id);
    db.run('DELETE FROM study_resources WHERE owner_id = ?', [user.id]);
    db.run('DELETE FROM students WHERE id = ?', [id]);
    await save();
    await removeStoredResources(storedFiles);
    res.status(204).end();
  }),
);

app.get('/api/resources/programs', requireAuth, (_req, res) => {
  const result = db.exec(
    'SELECT DISTINCT program FROM students ORDER BY program COLLATE NOCASE',
  );
  res.json(result[0]?.values.map(([program]) => String(program)) ?? []);
});

app.get('/api/resources', requireAuth, (req, res) => {
  const user = currentUser(req);
  const studentProgram = currentStudentProgram(user);
  const selectedProgram =
    typeof req.query.program === 'string' ? req.query.program.trim() : '';
  if (selectedProgram) {
    const programStatement = db.prepare('SELECT 1 FROM students WHERE program = ? LIMIT 1');
    programStatement.bind([selectedProgram]);
    const exists = programStatement.step();
    programStatement.free();
    if (!exists) throw new HttpError(400, 'Choose a program in the directory.');
  }
  const statement = db.prepare(`
    SELECT resources.id, resources.owner_id, resources.title, resources.program,
      resources.file_name, resources.mime_type, resources.file_size,
      resources.kind, resources.announcement_body, resources.clip_start_seconds,
      resources.clip_end_seconds, resources.audience, resources.created_at,
      COALESCE(students.name, 'Student') AS uploader_name
    FROM study_resources AS resources
    LEFT JOIN students ON students.owner_id = resources.owner_id
    WHERE (resources.audience = 'all' AND (? = '' OR resources.program = ?))
      OR (resources.audience = 'program' AND resources.program = ?
        AND (? = '' OR resources.program = ?))
    ORDER BY resources.created_at DESC
  `);
  statement.bind([
    selectedProgram,
    selectedProgram,
    studentProgram,
    selectedProgram,
    selectedProgram,
  ]);
  const resources: Array<Record<string, unknown>> = [];
  while (statement.step()) {
    const row = statement.getAsObject();
    resources.push({
      id: Number(row.id),
      title: String(row.title),
      program: String(row.program),
      kind: String(row.kind),
      fileName: String(row.file_name) || null,
      mimeType: String(row.mime_type) || null,
      fileSize: Number(row.file_size),
      announcementBody: String(row.announcement_body) || null,
      clipStartSeconds: row.clip_start_seconds == null
        ? null
        : Number(row.clip_start_seconds),
      clipEndSeconds: row.clip_end_seconds == null
        ? null
        : Number(row.clip_end_seconds),
      audience: String(row.audience),
      uploadedAt: String(row.created_at),
      uploaderName: String(row.uploader_name),
      isOwnedByCurrentUser: Number(row.owner_id) === user.id,
    });
  }
  statement.free();
  res.json(resources);
});

app.post(
  '/api/resources',
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = currentUser(req);
    currentStudentProgram(user);
    const resource = parseStudyAnnouncement(req.body);
    validateResourceProgram(resource.program);
    assertStudyResourceCapacity(user.id);
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO study_resources
        (owner_id, title, program, file_name, mime_type, file_data, storage_key,
         file_size, kind, announcement_body, clip_start_seconds, clip_end_seconds,
         audience, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, NULL, NULL, ?, ?)`,
      [
        user.id,
        resource.title,
        resource.program,
        resource.fileName,
        resource.mimeType,
        '',
        resource.kind,
        resource.announcementBody,
        resource.audience,
        now,
      ],
    );
    const id = Number(db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0]);
    await save();
    res.status(201).json({
      id,
      title: resource.title,
      program: resource.program,
      kind: resource.kind,
      fileName: null,
      mimeType: null,
      fileSize: 0,
      announcementBody: resource.announcementBody,
      clipStartSeconds: null,
      clipEndSeconds: null,
      audience: resource.audience,
      uploadedAt: now,
      uploaderName: 'You',
      isOwnedByCurrentUser: true,
    });
  }),
);

app.post(
  '/api/resources/upload',
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = currentUser(req);
    currentStudentProgram(user);
    const mimeType = (req.get('content-type') ?? '').split(';', 1)[0].toLowerCase();
    const resource = parseStudyResourceUpload(req.query, mimeType);
    validateResourceProgram(resource.program);
    assertStudyResourceCapacity(user.id);

    const extension = resource.fileName.slice(resource.fileName.lastIndexOf('.')).toLowerCase();
    const storageKey = `${randomBytes(16).toString('hex')}${extension}`;
    const temporaryPath = join(studyResourceStorageDir, `${storageKey}.part`);
    const destinationPath = resourceStoragePath(storageKey);
    let fileSize = 0;
    let fileTooLarge = false;
    let signature = Buffer.alloc(0);
    const inspectFile = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        if (fileTooLarge) {
          callback();
          return;
        }
        fileSize += chunk.length;
        if (fileSize > MAX_STUDY_RESOURCE_BYTES) {
          fileTooLarge = true;
          callback();
          return;
        }
        if (signature.length < 12) {
          signature = Buffer.concat([
            signature,
            chunk.subarray(0, 12 - signature.length),
          ]);
        }
        callback(null, chunk);
      },
    });

    try {
      await pipeline(req, inspectFile, createWriteStream(temporaryPath, { flags: 'wx' }));
      if (fileTooLarge) {
        throw new HttpError(413, 'Files and videos must be 500 MB or smaller.');
      }
      if (fileSize === 0) throw new HttpError(400, 'Choose a non-empty file.');
      if (!hasValidResourceSignature(extension, signature)) {
        throw new HttpError(400, 'The file content does not match its file type.');
      }
      assertStudyResourceCapacity(user.id);
      await rename(temporaryPath, destinationPath);
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO study_resources
          (owner_id, title, program, file_name, mime_type, file_data, storage_key,
           file_size, kind, announcement_body, clip_start_seconds, clip_end_seconds,
           audience, created_at)
         VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, '', ?, ?, ?, ?)`,
        [
          user.id,
          resource.title,
          resource.program,
          resource.fileName,
          resource.mimeType,
          storageKey,
          fileSize,
          resource.kind,
          resource.clipStartSeconds,
          resource.clipEndSeconds,
          resource.audience,
          now,
        ],
      );
      const id = Number(db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0]);
      try {
        await save();
      } catch (error) {
        db.run('DELETE FROM study_resources WHERE id = ?', [id]);
        throw error;
      }
      res.status(201).json({
        id,
        title: resource.title,
        program: resource.program,
        kind: resource.kind,
        fileName: resource.fileName,
        mimeType: resource.mimeType,
        fileSize,
        announcementBody: null,
        clipStartSeconds: resource.clipStartSeconds,
        clipEndSeconds: resource.clipEndSeconds,
        audience: resource.audience,
        uploadedAt: now,
        uploaderName: 'You',
        isOwnedByCurrentUser: true,
      });
    } catch (error) {
      await rm(temporaryPath, { force: true });
      await rm(destinationPath, { force: true });
      throw error;
    }
  }),
);

app.get('/api/resources/:id/download', requireAuth, (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: 'A valid resource ID is required.' });
    return;
  }
  const user = currentUser(req);
  const studentProgram = currentStudentProgram(user);
  const statement = db.prepare(`
    SELECT file_name, mime_type, file_data, storage_key, file_size, kind
    FROM study_resources
    WHERE id = ? AND (audience = 'all' OR program = ?)
  `);
  statement.bind([id, studentProgram]);
  const resource = statement.step() ? statement.getAsObject() : undefined;
  statement.free();
  if (!resource || String(resource.kind) === 'announcement') {
    res.status(404).json({ error: 'Study resource not found.' });
    return;
  }
  const fileName = String(resource.file_name);
  const downloadName = fileName.replace(/[^A-Za-z0-9._-]/g, '_') || 'study-resource';
  res.setHeader('Content-Type', String(resource.mime_type));
  const isVideo = String(resource.kind) === 'video';
  res.setHeader(
    'Content-Disposition',
    `${isVideo && req.query.download !== '1' ? 'inline' : 'attachment'}; filename="${downloadName}"`,
  );
  res.setHeader('Cache-Control', 'no-store');
  if (isVideo) res.setHeader('Accept-Ranges', 'bytes');

  const fileSize = Number(resource.file_size);
  let start = 0;
  let end = fileSize - 1;
  const range = req.get('Range');
  if (isVideo && range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      res.status(416).end();
      return;
    }
    if (match[1]) {
      start = Number(match[1]);
      if (match[2]) end = Math.min(Number(match[2]), fileSize - 1);
    } else {
      const suffixLength = Number(match[2]);
      start = Math.max(0, fileSize - suffixLength);
    }
    if (start >= fileSize || end < start || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      res.status(416).end();
      return;
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
  }
  res.setHeader('Content-Length', String(end - start + 1));
  const storageKey = resource.storage_key == null ? '' : String(resource.storage_key);
  const stream = storageKey
    ? createReadStream(resourceStoragePath(storageKey), { start, end })
    : Readable.from([
        Buffer.from(String(resource.file_data).slice(String(resource.file_data).indexOf(',') + 1), 'base64')
          .subarray(start, end + 1),
      ]);
  stream.on('error', (error: Error) => {
    if (res.headersSent) res.destroy(error);
    else next(error);
  });
  stream.pipe(res);
});

app.delete(
  '/api/resources/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      throw new HttpError(400, 'A valid resource ID is required.');
    }
    const user = currentUser(req);
    const resourceStatement = db.prepare(
      'SELECT storage_key FROM study_resources WHERE id = ? AND owner_id = ?',
    );
    resourceStatement.bind([id, user.id]);
    const resource = resourceStatement.step()
      ? resourceStatement.getAsObject()
      : undefined;
    resourceStatement.free();
    if (!resource) throw new HttpError(404, 'Study resource not found.');
    const statement = db.prepare(
      'DELETE FROM study_resources WHERE id = ? AND owner_id = ?',
    );
    statement.run([id, user.id]);
    const deleted = db.getRowsModified() > 0;
    statement.free();
    if (!deleted) throw new HttpError(404, 'Study resource not found.');
    await save();
    if (resource.storage_key != null) {
      await removeStoredResources([String(resource.storage_key)]);
    }
    res.status(204).end();
  }),
);

app.get('/api/departments', requireAuth, (_req, res) => {
  const result = db.exec(
    'SELECT DISTINCT department FROM students ORDER BY department COLLATE NOCASE',
  );
  res.json(result[0]?.values.map(([department]) => String(department)) ?? []);
});

app.get('/api/programs', requireAuth, (req, res) => {
  const department =
    typeof req.query.department === 'string' ? req.query.department.trim() : '';
  const statement = department
    ? db.prepare(
        'SELECT DISTINCT program FROM students WHERE department = ? ORDER BY program COLLATE NOCASE',
      )
    : db.prepare('SELECT DISTINCT program FROM students ORDER BY program COLLATE NOCASE');
  if (department) statement.bind([department]);
  const programs: string[] = [];
  while (statement.step()) {
    programs.push(String(statement.getAsObject().program));
  }
  statement.free();
  res.json(programs);
});

app.get('/api/stats', requireAuth, (_req, res) => {
  const result = db.exec(`
    SELECT
      COUNT(*) AS totalStudents,
      COUNT(DISTINCT department) AS departments,
      COUNT(DISTINCT program) AS programs,
      COALESCE(SUM(CASE WHEN datetime(created_at) >= datetime('now', '-7 days') THEN 1 ELSE 0 END), 0) AS recentlyJoined
    FROM students
  `);
  const [totalStudents, departments, programs, recentlyJoined] =
    result[0].values[0] as number[];
  res.json({ totalStudents, departments, programs, recentlyJoined });
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found.' });
});

const distPath = resolve('dist');
const indexPath = resolve(distPath, 'index.html');
if (existsSync(indexPath)) {
  app.use(express.static(distPath));
  app.get(/.*/, (_req, res) => res.sendFile(indexPath));
}

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  sendError(res, error);
};
app.use(errorHandler);

const port = Number(process.env.PORT ?? 3001);
app.listen(port, '0.0.0.0', () => {
  console.log(`PU Circle API listening at http://0.0.0.0:${port}`);
});
