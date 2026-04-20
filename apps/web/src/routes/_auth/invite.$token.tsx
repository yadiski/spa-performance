import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

export const Route = createFileRoute('/_auth/invite/$token')({
  component: InviteAccept,
});

interface InviteInfo {
  email: string;
  roles: string[];
  expiresAt: string;
}

function InviteAccept() {
  const { token } = Route.useParams();
  const nav = useNavigate();

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/onboarding/invite/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: 'Invalid invitation link' }));
          setFetchError((body as { message?: string }).message ?? 'Invalid invitation link');
          return;
        }
        const data = await res.json();
        setInvite(data as InviteInfo);
      })
      .catch(() => setFetchError('Unable to verify invitation link'));
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 12) {
      setError('Password must be at least 12 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/v1/onboarding/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
        credentials: 'include',
      });
      const body = await res.json();
      if (!res.ok) {
        setError((body as { message?: string }).message ?? 'Failed to accept invitation');
        return;
      }
      // After accepting, navigate to MFA enrollment (better-auth)
      nav({ to: '/first-login' });
    } finally {
      setLoading(false);
    }
  }

  if (fetchError) {
    return (
      <main className="min-h-screen grid place-items-center bg-canvas">
        <div className="bg-surface border border-hairline rounded-md p-8 w-96 space-y-4">
          <h1 className="text-lg font-semibold text-neg">Invalid Invitation</h1>
          <p className="text-sm text-ink-2">{fetchError}</p>
          <a href="/login" className="block text-sm text-indigo-600 hover:underline">
            Back to sign in
          </a>
        </div>
      </main>
    );
  }

  if (!invite) {
    return (
      <main className="min-h-screen grid place-items-center bg-canvas">
        <p className="text-sm text-ink-2">Verifying invitation...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen grid place-items-center bg-canvas">
      <form
        onSubmit={onSubmit}
        className="bg-surface border border-hairline rounded-md p-8 w-96 space-y-4"
      >
        <h1 className="text-lg font-semibold">Accept invitation</h1>
        <div className="text-sm text-ink-2 space-y-1">
          <p>
            You have been invited to join the performance platform as:{' '}
            <span className="text-ink font-medium">{invite.email}</span>
          </p>
          <p>
            Role(s): <span className="text-ink font-medium">{invite.roles.join(', ')}</span>
          </p>
        </div>

        <label className="block text-xs text-ink-2">
          New password (min. 12 characters)
          <input
            className="mt-1 block w-full border border-hairline rounded-sm px-3 py-2 text-sm"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={12}
            required
          />
        </label>

        <label className="block text-xs text-ink-2">
          Confirm password
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
          {loading ? 'Setting up account...' : 'Create account'}
        </button>
      </form>
    </main>
  );
}
