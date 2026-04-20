import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

export const Route = createFileRoute('/_auth/first-login')({
  component: FirstLogin,
});

interface StaffInfo {
  id: string;
  employee_no: string;
  name: string;
  designation: string;
  hire_date: string;
  department_name: string | null;
  grade_name: string | null;
  manager_name: string | null;
}

interface MeResponse {
  staff: StaffInfo | null;
  roles: string[];
  onboarded: boolean;
  onboardedAt: string | null;
}

function FirstLogin() {
  const nav = useNavigate();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/onboarding/me', { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) {
          setFetchError('Unable to load profile. Please log in again.');
          return;
        }
        const data = await res.json();
        const meData = data as MeResponse;
        setMe(meData);
        // If already onboarded, skip to /me
        if (meData.onboarded) {
          nav({ to: '/me' });
        }
      })
      .catch(() => setFetchError('Unable to load profile.'));
  }, [nav]);

  async function onConfirm() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/v1/onboarding/complete', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: 'Failed to complete onboarding' }));
        setError((body as { message?: string }).message ?? 'Failed to complete onboarding');
        return;
      }
      nav({ to: '/me' });
    } finally {
      setLoading(false);
    }
  }

  if (fetchError) {
    return (
      <main className="min-h-screen grid place-items-center bg-canvas">
        <div className="bg-surface border border-hairline rounded-md p-8 w-[480px] space-y-4">
          <h1 className="text-lg font-semibold text-neg">Error</h1>
          <p className="text-sm text-ink-2">{fetchError}</p>
          <a href="/login" className="block text-sm text-indigo-600 hover:underline">
            Back to sign in
          </a>
        </div>
      </main>
    );
  }

  if (!me) {
    return (
      <main className="min-h-screen grid place-items-center bg-canvas">
        <p className="text-sm text-ink-2">Loading your profile...</p>
      </main>
    );
  }

  const staff = me.staff;

  return (
    <main className="min-h-screen grid place-items-center bg-canvas">
      <div className="bg-surface border border-hairline rounded-md p-8 w-[480px] space-y-6">
        <div>
          <h1 className="text-lg font-semibold">Welcome — review your profile</h1>
          <p className="text-xs text-ink-2 mt-1">
            Please confirm your details are correct before proceeding.
          </p>
        </div>

        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-2">
            Your details
          </h2>
          {staff ? (
            <dl className="divide-y divide-hairline text-sm">
              <Row label="Name" value={staff.name} />
              <Row label="Employee No." value={staff.employee_no} />
              <Row label="Designation" value={staff.designation} />
              <Row label="Department" value={staff.department_name ?? '—'} />
              <Row label="Grade" value={staff.grade_name ?? '—'} />
              <Row label="Manager" value={staff.manager_name ?? '—'} />
              <Row label="Hire date" value={staff.hire_date} />
            </dl>
          ) : (
            <p className="text-sm text-ink-2">No staff record linked to your account yet.</p>
          )}
        </div>

        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-2">
            Assigned roles
          </h2>
          <ul className="flex flex-wrap gap-2">
            {me.roles.length > 0 ? (
              me.roles.map((r) => (
                <li
                  key={r}
                  className="px-2 py-0.5 text-xs bg-indigo-50 border border-indigo-200 rounded text-indigo-700"
                >
                  {r}
                </li>
              ))
            ) : (
              <li className="text-sm text-ink-2">No roles assigned yet.</li>
            )}
          </ul>
        </div>

        {error && <p className="text-xs text-neg">{error}</p>}

        <p className="text-xs text-ink-2">
          If any information above is incorrect, contact your HR administrator. Click confirm to
          proceed.
        </p>

        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className="w-full bg-ink text-white rounded-sm px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? 'Saving...' : 'Confirm and continue'}
        </button>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex py-2 gap-4">
      <dt className="w-32 shrink-0 text-ink-2">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
