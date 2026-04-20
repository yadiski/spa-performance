# Rehearsal Checklist (T42–T44)

**Owner:** HRA + IT Admin  
**Schedule:** Three rehearsals against the masked staging environment  
**Prerequisite:** Staging clone completed per `staging-clone.md`

---

## Rehearsal #1 — December Week 1 (T42)

**Goal:** Validate the KRA setup end-to-end for a small cohort. Catch any show-stoppers early.  
**Participants:** HRA (1), IT Admin (1), 3 test staff members with dedicated staging accounts.

### Checklist

#### Setup (IT Admin, before rehearsal)
- [ ] Staging clone refreshed (see `staging-clone.md`)
- [ ] 3 test staff accounts created in staging with known credentials
- [ ] 1 appraiser account linked to all 3 test staff
- [ ] HRA account confirmed working in staging
- [ ] FY 2027 cycle opened for the 3 test staff via `POST /api/v1/cycle/open-kra-bulk` (scope: staffIds)

#### KRA Setup (each test staff member)
- [ ] Staff logs in to staging app
- [ ] KRA draft form loads without errors
- [ ] Staff creates at least 3 KRAs across different perspectives (financial, customer, internal process, learning & growth)
- [ ] KRA weight percentages sum to exactly 100%
- [ ] Staff submits KRAs for approval
- [ ] **Notification check:** KRA submitted notification arrives in the appraiser's mailbox (use a real test mailbox) within 10 minutes

#### KRA Approval (appraiser)
- [ ] Appraiser receives email notification
- [ ] Appraiser reviews KRAs in the app
- [ ] Appraiser approves the KRAs for at least 1 staff member
- [ ] Appraiser rejects (with note) for at least 1 staff member to test the reject flow
- [ ] Rejected staff member revises and resubmits

#### Trajectory Bar
- [ ] After approval: staff member's dashboard shows the trajectory bar (even if empty at this stage)
- [ ] No JavaScript errors in browser console during KRA form and dashboard load

#### PMS Export Smoke Test
- [ ] HRA triggers `POST /api/v1/exports/pms-org` for FY 2027
- [ ] Export job appears in `GET /api/v1/exports/jobs` with status `queued` or `completed`
- [ ] Worker processes the job (check Railway staging worker logs)
- [ ] Download link is returned within 5 minutes

### Post-Rehearsal Report Template

File as: `infra/runbooks/post-mortems/rehearsal-1-YYYY-MM-DD.md`

```markdown
# Rehearsal #1 — Post-Rehearsal Report

**Date:** YYYY-MM-DD  
**Participants:** [names]  
**Filed by:** [name]  
**Filed at:** [within 24 hours]

## What Broke
[List each issue with severity: blocker / friction / cosmetic]

## What Was Confusing
[List UX pain points or unclear flows]

## What Was Missing
[Features or information that testers expected but wasn't there]

## Checklist Items That Failed
[Paste the items that got an X or partial pass]

## Action Items for Tech Lead
| Item | Severity | Owner | Target |
|------|----------|-------|--------|
| ... | ... | ... | ... |
```

---

## Rehearsal #2 — December Week 3 (T43)

**Goal:** Full-team run through the complete KRA → mid-year → PMS flow with 10+ staff. Validate email delivery to real mailboxes, PDF generation integrity, and all dashboard views.  
**Participants:** HRA (2), IT Admin (1), appraiser accounts (3+), 10+ test staff members.

### Checklist

#### Setup (IT Admin, before rehearsal)
- [ ] Staging clone refreshed (see `staging-clone.md` — use second December clone)
- [ ] 10+ test staff accounts with real email addresses (or redirected to a test inbox)
- [ ] All appraiser/next-level manager hierarchy correctly configured in staging
- [ ] FY 2027 KRA window opened for all 10+ staff

#### KRA → Approval Flow (all 10+ staff)
- [ ] All staff submit KRAs
- [ ] Email notifications land in **real mailboxes** (not just a log check) — spot-check 3 inboxes
- [ ] All appraisers approve KRAs (or reject/revise cycle tested for at least 1)
- [ ] Audit log: verify `kra_submitted`, `kra_approved` events appear in `audit_log` table

#### Mid-Year Flow
- [ ] HRA opens mid-year window for all 10+ staff: `POST /api/v1/cycle/open-mid-year-bulk`
- [ ] At least 5 staff complete mid-year self-assessment updates
- [ ] Mid-year notification emails land in real mailboxes — spot-check 3
- [ ] Appraiser acknowledges mid-year for at least 3 staff
- [ ] Mid-year state machine transitions verified: `kra_approved` → `mid_year_open` → `mid_year_done`

#### PMS Flow
- [ ] HRA opens PMS window: `POST /api/v1/cycle/open-pms-bulk`
- [ ] At least 3 staff complete full self-review (all 22 behavioural dimensions + KRA ratings + contributions + career + growth)
- [ ] Appraiser completes appraiser rating for same 3 staff
- [ ] Appraiser signs comment: `POST /api/v1/pms/sign`
- [ ] At least 1 cycle submitted to next-level
- [ ] HRA finalizes at least 1 cycle: `POST /api/v1/pms/finalize`

#### PDF Generation
- [ ] After finalization, PDF job completes (check worker logs)
- [ ] `GET /api/v1/pms/:cycleId/pdf` returns a presigned URL
- [ ] Download the PDF and verify it opens, reads correctly, and contains real-ish (masked) data
- [ ] Record the `pdfSha256` from `pms_final_snapshot` table; compare with hash of downloaded file — must match

#### Dashboard Verification
- [ ] `/me` dashboard: staff member sees their cycle trajectory
- [ ] Manager dashboard: appraiser sees all 10+ direct reports' states
- [ ] HRA dashboard: all 10+ cycles visible, filter by department works
- [ ] AI panel: summary generation returns a result for at least 1 finalized cycle
- [ ] Calibration view: HRA can see score distribution (if at least 3 cycles finalized)

#### Email Delivery Check
- [ ] At least 3 distinct notification types land in real inboxes (not just worker logs):
  - `kra_window_opened`
  - `mid_year_opened`
  - `pms_finalized`

#### Audit Chain
- [ ] `GET /api/v1/admin/audit/verify?from=<start>&to=<today>` returns `{"ok":true}`

### Post-Rehearsal Report Template

File as: `infra/runbooks/post-mortems/rehearsal-2-YYYY-MM-DD.md`

Same template as Rehearsal #1. Delivered to tech lead within 24 hours.

---

## Rehearsal #3 — January Week 1 (T44)

**Goal:** Final dress rehearsal against near-production data. Code freeze is active. Drill the rollback procedure.  
**Participants:** HRA (2), IT Admin (1), on-call engineer (1), appraiser accounts (3+), 15+ test staff.

### Code Freeze Protocol

From the start of Rehearsal #3 onwards:
- Only **blocker-severity** fixes may be merged to `main`
- All blocker fixes must be reviewed by tech lead + HRA sign-off before merge
- No new features, no refactors, no dependency upgrades
- A "blocker" is defined as: data loss risk, auth outage, notification failure, PDF corruption

### Checklist

#### Setup
- [ ] Staging clone refreshed (third December/January clone)
- [ ] Release commit SHA locked and documented in `#fy2027-golive`
- [ ] `bun test` green on the release commit (run in CI)
- [ ] Biome lint clean on the release commit

#### Full Flow (same as Rehearsal #2 but larger cohort)
- [ ] All checklist items from Rehearsal #2 pass with 15+ staff
- [ ] At least 5 complete PMS cycles finalized (self → appraiser → next-level → HRA)
- [ ] All PDF hashes verified

#### Rollback Drill
- [ ] IT Admin executes rollback per `rollback.md` against staging (using a deliberate break)
  1. Temporarily deploy a "broken" build (e.g., force 500 on /api/v1/cycle/list)
  2. Declare rollback in the practice Slack channel
  3. Restore staging DB from snapshot
  4. Deploy the release commit
  5. Confirm recovery in < 20 minutes
- [ ] All team members walk through the rollback comms template
- [ ] Recovery time documented

#### Checklist for Green Light
- [ ] All Rehearsal #2 items pass
- [ ] Rollback drill completed in < 20 minutes
- [ ] Zero unresolved blockers
- [ ] Audit chain verify passes
- [ ] Tech lead signs off: "Ready for production go-live"
- [ ] HRA signs off: "Business ready for production go-live"

### Post-Rehearsal Report Template

File as: `infra/runbooks/post-mortems/rehearsal-3-YYYY-MM-DD.md`

Same template as Rehearsal #1. Include rollback drill timing and outcome. Delivered to tech lead and Product Owner within 24 hours.

---

## Cross-Rehearsal Tracking

| Item | R#1 Dec Wk1 | R#2 Dec Wk3 | R#3 Jan Wk1 |
|------|-------------|-------------|-------------|
| KRA setup end-to-end | required | required | required |
| Email to real inbox | | required | required |
| PDF hash verified | smoke | required | required |
| All dashboards | | required | required |
| Rollback drilled | | | required |
| Code freeze active | | | required |
| Report filed < 24h | required | required | required |

A rehearsal is **not complete** until the post-rehearsal report is filed and the tech lead has reviewed it.
