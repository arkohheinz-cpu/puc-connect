import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download,
  Files,
  Globe2,
  Megaphone,
  Trash2,
  Upload,
  Users,
  Video,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  createStudyResource,
  deleteStudyResource,
  getAuthSession,
  getStudent,
  getStudyResourceDownloadUrl,
  listResourcePrograms,
  listStudyResources,
  uploadStudyResource,
} from '../api';
import type {
  ResourceAudience,
  StudyResourceInput,
  StudyResourceKind,
  StudyResourceUploadInput,
} from '../types';

const MAX_FILE_BYTES = 500 * 1024 * 1024;
const mimeTypes: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

function isStudyResourceKind(value: string): value is StudyResourceKind {
  return value === 'file' || value === 'video' || value === 'announcement';
}

function formatFileSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatVideoTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const remainingSeconds = (seconds % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${remainingSeconds}`;
}

function videoTimeToSeconds(value: string): number | null {
  const match = /^(\d{1,6}):([0-5]\d):([0-5]\d)$/.exec(value);
  if (!match) return null;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

export default function Resources() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<StudyResourceKind>('file');
  const [announcementBody, setAnnouncementBody] = useState('');
  const [clipStart, setClipStart] = useState('00:00:00');
  const [clipEnd, setClipEnd] = useState('');
  const [uploadProgram, setUploadProgram] = useState('');
  const [filterProgram, setFilterProgram] = useState('');
  const [audience, setAudience] = useState<ResourceAudience>('program');
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const auth = useQuery({
    queryKey: ['auth'],
    queryFn: ({ signal }) => getAuthSession(signal),
  });
  const studentId = auth.data?.user?.studentId;
  const profile = useQuery({
    queryKey: ['student', studentId],
    queryFn: () => {
      if (studentId == null) throw new Error('Your student profile is not set up.');
      return getStudent(studentId);
    },
    enabled: studentId != null,
  });
  const programs = useQuery({
    queryKey: ['resource-programs'],
    queryFn: listResourcePrograms,
  });
  const resources = useQuery({
    queryKey: ['study-resources', filterProgram],
    queryFn: () => listStudyResources(filterProgram || undefined),
  });
  const upload = useMutation({
    mutationFn: async (input: {
      title: string;
      program: string;
      audience: ResourceAudience;
      kind: StudyResourceKind;
      announcementBody: string;
      clipStart: string;
      clipEnd: string;
      file: File | null;
    }) => {
      if (input.kind === 'announcement') {
        const payload: StudyResourceInput = {
          title: input.title,
          program: input.program,
          audience: input.audience,
          kind: 'announcement',
          announcementBody: input.announcementBody,
        };
        return createStudyResource(payload);
      }
      if (!input.file) throw new Error('Choose a file to share.');
      const startSeconds = input.kind === 'video' ? videoTimeToSeconds(input.clipStart) : 0;
      const endSeconds = input.kind === 'video' && input.clipEnd
        ? videoTimeToSeconds(input.clipEnd)
        : null;
      if (startSeconds === null || (input.clipEnd && endSeconds === null)) {
        throw new Error('Enter video times in HH:MM:SS format.');
      }
      if (endSeconds !== null && endSeconds <= startSeconds) {
        throw new Error('Clip end time must be after the start time.');
      }
      if (input.file.size === 0 || input.file.size > MAX_FILE_BYTES) {
        throw new Error('Files and videos must be larger than 0 bytes and no larger than 500 MB.');
      }
      const extension = input.file.name.slice(input.file.name.lastIndexOf('.')).toLowerCase();
      const mimeType = mimeTypes[extension];
      if (!mimeType || (input.kind === 'video') !== mimeType.startsWith('video/')) {
        throw new Error(
          input.kind === 'video'
            ? 'Choose an MP4, MOV, or WebM video.'
            : 'Choose a PDF, PowerPoint, or Word file.',
        );
      }
      const payload: StudyResourceUploadInput = {
        title: input.title,
        program: input.program,
        audience: input.audience,
        fileName: input.file.name,
        mimeType,
        ...(input.kind === 'video'
          ? { clipStart: input.clipStart, ...(input.clipEnd ? { clipEnd: input.clipEnd } : {}) }
          : {}),
      };
      setUploadProgress(0);
      return uploadStudyResource(payload, input.file, setUploadProgress);
    },
    onSuccess: async (resource) => {
      toast.success(resource.kind === 'announcement' ? 'Announcement posted.' : 'Study resource shared.');
      setTitle('');
      setAnnouncementBody('');
      setFile(null);
      setClipStart('00:00:00');
      setClipEnd('');
      setUploadProgress(0);
      if (fileInput.current) fileInput.current.value = '';
      await queryClient.invalidateQueries({ queryKey: ['study-resources'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not share this resource.');
    },
  });
  const remove = useMutation({
    mutationFn: deleteStudyResource,
    onSuccess: async () => {
      toast.success('Resource removed.');
      await queryClient.invalidateQueries({ queryKey: ['study-resources'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not remove this resource.');
    },
  });

  useEffect(() => {
    if (profile.data?.program && !uploadProgram) {
      setUploadProgram(profile.data.program);
    }
  }, [profile.data?.program, uploadProgram]);

  function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (kind !== 'announcement' && !file) {
      toast.error('Choose a file to share.');
      return;
    }
    upload.mutate({
      title: title.trim(),
      program: uploadProgram,
      audience,
      kind,
      announcementBody: announcementBody.trim(),
      clipStart,
      clipEnd,
      file,
    });
  }

  function removeResource(id: number) {
    if (window.confirm('Delete this shared resource? This cannot be undone.')) {
      remove.mutate(id);
    }
  }

  return (
    <section className="content-section resources-section">
      <div className="page-heading">
        <span className="eyebrow">Learn together</span>
        <h1>Study resources</h1>
        <p>Share large study files, videos, and announcements with the students you choose.</p>
      </div>

      <div className="resource-layout">
        <form className="resource-upload form-card" onSubmit={submitUpload}>
          <div className="resource-panel-heading">
            <Upload size={19} aria-hidden="true" />
            <div>
              <h2>Share with students</h2>
              <p>Files and videos up to 500 MB; text announcements up to 5,000 characters. Up to 25 shared items per student.</p>
            </div>
          </div>
          <label className="field">
            What are you sharing?
            <select
              value={kind}
              onChange={(event) => {
                const nextKind = event.target.value;
                if (!isStudyResourceKind(nextKind)) return;
                setKind(nextKind);
                setFile(null);
                if (fileInput.current) fileInput.current.value = '';
              }}
              disabled={upload.isPending}
            >
              <option value="file">File or slides</option>
              <option value="video">Video</option>
              <option value="announcement">Announcement</option>
            </select>
          </label>
          <label className="field">
            Resource title
            <input
              maxLength={120}
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Introduction to Biology - Week 2"
            />
          </label>
          <label className="field">
            Program
            <select
              required
              value={uploadProgram}
              onChange={(event) => setUploadProgram(event.target.value)}
              disabled={programs.isLoading || !programs.data?.length}
            >
              <option value="" disabled>Select a program</option>
              {(programs.data ?? []).map((program) => (
                <option key={program} value={program}>{program}</option>
              ))}
            </select>
            <span className="field-hint">
              {audience === 'all'
                ? 'All students can access it; the program helps with browsing.'
                : 'Only students in this program can access it.'}
            </span>
          </label>
          <fieldset className="resource-audience">
            <legend>Who can access it?</legend>
            <label>
              <input
                type="radio"
                name="audience"
                value="program"
                checked={audience === 'program'}
                onChange={() => setAudience('program')}
              />
              <Users size={17} aria-hidden="true" />
              <span><strong>Selected program</strong><small>Only students in the selected program</small></span>
            </label>
            <label>
              <input
                type="radio"
                name="audience"
                value="all"
                checked={audience === 'all'}
                onChange={() => setAudience('all')}
              />
              <Globe2 size={17} aria-hidden="true" />
              <span><strong>All students</strong><small>Available to every signed-in student</small></span>
            </label>
          </fieldset>
          {kind === 'announcement' ? (
            <label className="field">
              Announcement
              <textarea
                maxLength={5000}
                required
                rows={5}
                value={announcementBody}
                onChange={(event) => setAnnouncementBody(event.target.value)}
                placeholder="Write the announcement for your selected students..."
              />
              <span className="field-hint">Maximum 5,000 characters.</span>
            </label>
          ) : (
            <label className="field">
              {kind === 'video' ? 'Video file' : 'File or slides'}
              <input
                ref={fileInput}
                type="file"
                accept={kind === 'video' ? '.mp4,.mov,.webm' : '.pdf,.ppt,.pptx,.doc,.docx'}
                required
                disabled={upload.isPending}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <span className="field-hint">
                {kind === 'video'
                  ? 'MP4, MOV, or WebM. Maximum file size: 500 MB.'
                  : 'PDF, PowerPoint, or Word. Maximum file size: 500 MB.'}
              </span>
            </label>
          )}
          {kind === 'video' && (
            <div className="video-time-fields">
              <label className="field">
                Clip start (HH:MM:SS)
                <input
                  type="text"
                  pattern="[0-9]{1,6}:[0-5][0-9]:[0-5][0-9]"
                  required
                  value={clipStart}
                  onChange={(event) => setClipStart(event.target.value)}
                  placeholder="00:00:00"
                />
              </label>
              <label className="field">
                Clip end (optional)
                <input
                  type="text"
                  pattern="[0-9]{1,6}:[0-5][0-9]:[0-5][0-9]"
                  value={clipEnd}
                  onChange={(event) => setClipEnd(event.target.value)}
                  placeholder="HH:MM:SS"
                />
              </label>
              <p className="field-hint">
                Video previews start and stop at these times; downloads contain the full video.
              </p>
            </div>
          )}
          {upload.isPending && kind !== 'announcement' && (
            <div className="upload-progress">
              <progress max={100} value={uploadProgress} aria-label="Upload progress" />
              <span>{uploadProgress === 100 ? 'Finishing upload…' : `Uploading ${uploadProgress}%`}</span>
            </div>
          )}
          {programs.error && <p className="field-error" role="alert">Could not load programs: {programs.error.message}</p>}
          <button
            className="button button-primary resource-submit"
            type="submit"
            disabled={upload.isPending || !uploadProgram}
          >
            <Upload size={16} aria-hidden="true" />
            {upload.isPending
              ? 'Sharing…'
              : kind === 'announcement'
                ? 'Post announcement'
                : kind === 'video'
                  ? 'Share video'
                  : 'Share file'}
          </button>
        </form>

        <div className="resource-list-panel">
          <div className="resource-list-heading">
            <div>
              <span className="eyebrow">Shared by students</span>
              <h2>Browse resources</h2>
            </div>
            <label>
              <span className="sr-only">Filter resources by program</span>
              <select value={filterProgram} onChange={(event) => setFilterProgram(event.target.value)}>
                <option value="">All-student items &amp; your program</option>
                {(programs.data ?? []).map((program) => (
                  <option key={program} value={program}>{program}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="resource-list-hint">
            Program-only items are visible to their selected program. All-student items can be browsed by program.
          </p>
          {resources.isLoading ? (
            <p className="muted-message">Loading study resources…</p>
          ) : resources.error ? (
            <div className="empty-state"><p className="field-error" role="alert">Could not load resources: {resources.error.message}</p></div>
          ) : resources.data?.length ? (
            <div className="resource-list">
              {resources.data.map((resource) => (
                <article className="resource-card" key={resource.id}>
                  <div className="resource-file-icon">
                    {resource.kind === 'announcement' ? (
                      <Megaphone size={20} aria-hidden="true" />
                    ) : resource.kind === 'video' ? (
                      <Video size={20} aria-hidden="true" />
                    ) : (
                      <Files size={20} aria-hidden="true" />
                    )}
                  </div>
                  <div className="resource-card-content">
                    <h3>{resource.title}</h3>
                    <p className="resource-metadata">
                      {resource.program} · {resource.kind === 'announcement'
                        ? 'Announcement'
                        : `${resource.fileName} · ${formatFileSize(resource.fileSize)}${
                            resource.kind === 'video'
                              ? ` · Clip ${formatVideoTime(resource.clipStartSeconds ?? 0)}–${
                                  resource.clipEndSeconds === null
                                    ? 'end'
                                    : formatVideoTime(resource.clipEndSeconds)
                                }`
                              : ''
                          }`}
                    </p>
                    <p className="resource-byline">
                      Shared by {resource.uploaderName} · {resource.audience === 'all' ? 'All students' : 'Program only'}
                    </p>
                    {resource.kind === 'announcement' ? (
                      <p className="resource-announcement-body">{resource.announcementBody}</p>
                    ) : resource.kind === 'video' ? (
                      <video
                        className="resource-video"
                        controls
                        preload="metadata"
                        src={getStudyResourceDownloadUrl(resource.id)}
                        aria-label={resource.title}
                        onLoadedMetadata={(event) => {
                          const start = resource.clipStartSeconds ?? 0;
                          event.currentTarget.currentTime = Math.min(start, event.currentTarget.duration);
                        }}
                        onTimeUpdate={(event) => {
                          const player = event.currentTarget;
                          const start = resource.clipStartSeconds ?? 0;
                          if (player.currentTime < start) {
                            player.currentTime = start;
                            return;
                          }
                          if (
                            resource.clipEndSeconds !== null &&
                            player.currentTime >= resource.clipEndSeconds
                          ) {
                            player.currentTime = resource.clipEndSeconds;
                            player.pause();
                          }
                        }}
                      />
                    ) : null}
                  </div>
                  <div className="resource-actions">
                    {resource.kind !== 'announcement' && (
                      <a
                        className="button button-outline"
                        href={getStudyResourceDownloadUrl(resource.id, true)}
                        aria-label={`Download ${resource.title}`}
                      >
                        <Download size={16} aria-hidden="true" />
                        Download
                      </a>
                    )}
                    {resource.isOwnedByCurrentUser && (
                      <button
                        className="button button-quiet resource-delete"
                        type="button"
                        aria-label={`Delete ${resource.title}`}
                        disabled={remove.isPending}
                        onClick={() => removeResource(resource.id)}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Files size={28} aria-hidden="true" />
              <h2>No resources shared yet</h2>
              <p>Share study files, videos, or announcements for a program or all students.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
