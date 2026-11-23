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

export type AuthUser = {
  id: number;
  email: string;
  studentId: number | null;
};

export type AuthSession = {
  user: AuthUser | null;
  csrfToken: string;
};
