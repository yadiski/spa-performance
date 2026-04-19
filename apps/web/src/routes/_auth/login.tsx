import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { authClient } from '../../auth/client';

export const Route = createFileRoute('/_auth/login')({ component: Login });

function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await authClient.signIn.email({ email, password });
      if (res.error) {
        setError(res.error.message ?? 'Sign-in failed.');
        return;
      }
      const needsMfa = (res.data as { twoFactorRedirect?: boolean } | undefined)?.twoFactorRedirect;
      if (needsMfa) {
        nav({ to: '/mfa' });
        return;
      }
      nav({ to: '/' });
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
        <h1 className="text-lg font-semibold">Sign in</h1>
        <label className="block text-xs text-ink-2">
          Email
          <input
            className="mt-1 block w-full border border-hairline rounded-sm px-3 py-2 text-sm"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="block text-xs text-ink-2">
          Password
          <input
            className="mt-1 block w-full border border-hairline rounded-sm px-3 py-2 text-sm"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="text-xs text-neg">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-ink text-white rounded-sm px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? 'Signing in\u2026' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
