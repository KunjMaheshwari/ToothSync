# Regression Test Report: Doctor Kinjal Maheshwari’s Patient Tracker

> **Application:** Doctor Kinjal Maheshwari’s Patient Tracker  
> **Environment:** Node.js / Vitest / TypeScript / SQLite Test Database  
> **Date:** 2026-11-04  
> **Overall Status:** PASSED (19 Suites, 111 Tests, 0 Failures)

---

## 1. Test Suite Execution Summary

The entire automated test suite was executed in CI mode:
- **Command:** `CI=true npm test` (invoking `vitest run`)
- **Exit Code:** `0`
- **Total Test Files:** 19 passed (19 total)
- **Total Tests:** 111 passed (111 total)
- **Duration:** 8.93s

### Complete Test Inventory

| # | Test File | Tests Passed | Focus Area |
|---|---|:---:|---|
| 1 | [`tests/patient-archive-lifecycle.test.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests/patient-archive-lifecycle.test.ts) | 3 | **NEW REGRESSION SUITE:** Patient archival, cascade cancellation, financial preservation, 17-col tombstone, hydration resurrection prevention, delete idempotency |
| 2 | [`tests/e2e/google-sheets-sync.spec.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests/e2e/google-sheets-sync.spec.ts) | 10 | Google Sheets synchronization, tab creation, header verification, queue processing |
| 3 | [`tests/profile-durable-storage.test.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests/profile-durable-storage.test.ts) | 11 | Durable storage resolution, error status mapping, multi-instance isolation |
| 4 | [`tests/production-incident-reliability.test.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests/production-incident-reliability.test.ts) | 5 | HTTP 503 error shielding, safe error messages without PHI/stack traces |
| 5 | [`tests/e2e/payments.spec.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests/e2e/payments.spec.ts) | 8 | Invoice payment recording, balance reduction, receipt generation |
| 6 | [`tests/e2e/billing.spec.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests/e2e/billing.spec.ts) | 8 | Invoice creation, tax and discount computation in integer paise |
| 7 | [`tests/e2e/appointments.spec.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests/e2e/appointments.spec.ts) | 6 | Appointment booking, rescheduling, conflict avoidance, status transitions |
| 8 | [`tests/e2e/treatments.spec.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests/e2e/treatments.spec.ts) | 6 | Treatment procedure logging, tooth numbering, status changes |
| 9 | [`tests/e2e/patients.spec.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests/e2e/patients.spec.ts) | 8 | Patient registration, DOB validation, contact updates |
| 10 | [`tests/e2e/ten-data-types.test.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests/e2e/ten-data-types.test.ts) | 1 | End-to-end integration across all 10 clinical data entities |
| 11 | [`tests/api-integration.test.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests/api-integration.test.ts) | 4 | Protected endpoint authentication, unauthorized rejection |
| 12 | [`tests/e2e/authentication.spec.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests/e2e/authentication.spec.ts) | 4 | Login with valid credentials, invalid password rejection, logout session wipe |
| 13 | [`tests/finance-billing.test.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests/finance-billing.test.ts) | 4 | Integer paise precision, financial balance consistency |
| 14 | [`tests/sync-worker.test.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests/sync-worker.test.ts) | 2 | Background queue processing, exponential backoff retries |
| 15 | [`tests/ui-branding.test.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests/ui-branding.test.ts) | 4 | "Welcome Doctor Kinjal Maheshwari" greeting preservation, clinic branding |
| 16 | [`tests/validation.test.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests/validation.test.ts) | 14 | Zod schema validation boundaries across all data contracts |
| 17 | [`tests/sheets.test.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests/sheets.test.ts) | 5 | Google Sheets simulator, column mapping, header expansion |
| 18 | [`tests/security.test.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests/security.test.ts) | 4 | CSRF origin enforcement, constant-time compare, rate limiter |
| 19 | [`tests/patient-search.test.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests/patient-search.test.ts) | 4 | Fast patient search query filtering and indexing |
| **TOTAL** | **19 Suites** | **111** | **100% Pass Rate** |

---

## 2. Dedicated Regression Coverage: Patient Deletion Reappearance Bug

[`tests/patient-archive-lifecycle.test.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests/patient-archive-lifecycle.test.ts) specifically verifies the conditions under which the 3-4 second reappearance bug previously reproduced:

### Test Case 1: Cascade Archival & Historical Preservation
```ts
it("archive sets deletedAt, cancels scheduled appointments and follow-ups, and preserves financial history")
```
- **Given:** A patient with scheduled & completed appointments, pending follow-ups, planned & completed treatments, and paid invoices.
- **When:** `DELETE /api/patients/:id` is invoked.
- **Then:**
  1. Patient's `deletedAt` is set to the current ISO timestamp.
  2. Scheduled appointment is updated to `CANCELLED`.
  3. Completed appointment remains `COMPLETED`.
  4. Pending follow-up is updated to `CANCELLED`.
  5. Planned treatment is updated to `CANCELLED`.
  6. Completed treatment remains `COMPLETED`.
  7. Invoices and payments remain untouched with `status: "PAID"`.
  8. `GET /api/patients?q=` does not return the archived patient.
  9. `GET /api/patients/:id` returns HTTP 404.
  10. Subsequent `DELETE /api/patients/:id` returns HTTP 200 with `{ ok: true, alreadyArchived: true }` (idempotent).

### Test Case 2: Google Sheets 17th Column Tombstone
```ts
it("Google Sheets record contains 17 columns with 'Archived At' tombstone")
```
- **Given:** A soft-deleted patient with a non-null `deletedAt`.
- **When:** `buildSheetRecord("Patient", patient)` is executed.
- **Then:**
  1. Returned headers array length is 17.
  2. Index 16 header is `"Archived At"`.
  3. Index 16 value contains the ISO string of `deletedAt`.

### Test Case 3: Hydration Zombie Resurrection Prevention
```ts
it("hydrateDatabaseFromSheets preserves deletedAt and never resurrects archived patient")
```
- **Given:** A simulated Google Sheets response containing an archived patient with an ISO timestamp in column 17 (`row[16]`).
- **When:** `hydrateDatabaseFromSheets()` runs during cold-start or background synchronization.
- **Then:**
  1. The database upsert sets `deletedAt` to the tombstone timestamp.
  2. Patient record in SQLite retains `deletedAt !== null`.
  3. `GET /api/patients` continues to omit the patient from all active patient listings.

---

## 3. Build & Static Analysis Verification

- **TypeScript Compilation (`npx tsc --noEmit`):** Exit code `0` (0 errors).
- **ESLint Code Quality (`npm run lint`):** Exit code `0` (clean).
- **Production Build (`npm run build`):** Exit code `0` (Prisma Client generated, 14 static pages generated, optimized production build finalized).
