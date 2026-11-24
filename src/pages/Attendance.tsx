import { ClipboardCheck } from 'lucide-react';

export default function Attendance() {
  return (
    <section className="content-section resources-section">
      <div className="page-heading">
        <span className="eyebrow">Student tools</span>
        <h1>Attendance</h1>
        <p>Attendance has its own menu and will be set up as a separate feature.</p>
      </div>
      <div className="empty-state">
        <ClipboardCheck size={28} aria-hidden="true" />
        <h2>Attendance tracking is coming later</h2>
        <p>
          The planned workflow is for a lecturer or class representative to create class sessions
          and mark students present or absent.
        </p>
      </div>
    </section>
  );
}
