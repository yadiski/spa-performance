# Phase-2 route scoping audit

Date: 2026-04-20
Last commit audited: 95f27ec

## apps/api/src/domain/pms/routes.ts

| Method | Path | Auth | Scoping | Status | Note |
|--------|------|------|---------|--------|------|
| POST | /kra-ratings | yes | actorIsManagerOfCycleStaff (service layer) | OK | Service returns `not_manager` 409 for non-managers |
| POST | /behavioural | yes | actorIsManagerOfCycleStaff (service layer) | OK | Service returns `not_manager` 409 for non-managers |
| POST | /contributions | yes | actorIsManagerOfCycleStaff (service layer) | OK | Service returns `not_manager` 409 for non-managers |
| POST | /career | yes | actorIsManagerOfCycleStaff (service layer) | OK | Service returns `not_manager` 409 for non-managers |
| POST | /growth | yes | actorIsManagerOfCycleStaff (service layer) | OK | Service returns `not_manager` 409 for non-managers |
| POST | /comment | yes | role-specific: appraisee → cycle.staffId===actor.staffId; appraiser → actorIsManager; next_level → roles check (service) | OK | Service enforces all three role paths |
| POST | /open-window | yes | state-machine validate() checks actor has `hra` role | OK | State machine rejects non-HRA |
| POST | /submit-self-review | yes | runTransition ownershipCheck='self': cycle.staffId===actor.staffId | OK | |
| POST | /submit-appraiser | yes | runTransition ownershipCheck='manager': actorIsManagerOfCycleStaff | OK | |
| POST | /return-to-appraisee | yes | runTransition ownershipCheck='manager': actorIsManagerOfCycleStaff | OK | |
| POST | /submit-next-level | yes | runTransition ownershipCheck='next_level': actorIsNextLevelOfCycleStaff | OK | |
| POST | /return-to-appraiser | yes | runTransition ownershipCheck='next_level': actorIsNextLevelOfCycleStaff | OK | |
| POST | /finalize | yes | actor.roles.includes('hra') check in finalizePms service | OK | |
| POST | /reopen | yes | actor.roles.includes('hra') check in reopenPms service | OK | |
| GET | /:cycleId/score | yes | MISSING → FIXED: staffReadScope + cycle lookup added | FIXED | Any authenticated user could compute score for any cycle; added staffReadScope check returning 403 |
| POST | /sign | yes | comment ownership enforced by signPmsComment (checks comment existence, signed_at) | OK | Route comment says "role + pms-ownership checks at route boundary" — ownership is actually in service/signing layer |
| GET | /:cycleId/verify-signatures | yes | MISSING → FIXED: staffReadScope + cycle lookup added | FIXED | Any authenticated user could verify signature chain for any cycle; added staffReadScope check returning 403 |
| GET | /behavioural-dimensions | yes | requireAuth only (public catalogue) | OK | Catalogue is non-sensitive — auth gate sufficient per spec comment "any authenticated user" |
| GET | /:cycleId/state | yes | staffReadScope + actor-owns-cycle | OK | Already had staffReadScope check |
| GET | /:cycleId/pdf | yes | staffReadScope + actor-owns-cycle | OK | Already had staffReadScope check |

## apps/api/src/domain/mid-year/routes.ts

| Method | Path | Auth | Scoping | Status | Note |
|--------|------|------|---------|--------|------|
| POST | /open | yes | MISSING → FIXED: actor.roles.includes('hra') check added | FIXED | Route accepted any authenticated user; only HRA should open mid-year window (mirrors cycle/open-mid-year-for-staff) |
| POST | /save | yes | cycle.staffId===actor.staffId (service layer) | OK | saveMidYearUpdate returns `not_owner` 409 for non-owners |
| POST | /submit | yes | cycle.staffId===actor.staffId (service layer) | OK | submitMidYearUpdate returns `not_owner` 409 |
| POST | /ack | yes | actorIsManagerOfCycleStaff (service layer) | OK | ackMidYear returns `not_manager` 409 |
| GET | /:cycleId | yes | MISSING → FIXED: staffReadScope + cycle lookup added | FIXED | Any authenticated user could read mid-year progress for any cycle; added staffReadScope check returning 403 |

## apps/api/src/domain/notifications/routes.ts

| Method | Path | Auth | Scoping | Status | Note |
|--------|------|------|---------|--------|------|
| GET | / | yes | eq(notification.recipientStaffId, actor.staffId) | OK | Query filters to actor's own notifications |
| GET | /unread-count | yes | eq(notification.recipientStaffId, actor.staffId) | OK | |
| PATCH | /read-all | yes | eq(notification.recipientStaffId, actor.staffId) | OK | UPDATE WHERE scoped to actor |
| PATCH | /:id/read | yes | row.recipientStaffId !== actor.staffId → 404 | OK | 404 chosen (hide existence) — correct pattern |

## apps/api/src/domain/cycle/routes.ts

| Method | Path | Auth | Scoping | Status | Note |
|--------|------|------|---------|--------|------|
| GET | /current | yes | eq(performanceCycle.staffId, actor.staffId) | OK | Returns own cycle only |
| GET | /for-staff/:staffId | yes | MISSING → FIXED: staffReadScope check added | FIXED | Any authenticated user could look up any staff member's cycle; added staffReadScope returning 403 |
| GET | /list | yes | non-HRA: scoped to actor.staffId; HRA: scoped to actor's org | OK | Dual-path scoping already correct |
| POST | /open-pms-for-staff | yes | actor.roles.includes('hra') → 403 | OK | |
| POST | /open-mid-year-for-staff | yes | actor.roles.includes('hra') → 403 | OK | |
| POST | /open-pms-bulk | yes | actor.roles.includes('hra') → 403; org scoped via actorStaff.orgId | OK | |
| POST | /open-mid-year-bulk | yes | actor.roles.includes('hra') → 403; org scoped via actorStaff.orgId | OK | |
| GET | /departments | yes | actor.roles.includes('hra') → 403; org scoped | OK | |
| GET | /org-staff | yes | actor.roles.includes('hra') → 403; org scoped | OK | |

---

## Summary of gaps found and fixed

| # | Route file | Endpoint | Gap | Fix |
|---|-----------|----------|-----|-----|
| 1 | pms/routes.ts | GET /:cycleId/score | No ownership check — any authenticated user could read score | Added staffReadScope + 403 |
| 2 | pms/routes.ts | GET /:cycleId/verify-signatures | No ownership check — any authenticated user could read signature chain | Added staffReadScope + 403 |
| 3 | mid-year/routes.ts | POST /open | No role check — any authenticated user could open a mid-year window | Added hra role check + 403 |
| 4 | mid-year/routes.ts | GET /:cycleId | No ownership check — any authenticated user could read mid-year data | Added staffReadScope + 403 |
| 5 | cycle/routes.ts | GET /for-staff/:staffId | No ownership check — any authenticated user could look up any staff's cycle | Added staffReadScope + 403 |

## Scoping rules not expressible in T43 unit tests (T44 E2E coverage recommended)

- **PDF signed URL expiry**: The PDF endpoint returns a pre-signed R2 URL valid for 24 h. Once issued, the URL itself is unscoped (bearer token pattern). T44 E2E should verify the URL cannot be re-issued to an outsider.
- **Next-level chain depth**: `staffReadScope` uses `transitiveReports(depth=2)` to compute next-level visibility. Unit tests use mock data with 2 levels; a 3-level hierarchy might expose unexpected visibility — T44 should test with real HR data depth.
- **Cross-org HRA isolation**: The `staffReadScope` returns `true` for HRA (all staff) — it does NOT filter by org. An HRA actor who also has staff records in a second org could theoretically read cycles from both. The cycle /list endpoint manually scopes to `actorStaff.orgId`. Other endpoints (e.g., pms/state) use staffReadScope which returns `true` for HRA without org-scoping. T44 should verify multi-org isolation for HRA actors.
