import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { ChevronDown, LogOut, Menu as MenuIcon, UserPlus } from 'lucide-react';
import type { AuthUser } from '../../types';

export function Navbar({
  user,
  onLogout,
}: {
  user: AuthUser | null;
  onLogout: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="brand" aria-label="PUC Connect home">
          <span className="brand-mark">
            <img src="/pentecost-university-logo.jpg" alt="" />
          </span>
          <span>PUC Connect</span>
        </Link>
        {user ? (
          <div className="menu-wrapper" ref={menuRef}>
            <button
              ref={toggleRef}
              className="button button-outline menu-toggle"
              type="button"
              aria-label={menuOpen ? 'Close student menu' : 'Open student menu'}
              aria-expanded={menuOpen}
              aria-controls="student-menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MenuIcon size={17} aria-hidden="true" />
              <span className="menu-label">Menu</span>
              <ChevronDown className="menu-chevron" size={15} aria-hidden="true" />
            </button>
            <nav
              id="student-menu"
              className="student-menu"
              aria-label="Student options"
              hidden={!menuOpen}
            >
              <Link href="/directory" onClick={() => setMenuOpen(false)}>Directory</Link>
              <Link href="/resources" onClick={() => setMenuOpen(false)}>Study resources</Link>
              <Link href="/attendance" onClick={() => setMenuOpen(false)}>Attendance</Link>
              <Link
                href={user.studentId ? `/profile/${user.studentId}` : '/join'}
                onClick={() => setMenuOpen(false)}
              >
                {user.studentId ? 'My profile' : 'Join Directory'}
              </Link>
              <button
                className="student-menu-action"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onLogout();
                }}
              >
                <LogOut size={16} aria-hidden="true" />
                Sign out
              </button>
            </nav>
          </div>
        ) : (
          <nav className="main-nav" aria-label="Main navigation">
            <Link href="/login">Sign in</Link>
            <Link href="/register">Create account</Link>
          </nav>
        )}
        {!user && (
          <Link href="/register" className="button button-primary header-cta header-cta-guest">
            <UserPlus size={16} aria-hidden="true" />
            Sign up
          </Link>
        )}
      </div>
    </header>
  );
}
