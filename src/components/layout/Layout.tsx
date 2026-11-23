import type { ReactNode } from 'react';
import type { AuthUser } from '../../types';
import { Footer } from './Footer';
import { Navbar } from './Navbar';

export function Layout({
  children,
  user,
  onLogout,
}: {
  children: ReactNode;
  user: AuthUser | null;
  onLogout: () => void;
}) {
  return (
    <div className="app-shell">
      <Navbar user={user} onLogout={onLogout} />
      <main className="page-main">{children}</main>
      <Footer />
    </div>
  );
}
