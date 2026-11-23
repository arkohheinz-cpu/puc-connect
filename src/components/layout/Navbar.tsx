import { Link } from 'wouter';
import { LogOut, UserPlus, Users } from 'lucide-react';
import type { AuthUser } from '../../types';

export function Navbar({
  user,
  onLogout,
}: {
  user: AuthUser | null;
  onLogout: () => void;
}) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="brand" aria-label="PUC Connect home">
          <span className="brand-mark">
            <Users size={20} aria-hidden="true" />
          </span>
          <span>PUC Connect</span>
        </Link>
        <nav className="main-nav" aria-label="Main navigation">
          {user ? (
            <>
              <Link href="/directory">Directory</Link>
              <Link href={user.studentId ? `/profile/${user.studentId}` : '/join'}>
                {user.studentId ? 'My profile' : 'Join Directory'}
              </Link>
            </>
          ) : (
            <>
              <Link href="/login">Sign in</Link>
              <Link href="/register">Create account</Link>
            </>
          )}
        </nav>
        {user ? (
          <button className="button button-quiet header-cta" type="button" onClick={onLogout}>
            <LogOut size={16} aria-hidden="true" />
            Sign out
          </button>
        ) : (
          <Link href="/register" className="button button-primary header-cta">
            <UserPlus size={16} aria-hidden="true" />
            Sign up
          </Link>
        )}
      </div>
    </header>
  );
}
