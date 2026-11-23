import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'wouter';
import { toast } from 'sonner';
import { deleteStudent, getStudent, updateStudent } from '../api';
import { StudentForm } from '../components/StudentForm';
import type { StudentInput } from '../types';

export default function EditProfile() {
  const { id: idParam } = useParams<{ id: string }>();
  const id = Number(idParam);
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { data: student, isLoading, error } = useQuery({
    queryKey: ['student', id],
    queryFn: () => getStudent(id),
    enabled: Number.isInteger(id) && id > 0,
  });
  const update = useMutation({
    mutationFn: (data: StudentInput) => updateStudent(id, data),
  });
  const remove = useMutation({ mutationFn: () => deleteStudent(id) });

  async function onSubmit(data: StudentInput) {
    await update.mutateAsync(data);
    await queryClient.invalidateQueries();
    toast.success('Your profile has been updated.');
    navigate(`/profile/${id}`);
  }

  async function onDelete() {
    if (!window.confirm('Delete this profile? This cannot be undone.')) return;
    try {
      await remove.mutateAsync();
      await queryClient.invalidateQueries();
      toast.success('Your profile has been deleted.');
      navigate('/directory');
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : 'Could not delete the profile.');
    }
  }

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
    <section className="content-section form-page">
      <div className="page-heading">
        <span className="eyebrow">Your profile</span>
        <h1>Edit profile</h1>
        <p>Keep your information up to date for the community.</p>
      </div>
      <div className="form-card">
        <StudentForm
          key={student.id}
          student={student}
          submitLabel="Save changes"
          pending={update.isPending}
          onSubmit={onSubmit}
        />
      </div>
      <div className="danger-zone">
        <div>
          <h2>Delete profile</h2>
          <p>Remove your profile from the directory permanently.</p>
        </div>
        <button className="button button-danger" type="button" disabled={remove.isPending} onClick={() => void onDelete()}>
          {remove.isPending ? 'Deleting…' : 'Delete profile'}
        </button>
      </div>
    </section>
  );
}
