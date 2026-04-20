import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';

const searchSchema = z.object({
  token: z.string().optional(),
});

export const Route = createFileRoute('/_auth/password-reset')({
  validateSearch: searchSchema,
  component: PasswordReset,
});

function PasswordReset() {
  const { token } = useSearch({ from: '/_auth/password-reset' });
  return token ? <ResetWithToken token={token} /> : <RequestReset />;
}

function RequestReset() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/v1/onboarding/password-reset/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: 'Request failed' }));
        setError((body as { message?: string }).message ?? 'Request failed');
        return;
      }
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <main className="min-h-screen grid place-items-center bg-canvas">
        <div className="bg-surface border border-hairline rounded-md p-8 w-96 space-y-4">
          <h1 className="text-lg font-semibold">Check your email</h1>
          <p className="text-sm text-ink-2">
            If an account exists for <span className="text-ink font-medium">{email}</span>, you will
            receive a password reset link shortly. The link expires in 1 hour.
          </p>
          <a href="/login" className="block text-sm text-indigo-600 hover:underline">
            Back to sign in
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen grid place-items-center bg-canvas">
      <form
        onSubmit={onSubmit}
        className="bg-surface border border-hairline rounded-md p-8 w-96 space-y-4"
      >
        <h1 className="text-lg font-semibold">Reset password</h1>
        <p className="text-xs text-ink-2">
          Enter your email address and we will send you a reset link.
        </p>
        <label className="block text-xs text-ink-2">
          Email address
          <input
            className="mt-1 block w-full border border-hairline rounded-sm px-3 py-2 text-sm"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        {error && <p className="text-xs text-neg">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-ink text-white rounded-sm px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? 'Sending...' : 'Send reset link'}
        </button>
        <a href="/login" className="block text-center text-xs text-ink-2 hover:underline">
          Back to sign in
        </a>
      </form>
    </main>
  );
}

function ResetWithToken({ token }: { token: string }) {
  const nav = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 12) {
      setError('Password must be at least 12 characters');
      return;
    }
    if (newPassword !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/v1/onboarding/password-reset/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError((body as { message?: string }).message ?? 'Password reset failed');
        return;
      }
      nav({ to: '/login' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center bg-canvas">
      <form
        onSubmit={onSubmit}
        className="bg-surface border border-hairline rounded-md p-8 w-96 space-y-4"
      >
        <h1 className="text-lg font-semibold">Set new password</h1>
        <label className="block text-xs text-ink-2">
          New password (min. 12 characters)
          <input
            className="mt-1 block w-full border border-hairline rounded-sm px-3 py-2 text-sm"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={12}
            required
          />
        </label>
        <label className="block text-xs text-ink-2">
          Confirm new password
          <input
            className="mt-1 block w-full border border-hairline rounded-sm px-3 py-2 text-sm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </label>
        {error && <p className="text-xs text-neg">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-ink text-white rounded-sm px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? 'Updating...' : 'Set new password'}
        </button>
      </form>
    </main>
  );
}
