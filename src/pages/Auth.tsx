import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { ApiError, register, signIn } from '../api';

function AuthForm({ creatingAccount }: { creatingAccount: boolean }) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [verificationMessage, setVerificationMessage] = useState('');
  const submit = useMutation({
    mutationFn: async () => {
      if (creatingAccount) {
        return { kind: 'registered' as const, ...(await register(email, password)) };
      }
      return { kind: 'signed-in' as const, session: await signIn(email, password) };
    },
    onSuccess: (result) => {
      if (result.kind === 'registered') {
        setVerificationMessage(result.message);
        return;
      }
      queryClient.setQueryData(['auth'], result.session);
      navigate(
        result.session.user?.studentId
          ? `/profile/${result.session.user.studentId}`
          : '/join',
      );
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    setVerificationMessage('');
    if (creatingAccount && password !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }
    submit.mutate();
  }

  return (
    <section className="content-section form-page">
      <div className="page-heading">
        <span className="eyebrow">PUC Connect account</span>
        <h1>{creatingAccount ? 'Create your account' : 'Sign in'}</h1>
        <p>
          {creatingAccount
            ? 'Create an account to access the private directory and manage your profile.'
            : 'Sign in to browse the directory and manage your profile.'}
        </p>
      </div>
      <div className="form-card">
        {verificationMessage ? (
          <div role="status">
            <h2>
              {verificationMessage.startsWith('Use the development')
                ? 'Email link ready'
                : 'Check your email'}
            </h2>
            <p>
              {verificationMessage}
              {verificationMessage.startsWith('Use the development') && (
                <> Then open the link to activate <strong>{email}</strong>.</>
              )}
            </p>
            <p>
              Didn’t receive it? <Link href="/verify-email">Resend the verification email</Link>.
            </p>
          </div>
        ) : (
          <form className="profile-form" onSubmit={handleSubmit}>
            <section className="form-section">
              <label className="field">
                <span>Email address</span>
                <input
                  type="email"
                  name="email"
                  autoComplete="username"
                  maxLength={254}
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  name="password"
                  autoComplete={creatingAccount ? 'new-password' : 'current-password'}
                  minLength={8}
                  maxLength={128}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                {creatingAccount && (
                  <span className="field-hint">
                    At least 8 characters. Letters, numbers, symbols, or any combination are accepted.
                  </span>
                )}
              </label>
              {creatingAccount && (
                <label className="field">
                  <span>Confirm password</span>
                  <input
                    type="password"
                    name="confirm-password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    required
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </label>
              )}
              {(formError || submit.error) && (
                <p className="field-error" role="alert">
                  {formError || submit.error?.message}
                </p>
              )}
              {submit.error instanceof ApiError &&
                submit.error.verificationUrl && (
                  <p role="status">
                    <a
                      className="button button-outline"
                      href={submit.error.verificationUrl}
                    >
                      Verify email and sign in
                    </a>
                    <span className="field-hint">
                      {' '}Verification will sign you in automatically.
                    </span>
                  </p>
                )}
              {creatingAccount && (
                <p className="field-hint">
                  You must verify your email before signing in.
                </p>
              )}
            </section>
            <div className="form-actions">
              <button
                className="button button-primary"
                type="submit"
                disabled={submit.isPending}
              >
                {submit.isPending
                  ? 'Please wait…'
                  : creatingAccount
                    ? 'Create account'
                    : 'Sign in'}
              </button>
            </div>
          </form>
        )}
      </div>
      <p className="privacy-note">
        {creatingAccount ? 'Already have an account? ' : 'New to PUC Connect? '}
        <Link href={creatingAccount ? '/login' : '/register'}>
          {creatingAccount ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
      <p className="privacy-note">
        <Link href="/verify-email">Resend a verification email</Link>
      </p>
    </section>
  );
}

export function Login() {
  return <AuthForm creatingAccount={false} />;
}

export function Register() {
  return <AuthForm creatingAccount />;
}
