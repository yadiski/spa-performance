# ClamAV Sidecar — Feasibility Decision

**Date:** 2026-04-20  
**Status:** Deferred  
**Decided by:** IT / Engineering  

---

## 1. Context

The application currently handles two categories of file I/O:

| File type | Direction | Source |
|---|---|---|
| XLSX exports | Output only | Generated server-side from DB data |
| PDF reports | Output only | Generated server-side via React-PDF |

There are **no user-initiated file uploads** in the current feature set. No staff-supplied binary blobs, attachments, or document uploads flow through any endpoint. All R2 writes originate from the server process with controlled, typed inputs.

**Risk surface:** Low. No untrusted binary content enters the system.

---

## 2. Options Evaluated

### (a) ClamAV sidecar on Railway

- Deploy a second Railway service running `clamav/clamav` Docker image.
- Each file before R2 upload is piped through the ClamAV TCP daemon (`clamd`).
- Infected files are quarantined (not uploaded); uploader is notified via email.
- **Pros:** Open-source, no per-scan cost, supports large files.
- **Cons:** Railway's free and hobby tiers do not support persistent volumes (ClamAV virus DB ~300 MB must be refreshed daily). The sidecar would need a persistent disk or must re-download definitions on every restart. Railway Pro plans support volumes; however, the operational overhead (DB refresh cron, memory footprint ~1 GB, latency for scan) is disproportionate when there are zero user uploads.

### (b) VirusTotal API per upload

- POST file bytes to VirusTotal v3 API; poll for result before accepting the file.
- **Pros:** No infrastructure; covers 70+ AV engines.
- **Cons:** Rate-limited on free tier (4 lookups/min); 25 MB file size cap on free tier; privacy concern (file content leaves the system); adds 30–120 s latency per upload; requires API key management.

### (c) Defer until a real user-upload path is added

- Track the decision in this document.
- Re-evaluate when an endpoint accepting user-supplied binary content is introduced.
- **Pros:** Zero operational cost, no false positives, no latency impact on current flows.
- **Cons:** If a file-upload feature is added without revisiting this decision, a risk gap opens.

---

## 3. Recommendation

**Defer (option c).**

Current output-only file paths have no attack surface that AV scanning would mitigate. All bytes written to R2 are produced deterministically by server-side code from structured database records.

The nearest upcoming feature that could open a user-upload path is **Staff CSV bulk import (T28)**. That feature should be revisited before phase 5 goes live — if the CSV is accepted as a raw file upload (vs. copy-paste into a textarea), this decision must be reconsidered and either option (a) or (b) implemented before launch.

---

## 4. Risk Acceptance

This decision is accepted by the Engineering and IT teams on the date above.

**Revisit trigger:** Before Phase 5 launch, or when any endpoint accepting user-supplied binary content (`multipart/form-data` or equivalent) is added to the API. The code review checklist for such endpoints must include a mandatory "AV scan in place?" gate.

**Owner:** IT Admin (`it@yadiski.my`)
