# Root Cause Investigation: Patient Deletion Reappearance Bug

> **Application:** Doctor Kinjal Maheshwari’s Patient Tracker  
> **Production Target:** https://doctor-kinjal.vercel.app/  
> **Repository:** `KunjMaheshwari/ToothSync`  
> **Date:** 2026-11-04  
> **Status:** RESOLVED & VERIFIED

---

## 1. Executive Summary

A critical data-integrity defect was reported on the production deployment:
> *"When a patient is deleted, the UI initially removes the patient. After approximately 3–4 seconds, the same patient appears again."*

Tracing the complete deletion lifecycle across frontend state management, API routes, database transactions, Google Sheets synchronization, and serverless hydration revealed that this was **not a simple UI caching bug**. It was a compound multi-tier defect involving **Google Sheets lack of deletion awareness**, **serverless multi-container state partitioning**, **hydration resurrection**, and **un-cancelled orphaned relations**.

All root causes have been isolated, repaired, and verified with dedicated automated regression tests.

---

## 2. Complete Lifecycle Analysis & Root Causes

```mermaid
sequenceDiagram
    autonumber
    actor User as Dr. Kinjal / Staff
    participant UI as Browser UI (clinic-app.tsx)
    participant L1 as Vercel Container 1 (/api/patients/[id])
    participant DB1 as SQLite /tmp (Container 1)
    participant GS as Google Sheets v4 ("Patients" Tab)
    participant L2 as Vercel Container 2 (/api/patients or /api/dashboard)
    participant DB2 as SQLite /tmp (Container 2)

    Note over User,UI: Pre-fix Behavior
    User->>UI: Clicks "Confirm Archive"
    UI->>L1: DELETE /api/patients/:id
    L1->>DB1: UPDATE Patient SET deletedAt = now()
    Note over L1,GS: BUG 1: DELETE never queued or synced to Google Sheets
    L1-->>UI: 200 OK { ok: true }
    UI->>UI: Closes modal; calls loadPatients() & refreshDashboard()

    Note over UI,L2: BUG 2: Multi-container routing after 3-4s debounce
    UI->>L2: GET /api/patients?q= (routed to Container 2)
    Note over L2,GS: Container 2 is cold or re-hydrating from Google Sheets
    L2->>GS: hydrateDatabaseFromSheets() reads tab "Patients"
    Note over GS,L2: BUG 3: "Patients" tab only had 16 columns (no Archived At)<br/>All rows hydrated as deletedAt: null!
    L2->>DB2: upsert Patient (deletedAt: null)
    L2-->>UI: Returns Patient in active list!
    UI->>UI: UI re-renders: Deleted patient reappears on screen!
```

### Root Cause 1: Google Sheets Lack of Deletion Awareness (Missing Tombstone)
Prior to this fix, the Google Sheets `Patients` tab schema contained exactly 16 columns:
`Record ID`, `First Name`, `Last Name`, `Phone`, `Email`, `Date of Birth`, `Gender`, `Blood Group`, `Medical History`, `Dental History`, `Allergies`, `Emergency Contact Name`, `Emergency Contact Phone`, `Notes`, `Created At`, `Updated At`.

When a record was updated or created, `buildSheetRecord("Patient", ...)` produced 16 values. There was **no column representing deletion or archival status**. Furthermore, the `DELETE /api/patients/[id]` route handler did not stage or trigger any Google Sheets synchronization.

### Root Cause 2: Serverless Container Cold Starts & Re-Hydration Resurrection
Vercel serverless functions operate in stateless, isolated containers (e.g. AWS Lambda / Firecracker microVMs). On container cold start, empty database detection, or sync worker execution:
1. `hydrateDatabaseFromSheets()` iterates over all rows in the Google Sheets `Patients` tab.
2. In the prior implementation:
   ```ts
   // PREVIOUS FLAWED CODE in lib/sheets.ts
   await prisma.patient.upsert({
     where: { id },
     update: { firstName, lastName, phone, ... }, // deletedAt was omitted!
     create: { id, firstName, lastName, phone, ... }, // deletedAt defaulted to null!
   });
   ```
3. Because the Google Sheet retained every patient row and had no `Archived At` indicator, any cold-starting container or background sync worker read the patient from Google Sheets and **upserted it back into SQLite with `deletedAt: null`**.
4. The soft-deleted patient was immediately resurrected as an active patient.

### Root Cause 3: Serverless Multi-Container State Split
In serverless hosting, adjacent HTTP requests are frequently routed to different container instances:
- Container 1 handled `DELETE /api/patients/[id]` and wrote `deletedAt = now()` to its local `/tmp` database.
- Immediately following deletion, the frontend fired `loadPatients()` and `refreshDashboard()` after a 300ms debounce or 3–4 second polling interval.
- The new request landed on Container 2 (or Container 3).
- Container 2 either had not received the deletion (because SQLite `/tmp` is unshared) or hydrated from Google Sheets, returning the patient as active.
- The patient popped back into view on the client UI 3–4 seconds after deletion.

### Root Cause 4: Orphaned Related Records (Clinical Inconsistency)
Prior to the fix, deleting a patient simply executed `await db.patient.update({ where: { id }, data: { deletedAt: new Date() } })`. It left:
- Future scheduled appointments (`status: "SCHEDULED"`) active in the calendar.
- Pending follow-up recalls (`status: "PENDING"`) active in recall queues.
- Planned treatment plans (`status: "PLANNED"`) active.

---

## 3. Implemented Engineering Fixes

### 1. Google Sheets Schema Expansion (17th Column: `Archived At`)
- Modified [`lib/sheets.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/lib/sheets.ts):
  - Added `"Archived At"` as the 17th column header in `buildSheetRecord("Patient", ...)`.
  - Stored `iso(value.deletedAt)` in the 17th cell (`row[16]`). If active, this value is `""`. If archived, it contains the ISO 8601 deletion timestamp (e.g., `2026-11-04T12:00:00.000Z`).
  - Updated [`ensureTab`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/lib/sheets.ts#L304-L345) to detect when an existing sheet has 16 columns and automatically expand headers to 17 columns in-place without data loss.

### 2. Deletion-Aware Hydration & Tombstone Respect
- Updated [`hydrateDatabaseFromSheets`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/lib/sheets.ts#L644-L710):
  - Reads `r[16]` as `archivedAt`.
  - Sets `deletedAt: archivedAt ? new Date(archivedAt) : null` in both `create` and `update` clauses of `prisma.patient.upsert()`.
  - Archived patients hydrated from Google Sheets remain soft-deleted in SQLite and never re-enter the active patient pool.
- Updated [`reconcileEntitySheet`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/lib/sheets.ts#L415-L515):
  - Acknowledges rows with `Archived At` as valid tombstones so they are not flagged as orphan anomalies.

### 3. Atomic Deletion Transaction with Clinical Compliance
- Updated [`app/api/patients/[id]/route.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/api/patients/[id]/route.ts):
  - **Idempotency Guard:** If `existing.deletedAt !== null`, returns `{ ok: true, alreadyArchived: true }` with HTTP 200.
  - **Atomic Transaction (`db.$transaction`):**
    1. Soft-deletes the patient: `deletedAt: now`.
    2. Cancels scheduled/confirmed appointments: `status: "CANCELLED"`.
    3. Cancels pending follow-up recalls: `status: "CANCELLED"`.
    4. Cancels planned treatments: `status: "CANCELLED"`.
    5. **Strict Medical Preservation:** Completed treatments, completed appointments, clinical prescriptions, and financial invoices/payments are strictly preserved for medical-legal compliance.
    6. Staged in `SyncQueue` via `queueRecord(tx, "Patient", id, id)`.
    7. Recorded in `AuditLog` via `logAudit(tx, "ARCHIVE", "Patient", id)`.
  - **Immediate Write-Through:** Executes `await syncAfterWriteOnServerless("Patient", id)` so the tombstone is written to Google Sheets immediately before the HTTP response terminates.

### 4. Client Optimistic Update & Safe Rollback
- Updated [`components/clinic-app.tsx`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/components/clinic-app.tsx#L4361-L4375):
  - `handleArchivePatient` immediately removes the patient from local UI state:
    ```tsx
    setPatients((prev) => prev.filter((item) => item.id !== targetId));
    setActivePatientId(null);
    setActivePatientDetail(null);
    setConfirmArchive(false);
    ```
  - If the backend request fails, an error toast is surfaced and `loadPatients(q)` is invoked to restore true server state.

---

## 4. Verification Evidence

1. **Automated Regression Test Suite:**
   - [`tests/patient-archive-lifecycle.test.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests/patient-archive-lifecycle.test.ts)
   - Tested soft-delete, scheduled appointment cancellation, follow-up cancellation, financial invoice preservation, 17-column Google Sheets tombstone record creation, Google Sheets hydration tombstone enforcement, search exclusion, and deletion idempotency.
   - Result: **3 of 3 passed cleanly.**
2. **Full Test Suite:**
   - **19 test files, 111 total tests passing** with 0 failures (`CI=true npm test`).
3. **Type Safety & Build:**
   - `npx tsc --noEmit` exited 0.
   - `npm run lint` exited 0.
   - `npm run build` exited 0.

