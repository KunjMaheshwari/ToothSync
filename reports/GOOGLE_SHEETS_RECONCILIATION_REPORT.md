# Google Sheets Synchronization & Reconciliation Report — Doctor Kinjal Maheshwari's Patient Tracker

**Application**: Doctor Kinjal Maheshwari's Patient Tracker  
**Synchronization Engine**: Transactional SQLite Outbox (`SyncQueue`) + Google Sheets v4 API (`lib/sheets.ts`, `lib/sync-queue.ts`)  
**Authoritative Source of Truth**: Local SQLite Database (`prisma/dev.db` in production, `prisma/test.db` in E2E QA)  
**Downstream Replica**: Google Sheets Workbook (`GOOGLE_SHEET_ID`) across 6 Entity Worksheets

---

## 1. Worksheet Architecture & Column Mappings

Every worksheet uses **Column A (`Record ID`)** as the deterministic primary key for idempotent row upserts (`update` in-place when `Record ID` exists, `append` when new, and blanking row on soft-delete).

| Worksheet Name | Columns | Exact Header Order (`A` → Last Column) |
|---|---:|---|
| **`Patients`** | 13 (`A:M`) | `Record ID`, `First Name`, `Last Name`, `Phone`, `Email`, `Gender`, `Date of Birth`, `Address`, `Medical History`, `Allergies`, `Clinical Notes`, `Created At`, `Updated At` |
| **`Appointments`** | 9 (`A:I`) | `Record ID`, `Patient ID`, `Patient Name`, `Scheduled At`, `Duration (Min)`, `Reason`, `Status`, `Notes`, `Updated At` |
| **`Treatments`** | 9 (`A:I`) | `Record ID`, `Patient ID`, `Patient Name`, `Appointment ID`, `Diagnosis`, `Procedure`, `Tooth`, `Cost (INR)`, `Performed At` |
| **`Prescriptions`** | 6 (`A:F`) | `Record ID`, `Patient ID`, `Patient Name`, `Treatment ID`, `Medications`, `Notes` |
| **`Invoices`** | 13 (`A:M`) | `Record ID`, `Invoice Number`, `Patient ID`, `Patient Name`, `Subtotal (INR)`, `Discount (INR)`, `Tax (INR)`, `Total (INR)`, `Paid (INR)`, `Balance (INR)`, `Status`, `Issued At`, `Updated At` |
| **`Payments`** | 10 (`A:J`) | `Record ID`, `Invoice ID`, `Invoice Number`, `Patient ID`, `Patient Name`, `Amount (INR)`, `Type`, `Method`, `Reference`, `Paid At` |

---

## 2. Outbox Queue (`SyncQueue`) & Self-Healing Reconciliation Architecture

1. **Transactional Outbox Enqueueing**:
   - Every clinical or financial mutation (`POST`/`PATCH`/`DELETE` on Patients, Appointments, Treatments, Prescriptions, Invoices, Payments) writes or updates a `SyncQueue` record (`unique(entity, entityId)`) with `status = "PENDING"`, `attempts = 0`, and `nextRetryAt = now`.
2. **Idempotent Worker (`processSyncQueue`)**:
   - Claims eligible jobs (`status IN ("PENDING", "FAILED")` and `nextRetryAt <= now`) atomically via `updateMany` optimistic locking (`status = "PROCESSING"`).
   - Reads the latest authoritative record directly from SQLite (`syncEntityById`), guaranteeing out-of-order queue execution never overwrites newer state with stale state.
   - Looks up `Record ID` in Column A of the target worksheet:
     - If found: updates the exact row range (`Sheet!A{row}:Z{row}`) in-place (`0` duplicate rows).
     - If not found: appends a new row at `Sheet!A:Z`.
3. **Exponential Backoff Retry**:
   - If the Google Sheets API returns an error or network failure, the job transitions to `status = "FAILED"`, increments `attempts`, stores the diagnostic message in `lastError`, and schedules `nextRetryAt = now + min(30 min, 2^(attempts-1) * 15 sec)`.
4. **Full-Sheet Self-Healing Reconciliation (`reconcileAllSheets`)**:
   - Compares every authoritative record in SQLite against every row in all 6 Google Sheets tabs:
     - **`missingIds`**: Records present in SQLite but missing from the Google Sheet → **Automatically appended**.
     - **`mismatchedIds`**: Records present in both SQLite and Google Sheet whose cell values differ → **Automatically overwritten with authoritative SQLite values**.
     - **`unexpectedIds`**: Orphan/stale rows present in the Google Sheet that do not exist in SQLite → **Flagged in `ReconciliationResult.unexpectedIds`**.

---

## 3. Execution Results for Google Sheets QA Test Cases (`TC-041` – `TC-050`)

| Test ID | Scenario | Sheet Tabs Verified | Expected vs. Actual Rows | Financial / Field Parity | Status |
|---|---|---|---|---|---|
| `TC-041` | Patient creation & subsequent profile update | `Patients` | `1` expected / `1` actual (in-place update, `0` duplicates) | Columns `A:M` matched updated phone, allergies, and clinical notes | **PASS** |
| `TC-042` | Appointment creation (`SCHEDULED`) & completion (`COMPLETED`) | `Appointments` | `1` expected / `1` actual | Status updated in-place from `SCHEDULED` to `COMPLETED` | **PASS** |
| `TC-043` | Clinical treatment (`₹6,500.00`) & 2-item prescription sync | `Treatments`, `Prescriptions` | `1` treatment row, `1` prescription row | `Cost (INR) = 6500.00`; Medications formatted cleanly | **PASS** |
| `TC-044` | Multi-item invoice with discount & tax sync | `Invoices` | `1` expected / `1` actual | `Subtotal = 19000.00`, `Discount = 1000.00`, `Tax = 900.00`, `Total = 18900.00`, `Balance = 18900.00`, `Status = UNPAID` | **PASS** |
| `TC-045` | Partial payment (`₹8,900`) + settling payment (`₹10,000`) | `Payments`, `Invoices` | `2` payment rows, `1` invoice row | Invoice transitioned `Paid = 8900.00, Balance = 10000.00 (PARTIALLY_PAID)` → `Paid = 18900.00, Balance = 0.00 (PAID)` | **PASS** |
| `TC-046` | Transient Google API `503` failure & exponential backoff recovery | `SyncQueue`, `Patients` | Failed on attempt #1 (`FAILED`, `attempts=1`), succeeded on attempt #2 (`SYNCED`) | Row written accurately on retry without data loss | **PASS** |
| `TC-047` | Idempotency under 3x `processSyncQueue()` + 2x `reconcileAllSheets()` | `Patients`, `Invoices`, `Payments` | `1` row per entity ID (`0` duplicates) | 100% idempotent | **PASS** |
| `TC-048` | Drift detection (missing row, tampered total `999.99`, orphan row) & self-healing | `Patients`, `Invoices` | Detected `1` missing, `1` mismatched, `1` unexpected; repaired missing & mismatched | Corrupted `Total (INR) = 999.99` restored to `18900.00` (`driftRepaired = true`) | **PASS** |
| `TC-049` | Special characters, commas, quotes, HTML brackets, newlines & Devanagari Unicode | `Patients` | `1` expected / `1` actual (`13` columns `A:M`) | `Vikram सिंह (Singh)` and multiline allergy/clinical notes preserved with `0` column shifting | **PASS** |
| `TC-050` | Complete 6-worksheet end-to-end reconciliation & financial audit | All 6 Tabs | `totalReconciled = 6/6`, `missing = 0`, `mismatched = 0`, `unexpected = 0` | `0.00` INR variance between SQLite paise ledger and Google Sheets | **PASS** |

---

## 4. Production Database (`prisma/dev.db`) & Live Environment Sync Status

### Production `prisma/dev.db` SyncQueue Audit
An inspection of the production SQLite database (`prisma/dev.db`) confirmed:
- **Configured Credentials**: `.env` is configured with `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, and `GOOGLE_SHEET_ID`.
- **Production `SyncQueue` Ledger**:
  - Total Queued Entities in `prisma/dev.db`: **16**
  - `SYNCED`: **16 / 16 (100%)** (`11` Patients, `3` Appointments, `1` Invoice `INV-2026-94875345` for `₹2,418.00` `PAID`, `1` Payment for `₹2,418.00` `UPI`)
  - `PENDING`: **0**
  - `FAILED`: **0**
- **Sandbox Network Note**:
  - During automated test execution inside the local terminal sandbox, outbound DNS resolution to `www.googleapis.com` is blocked by the sandbox boundary (`ENOTFOUND www.googleapis.com`).
  - Rather than fabricating live outbound network calls during sandboxed execution, our E2E suite (`tests/e2e/google-sheets-sync.spec.ts`) exercises the real `processSyncQueue`, `syncEntityById`, and `reconcileAllSheets` production code against a stateful in-memory Google Sheets v4 API (`spreadsheets.get`, `spreadsheets.batchUpdate`, `spreadsheets.values.get`, `spreadsheets.values.update`, `spreadsheets.values.append`) while preserving all 16 `SYNCED` production records in `prisma/dev.db` untouched.

