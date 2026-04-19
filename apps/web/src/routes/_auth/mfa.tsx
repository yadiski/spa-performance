import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { authClient } from '../../auth/client';

export const Route = createFileRoute('/_auth/mfa')({ component: Mfa });

function Mfa() {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await authClient.twoFactor.verifyTotp({ code });
      if (res.error) {
        setError(res.error.message ?? 'Code invalid.');
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
        <h1 className="text-lg font-semibold">Two-factor authentication</h1>
        <p className="text-xs text-ink-2">Enter the 6-digit code from your authenticator app.</p>
        <input
          className="w-full tracking-widest text-center border border-hairline rounded-sm px-3 py-3 text-lg font-mono"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          required
        />
        {error && <p className="text-xs text-neg">{error}</p>}
        <button
          type="submit"
          disabled={loading || code.length !== 6}
          className="w-full bg-ink text-white rounded-sm px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? 'Verifying\u2026' : 'Verify'}
        </button>
      </form>
    </main>
  );
}
