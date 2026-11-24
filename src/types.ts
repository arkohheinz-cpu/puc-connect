export type Student = {
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
  isOwnedByCurrentUser: boolean;
};

export type StudentInput = Omit<
  Student,
  'id' | 'createdAt' | 'updatedAt' | 'isOwnedByCurrentUser'
>;

export type StudentStats = {
  totalStudents: number;
  departments: number;
  programs: number;
  recentlyJoined: number;
};

export type ResourceAudience = 'program' | 'all';
export type StudyResourceKind = 'file' | 'video' | 'announcement';

export type StudyResource = {
  id: number;
  title: string;
  program: string;
  kind: StudyResourceKind;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number;
  announcementBody: string | null;
  clipStartSeconds: number | null;
  clipEndSeconds: number | null;
  audience: ResourceAudience;
  uploadedAt: string;
  uploaderName: string;
  isOwnedByCurrentUser: boolean;
};

export type StudyResourceInput = {
  title: string;
  program: string;
  audience: ResourceAudience;
  kind: 'announcement';
  announcementBody: string;
};

export type StudyResourceUploadInput = {
  title: string;
  program: string;
  fileName: string;
  mimeType: string;
  audience: ResourceAudience;
  clipStart?: string;
  clipEnd?: string;
};

export type AuthUser = {
  id: number;
  email: string;
  studentId: number | null;
};

export type AuthSession = {
  user: AuthUser | null;
  csrfToken: string;
};
