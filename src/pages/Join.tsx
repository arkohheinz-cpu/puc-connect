import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { toast } from 'sonner';
import { createStudent } from '../api';
import { StudentForm } from '../components/StudentForm';
import type { StudentInput } from '../types';

export default function Join() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const create = useMutation({ mutationFn: (data: StudentInput) => createStudent(data) });

  async function onSubmit(data: StudentInput) {
    await create.mutateAsync(data);
    await queryClient.invalidateQueries();
    toast.success('Your profile is ready. Meet your classmates on Home.');
    navigate('/');
  }

  return (
    <section className="content-section form-page">
      <div className="page-heading">
        <span className="eyebrow">Join the community</span>
        <h1>Create your profile</h1>
        <p>
          Choose your Faculty and program so Home can show students studying
          alongside you. Add your name and year to finish your profile.
        </p>
      </div>
      <div className="form-card">
        <StudentForm submitLabel="Publish profile" pending={create.isPending} onSubmit={onSubmit} />
      </div>
      <p className="privacy-note">Only share contact information you are comfortable making visible to others using this directory.</p>
      <Link href="/directory" className="back-link">Cancel and return to directory</Link>
    </section>
  );
}
