import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/help/')({
  component: HelpPage,
});

function HelpPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Quickstart Guide</h1>
        <p className="text-xs text-ink-2 mt-1">
          Welcome to the performance management platform. Here is what you need to know to get
          started.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">Getting started</h2>
        <ol className="list-decimal list-inside text-sm text-ink-2 space-y-2">
          <li>
            Log in with the credentials from your invitation email. You will be prompted to enroll
            in two-factor authentication (TOTP) on first login.
          </li>
          <li>
            Review your profile on the first-login checklist — confirm your department, manager, and
            assigned role.
          </li>
          <li>
            Navigate to <strong>Me &rarr; KRA</strong> to review your Key Result Areas for the
            current appraisal cycle.
          </li>
          <li>
            When the appraisal window opens, complete your self-review under{' '}
            <strong>Me &rarr; Current cycle</strong>.
          </li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">Navigating by role</h2>
        <div className="space-y-2 text-sm text-ink-2">
          <p>
            <strong className="text-ink">Staff</strong> — Access your KRAs, mid-year check-in, and
            appraisal under the <em>Me</em> section.
          </p>
          <p>
            <strong className="text-ink">Appraiser / Next-level reviewer</strong> — Review direct
            reports under the <em>Team</em> section.
          </p>
          <p>
            <strong className="text-ink">HR Administrator (HRA)</strong> — Manage cycles, staff,
            calibration, and exports under the <em>HR</em> section.
          </p>
          <p>
            <strong className="text-ink">IT Admin</strong> — Manage users, access reviews, audit
            logs, and system settings under the <em>Admin</em> section.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">Password &amp; security</h2>
        <ul className="list-disc list-inside text-sm text-ink-2 space-y-1">
          <li>Your password must be at least 12 characters.</li>
          <li>Two-factor authentication (TOTP) is required.</li>
          <li>Sessions expire after 7 days or 8 hours of inactivity.</li>
          <li>
            To reset your password, visit{' '}
            <a href="/password-reset" className="text-indigo-600 hover:underline">
              /password-reset
            </a>
            .
          </li>
        </ul>
      </section>

      <div className="bg-surface border border-hairline rounded-md px-5 py-4 text-sm text-ink-2">
        <strong className="text-ink">Need more help?</strong> Contact your HR administrator or IT
        support team directly.
      </div>
    </div>
  );
}
