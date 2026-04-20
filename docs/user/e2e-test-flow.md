# End-to-end test flow — full cycle on Railway

Walk a single PMS cycle from KRA drafting to a finalized PDF across four
roles. Uses the seeded Malaysian demo org.

## Prerequisites

- Seed run: `bun apps/api/src/scripts/seed-malaysian-org.ts` (one-time)
- Passwords granted: `bun apps/api/src/scripts/grant-demo-passwords.ts`
  - Every seeded user ends up with the same demo password:
    `correct-horse-battery-staple-123`
- Open `https://web-production-14775.up.railway.app` — normal window plus
  one incognito window so you can run two sessions side-by-side.

## The four accounts

| Role in the flow | Email                                     | Name                                    | Grade |
|---|---|---|---|
| HRA / IT admin   | `admin@invenioptl.com`                    | Daisy Yadiski (CEO)                     | E12   |
| Next-level       | `farid.abdullah@invenioptl.local`         | Muhammad Farid bin Abdullah (VP Ops)    | E11   |
| Appraiser        | `siti.ibrahim@invenioptl.local`           | Siti Nurhaliza binti Ibrahim (Mgr Ops)  | E09   |
| Appraisee        | `anand.krishnan@invenioptl.local`         | Anand Krishnan (Logistics Analyst)      | E08   |

Reporting chain: Anand → Siti → Farid → Daisy.

---

## Step 1 — HRA opens the KRA window

1. Log in as **admin@invenioptl.com**.
2. Sidebar → **HR → Cycles** or **Bulk window operations**.
3. If no cycles exist yet for Anand, create one via bulk-windows or the
   cycles page; target state = `kra_drafting`.

## Step 2 — Staff drafts & submits KRAs

1. Log in as **Anand**.
2. **Me → KRA** (`/me/kra`).
3. Add 3–5 KRAs. Each needs description, perspective, weight %,
   measurement, target, 1–5 rubric. Weights must sum to 100.
4. **Submit for approval**. State → `kra_pending_approval`.
5. (Optional) **Check quality** on a KRA opens an AI panel if
   `OPENROUTER_API_KEY` is set on the api service.

## Step 3 — Appraiser approves KRAs

1. Log in as **Siti**.
2. **Team** → find Anand → **Approve KRA for Anand**
   (`/team/kra-approve/<staffId>`).
3. Approve or reject each. State → `kra_approved`.

## Step 4 — HRA opens mid-year window

1. Log in as **admin**.
2. `/hr/cycles` → find Anand's cycle → **Open mid-year window**.
   State → `mid_year_open`.

## Step 5 — Staff submits mid-year update

1. Log in as **Anand**.
2. `/me/mid-year`. Fill per-KRA progress note + self-rating.
3. Submit. State → `mid_year_submitted`.
4. AI nudges panel appears after submission if AI is configured.

## Step 6 — Appraiser acknowledges mid-year

1. Log in as **Siti**.
2. **Team → Mid-year review for Anand** (`/team/mid-year-review/<staffId>`).
3. **Acknowledge**. State → `mid_year_done`.

## Step 7 — HRA opens PMS window

1. Log in as **admin**.
2. `/hr/cycles` → **Open PMS window** for Anand.
   State → `pms_self_review`.

## Step 8 — Staff self-review

1. Log in as **Anand**.
2. `/me/cycle/<cycleId>/review`.
3. Fill Part I results and Part VI(b) comment, sign, submit.
   State → `pms_awaiting_appraiser`.

## Step 9 — Appraiser rates everything

1. Log in as **Siti**.
2. `/team/cycle/<cycleId>/review`. Six-step stepper:
   - Part I: rate each KRA 1–5.
   - Part II: pick an anchor per dimension across all 22 behavioural
     dimensions (progress counter shows `N / 22 rated`).
   - Part III: staff contributions (whenDate / achievement / weight %;
     total ≤ 100).
   - Part V: career potential window + growth goals + notes.
   - Part VI(a): appraiser comment + sign.
   - Submit. State → `pms_awaiting_next_lvl`.
3. The **Return to appraisee** button sends it back with a note.

## Step 10 — Next-level signs

1. Log in as **Farid**.
2. `/team/cycle/<cycleId>/next-level-review`.
3. Review summary, Part VI(c) comment, sign, submit.
   State → `pms_awaiting_hra`.
4. **Return to appraiser** with a note is also available.

## Step 11 — HRA finalizes + PDF

1. Log in as **admin**.
2. `/hr/cycle/<cycleId>/finalize`.
3. **Finalize PMS**. State → `pms_finalized`. Score snapshotted.
4. **Get PDF download link**. If the worker has processed
   `pms.generate_pdf`, you get a 24-hour signed URL. If not, retry in a
   few seconds.
5. Check `/notifications` — a `PmsPdfReady` notification should appear.

---

## Everything else to click through

- **Dashboards:** `/team`, `/department`, `/hr` — use materialized views,
  refreshed every 10 min by the worker cron.
- **HR calibration:** `/hr/calibration` — pick grade + FY, run AI
  calibration (requires `OPENROUTER_API_KEY`).
- **Exports:** `/hr/exports` — trigger **org-wide PMS snapshot**, wait
  for the worker, download XLSX via signed URL.
- **Admin audit verify:** `/admin/audit` — date-range hash-chain check.
- **Access review:** `/admin/access-review` — populated after the
  quarterly cron runs (or trigger manually).
- **Staff directory search:** `/department` — trigram combobox across
  all seeded staff; try "lim" or "kumar".

## If something breaks

- Blank page → open devtools console and copy the first red error.
- 401 / 403 → likely scoping; check the logged-in user's role against
  the route's required role.
- 502 on an AI endpoint → `OPENROUTER_API_KEY` is missing or invalid.
- Export stuck in `queued` → the worker isn't consuming; check
  `railway logs --service worker`.
