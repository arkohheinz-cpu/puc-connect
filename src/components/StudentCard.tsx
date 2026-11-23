import { Link } from 'wouter';
import type { Student } from '../types';

export function StudentCard({ student }: { student: Student }) {
  const initials = student.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    <Link href={`/profile/${student.id}`} className="student-card">
      {student.photoUrl ? (
        <img
          className="student-card-photo"
          src={student.photoUrl}
          alt={`${student.name}'s profile`}
        />
      ) : (
        <div className="student-card-placeholder" aria-hidden="true">
          {initials}
        </div>
      )}
      <div className="student-card-body">
        <h3>{student.name}</h3>
        <p>{student.program}</p>
        <div className="card-tags">
          <span>{student.department}</span>
          <span>{student.year}</span>
        </div>
      </div>
    </Link>
  );
}
