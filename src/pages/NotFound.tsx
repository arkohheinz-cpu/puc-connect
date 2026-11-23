import { Link } from 'wouter';

export default function NotFound() {
  return (
    <section className="content-section empty-state not-found">
      <span className="eyebrow">404</span>
      <h1>We couldn't find that page</h1>
      <p>The link may be incorrect, or the page may have moved.</p>
      <Link href="/" className="button button-primary">Return home</Link>
    </section>
  );
}
