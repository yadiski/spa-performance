import { useMutation } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

export const Route = createFileRoute('/_app/admin/audit')({
  component: AdminAuditPage,
});

interface VerifyOk {
  ok: true;
}

interface VerifyFail {
  ok: false;
  firstFailureAt: string;
  reason: string;
}

type VerifyResult = VerifyOk | VerifyFail;

async function callVerify(from: string, to: string): Promise<VerifyResult> {
  const res = await fetch(
    `/api/v1/admin/audit/verify?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { credentials: 'include' },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json() as Promise<VerifyResult>;
}

function defaultDateRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 86_400_000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function AdminAuditPage() {
  const defaults = defaultDateRange();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);

  const verifyMutation = useMutation<VerifyResult, Error, { from: string; to: string }>({
    mutationFn: ({ from, to }) => callVerify(from, to),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    verifyMutation.mutate({ from, to });
  }

  const result = verifyMutation.data;

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Audit Chain Verifier</h1>
        <p className="text-xs text-ink-2 mt-1">
          Verify the cryptographic hash chain integrity for a date range. HRA or IT Admin only.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-surface border border-hairline rounded-md p-5 space-y-4"
      >
        <div className="flex gap-4">
          <div className="flex-1 space-y-1">
            <label
              htmlFor="from-date"
              className="text-xs text-ink-2 font-medium uppercase tracking-wider"
            >
              From
            </label>
            <input
              id="from-date"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full border border-hairline rounded-sm px-2 py-1.5 text-sm text-ink bg-canvas focus:outline-none focus:ring-1 focus:ring-ink/30"
              required
            />
          </div>
          <div className="flex-1 space-y-1">
            <label
              htmlFor="to-date"
              className="text-xs text-ink-2 font-medium uppercase tracking-wider"
            >
              To
            </label>
            <input
              id="to-date"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full border border-hairline rounded-sm px-2 py-1.5 text-sm text-ink bg-canvas focus:outline-none focus:ring-1 focus:ring-ink/30"
              required
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={verifyMutation.isPending}
          className="text-sm border border-hairline rounded-sm px-4 py-1.5 bg-canvas hover:bg-surface transition-colors disabled:opacity-50"
        >
          {verifyMutation.isPending ? 'Verifying...' : 'Verify'}
        </button>
      </form>

      {verifyMutation.isError && (
        <div className="bg-red-50 border border-red-200 rounded-md px-4 py-3 text-sm text-red-700">
          Error: {verifyMutation.error.message}
        </div>
      )}

      {result && (
        <div
          className={`border rounded-md px-4 py-3 text-sm ${
            result.ok
              ? 'bg-green-50 border-green-200 text-green-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {result.ok ? (
            <span className="font-medium">Chain intact — no hash mismatches found.</span>
          ) : (
            <div className="space-y-1">
              <div className="font-medium">Verification failed</div>
              <div>First failure at audit_log id: {result.firstFailureAt}</div>
              <div className="text-xs opacity-80">{result.reason}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
