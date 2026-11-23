import type { AuthSession, Student, StudentInput, StudentStats } from './types';

let csrfToken: string | null = null;
let authSessionRequest: Promise<AuthSession> | null = null;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly verificationUrl?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function readCsrfCookie(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const cookieNames = import.meta.env.PROD
    ? ['__Host-puc_csrf', 'puc_csrf']
    : ['puc_csrf', '__Host-puc_csrf'];
  for (const name of cookieNames) {
    const cookie = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`));
    if (!cookie) continue;
    try {
      const token = decodeURIComponent(cookie.slice(name.length + 1));
      if (/^[A-Za-z0-9_-]{43}$/.test(token)) return token;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const method = init?.method?.toUpperCase() ?? 'GET';
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const cookieToken = readCsrfCookie();
    if (cookieToken) {
      csrfToken = cookieToken;
    } else {
      const session = await getAuthSession();
      csrfToken = session.csrfToken;
    }
  }
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken);
  }
  const response = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    headers,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string; verificationUrl?: string }
      | null;
    throw new ApiError(
      body?.error || `Request failed (${response.status}).`,
      body?.verificationUrl,
    );
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function getAuthSession(): Promise<AuthSession> {
  if (!authSessionRequest) {
    authSessionRequest = request<AuthSession>('/api/auth/session')
      .then((session) => {
        csrfToken = session.csrfToken;
        return session;
      })
      .finally(() => {
        authSessionRequest = null;
      });
  }
  return authSessionRequest;
}

async function submitAuth(
  endpoint: '/api/auth/login',
  email: string,
  password: string,
): Promise<AuthSession> {
  const session = await request<AuthSession>(endpoint, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  csrfToken = session.csrfToken;
  return session;
}

export function signIn(email: string, password: string): Promise<AuthSession> {
  return submitAuth('/api/auth/login', email, password);
}

export function register(email: string, password: string): Promise<{ message: string }> {
  return request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function verifyEmail(
  token: string,
): Promise<
  AuthSession & {
    verified: boolean;
    user: NonNullable<AuthSession['user']>;
  }
> {
  const session = await request<
    AuthSession & {
      verified: boolean;
      user: NonNullable<AuthSession['user']>;
    }
  >('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  csrfToken = session.csrfToken;
  return session;
}

export function resendVerification(email: string): Promise<{ message: string }> {
  return request('/api/auth/verification/resend', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function signOut(): Promise<void> {
  await request<void>('/api/auth/logout', { method: 'POST' });
  csrfToken = null;
}

export function listStudents(filters: {
  search?: string;
  department?: string;
  program?: string;
  year?: string;
  limit?: number;
} = {}): Promise<Student[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return request(`/api/students${query ? `?${query}` : ''}`);
}

export function getStudent(id: number): Promise<Student> {
  return request(`/api/students/${id}`);
}

export function createStudent(data: StudentInput): Promise<Student> {
  return request('/api/students', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateStudent(
  id: number,
  data: Partial<StudentInput>,
): Promise<Student> {
  return request(`/api/students/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteStudent(id: number): Promise<void> {
  return request(`/api/students/${id}`, { method: 'DELETE' });
}

export function listDepartments(): Promise<string[]> {
  return request('/api/departments');
}

export function listPrograms(department?: string): Promise<string[]> {
  const query = department
    ? `?department=${encodeURIComponent(department)}`
    : '';
  return request(`/api/programs${query}`);
}

export function getStats(): Promise<StudentStats> {
  return request('/api/stats');
}
