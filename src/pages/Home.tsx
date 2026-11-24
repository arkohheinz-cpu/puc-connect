import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BookOpen, GraduationCap, Users } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { getAuthSession, getStats, getStudent, listStudents } from '../api';
import { StudentCard } from '../components/StudentCard';

export default function Home() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');
  const { data: auth } = useQuery({
    queryKey: ['auth'],
    queryFn: ({ signal }) => getAuthSession(signal),
  });
  const studentId = auth?.user?.studentId;
  const { data: stats, error: statsError } = useQuery({ queryKey: ['stats'], queryFn: getStats });
  const {
    data: profile,
    isLoading: profileLoading,
    error: profileError,
  } = useQuery({
    queryKey: ['student', studentId],
    queryFn: () => {
      if (studentId == null) throw new Error('Your profile is not set up.');
      return getStudent(studentId);
    },
    enabled: studentId != null,
  });
  const {
    data: classmates,
    isLoading: classmatesLoading,
    error: classmatesError,
  } = useQuery({
    queryKey: ['classmates', profile?.department, profile?.program],
    queryFn: () => {
      if (!profile) throw new Error('Your profile is not set up.');
      return listStudents({
        department: profile.department,
        program: profile.program,
        limit: 100,
      });
    },
    enabled: Boolean(profile),
  });
  const visibleClassmates = classmates?.filter(
    (student) => student.id !== profile?.id,
  );

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = search.trim();
    navigate(query ? `/directory?q=${encodeURIComponent(query)}` : '/directory');
  }

  return (
    <>
      <section className="hero">
        <div className="hero-content">
          <span className="eyebrow eyebrow-light">Pentecost University community</span>
          <h1>Find your people at <span>Pentecost University.</span></h1>
          <p>Meet students, discover new connections, and grow your university community.</p>
          <form onSubmit={handleSearch} className="hero-search">
            <input
              aria-label="Search the directory"
              placeholder="Search by name, program, or email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button className="button button-gold" type="submit">Search directory</button>
          </form>
          <Link
            href={studentId ? `/profile/${studentId}` : '/join'}
            className="hero-secondary-link"
          >
            {studentId ? 'View your profile' : 'Complete your profile'}
            <ArrowRight size={16} />
          </Link>
        </div>
        <div className="hero-decoration" aria-hidden="true">PU</div>
      </section>

      <section className="content-section stats-section" aria-label="Directory statistics">
        {statsError && <p className="field-error" role="alert">Could not load directory statistics: {statsError.message}</p>}
        <div className="stats-grid">
          <Stat icon={<Users />} value={stats?.totalStudents} label="Community members" />
          <Stat icon={<GraduationCap />} value={stats?.departments} label="Faculties" />
          <Stat icon={<BookOpen />} value={stats?.programs} label="Programs" />
        </div>
      </section>

      <section className="content-section recent-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Get connected</span>
            <h2>Your classmates</h2>
            <p>
              {profile
                ? `${profile.program} students in ${profile.department}.`
                : 'Find students in your faculty and program.'}
            </p>
          </div>
          <Link href="/directory" className="text-link">Browse directory <ArrowRight size={16} /></Link>
        </div>
        {profileLoading || classmatesLoading ? (
          <p className="muted-message">Finding your classmates…</p>
        ) : profileError || classmatesError ? (
          <p className="field-error" role="alert">
            Could not load classmates: {(profileError ?? classmatesError)?.message}
          </p>
        ) : visibleClassmates?.length ? (
          <div className="student-grid">
            {visibleClassmates.map((student) => <StudentCard key={student.id} student={student} />)}
          </div>
        ) : (
          <div className="empty-state">
            <Users size={28} />
            <h3>No classmates found yet</h3>
            <p>We’ll show students in your faculty and program as they join.</p>
            <Link href="/directory" className="button button-primary">Browse the directory</Link>
          </div>
        )}
      </section>
    </>
  );
}

function Stat({ icon, value, label }: { icon: ReactNode; value?: number; label: string }) {
  return (
    <div className="stat-card">
      <span className="stat-icon">{icon}</span>
      <strong>{value ?? '—'}</strong>
      <span>{label}</span>
    </div>
  );
}
