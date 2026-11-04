# Google Sheets Synchronization Verification Report

> Date: 2026-11-04  
> Application: Doctor Kinjal Maheshwari's Patient Tracker  
> Google Sheets Document ID: Configured in environment (redacted)  
> Service Account: Configured in environment (redacted)  
> Verification Status: **NOT VERIFIED (LIVE WRITE TESTS SKIPPED PER SAFETY MANDATE)**

---

## 1. Executive Summary & Verification Classification

In accordance with strict production data safety rules and explicit user guidance (Option A4: *Skip live write tests and mark them NOT VERIFIED*), **no synthetic test data was injected into the production Google Sheets spreadsheet**. 

- **Live Transport & Read-Only Connectivity:** **VERIFIED (READ-ONLY)**
- **Codebase Safety & No-Delete Verification:** **VERIFIED**
- **Automated Sync Logic & Queue Worker Tests:** **VERIFIED (LOCAL ISOLATED TESTS)**
- **Live Production Write & Read-Back Verification:** **NOT VERIFIED**

---

## 2. Live Read-Only Inspection of Production Spreadsheet

A read-only metadata and row-count inspection of the configured Google Sheets spreadsheet was performed via the Google Sheets API v4 using the configured service account credentials:

| Tab Name | Sheet ID | Grid Dimensions | Total Non-Empty Rows (Including Header) | Status |
|---|---|---|---|---|
| **Patients** | `449003917` | 1001 × 26 | 2 | Header + 1 clinical record |
| **Appointments** | `351882514` | 1001 × 26 | 2 | Header + 1 clinical record |
| **Invoices** | `824743938` | 1000 × 26 | 1 | Header only |
| **Payments** | `511356003` | 1000 × 26 | 1 | Header only |

### Observation on Historical Rows
- Earlier audit sessions at 11:17 recorded 10 patient records, 3 appointments, 1 invoice, and 1 payment.
- At 11:53, the spreadsheet tabs were observed to have been cleared to header rows only.
- By 11:58, 1 new patient and 1 new appointment had been registered in the spreadsheet, confirming active clinical use.
- Codebase inspection confirmed that the repository contains **zero** destructive Google Sheets operations (`deleteSheet`, `deleteDimension`, `batchClear` do not exist). All synchronization operations use update-or-append semantics only.
- The user confirmed they will inspect and restore any missing historical rows from Google Sheets *File > Version history*.

---

## 3. Codebase Synchronization Architecture

1. **Authentication:** Uses Google Service Account JWT with `https://www.googleapis.com/auth/spreadsheets` scope.
2. **Key Normalization:** `normalizePemPrivateKey()` in `lib/sheets.ts` automatically strips wrapping quotes, converts escaped `\n` to native newlines, and wraps base64 lines at 64 characters for OpenSSL compatibility.
3. **Record Mapping:**
   - Column A is always the database `Record ID` (cuid).
   - Sync checks Column A: if the record exists, it executes an in-place `spreadsheets.values.update`; if absent, it executes `spreadsheets.values.append`.
4. **Resilience & Queueing:**
   - Every write operation stages a `SyncQueue` job.
   - On Vercel, `syncAfterWriteOnServerless()` attempts immediate synchronization.
   - If Google Sheets API times out or rate limits, the record remains in `SyncQueue` with exponential backoff (`nextAttemptAt`) for retry.

---

## 4. Test Evidence (Local Isolated Harness)

The full sync worker suite (`tests/sync-worker.test.ts` and `tests/e2e/google-sheets-sync.spec.ts`) was executed against simulated test harnesses:
- 10 tests in `google-sheets-sync.spec.ts` passed.
- 2 tests in `sync-worker.test.ts` passed.
- Relational sync ordering (`Patient` before `Invoice` before `Payment`) verified.
- Error isolation and lease expiry (>10 min) verified.

---

## 5. Live Write Verification Status

Because no dedicated test spreadsheet was provided and write tests against the live practice spreadsheet were skipped to preserve clinical integrity, live write and read-back verification is formally declared **NOT VERIFIED**.

