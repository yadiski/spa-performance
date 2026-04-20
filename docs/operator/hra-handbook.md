# HR Admin (HRA) Handbook

**Audience:** Human Resources Administrator (HRA)  
**System:** Performance Management System (PMS)  
**Last updated:** 2026-04-20

This handbook covers every cycle management task an HRA performs. Each workflow is described as a numbered procedure.

---

## A. The Performance Cycle Lifecycle

A performance cycle moves through the following states:

```
draft → kra_open → kra_submitted → kra_approved → mid_year_open → mid_year_done
     → pms_open → self_review_done → appraiser_done → next_level_done → finalized
```

As HRA you control the transitions between states for individual staff or in bulk.

---

## B. Workflows

### B1. Opening the KRA Window (Individual)

Use this to open the KRA input window for a single staff member.

1. Log in as HRA.
2. Navigate to **Cycle Admin** → **Manage Cycles**.
3. Search for the staff member by name or employee number.
4. In the cycle row, click **Open KRA Window**.
5. Confirm the dialog (FY and staff name displayed).
6. The cycle moves from `draft` to `kra_open`.
7. The staff member receives an email notification.

API equivalent:
```
POST /api/v1/cycle/open-kra-for-staff
{ "cycleId": "<uuid>" }
```

### B2. Opening the KRA Window (Bulk)

Use this to open KRA windows for an entire department or the whole organisation at once.

1. Navigate to **Cycle Admin** → **Bulk Open KRA**.
2. Select the scope:
   - **Organisation**: all staff in your org
   - **Department**: pick a department from the dropdown
   - **Selected staff**: enter staff IDs or upload a CSV
3. Click **Open KRA Windows**.
4. The system returns a count: `{ "opened": N, "failed": [...] }`.
5. Any failures are listed with their `cycleId` and reason; address them individually.

API equivalent:
```
POST /api/v1/cycle/open-kra-bulk
{
  "scope": "org" | "department" | "staffIds",
  "departmentId": "<uuid>",   // if scope=department
  "staffIds": ["<uuid>", ...]  // if scope=staffIds
}
```

### B3. Opening the Mid-Year Window

Prerequisite: KRA has been approved (`kra_approved` state).

1. Navigate to **Cycle Admin** → **Bulk Open Mid-Year**.
2. Select scope (same options as B2).
3. Click **Open Mid-Year Windows**.
4. Notification emails are sent to staff automatically.

API equivalent:
```
POST /api/v1/cycle/open-mid-year-bulk
{ "scope": "org" }
```

Individual staff:
```
POST /api/v1/cycle/open-mid-year-for-staff
{ "cycleId": "<uuid>" }
```

### B4. Opening the PMS Window

Prerequisite: Mid-year checkpoint completed (`mid_year_done` state).

1. Navigate to **Cycle Admin** → **Bulk Open PMS**.
2. Select scope.
3. Click **Open PMS Windows**.

API equivalent:
```
POST /api/v1/cycle/open-pms-bulk
{ "scope": "org" }
```

Individual staff:
```
POST /api/v1/cycle/open-pms-for-staff
{ "cycleId": "<uuid>" }
```

### B5. Finalizing a Cycle

Prerequisite: Appraiser and (if configured) next-level have completed their ratings and comments are signed.

1. Navigate to **Cycle Admin** → **Manage Cycles** → find the cycle.
2. Verify the cycle state shows `next_level_done` (or `appraiser_done` if no next-level).
3. Click **Finalize**.
4. The system computes the final score, locks the cycle, generates a PDF, and creates a `pms_final_snapshot`.
5. The staff member and appraiser receive a notification.

API equivalent:
```
POST /api/v1/pms/finalize
{ "cycleId": "<uuid>" }
```

### B6. Retrieving a Finalized PDF

1. Navigate to **Cycle Admin** → **Manage Cycles** → find the finalized cycle.
2. Click **Download PDF**.
3. A presigned download URL is returned (valid for 24 hours).

API equivalent:
```
GET /api/v1/pms/:cycleId/pdf
```
Response: `{ "url": "...", "expiresAt": "..." }`

For bulk PDF retrieval (e.g., for HR records), use the export:
```
POST /api/v1/exports/pms-org
{ "fy": 2027 }
```
Then poll `GET /api/v1/exports/jobs/:jobId` until `status = "completed"` and download.

### B7. Re-Opening a Cycle with Amendment

Use this when a finalized cycle needs to be corrected (e.g., an error in ratings after sign-off).

1. Navigate to **Cycle Admin** → find the finalized cycle.
2. Click **Amend/Re-Open**.
3. Enter a reason (required, minimum 3 characters).
4. The cycle state returns to `pms_open` and a `cycle_amendment` record is created.
5. The appraiser and staff member are notified.
6. After corrections, finalize again per B5 — a new `pms_final_snapshot` is created linked to the original via `amendment_of_snapshot_id`.

API equivalent:
```
POST /api/v1/pms/reopen
{ "cycleId": "<uuid>", "reason": "Rating error found after discussion" }
```

### B8. Calibration View

Use the calibration view to compare scores across staff in the same department or grade before finalizing.

1. Navigate to **Dashboards** → **Calibration**.
2. Filter by department, grade, or FY.
3. The view shows all staff with their current total scores and state.
4. Use this to identify outliers before issuing final PDFs.

The calibration view is read-only. To adjust a score, the appraiser must re-rate (return to appraiser flow) and the HRA re-finalizes.

### B9. Exporting PMS Data

1. Navigate to **Exports** → **PMS Organisation Snapshot**.
2. Select FY (defaults to current year).
3. Click **Request Export**.
4. The system enqueues an XLSX generation job. Return to **Exports → Jobs** to monitor progress.
5. When `status = "completed"`, click **Download** for the presigned URL.

API equivalent: see B6 above.

---

## C. Monitoring Cycle Progress

Navigate to **Dashboards** → **HRA View** to see:
- Count of cycles by state
- Pending KRA approvals (cycles in `kra_submitted` waiting for appraiser action)
- Overdue mid-year checkpoints
- PMS completion rate

Use the search and filter to drill down by department, FY, or state.

---

## D. Edge Cases

### D1. Terminated Staff Mid-Cycle

When a staff member leaves during an active cycle:

1. IT Admin sets `terminated_at` on the staff record.
2. The cycle does not auto-close. HRA must decide:
   - **Complete the cycle:** If the staff member was active for most of the year, coordinate with the appraiser to complete ratings and finalize.
   - **Abandon the cycle:** Contact IT Admin to manually set the cycle state to `abandoned` (requires direct DB access or a future admin UI — log this as a product request if needed).
3. The terminated staff member cannot log in after termination (their session is invalidated by IT Admin).
4. The appraiser can still act on the cycle even after the appraisee is terminated, as long as the HRA keeps the cycle open.

### D2. Manager Hierarchy Changes Mid-Cycle

If a staff member's direct manager changes after KRAs have been approved:

1. The `manager_id` field on the staff record can be updated by IT Admin (via staff import batch or direct DB edit).
2. **Important:** The `appraiser` on an in-progress PMS assessment is stored at the time of KRA approval. Changing the manager_id does not automatically re-assign the appraiser role for existing cycles.
3. To re-assign the appraiser for a live cycle, contact the tech lead — this requires a targeted DB update and an audit note.
4. For future cycles, the new manager is picked up automatically.

### D3. Cycle Amendments After Distribution

If a PDF has already been distributed (emailed or printed) and then an amendment is made:

1. HRA must communicate to the affected staff member and appraiser that the previous PDF is superseded.
2. After re-finalization, a new PDF is generated. The `amendment_of_snapshot_id` field links the new snapshot to the original.
3. HRA distributes the new PDF and requests the old one be destroyed.

### D4. Bulk Failure on Open-Window Operations

If `open-pms-bulk` returns partial failures:

```json
{
  "opened": 47,
  "failed": [
    { "cycleId": "...", "error": "invalid_state" }
  ]
}
```

For each failed `cycleId`:
1. Check the cycle's current state via **Manage Cycles**.
2. `invalid_state` means the cycle is not in the prerequisite state (e.g., mid-year not completed).
3. Open the cycle individually once the prerequisite is met.

---

## E. Audit Trail

All HRA actions are recorded in the audit log:
- `cycle_window_opened`: KRA/mid-year/PMS window transitions
- `pms_finalized`: cycle finalized
- `pms_reopened`: amendment opened
- `bulk_action_initiated`: bulk open operations

HRA can view the audit log by asking IT Admin to run `GET /api/v1/admin/audit/verify` or by querying the `audit_log` table directly (read access required).
