import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { getAuthSession, resendVerification, verifyEmail } from '../api';

export default function VerifyEmail() {
  const queryClient = useQueryClient();
  const [token] = useState(
    () => new URLSearchParams(window.location.search).get('token'),
  );
  const verificationStarted = useRef(false);
  const [verificationStatus, setVerificationStatus] = useState<
    'verifying' | 'verified' | 'failed'
  >('verifying');
  const [verificationError, setVerificationError] = useState('');
  const [studentId, setStudentId] = useState<number | null>(null);
  const [email, setEmail] = useState(() => localStorage.getItem("pendingVerificationEmail") || '');
  const [resendMessage, setResendMessage] = useState('');
  const [resendError, setResendError] = useState('');
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (!token || verificationStarted.current) return;
    verificationStarted.current = true;
    window.history.replaceState(null, '', window.location.pathname);
    void (async () => {
      try {
        await getAuthSession();
        const session = await verifyEmail(token);
        queryClient.setQueryData(['auth'], {
          user: session.user,
          csrfToken: session.csrfToken,
        });
        setStudentId(session.user.studentId);
        setVerificationStatus('verified');
      } catch (error) {
        setVerificationStatus('failed');
        setVerificationError(
          error instanceof Error ? error.message : 'Could not verify this email.',
        );
      }
    })();
  }, [token]);

  async function handleResend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResendMessage('');
    setResendError('');
    setResending(true);
    try {
      const result = await resendVerification(email);
      setResendMessage(result.message);
    } catch (error) {
      setResendError(
        error instanceof Error ? error.message : 'Could not resend the email.',
      );
    } finally {
      setResending(false);
    }
  }

  return (
    <section className="content-section form-page">
      <div className="page-heading">
        <span className="eyebrow">Email verification</span>
        <h1>{token ? 'Verify your email' : 'Resend a verification link'}</h1>
      </div>
      {token ? (
        <div className="form-card">
          {verificationStatus === 'verifying' ? (
            <p className="muted-message">Verifying your email…</p>
          ) : verificationStatus === 'verified' ? (
            <>
              <p role="status">Your email is verified and you are signed in.</p>
              <Link
                href={studentId ? '/' : '/join'}
                className="button button-primary"
              >
                {studentId ? 'Go to Home' : 'Choose your Faculty and program'}
              </Link>
            </>
          ) : (
            <>
              <p className="field-error" role="alert">{verificationError}</p>
              <p>Request a fresh verification link if this one expired.</p>
              <Link href="/verify-email" className="button button-outline">
                Resend verification email
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="form-card">
          <form className="profile-form" onSubmit={(event) => void handleResend(event)}>
            <label className="field">
              <span>Email address</span>
              <input
                type="email"
                name="email"
                autoComplete="email"
                maxLength={254}
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            {resendMessage && <p role="status">{resendMessage}</p>}
            {resendError && <p className="field-error" role="alert">{resendError}</p>}
            {import.meta.env.DEV && (
              <p className="field-hint">
                If local email delivery is unavailable, sign in with your password to get a one-time verification link.
              </p>
            )}
            <div className="form-actions">
              <button
                className="button button-primary"
                type="submit"
                disabled={resending}
              >
                {resending ? 'Sending…' : 'Resend verification email'}
              </button>
            </div>
          </form>
        </div>
      )}
      <p className="privacy-note">
        <Link href="/login">
          {import.meta.env.DEV
            ? 'Sign in to get a local verification link'
            : 'Back to sign in'}
        </Link>
      </p>
    </section>
  );
}