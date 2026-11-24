import type {
  AuthSession,
  Student,
  StudentInput,
  StudentStats,
  StudyResource,
  StudyResourceInput,
  StudyResourceUploadInput,
} from './types';

let csrfToken: string | null = null;

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

export function getAuthSession(signal?: AbortSignal): Promise<AuthSession> {
  return request<AuthSession>('/api/auth/session', { signal }).then((session) => {
    csrfToken = session.csrfToken;
    return session;
  });
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

export async function register(
  email: string,
  password: string,
): Promise<AuthSession | { message: string }> {
  const result = await request<AuthSession | { message: string }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if ('csrfToken' in result) csrfToken = result.csrfToken;
  return result;
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

export function listResourcePrograms(): Promise<string[]> {
  return request('/api/resources/programs');
}

export function listStudyResources(program?: string): Promise<StudyResource[]> {
  const query = program ? `?program=${encodeURIComponent(program)}` : '';
  return request(`/api/resources${query}`);
}

export function createStudyResource(data: StudyResourceInput): Promise<StudyResource> {
  return request('/api/resources', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function uploadStudyResource(
  data: StudyResourceUploadInput,
  file: File,
  onProgress: (progress: number) => void,
): Promise<StudyResource> {
  const cookieToken = readCsrfCookie();
  if (cookieToken) {
    csrfToken = cookieToken;
  } else if (!csrfToken) {
    csrfToken = (await getAuthSession()).csrfToken;
  }
  const params = new URLSearchParams({
    title: data.title,
    program: data.program,
    audience: data.audience,
    fileName: data.fileName,
  });
  if (data.clipStart) params.set('clipStart', data.clipStart);
  if (data.clipEnd) params.set('clipEnd', data.clipEnd);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/resources/upload?${params.toString()}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', data.mimeType);
    if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken);
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    xhr.addEventListener('load', () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        let errorMessage = `Request failed (${xhr.status}).`;
        try {
          const body = JSON.parse(xhr.responseText) as { error?: string };
          if (body.error) errorMessage = body.error;
        } catch {
          errorMessage = `Request failed (${xhr.status}).`;
        }
        reject(new ApiError(errorMessage));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText) as StudyResource);
      } catch {
        reject(new ApiError('The server returned an invalid upload response.'));
      }
    });
    xhr.addEventListener('error', () => {
      reject(new ApiError('A network error interrupted the upload.'));
    });
    xhr.addEventListener('abort', () => {
      reject(new ApiError('The upload was cancelled.'));
    });
    xhr.send(file);
  });
}

export function deleteStudyResource(id: number): Promise<void> {
  return request(`/api/resources/${id}`, { method: 'DELETE' });
}

export function getStudyResourceDownloadUrl(id: number, asAttachment = false): string {
  return `/api/resources/${id}/download${asAttachment ? '?download=1' : ''}`;
}
