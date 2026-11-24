import { Link } from 'wouter';

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <span>PU Circle</span>
        <span>Find your people at Pentecost University.</span>
        <Link href="/directory">Explore the directory</Link>
      </div>
    </footer>
  );
}
