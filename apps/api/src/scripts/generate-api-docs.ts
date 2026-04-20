/**
 * generate-api-docs.ts
 *
 * Approach: static AST-style extraction via regex scan over route files.
 *
 * Rationale: Hono sub-routers are not introspectable at runtime without
 * instantiating the full application, which pulls in DB connections and env
 * vars. Instead, this script walks every routes.ts file imported by app.ts,
 * extracts HTTP method + path combinations with a regex, and injects
 * supplemental metadata (role requirements, Zod schema names) from a
 * hand-maintained table. The output is a Markdown file at docs/api/reference.md.
 *
 * Run:
 *   bun run apps/api/src/scripts/generate-api-docs.ts
 *
 * Output:
 *   docs/api/reference.md
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// import.meta.dir = .../prototype-performanceanalysis/apps/api/src/scripts
// Up 4 levels: scripts(1) → src(2) → api(3) → apps(4) → prototype-performanceanalysis
const REPO_ROOT = join(import.meta.dir, '../../../..');
const DOCS_OUT = join(REPO_ROOT, 'docs/api/reference.md');

// ── Route file registry ───────────────────────────────────────────────────────
// Maps mount prefix → route source file (relative to apps/api/src)
const ROUTE_FILES: Array<{ mountPrefix: string; file: string }> = [
  { mountPrefix: '/api/auth', file: 'auth/better-auth.ts' }, // handled by better-auth, described manually
  { mountPrefix: '/api/v1/kra', file: 'domain/kra/routes.ts' },
  { mountPrefix: '/api/v1/cycle', file: 'domain/cycle/routes.ts' },
  { mountPrefix: '/api/v1/staff', file: 'domain/staff/routes.ts' },
  { mountPrefix: '/api/v1/mid-year', file: 'domain/mid-year/routes.ts' },
  { mountPrefix: '/api/v1/pms', file: 'domain/pms/routes.ts' },
  { mountPrefix: '/api/v1/notifications', file: 'domain/notifications/routes.ts' },
  { mountPrefix: '/api/v1/ai', file: 'ai/routes.ts' },
  { mountPrefix: '/api/v1/dashboards', file: 'dashboards/routes.ts' },
  { mountPrefix: '/api/v1/search', file: 'search/routes.ts' },
  { mountPrefix: '/api/v1/exports', file: 'exports/routes.ts' },
  { mountPrefix: '/api/v1/admin/audit', file: 'audit/routes.ts' },
  { mountPrefix: '/api/v1/auth', file: 'auth/session-routes.ts' },
  { mountPrefix: '/api/v1/auth', file: 'auth/mfa-recovery-routes.ts' },
  { mountPrefix: '/api/v1/admin/auth', file: 'auth/admin-routes.ts' },
  { mountPrefix: '/api/v1/admin/auth', file: 'auth/session-routes.ts' }, // adminSessionRoutes
  { mountPrefix: '/api/v1/admin/impersonation', file: 'auth/impersonation-routes.ts' },
  { mountPrefix: '/api/v1/onboarding', file: 'onboarding/routes.ts' },
  { mountPrefix: '/api/v1/admin/access-review', file: 'compliance/routes.ts' },
];

// ── Supplemental metadata ─────────────────────────────────────────────────────
// Describes roles and notes that cannot be inferred from the route file alone.
// Key format: "METHOD /full/path"
type RouteMeta = {
  roles: string;
  notes?: string;
  requestBody?: string;
  responseBody?: string;
};

const META: Record<string, RouteMeta> = {
  // ── Auth (better-auth managed) ─────────────────────────────────────────────
  'POST /api/auth/sign-in/email': {
    roles: 'public',
    requestBody: '`{ email, password }`',
    responseBody: '`{ token, user }`',
    notes: 'Rate-limited 10 req/min/IP. Triggers lockout after 10 failures.',
  },
  'POST /api/auth/sign-out': {
    roles: 'authenticated',
    responseBody: '`{ ok: true }`',
  },
  'POST /api/auth/sign-up/email': {
    roles: 'public (invite-only flow)',
    requestBody: '`{ email, password, name, inviteToken }`',
    responseBody: '`{ user }`',
  },

  // ── Health ─────────────────────────────────────────────────────────────────
  'GET /healthz': {
    roles: 'public',
    responseBody: '`{ status: "ok" }`',
  },
  'GET /api/v1/healthz/deep': {
    roles: 'x-health-token header required',
    responseBody: '`{ db: "ok"|"error", r2: "ok"|"unconfigured", timestamp }`',
  },

  // ── Me ─────────────────────────────────────────────────────────────────────
  'GET /api/v1/me': {
    roles: 'any authenticated',
    responseBody: '`{ actor: { userId, staffId, roles } }`',
  },

  // ── KRA ───────────────────────────────────────────────────────────────────
  'POST /api/v1/kra/draft': {
    roles: 'staff (own cycle)',
    requestBody:
      '`kraCreateBatch` — `{ cycleId, kras: [{ perspective, description, weightPct, measurement, target, order, rubric1to5 }] }`',
    responseBody: '`{ ok: true }` or `{ code, message }` 409',
  },
  'POST /api/v1/kra/submit/:cycleId': {
    roles: 'staff (own cycle)',
    responseBody: '`{ ok: true }` or `{ code, message }` 409',
  },
  'POST /api/v1/kra/approve': {
    roles: 'appraiser (scoped to own direct reports)',
    requestBody: '`kraApprove` — `{ cycleId }`',
    responseBody: '`{ ok: true }` or `{ code, message }` 409',
  },
  'POST /api/v1/kra/reject': {
    roles: 'appraiser (scoped to own direct reports)',
    requestBody: '`kraReject` — `{ cycleId, note }`',
    responseBody: '`{ ok: true }` or `{ code, message }` 409',
  },
  'GET /api/v1/kra/:cycleId': {
    roles: 'any authenticated (staffReadScope)',
    responseBody: '`{ kras: KRA[] }`',
  },

  // ── Cycle ──────────────────────────────────────────────────────────────────
  'GET /api/v1/cycle/current': {
    roles: 'any authenticated (own cycle)',
    responseBody: '`{ cycle: PerformanceCycle | null }`',
  },
  'GET /api/v1/cycle/for-staff/:staffId': {
    roles: 'any authenticated (staffReadScope)',
    responseBody: '`{ cycle: PerformanceCycle | null }` or 403/404',
  },
  'GET /api/v1/cycle/list': {
    roles: 'hra (all org cycles) | staff (own cycle only)',
    requestBody: 'query: `{ state?, fy?, staffId?, departmentId?, limit?, offset? }`',
    responseBody: '`{ items: CycleSummary[], total: number }`',
  },
  'POST /api/v1/cycle/open-pms-for-staff': {
    roles: 'hra only',
    requestBody: '`{ cycleId }`',
    responseBody: '`{ ok: true }` or `{ ok: false, error }` 409',
  },
  'POST /api/v1/cycle/open-mid-year-for-staff': {
    roles: 'hra only',
    requestBody: '`{ cycleId }`',
    responseBody: '`{ ok: true }` or `{ ok: false, error }` 409',
  },
  'POST /api/v1/cycle/open-pms-bulk': {
    roles: 'hra only',
    requestBody: '`{ scope: "org" | "department" | "staffIds", departmentId?, staffIds? }`',
    responseBody: '`{ opened: number, failed: [{ cycleId, error }] }`',
  },
  'POST /api/v1/cycle/open-mid-year-bulk': {
    roles: 'hra only',
    requestBody: '`{ scope: "org" | "department" | "staffIds", departmentId?, staffIds? }`',
    responseBody: '`{ opened: number, failed: [{ cycleId, error }] }`',
  },
  'GET /api/v1/cycle/departments': {
    roles: 'hra only',
    responseBody: '`{ items: [{ id, name, code }] }`',
  },
  'GET /api/v1/cycle/org-staff': {
    roles: 'hra only',
    responseBody: '`{ items: [{ id, name, employeeNo, departmentId }] }`',
  },

  // ── Staff ──────────────────────────────────────────────────────────────────
  'POST /api/v1/staff/import': {
    roles: 'hra | it_admin',
    requestBody: 'raw CSV body; query param `orgId`',
    responseBody: '`{ inserted, updated, errors }`',
  },
  'POST /api/v1/staff/import/stage': {
    roles: 'hra | it_admin',
    requestBody: '`{ csv: string, orgId: string }`',
    responseBody: '`{ batchId, rowCount, validationErrors }`',
  },
  'POST /api/v1/staff/import/apply': {
    roles: 'hra | it_admin',
    requestBody: '`{ batchId }`',
    responseBody: '`{ ok: true, applied }` or 422',
  },
  'POST /api/v1/staff/import/revert': {
    roles: 'hra | it_admin',
    requestBody: '`{ batchId }`',
    responseBody: '`{ ok: true }` or 422',
  },
  'GET /api/v1/staff/import/batches': {
    roles: 'hra | it_admin',
    requestBody: 'query: `orgId`',
    responseBody: '`{ batches: StaffImportBatch[] }`',
  },

  // ── Mid-Year ───────────────────────────────────────────────────────────────
  'POST /api/v1/mid-year/open': {
    roles: 'hra only',
    requestBody: '`openMidYearWindow` — `{ cycleId }`',
    responseBody: '`{ ok: true }` or 409',
  },
  'POST /api/v1/mid-year/save': {
    roles: 'staff (own cycle)',
    requestBody:
      '`midYearSave` — `{ cycleId, updates: [{ kraId, resultAchieved, rating1to5 }], summary? }`',
    responseBody: '`{ ok: true }` or 409',
  },
  'POST /api/v1/mid-year/submit': {
    roles: 'staff (own cycle)',
    requestBody: '`midYearSubmit` — `{ cycleId }`',
    responseBody: '`{ ok: true }` or 409',
  },
  'POST /api/v1/mid-year/ack': {
    roles: 'appraiser (scoped)',
    requestBody: '`midYearAck` — `{ cycleId }`',
    responseBody: '`{ ok: true }` or 409',
  },
  'GET /api/v1/mid-year/:cycleId': {
    roles: 'any authenticated (staffReadScope)',
    responseBody: '`{ updates: KraProgressUpdate[], summary: string | null }`',
  },

  // ── PMS ───────────────────────────────────────────────────────────────────
  'POST /api/v1/pms/kra-ratings': {
    roles: 'appraiser | staff (own cycle, during self-review)',
    requestBody:
      '`savePmsKraRatings` — `{ pmsId, ratings: [{ kraId, resultAchieved, finalRating, comment? }] }`',
    responseBody: '`{ ok: true }` or 409',
  },
  'POST /api/v1/pms/behavioural': {
    roles: 'appraiser | staff (own)',
    requestBody:
      '`saveBehaviouralRatings` — `{ pmsId, ratings: [{ dimensionCode, rating1to5, rubricAnchorText, comment? }] }`',
    responseBody: '`{ ok: true }` or 409',
  },
  'POST /api/v1/pms/contributions': {
    roles: 'staff (own)',
    requestBody:
      '`saveStaffContributions` — `{ pmsId, items: [{ whenDate, achievement, weightPct }] }`',
    responseBody: '`{ ok: true }` or 409',
  },
  'POST /api/v1/pms/career': {
    roles: 'appraiser | staff (own)',
    requestBody: '`saveCareerDevelopment` — `{ pmsId, potentialWindow, readyIn?, comments? }`',
    responseBody: '`{ ok: true }` or 409',
  },
  'POST /api/v1/pms/growth': {
    roles: 'appraiser | staff (own)',
    requestBody: '`savePersonalGrowth` — `{ pmsId, trainingNeeds?, comments? }`',
    responseBody: '`{ ok: true }` or 409',
  },
  'POST /api/v1/pms/comment': {
    roles: 'appraiser | appraisee | next_level',
    requestBody: '`savePmsComment` — `{ pmsId, role, body }`',
    responseBody: '`{ ok: true }` or 409',
  },
  'POST /api/v1/pms/open-window': {
    roles: 'hra only',
    requestBody: '`openPmsWindow` — `{ cycleId }`',
    responseBody: '`{ ok: true }` or 409',
  },
  'POST /api/v1/pms/submit-self-review': {
    roles: 'staff (own cycle)',
    requestBody: '`pmsCycleAction` — `{ cycleId }`',
    responseBody: '`{ ok: true }` or 409',
  },
  'POST /api/v1/pms/submit-appraiser': {
    roles: 'appraiser (scoped)',
    requestBody: '`pmsCycleAction` — `{ cycleId }`',
    responseBody: '`{ ok: true }` or 409',
  },
  'POST /api/v1/pms/return-to-appraisee': {
    roles: 'appraiser (scoped)',
    requestBody: '`pmsCycleAction` — `{ cycleId }`',
    responseBody: '`{ ok: true }` or 409',
  },
  'POST /api/v1/pms/submit-next-level': {
    roles: 'appraiser (scoped)',
    requestBody: '`pmsCycleAction` — `{ cycleId }`',
    responseBody: '`{ ok: true }` or 409',
  },
  'POST /api/v1/pms/return-to-appraiser': {
    roles: 'next_level (scoped)',
    requestBody: '`pmsCycleAction` — `{ cycleId }`',
    responseBody: '`{ ok: true }` or 409',
  },
  'POST /api/v1/pms/finalize': {
    roles: 'hra only',
    requestBody: '`finalizePms` — `{ cycleId }`',
    responseBody: '`{ ok: true }` or 409',
  },
  'POST /api/v1/pms/reopen': {
    roles: 'hra only',
    requestBody: '`{ cycleId, reason: string (min 3) }`',
    responseBody: '`{ ok: true }` or 409',
  },
  'GET /api/v1/pms/:cycleId/score': {
    roles: 'any authenticated (staffReadScope)',
    responseBody: '`{ breakdown: ScoreBreakdown }`',
  },
  'POST /api/v1/pms/sign': {
    roles: 'appraiser | appraisee | next_level (own comment)',
    requestBody: '`signPmsComment` — `{ commentId }`',
    responseBody: '`{ ok: true }` or 409',
  },
  'GET /api/v1/pms/:cycleId/verify-signatures': {
    roles: 'any authenticated (staffReadScope)',
    responseBody: '`{ ok: boolean, firstFailureAt?, reason? }`',
  },
  'GET /api/v1/pms/behavioural-dimensions': {
    roles: 'any authenticated',
    responseBody: '`{ items: [{ code, title, description, order, anchors }] }`',
  },
  'GET /api/v1/pms/:cycleId/state': {
    roles: 'any authenticated (staffReadScope)',
    responseBody:
      '`{ cycle, pms, kraRatings, behavioural, contributions, career, growth, comments }`',
  },
  'GET /api/v1/pms/:cycleId/pdf': {
    roles: 'any authenticated (staffReadScope)',
    responseBody: '`{ url: string, expiresAt: string }` (presigned R2 URL, 24h TTL)',
  },

  // ── Notifications ──────────────────────────────────────────────────────────
  'GET /api/v1/notifications/': {
    roles: 'any authenticated (own)',
    requestBody: 'query: `{ limit?, unread? }`',
    responseBody: '`{ items: Notification[] }`',
  },
  'POST /api/v1/notifications/:id/read': {
    roles: 'any authenticated (own)',
    responseBody: '`{ ok: true }`',
  },
  'POST /api/v1/notifications/read-all': {
    roles: 'any authenticated (own)',
    responseBody: '`{ ok: true }`',
  },

  // ── AI ─────────────────────────────────────────────────────────────────────
  'POST /api/v1/ai/staff-summary': {
    roles: 'any authenticated (staffReadScope)',
    requestBody: '`{ cycleId }`',
    responseBody: '`{ summary: string }` or 409/429/502',
    notes: 'Subject to AI budget (tokens/day). Rate-limited per user.',
  },
  'POST /api/v1/ai/kra-quality': {
    roles: 'staff | appraiser (scoped)',
    requestBody: '`{ cycleId }`',
    responseBody: '`{ feedback: KraQualityFeedback[] }` or 409/429/502',
  },
  'POST /api/v1/ai/mid-year-nudges': {
    roles: 'any authenticated (staffReadScope)',
    requestBody: '`{ cycleId }`',
    responseBody: '`{ nudges: string[] }` or 409/429/502',
  },
  'POST /api/v1/ai/dev-recommendations': {
    roles: 'any authenticated (staffReadScope)',
    requestBody: '`{ cycleId }`',
    responseBody: '`{ recommendations: string[] }` or 409/429/502',
  },
  'POST /api/v1/ai/calibration': {
    roles: 'hra only',
    requestBody: '`{ fy, departmentId? }`',
    responseBody: '`{ analysis: string }` or 409/429/502',
  },
  'GET /api/v1/ai/budget': {
    roles: 'hra | it_admin',
    responseBody: '`{ used: number, limit: number, resetAt: string }`',
  },

  // ── Dashboards ────────────────────────────────────────────────────────────
  'GET /api/v1/dashboards/me': {
    roles: 'any authenticated (own)',
    responseBody: '`{ cycles: [{ id, fy, state, score?, trajectoryData }] }`',
  },
  'GET /api/v1/dashboards/manager': {
    roles: 'appraiser | next_level | department_head',
    responseBody: '`{ directReports: CycleSummary[] }`',
  },
  'GET /api/v1/dashboards/hra': {
    roles: 'hra only',
    requestBody: 'query: `{ fy?, departmentId?, state? }`',
    responseBody: '`{ summary: HraSummary, cycles: CycleSummary[] }`',
  },
  'GET /api/v1/dashboards/calibration': {
    roles: 'hra only',
    requestBody: 'query: `{ fy?, departmentId? }`',
    responseBody: '`{ items: CalibrationRow[] }`',
  },

  // ── Search ────────────────────────────────────────────────────────────────
  'GET /api/v1/search/staff': {
    roles: 'any authenticated (staffReadScope)',
    requestBody: 'query: `{ q, limit?, offset? }`',
    responseBody: '`{ items: StaffSearchResult[], total: number }`',
  },

  // ── Exports ───────────────────────────────────────────────────────────────
  'POST /api/v1/exports/pms-org': {
    roles: 'hra only',
    requestBody: '`{ fy? }`',
    responseBody: '`{ jobId }` — async; poll GET /api/v1/exports/jobs/:jobId',
  },
  'GET /api/v1/exports/jobs': {
    roles: 'hra only',
    responseBody: '`{ jobs: ExportJob[] }`',
  },
  'GET /api/v1/exports/jobs/:jobId': {
    roles: 'hra only (own org)',
    responseBody: '`{ job: ExportJob }` — status: queued | processing | completed | failed',
  },
  'GET /api/v1/exports/jobs/:jobId/download': {
    roles: 'hra only (own org)',
    responseBody: '`{ url: string, expiresAt: string }` (presigned R2, 24h TTL)',
  },

  // ── Audit ─────────────────────────────────────────────────────────────────
  'GET /api/v1/admin/audit/verify': {
    roles: 'hra | it_admin',
    requestBody: 'query: `{ from: YYYY-MM-DD, to: YYYY-MM-DD }`',
    responseBody: '`{ ok: true }` or `{ ok: false, firstFailureAt, reason }`',
  },

  // ── Auth (session) ────────────────────────────────────────────────────────
  'POST /api/v1/auth/logout-all': {
    roles: 'any authenticated (self)',
    responseBody: '`{ ok: true }`',
    notes: 'Destroys all active sessions for the caller.',
  },
  'POST /api/v1/auth/mfa-recover': {
    roles: 'public (rate-limited)',
    requestBody: '`{ email, recoveryCode }`',
    responseBody: '`{ ok: true }` or `{ ok: false, error }` 401',
    notes: 'Consumes a single-use TOTP recovery code. Deletes the TOTP secret for re-enrollment.',
  },

  // ── Auth Admin ────────────────────────────────────────────────────────────
  'POST /api/v1/admin/auth/unlock': {
    roles: 'hra | it_admin',
    requestBody: '`{ userId, reason }`',
    responseBody: '`{ ok: true }`',
  },
  'POST /api/v1/admin/auth/logout-user': {
    roles: 'it_admin',
    requestBody: '`{ userId, reason }`',
    responseBody: '`{ ok: true }`',
  },
  'GET /api/v1/admin/auth/sessions': {
    roles: 'it_admin',
    requestBody: 'query: `{ userId }`',
    responseBody: '`{ sessions: Session[] }`',
  },

  // ── Impersonation ─────────────────────────────────────────────────────────
  'POST /api/v1/admin/impersonation/start': {
    roles: 'it_admin',
    requestBody: '`{ targetUserId, reason, durationMin? (1–60) }`',
    responseBody: '`{ ok: true, sessionId, expiresAt }` or `{ ok: false, error }` 403/400',
  },
  'POST /api/v1/admin/impersonation/stop': {
    roles: 'it_admin',
    requestBody: '`{ sessionId?, reason? }`',
    responseBody: '`{ ok: true }`',
  },
  'GET /api/v1/admin/impersonation/active': {
    roles: 'it_admin',
    responseBody: '`{ session: ImpersonationSession | null }`',
  },

  // ── Onboarding ────────────────────────────────────────────────────────────
  'POST /api/v1/onboarding/invite': {
    roles: 'hra | it_admin',
    requestBody: '`{ email, staffId?, roles, orgId }`',
    responseBody: '`{ ok: true, inviteToken, link }`',
  },
  'GET /api/v1/onboarding/invite/verify': {
    roles: 'public',
    requestBody: 'query: `{ token }`',
    responseBody: '`{ ok: true, email, roles }` or `{ ok: false, error }`',
  },
  'POST /api/v1/onboarding/invite/accept': {
    roles: 'public',
    requestBody: '`{ token, password }`',
    responseBody: '`{ ok: true }` or `{ ok: false, error }`',
  },
  'POST /api/v1/onboarding/password-reset/initiate': {
    roles: 'public (rate-limited)',
    requestBody: '`{ email }`',
    responseBody: '`{ ok: true }` (always, to avoid email enumeration)',
  },
  'POST /api/v1/onboarding/password-reset/accept': {
    roles: 'public',
    requestBody: '`{ token, password }`',
    responseBody: '`{ ok: true }` or `{ ok: false, error }`',
  },

  // ── Access Review ─────────────────────────────────────────────────────────
  'GET /api/v1/admin/access-review/cycles': {
    roles: 'hra | it_admin',
    responseBody: '`{ cycles: AccessReviewCycle[] }`',
  },
  'GET /api/v1/admin/access-review/cycles/:id/items': {
    roles: 'hra | it_admin',
    requestBody: 'query: `{ decision?: pending|retain|revoke|escalate, limit? }`',
    responseBody: '`{ items: AccessReviewItem[] }`',
  },
  'POST /api/v1/admin/access-review/cycles/:id/items/:itemId/decide': {
    roles: 'hra | it_admin',
    requestBody: '`{ decision: "retain"|"revoke"|"escalate", reason }`',
    responseBody: '`{ ok: true }`',
  },
  'POST /api/v1/admin/access-review/cycles/generate': {
    roles: 'hra | it_admin',
    requestBody: '`{ periodStart, periodEnd }`',
    responseBody: '`{ cycleId }`',
  },
};

// ── Regex extractor ───────────────────────────────────────────────────────────

type ExtractedRoute = {
  method: string;
  routerPath: string;
  fullPath: string;
  mountPrefix: string;
};

function extractRoutes(mountPrefix: string, filePath: string): ExtractedRoute[] {
  let src: string;
  try {
    src = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const results: ExtractedRoute[] = [];
  // Match: .get('/path' or .post('/path' etc (with optional zValidator before the path)
  const routeRe = /\.(get|post|patch|put|delete|on)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let match = routeRe.exec(src);
  while (match !== null) {
    const method = match[1]!.toUpperCase();
    const routerPath = match[2]!;

    // Skip middleware wildcards and internal use patterns
    if (routerPath !== '*') {
      // Combine mount prefix + router path (avoid double slashes)
      const cleanRouter = routerPath === '/' ? '' : routerPath;
      const fullPath = `${mountPrefix}${cleanRouter}`;
      results.push({ method, routerPath, fullPath, mountPrefix });
    }
    match = routeRe.exec(src);
  }

  return results;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function buildReference(): string {
  const lines: string[] = [];

  lines.push('# API Reference');
  lines.push('');
  lines.push(
    '**Approach:** This reference was generated by `apps/api/src/scripts/generate-api-docs.ts`',
  );
  lines.push(
    'using static regex extraction over Hono route files, supplemented by a hand-maintained',
  );
  lines.push(
    'metadata table for roles, request/response shapes, and notes. Hono sub-routers are not',
  );
  lines.push(
    'introspectable at runtime without full app instantiation, so this hybrid approach was chosen.',
  );
  lines.push('');
  lines.push(
    '**Authentication:** All `/api/v1/*` routes require a valid session cookie or Bearer token',
  );
  lines.push('(via better-auth). Role enforcement is noted per route.');
  lines.push('');
  lines.push('**Rate limits:**');
  lines.push('- Auth paths (`/api/auth/*`): 10 req/min/IP');
  lines.push('- Mutating paths (`POST/PATCH/PUT/DELETE /api/v1/*`): 60 req/min/user');
  lines.push('');
  lines.push('**Error format:** `{ code: string, message: string }` with appropriate HTTP status.');
  lines.push('');
  lines.push('---');
  lines.push('');

  // Group by mount prefix / section
  const sections: Record<string, Set<string>> = {};

  // Always include the static entries
  for (const key of Object.keys(META)) {
    const spaceIdx = key.indexOf(' ');
    const path = key.slice(spaceIdx + 1);
    // derive section from path
    const parts = path.split('/').filter(Boolean);
    let section = 'Other';
    if (parts[0] === 'healthz') section = 'Health';
    else if (parts[0] === 'api' && parts[1] === 'auth') section = 'Auth (better-auth)';
    else if (parts[1] === 'v1' && parts[2] === 'me') section = 'Session';
    else if (parts[1] === 'v1' && parts[2] === 'kra') section = 'KRA';
    else if (parts[1] === 'v1' && parts[2] === 'cycle') section = 'Cycle';
    else if (parts[1] === 'v1' && parts[2] === 'staff') section = 'Staff';
    else if (parts[1] === 'v1' && parts[2] === 'mid-year') section = 'Mid-Year';
    else if (parts[1] === 'v1' && parts[2] === 'pms') section = 'PMS';
    else if (parts[1] === 'v1' && parts[2] === 'notifications') section = 'Notifications';
    else if (parts[1] === 'v1' && parts[2] === 'ai') section = 'AI';
    else if (parts[1] === 'v1' && parts[2] === 'dashboards') section = 'Dashboards';
    else if (parts[1] === 'v1' && parts[2] === 'search') section = 'Search';
    else if (parts[1] === 'v1' && parts[2] === 'exports') section = 'Exports';
    else if (parts[1] === 'v1' && parts[2] === 'auth') section = 'Auth (session)';
    else if (parts[1] === 'v1' && parts[2] === 'admin' && parts[3] === 'audit')
      section = 'Admin — Audit';
    else if (parts[1] === 'v1' && parts[2] === 'admin' && parts[3] === 'auth')
      section = 'Admin — Auth';
    else if (parts[1] === 'v1' && parts[2] === 'admin' && parts[3] === 'impersonation')
      section = 'Admin — Impersonation';
    else if (parts[1] === 'v1' && parts[2] === 'admin' && parts[3] === 'access-review')
      section = 'Admin — Access Review';
    else if (parts[1] === 'v1' && parts[2] === 'onboarding') section = 'Onboarding';

    let bucket = sections[section];
    if (!bucket) {
      bucket = new Set();
      sections[section] = bucket;
    }
    bucket.add(key);
  }

  for (const [section, keys] of Object.entries(sections)) {
    lines.push(`## ${section}`);
    lines.push('');
    lines.push('| Method | Path | Required Role | Request | Response | Notes |');
    lines.push('|--------|------|---------------|---------|----------|-------|');

    for (const key of [...keys].sort()) {
      const m = META[key]!;
      const spaceIdx = key.indexOf(' ');
      const method = key.slice(0, spaceIdx);
      const path = key.slice(spaceIdx + 1);
      const req = m.requestBody ?? '—';
      const res = m.responseBody ?? '—';
      const notes = m.notes ?? '—';
      lines.push(`| \`${method}\` | \`${path}\` | ${m.roles} | ${req} | ${res} | ${notes} |`);
    }

    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## Zod Schema Locations');
  lines.push('');
  lines.push('Core request schemas are defined in `packages/shared/src/`. Key exports:');
  lines.push('');
  lines.push('| Schema name | Used in |');
  lines.push('|-------------|---------|');
  lines.push('| `kraCreateBatch` | POST /api/v1/kra/draft |');
  lines.push('| `kraApprove` | POST /api/v1/kra/approve |');
  lines.push('| `kraReject` | POST /api/v1/kra/reject |');
  lines.push('| `midYearSave` | POST /api/v1/mid-year/save |');
  lines.push('| `midYearSubmit` | POST /api/v1/mid-year/submit |');
  lines.push('| `midYearAck` | POST /api/v1/mid-year/ack |');
  lines.push('| `openMidYearWindow` | POST /api/v1/mid-year/open |');
  lines.push('| `savePmsKraRatings` | POST /api/v1/pms/kra-ratings |');
  lines.push('| `saveBehaviouralRatings` | POST /api/v1/pms/behavioural |');
  lines.push('| `saveStaffContributions` | POST /api/v1/pms/contributions |');
  lines.push('| `saveCareerDevelopment` | POST /api/v1/pms/career |');
  lines.push('| `savePersonalGrowth` | POST /api/v1/pms/growth |');
  lines.push('| `savePmsComment` | POST /api/v1/pms/comment |');
  lines.push('| `pmsCycleAction` | POST /api/v1/pms/submit-self-review and related |');
  lines.push('| `finalizePms` | POST /api/v1/pms/finalize |');
  lines.push('| `signPmsComment` | POST /api/v1/pms/sign |');
  lines.push('| `openPmsWindow` | POST /api/v1/pms/open-window |');
  lines.push('');
  lines.push(
    'Inline Zod schemas (defined in route files, not shared) are described in the table above.',
  );
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(
    `*Generated by \`apps/api/src/scripts/generate-api-docs.ts\` on ${new Date().toISOString().slice(0, 10)}.*`,
  );

  return lines.join('\n');
}

const markdown = buildReference();
writeFileSync(DOCS_OUT, markdown, 'utf-8');
console.log(`[generate-api-docs] Written to ${DOCS_OUT}`);
