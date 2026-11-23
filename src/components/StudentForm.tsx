import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { listDepartments, listPrograms } from '../api';
import type { Student, StudentInput } from '../types';

type FormValues = StudentInput & { photoFile: File | null };

const emptyValues: FormValues = {
  name: '',
  email: '',
  phone: '',
  whatsapp: '',
  linkedin: '',
  program: '',
  department: '',
  year: '',
  bio: '',
  photoUrl: '',
  photoFile: null,
};

function toFormValues(student?: Student): FormValues {
  if (!student) return emptyValues;
  return {
    name: student.name,
    email: student.email ?? '',
    phone: student.phone ?? '',
    whatsapp: student.whatsapp ?? '',
    linkedin: student.linkedin ?? '',
    program: student.program,
    department: student.department,
    year: student.year,
    bio: student.bio ?? '',
    photoUrl: student.photoUrl ?? '',
    photoFile: null,
  };
}

function readPhoto(file: File): Promise<string> {
  if (file.size > 2 * 1024 * 1024) {
    return Promise.reject(new Error('Choose a photo smaller than 2 MB.'));
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return Promise.reject(new Error('Use a JPG, PNG, or WebP image.'));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('The photo could not be read.'));
    };
    reader.onerror = () => reject(new Error('The photo could not be read.'));
    reader.readAsDataURL(file);
  });
}

export function StudentForm({
  student,
  submitLabel,
  pending,
  onSubmit,
}: {
  student?: Student;
  submitLabel: string;
  pending: boolean;
  onSubmit: (data: StudentInput) => Promise<void>;
}) {
  const [values, setValues] = useState<FormValues>(() => toFormValues(student));
  const [preview, setPreview] = useState<string>(values.photoUrl ?? '');
  const [photoError, setPhotoError] = useState('');
  const { data: departments = [], error: departmentsError } = useQuery({
    queryKey: ['departments'],
    queryFn: listDepartments,
  });
  const { data: programs = [], error: programsError } = useQuery({
    queryKey: ['programs', values.department],
    queryFn: () => listPrograms(values.department),
    enabled: departments.includes(values.department),
  });

  useEffect(() => {
    if (!preview.startsWith('blob:')) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const photoUrl = values.photoFile
        ? await readPhoto(values.photoFile)
        : values.photoUrl;
      await onSubmit({
        name: values.name.trim(),
        email: values.email?.trim() ?? '',
        phone: values.phone?.trim() ?? '',
        whatsapp: values.whatsapp?.trim() ?? '',
        linkedin: values.linkedin?.trim() ?? '',
        program: values.program.trim(),
        department: values.department.trim(),
        year: values.year,
        bio: values.bio?.trim() ?? '',
        photoUrl,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the photo.');
    }
  }

  return (
    <form className="profile-form" onSubmit={handleSubmit}>
      <section className="form-section photo-section">
        <div className="photo-preview">
          {preview ? (
            <img src={preview} alt="Profile photo preview" />
          ) : (
            <span aria-hidden="true">{values.name.slice(0, 1).toUpperCase() || '?'}</span>
          )}
        </div>
        <div>
          <label className="field-label" htmlFor="photo">Profile photo</label>
          <input
            id="photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0] ?? null;
              update('photoFile', file);
              setPhotoError('');
              if (!file) return;
              if (file.size > 2 * 1024 * 1024) {
                setPhotoError('Choose a photo smaller than 2 MB.');
                return;
              }
              if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                setPhotoError('Use a JPG, PNG, or WebP image.');
                return;
              }
              setPreview(URL.createObjectURL(file));
            }}
          />
          <p className="field-hint">JPG, PNG, or WebP. Maximum file size: 2 MB.</p>
          {photoError && <p className="field-error">{photoError}</p>}
        </div>
      </section>

      <section className="form-section">
        <h2>Academic information</h2>
        <div className="form-grid">
          <label className="field">
            <span>Full name *</span>
            <input required maxLength={120} value={values.name} onChange={(e) => update('name', e.target.value)} />
          </label>
          <label className="field">
            <span>Faculty *</span>
            <input
              required
              maxLength={120}
              list="faculty-options"
              value={values.department}
              onChange={(e) => {
                setValues((current) => ({
                  ...current,
                  department: e.target.value,
                  program: current.department === e.target.value ? current.program : '',
                }));
              }}
            />
            <datalist id="faculty-options">
              {departments.map((department) => <option key={department} value={department} />)}
            </datalist>
            {departmentsError && <span className="field-hint">Faculty suggestions are unavailable; you can still enter one.</span>}
          </label>
          <label className="field">
            <span>Program *</span>
            <input
              required
              maxLength={120}
              list="program-options"
              value={values.program}
              onChange={(e) => update('program', e.target.value)}
            />
            <datalist id="program-options">
              {programs.map((program) => <option key={program} value={program} />)}
            </datalist>
            {programsError && (
              <span className="field-hint">Program suggestions are unavailable; you can still enter one.</span>
            )}
          </label>
          <label className="field">
            <span>Year *</span>
            <select required value={values.year} onChange={(e) => update('year', e.target.value)}>
              <option value="">Select year</option>
              <option value="Level 100">Level 100</option>
              <option value="Level 200">Level 200</option>
              <option value="Level 300">Level 300</option>
              <option value="Level 400">Level 400</option>
              <option value="Postgraduate">Postgraduate</option>
              <option value="Alumni">Alumni</option>
            </select>
          </label>
        </div>
      </section>

      <section className="form-section">
        <h2>Contact and bio</h2>
        <div className="form-grid">
          <label className="field">
            <span>Email</span>
            <input type="email" maxLength={254} value={values.email ?? ''} onChange={(e) => update('email', e.target.value)} />
          </label>
          <label className="field">
            <span>Phone</span>
            <input type="tel" maxLength={40} value={values.phone ?? ''} onChange={(e) => update('phone', e.target.value)} />
          </label>
          <label className="field">
            <span>WhatsApp</span>
            <input type="tel" maxLength={40} value={values.whatsapp ?? ''} onChange={(e) => update('whatsapp', e.target.value)} />
          </label>
          <label className="field">
            <span>LinkedIn profile URL</span>
            <input type="url" maxLength={500} placeholder="https://www.linkedin.com/in/..." value={values.linkedin ?? ''} onChange={(e) => update('linkedin', e.target.value)} />
          </label>
          <label className="field field-wide">
            <span>About you</span>
            <textarea rows={5} maxLength={1200} placeholder="Share a little about yourself, your interests, or what you'd like to connect about." value={values.bio ?? ''} onChange={(e) => update('bio', e.target.value)} />
            <span className="field-hint">{values.bio?.length ?? 0}/1200 characters</span>
          </label>
        </div>
      </section>

      <div className="form-actions">
        <button className="button button-primary" type="submit" disabled={pending || Boolean(photoError)}>
          {pending ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
