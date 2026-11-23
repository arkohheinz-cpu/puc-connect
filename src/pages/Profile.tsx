import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BriefcaseBusiness, Mail, MessageCircle, Pencil, Phone } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { getStudent } from '../api';

export default function Profile() {
  const { id: idParam } = useParams<{ id: string }>();
  const id = Number(idParam);
  const { data: student, isLoading, error } = useQuery({
    queryKey: ['student', id],
    queryFn: () => getStudent(id),
    enabled: Number.isInteger(id) && id > 0,
  });

  if (isLoading) return <p className="content-section muted-message">Loading profile…</p>;
  if (error || !student) {
    return (
      <section className="content-section empty-state">
        <h1>Profile not found</h1>
        <p>{error instanceof Error ? error.message : 'This profile may have been removed.'}</p>
        <Link href="/directory" className="button button-primary">Back to directory</Link>
      </section>
    );
  }

  return (
    <section className="content-section profile-section">
      <Link href="/directory" className="back-link"><ArrowLeft size={16} /> Back to directory</Link>
      <article className="profile-card">
        <div className="profile-cover" />
        <div className="profile-main">
          <div className="profile-avatar">
            {student.photoUrl
              ? <img src={student.photoUrl} alt={`${student.name}'s profile`} />
              : <span>{student.name.slice(0, 1).toUpperCase()}</span>}
          </div>
          <div className="profile-heading">
            <div>
              <span className="eyebrow">{student.department}</span>
              <h1>{student.name}</h1>
              <p>{student.program}</p>
            </div>
            {student.isOwnedByCurrentUser && (
              <Link href={`/edit/${student.id}`} className="button button-outline">
                <Pencil size={16} /> Edit profile
              </Link>
            )}
          </div>
          <div className="profile-tags">
            <span>{student.year}</span>
            <span>{student.department}</span>
          </div>
          {student.bio && (
            <section className="profile-bio">
              <h2>About</h2>
              <p>{student.bio}</p>
            </section>
          )}
          <section className="profile-contact">
            <h2>Connect</h2>
            <div className="contact-links">
              {student.email && <a href={`mailto:${student.email}`}><Mail size={17} />{student.email}</a>}
              {student.phone && <a href={`tel:${student.phone}`}><Phone size={17} />{student.phone}</a>}
              {student.whatsapp && <a href={`https://wa.me/${student.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"><MessageCircle size={17} />WhatsApp</a>}
              {student.linkedin && <a href={student.linkedin} target="_blank" rel="noreferrer"><BriefcaseBusiness size={17} />LinkedIn profile</a>}
              {!student.email && !student.phone && !student.whatsapp && !student.linkedin && (
                <p className="muted-message">No contact details have been shared.</p>
              )}
            </div>
          </section>
        </div>
      </article>
    </section>
  );
}
