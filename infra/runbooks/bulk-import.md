# Bulk Staff Import Runbook

## 1. CSV Template

All columns are required except `manager_employee_no` (leave blank for top-level staff).

```
employee_no,email,name,designation,department_code,grade_code,manager_employee_no,hire_date,roles
```

### Column definitions

| Column | Type | Notes |
|--------|------|-------|
| `employee_no` | text | Unique identifier for the employee (e.g. `E001`). Must be unique across the entire CSV. |
| `email` | text | Valid email address. Used to match/create a user account. |
| `name` | text | Full display name. |
| `designation` | text | Job title / designation string. |
| `department_code` | text | Must match an existing `department.code` for this org. |
| `grade_code` | text | Must match an existing `grade.code` for this org. |
| `manager_employee_no` | text | `employee_no` of this person's direct manager. Leave blank for the root of the hierarchy. |
| `hire_date` | date | `YYYY-MM-DD` format. |
| `roles` | text | Semicolon- or comma-separated list of role names. Known values: `staff`, `appraiser`, `next_level`, `department_head`, `hr_manager`, `hra`, `it_admin`. |

### Sample row

```
E001,ceo@acme.com,Alya CEO,Chief Executive,EXEC,E12,,2015-01-01,hra
E002,vp@acme.com,Bakar VP,VP Operations,OPS,E11,E001,2017-03-15,appraiser;next_level
```

---

## 2. Staging Step

### What to do

1. Navigate to **HR → Staff Import** in the web application, or call the API directly:

   ```bash
   curl -X POST https://your-api/api/v1/staff/import/stage \
     -H 'Content-Type: application/json' \
     -b 'your-session-cookie' \
     -d '{"orgId": "<uuid>", "csv": "<csv-content>"}'
   ```

2. The API returns a `StageBatchResult`:

   ```json
   {
     "batchId": "...",
     "csvHash": "sha256...",
     "rowCount": 50,
     "errors": []
   }
   ```

3. If `errors` is empty, the batch is `validated` and ready to apply.
4. If `errors` is non-empty, the batch is `failed` — **do not apply**. Fix the CSV and re-stage.

### Common errors and fixes

| Error message | Cause | Fix |
|---------------|-------|-----|
| `invalid email` | Malformed email address | Correct the email in the CSV |
| `department_code "X" not found for this org` | Department code doesn't exist | Check `department.code` values in the DB, or create the department |
| `grade_code "X" not found for this org` | Grade code doesn't exist | Check `grade.code` values |
| `employee_no "X" appears more than once` | Duplicate row | Remove or merge duplicates in the CSV |
| `manager_employee_no "X" not found in CSV or existing staff` | Manager reference is invalid | Ensure the manager's `employee_no` is either in the same CSV or already in the system |
| `employee_no "X" is part of a manager chain cycle` | Circular reporting chain | Review the `manager_employee_no` column and eliminate cycles |
| `unknown role "X"` | Unrecognised role value | Use only known role values (see column definitions above) |
| `hire_date must be YYYY-MM-DD` | Wrong date format | Ensure dates are in ISO format: `2024-01-15` |

---

## 3. Apply Step

### What to do

Once staging succeeds with no errors:

```bash
curl -X POST https://your-api/api/v1/staff/import/apply \
  -H 'Content-Type: application/json' \
  -b 'your-session-cookie' \
  -d '{"batchId": "<batchId>"}'
```

Response on success:

```json
{ "ok": true, "created": 12, "updated": 38 }
```

### Timing considerations

- Each row triggers a user upsert + staff upsert + role replacement inside a single database transaction.
- For imports of **under 500 rows**: typically 2–10 seconds.
- For imports of **500–2000 rows**: 10–60 seconds. Consider running during off-peak hours.
- For imports of **over 2000 rows**: split into multiple batches of ≤500 rows. Large single-transaction imports hold table locks and may impact other DB operations.

### Idempotency

Re-staging a CSV with the same content as an already-applied batch returns the original `batchId` immediately without creating a duplicate batch or re-applying any rows.

---

## 4. Revert Procedure

### Window

An HRA can revert a batch **within 24 hours of apply**. After that, the revert window expires.

### What to do

```bash
curl -X POST https://your-api/api/v1/staff/import/revert \
  -H 'Content-Type: application/json' \
  -b 'your-session-cookie' \
  -d '{"batchId": "<batchId>"}'
```

Response on success:

```json
{ "ok": true, "reverted": 50 }
```

### What revert does

- **Newly created staff**: deleted.
- **Updated staff**: prior values (name, designation, department, grade, manager, hire date, and roles) are restored from the `snapshot_before` field stored at apply time.
- The batch status changes to `reverted`.
- An audit event `staff_import.reverted` is written to the audit log.

### Revert window error

```json
{ "message": "revert window expired (24 hours after apply)" }
```

If you see this error, manual correction is required (see section 5 below).

---

## 5. Rollback-plan-for-rollback (if revert fails)

If the automated revert fails (e.g., revert window expired, or the `snapshot_before` column is corrupted), use one of these escalation paths:

### Option A — Manual row correction

1. Query `staff_import_batch.snapshot_before` for the batch in question:

   ```sql
   select snapshot_before from staff_import_batch where id = '<batchId>';
   ```

2. The `snapshot_before` column contains a JSON array of staff rows as they existed before the import (including roles). Use these values to manually `UPDATE` or `DELETE` the affected `staff` rows.

3. Write a corrective audit event via the API or directly in the DB to document the change.

### Option B — Database restore

If the import caused widespread data corruption and Option A is not feasible:

1. Identify the snapshot taken **before** the import was applied (check Railway snapshot timestamps vs. `applied_at` in `staff_import_batch`).
2. Follow the restore procedure in [`restore-drill.md`](./restore-drill.md).
3. Run the restore drill verification after the restore to confirm audit chain integrity.

### Option C — Escalation

If neither option is feasible, escalate to the IT Admin and HRA lead. Create an incident ticket following the procedure in [`incident-response.md`](./incident-response.md).
