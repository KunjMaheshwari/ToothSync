# QA Master Test Execution Report — Doctor Kinjal Maheshwari's Patient Tracker

**Execution Date**: 2026-11-04  
**Application**: Doctor Kinjal Maheshwari's Patient Tracker  
**Test Runner**: Vitest v3.2.7 (`npm test`)  
**Total Test Suites**: 15 Passed / 15 Total  
**Total Automated Tests**: 91 Passed / 91 Total (including all 50 Distinct End-to-End QA Test Cases `TC-001` – `TC-050`)  
**Final Pass Rate**: **100% (50 / 50 QA Test Cases PASS)**

---

## 1. Executive Summary Table

| Metric | Count | Status |
|---|---:|---|
| Total Master QA Test Cases Executed (`TC-001` – `TC-050`) | 50 | **50 PASS / 0 FAIL** |
| Supporting Unit & Integration Tests Executed | 41 | **41 PASS / 0 FAIL** |
| Total Automated Assertions / Suites | 91 tests across 15 files | **100% PASS** |
| Defects Identified & Fixed at Root Cause | 4 (`QA-DEF-001` – `QA-DEF-004`) | **All Resolved & Regression-Tested** |
| TypeScript Compiler Verification (`npx tsc --noEmit`) | 0 errors | **PASS** |
| ESLint Verification (`npm run lint`) | 0 errors, 0 warnings | **PASS** |
| Production Build Verification (`npm run build`) | Exit code 0 | **PASS** |
| Production SQLite (`prisma/dev.db`) Data Preservation | 11 patients, 3 appts, 1 invoice (`₹2,418.00`), 1 payment | **100% Intact** |

---

## 2. Complete 50-Test-Case Execution Results (`TC-001` – `TC-050`)

### Module 1: Authentication and Authorization (`TC-001` – `TC-004`) — 4 / 4 PASS

| Test ID | Test Case Name | Actual Result | Status | Defect Ref |
|---|---|---|---|---|
| `TC-001` | Valid login and logout workflow | `POST /api/auth/login` returned HTTP 200 with `dentalcare_session` `HttpOnly` cookie and created `LOGIN` audit log (`entityId: "doctorkinjal"`). `POST /api/auth/logout` cleared cookie (`Max-Age=0`) and created `LOGOUT` audit log. | **PASS** | None |
| `TC-002` | Invalid credentials and brute-force rate limit | Invalid username (`wrongdoctor`) and wrong password returned HTTP 401 (`Invalid username or password.`) with no session cookie. After 8 failed attempts from IP `10.0.0.104`, the 9th attempt returned HTTP 429 (`Too many attempts. Try again in 15 minutes.`). | **PASS** | None |
| `TC-003` | Protected route access without authentication | Rendering `Home()` unauthenticated rendered `<Login />` (`Sign in to Patient Tracker`) and excluded clinical dashboard markup. Rendering `Home()` authenticated displayed `Welcome Doctor Kinjal Maheshwari` and `Here's your clinic overview for today.`. | **PASS** | None |
| `TC-004` | Unauthorized and cross-origin (CSRF) API protection | Unauthenticated `GET /api/patients`, `GET /api/invoices`, `GET /api/dashboard`, and `POST /api/invoices/inv-1/payments` returned HTTP 401. Authenticated `POST /api/patients` with header `Origin: https://evil.example.com` returned HTTP 403 (`Invalid request origin.`). | **PASS** | None |

### Module 2: Patient Management (`TC-005` – `TC-012`) — 8 / 8 PASS

| Test ID | Test Case Name | Actual Result | Status | Google Sheets Sync Status |
|---|---|---|---|---|
| `TC-005` | Create patient with complete valid details | `Aarav Sharma` (`+91 98201 11223`, `1988-05-14`, Penicillin allergy, Hypertension history) created with HTTP 201; all fields persisted in SQLite `Patient` table. | **PASS** | `PENDING` `UPSERT` queued in `SyncQueue` |
| `TC-006` | Create patient with minimum required fields | `Priya Patel` (`+91 9876543210`) created with HTTP 201; optional fields defaulted cleanly (`gender: "Other"`, empty strings for email/address/notes). | **PASS** | `PENDING` `UPSERT` queued in `SyncQueue` |
| `TC-007` | Patient validation for missing required & invalid fields | Empty `firstName`, short phone `1234`, and malformed email `not-an-email` each returned HTTP 400 with field validation message; 0 records written to DB. | **PASS** | Not queued (invalid input rejected) |
| `TC-008` | Duplicate phone warning & explicit override | Creating `Rohan Jr Mehta` with phone `98111-22334` matching `Rohan Mehta` (`+91 98111 22334`) returned HTTP 409 `DUPLICATE_PHONE` warning; resending with `allowDuplicatePhone: true` succeeded with HTTP 201. | **PASS** | `PENDING` `UPSERT` queued in `SyncQueue` |
| `TC-009` | Edit patient details & update persistence | `PATCH /api/patients/[id]` for `Ananya Iyer` updated phone, email, address, medicalHistory, allergies, and notes (HTTP 200). | **PASS** | `SyncQueue` updated to `PENDING` `UPSERT` |
| `TC-010` | Search & filter patients by name, phone, email | Verified matching across case-insensitive name (`neha`), normalized 10-digit phone (`9900112233` matching `+91 99001 12233`), and email (`kabir.v@example.in`). | **PASS** | Read-only query |
| `TC-011` | Patient detail view relational history | `GET /api/patients` for `Meera Nair` returned nested `appointments` (1), `treatments` (1), `prescriptions` (1), and `invoices` (1) with items and payments. | **PASS** | All 5 entities queued in `SyncQueue` |
| `TC-012` | Archive (soft-delete) patient & preserve financial records | `DELETE /api/patients/[id]` for `Aditya Joshi` set `deletedAt`, removed patient from active `GET /api/patients`, and preserved paid invoice (`₹500.00`) in `GET /api/invoices`. | **PASS** | `DELETE` job queued in `SyncQueue` |

### Module 3: Appointments (`TC-013` – `TC-018`) — 6 / 6 PASS

| Test ID | Test Case Name | Actual Result | Status | Google Sheets Sync Status |
|---|---|---|---|---|
| `TC-013` | Schedule new appointment for existing patient | Scheduled `Kavita Kulkarni` at `2026-06-15T10:00:00.000Z` (45 min, `Root Canal Consultation`) with HTTP 201 and `status = SCHEDULED`. | **PASS** | `PENDING` `UPSERT` queued in `SyncQueue` |
| `TC-014` | Reschedule appointment date, time, duration, notes | `PATCH /api/appointments/[id]` updated `scheduledAt` to `14:30:00.000Z`, `durationMin = 60`, and updated reason/notes (HTTP 200). | **PASS** | `SyncQueue` updated to `PENDING` `UPSERT` |
| `TC-015` | Update appointment status (`COMPLETED`, `CANCELLED`, `NO_SHOW`) | Transitioned appointment across `COMPLETED`, `CANCELLED`, and `NO_SHOW` via `PATCH /api/appointments/[id]` with HTTP 200. | **PASS** | `SyncQueue` updated on each transition |
| `TC-016` | Prevent overlapping appointment conflict | Booking `11:15–11:45` overlapping active `11:00–11:45` appointment returned HTTP 409 (`Appointment overlaps with Aarav Sharma`). Cancelling first appointment allowed re-booking the slot (HTTP 201). | **PASS** | Only valid appointments queued |
| `TC-017` | Appointment validation for invalid patient/date/duration | Non-existent `patientId` returned HTTP 404; invalid date string and `durationMin: 2` returned HTTP 400. | **PASS** | Not queued |
| `TC-018` | Schedule chronological sort, dashboard today filter & archived patient slot release | `GET /api/appointments` returned chronological ascending order; `GET /api/dashboard` accurately counted `todayAppointments`; archived patient's historical appointment did not block active patient scheduling (`QA-DEF-004` fix verified). | **PASS** | Queued & verified |

### Module 4: Treatments and Prescriptions (`TC-019` – `TC-024`) — 6 / 6 PASS

| Test ID | Test Case Name | Actual Result | Status | Google Sheets Sync Status |
|---|---|---|---|---|
| `TC-019` | Record clinical treatment linked to patient & appointment | Created `Root Canal Treatment` (`Tooth 46`, `Irreversible Pulpitis`, `₹6,500.00`) for `Rohan Mehta` linked to appointment (`costPaise = 650000`, HTTP 201). | **PASS** | `PENDING` `UPSERT` queued in `SyncQueue` |
| `TC-020` | Record multiple treatments across teeth for single patient | Recorded Tooth `11` Crown (`950,000 paise`), Tooth `12` Crown (`950,000 paise`), and Full Mouth Scaling (`150,000 paise`) for `Ananya Iyer` (total `2,050,000 paise` / `₹20,500.00`). | **PASS** | 3 `UPSERT` jobs queued in `SyncQueue` |
| `TC-021` | Create multi-medication prescription linked to patient & treatment | Created prescription for `Vikram Singh` with 3 medications (`Amoxicillin 500mg`, `Ibuprofen 400mg`, `Chlorhexidine Mouthwash 0.2%`) linked to treatment (HTTP 201). | **PASS** | `PENDING` `UPSERT` queued in `SyncQueue` |
| `TC-022` | Reject cross-patient appointment link & invalid treatment/Rx payloads | Submitting a treatment for `Kabir` linked to `Neha`'s `appointmentId` returned HTTP 400 (`Appointment does not belong to the selected patient`, `QA-DEF-001` fix). Negative cost and empty Rx items returned HTTP 400. | **PASS** | Not queued |
| `TC-023` | Retrieve treatment & prescription history inside patient record | `GET /api/patients` returned `Meera Nair`'s 2 treatments (`150,000` & `220,000 paise`) and 1 prescription in descending chronological order. | **PASS** | Synced |
| `TC-024` | Link clinical treatments into an invoice | Created invoice for `Aditya Joshi` linking `Consultation` (`50,000 paise`) and `Dental X-Ray IOPAR` (`35,000 paise`) via `treatmentId` (`subtotalPaise = 85000`, HTTP 201). | **PASS** | `PENDING` `UPSERT` queued in `SyncQueue` |

### Module 5: Billing and Invoices (`TC-025` – `TC-032`) — 8 / 8 PASS

| Test ID | Test Case Name | Actual Result | Status | Google Sheets Sync Status |
|---|---|---|---|---|
| `TC-025` | Single-item invoice creation | Created `Consultation` (`qty 1`, `50,000 paise`) invoice for `Aarav Sharma`: `subtotalPaise = 50000`, `discountPaise = 0`, `taxPaise = 0`, `totalPaise = 50000`, `status = UNPAID`. | **PASS** | `PENDING` `UPSERT` queued in `SyncQueue` |
| `TC-026` | Multi-item invoice with quantities > 1 | Created invoice with `1x 650,000` + `2x 950,000` + `3x 35,000` paise: `subtotalPaise = 2655000` (`₹26,550.00`), `totalPaise = 2655000`. | **PASS** | `PENDING` `UPSERT` queued in `SyncQueue` |
| `TC-027` | Percentage discount calculation | Subtotal `1,000,000 paise` (`₹10,000.00`) with `discountPercent = 12.5%` produced `discountPaise = 125000` (`₹1,250.00`) and `totalPaise = 875000` (`₹8,750.00`). | **PASS** | `PENDING` `UPSERT` queued in `SyncQueue` |
| `TC-028` | Fixed discount calculation | Subtotal `400,000 paise` (`₹4,000.00`) with `discountPaise = 75000` (`₹750.00`) produced `totalPaise = 325000` (`₹3,250.00`). | **PASS** | `PENDING` `UPSERT` queued in `SyncQueue` |
| `TC-029` | Tax calculation after discount & rounding accuracy | `3x 111,133 paise` (`subtotal = 333399`), `7.5%` discount (`discountPaise = 25005`, `taxable = 308394`), `18%` GST (`taxPaise = 55511`) → `totalPaise = 363905` (`₹3,639.05`). | **PASS** | `PENDING` `UPSERT` queued in `SyncQueue` |
| `TC-030` | Edit existing invoice items/discounts & guard against reducing below paid amount | `PATCH /api/invoices/[id]` updated line items, discount (`20,000 paise`), and tax (`18,000 paise`) to `totalPaise = 368000` while preserving `paidPaise = 100000` (`PARTIALLY_PAID`, `QA-DEF-002` fix). Attempting to reduce total to `50,000 paise` (< `100,000` paid) returned HTTP 400. | **PASS** | `SyncQueue` re-queued on valid edit |
| `TC-031` | Cancel unpaid invoice & prevent cancelling invoice with active payments | `PATCH /api/invoices/[id]` with `{ status: "CANCELLED" }` succeeded on unpaid invoice (`status = CANCELLED`), and returned HTTP 400 when `paidPaise > 0`. | **PASS** | `SyncQueue` updated on cancellation |
| `TC-032` | Invoice validation for zero/negative/invalid discounts | Empty `items: []`, negative `unitCostPaise: -500`, and `discountPercent: 150` all returned HTTP 400. | **PASS** | Not queued |

### Module 6: Payments and Financial Integrity (`TC-033` – `TC-040`) — 8 / 8 PASS

| Test ID | Test Case Name | Actual Result | Status | Google Sheets Sync Status |
|---|---|---|---|---|
| `TC-033` | Full single payment transitions `UNPAID` → `PAID` | Payment of `180,000 paise` (`₹1,800.00`, `UPI`) updated `paidPaise = 180000`, `balance = 0`, `status = PAID`. | **PASS** | Both `Payment` & `Invoice` queued in `SyncQueue` |
| `TC-034` | Partial payment updates `paidPaise` & `PARTIALLY_PAID` | Payment of `250,000 paise` (`₹2,500.00`) on `650,000 paise` invoice updated `paidPaise = 250000`, `balance = 400000` (`₹4,000.00`), `status = PARTIALLY_PAID`. | **PASS** | Both `Payment` & `Invoice` queued in `SyncQueue` |
| `TC-035` | Multiple installment payments across all 4 payment methods | Recorded 4 installments (`200,000` `CASH`, `300,000` `UPI`, `250,000` `CARD`, `200,000` `BANK_TRANSFER`) on `950,000 paise` invoice; transitioned `UNPAID` → `PARTIALLY_PAID` → `PAID` (`balance = 0`). | **PASS** | 4 `Payment` + 4 `Invoice` updates queued |
| `TC-036` | Prevent overpayment & zero/negative payment | Attempting `50,001 paise` on `50,000 paise` remaining balance returned HTTP 400 (`Payment exceeds remaining invoice balance of ₹500.00`). Zero and negative amounts returned HTTP 400. | **PASS** | Not queued |
| `TC-037` | Prevent payment on `CANCELLED` invoice | `POST /api/invoices/[id]/payments` on cancelled invoice returned HTTP 400 (`Cannot record payment on a cancelled invoice.`). | **PASS** | Not queued |
| `TC-038` | Refund / reversal workflow & over-refund guard | Partial refund of `150,000 paise` on paid `450,000 paise` invoice updated `paidPaise = 300000` (`PARTIALLY_PAID`). Over-refund of `400,000 paise` rejected with HTTP 400. Final refund of `300,000 paise` transitioned `paidPaise = 0` (`UNPAID`). | **PASS** | Refund `Payment` & `Invoice` queued |
| `TC-039` | Dashboard financial summary reconciliation | Verified `GET /api/dashboard` against ledger: `totalRevenuePaise = 350000` (`₹3,500.00` net of refund), `outstandingPaise = 350000` (`₹3,500.00` excluding cancelled invoice), `collectionRate = 50%`. | **PASS** | Verified |
| `TC-040` | Floating-point precision & odd-paise boundary test | Invoice with `111,133 + 33,333 + 1 = 144,467 paise` (`₹1,444.67`) paid via 3 odd-paise installments (`48,155 + 48,156 + 48,156 = 144,467 paise`) settled with `0` rounding drift and `status = PAID`. | **PASS** | Synced with exact 2-decimal INR formatting |

### Module 7: Google Sheets Synchronization and Reconciliation (`TC-041` – `TC-050`) — 10 / 10 PASS

| Test ID | Test Case Name | Actual Result | Status | Google Sheets Verification |
|---|---|---|---|---|
| `TC-041` | Patient creation & update sync (`Patients` tab) | Created & updated `Siddharth Rao`; `processSyncQueue()` wrote row and updated in-place by Record ID in `Patients` tab (1 row total, columns `A:M` exact match). | **PASS** | Verified (`Patients` tab) |
| `TC-042` | Appointment creation & status transition sync (`Appointments` tab) | Synced `SCHEDULED` appointment and updated to `COMPLETED`; `Appointments` tab row updated in-place (`Status = COMPLETED`, 1 row total). | **PASS** | Verified (`Appointments` tab) |
| `TC-043` | Treatment & prescription sync (`Treatments` & `Prescriptions` tabs) | Synced RCT (`Cost (INR) = 6500.00`) to `Treatments` tab and 2-medication Rx (`Ketorolac DT 10mg`, `Pantoprazole 40mg`) to `Prescriptions` tab. | **PASS** | Verified (`Treatments` & `Prescriptions` tabs) |
| `TC-044` | Invoice creation sync with financial columns (`Invoices` tab) | Synced invoice (`Subtotal = 19000.00`, `Discount = 1000.00`, `Tax = 900.00`, `Total = 18900.00`, `Paid = 0.00`, `Balance = 18900.00`, `Status = UNPAID`) to `Invoices` tab. | **PASS** | Verified (`Invoices` tab) |
| `TC-045` | Partial & full payment sync (`Payments` + `Invoices` tabs) | Synced `₹8,900.00` (`UPI`) and `₹10,000.00` (`CARD`); `Payments` tab recorded both rows (`PAYMENT`) and `Invoices` tab transitioned `PARTIALLY_PAID` (`Balance = 10000.00`) → `PAID` (`Balance = 0.00`). | **PASS** | Verified (`Payments` & `Invoices` tabs) |
| `TC-046` | SyncQueue retry with exponential backoff on transient error | Simulated Google Sheets API `503` failure on 1st attempt: `SyncQueue` marked `FAILED` (`attempts = 1`, `lastError` captured, `nextRetryAt` scheduled). On retry after backoff window, job succeeded and transitioned to `SYNCED`. | **PASS** | Verified (`SyncQueue` → `Patients` tab) |
| `TC-047` | Idempotency & duplicate prevention on repeated sync triggers | Running `processSyncQueue()` 3 times and `reconcileAllSheets()` twice produced 0 duplicate rows across `Patients`, `Invoices`, and `Payments` tabs. | **PASS** | Verified (1 unique row per Record ID) |
| `TC-048` | Drift detection & self-healing reconciliation | Injected missing row, corrupted invoice total (`999.99`), and unexpected orphan row (`orphan-stale-id-999`). `reconcileAllSheets()` detected `missingIds`, `mismatchedIds`, and `unexpectedIds` (`QA-DEF-003` fix) and automatically repaired missing/mismatched rows. | **PASS** | Verified (`driftRepaired = true`) |
| `TC-049` | Special characters, commas, quotes, newlines & Unicode preservation | Synced `Vikram सिंह (Singh)` with `"Allergic to 'NSAIDs', Penicillin & Latex; notes: <check BP>\nLine 2"` to `Patients` tab; verified all 13 columns (`A:M`) aligned without cell shifting or truncation. | **PASS** | Verified (`Patients` tab columns `A:M`) |
| `TC-050` | Full 6-sheet reconciliation audit | Executed `reconcileAllSheets()` across all 6 worksheets (`Patients`, `Appointments`, `Treatments`, `Prescriptions`, `Invoices`, `Payments`); `totalReconciled = 6`, `0` missing, `0` mismatched, and exact financial parity between SQLite and Sheets. | **PASS** | Verified (All 6 tabs 100% reconciled) |

---

## 3. Financial Integrity Audit Report

1. **Integer Paise Representation**:
   - All monetary values in SQLite (`Treatment.costPaise`, `Invoice.subtotalPaise`, `Invoice.discountPaise`, `Invoice.taxPaise`, `Invoice.totalPaise`, `Invoice.paidPaise`, `InvoiceItem.unitCostPaise`, `InvoiceItem.lineTotalPaise`, `Payment.amountPaise`) are stored as exact integers in **paise** (`₹1.00 = 100 paise`).
   - Verified zero IEEE-754 floating-point drift across odd-paise boundary cases (`₹1,111.33`, `₹333.33`, `₹0.01`, `12.5%` discount, `7.5%` discount, `18%` GST).
2. **Core Billing Identities Verified**:
   - $\text{Line Total (paise)} = \text{round}(\text{Quantity} \times \text{Unit Cost (paise)})$
   - $\text{Subtotal (paise)} = \sum \text{Line Total (paise)}$
   - $\text{Discount (paise)} = \min\left(\text{Subtotal}, \max\left(0, \text{Fixed Discount} + \text{round}\left(\frac{\text{Subtotal} \times \text{Discount \%}}{100}\right)\right)\right)$
   - $\text{Taxable Amount (paise)} = \text{Subtotal (paise)} - \text{Discount (paise)}$
   - $\text{Tax (paise)} = \max\left(0, \text{Fixed Tax} + \text{round}\left(\frac{\text{Taxable Amount} \times \text{Tax \%}}{100}\right)\right)$
   - $\text{Total Invoice Amount (paise)} = \text{Taxable Amount (paise)} + \text{Tax (paise)}$
   - $\text{Net Paid (paise)} = \sum \text{Payments (isRefund=false)} - \sum \text{Refunds (isRefund=true)}$
   - $\text{Outstanding Balance (paise)} = \max(0, \text{Total Invoice Amount} - \text{Net Paid})$
3. **Transactional Concurrency & Invariant Guards**:
   - All payment/refund creations (`POST /api/invoices/[id]/payments`) and invoice edits/cancellations (`PATCH /api/invoices/[id]`) execute inside `Prisma.TransactionIsolationLevel.Serializable` transactions.
   - Overpayments (`amountPaise > balancePaise`), over-refunds (`amountPaise > paidPaise`), payments against `CANCELLED` invoices, and invoice edits that reduce `totalPaise` below `paidPaise` are strictly rejected with HTTP 400.

---

## 4. Defect Report (Root Causes Identified, Fixed & Retested)

### `QA-DEF-001` — Cross-Patient Appointment Link in Treatment Creation
- **Affected File**: [`app/api/treatments/route.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/api/treatments/route.ts)
- **Severity**: Medium (Data Integrity)
- **Symptom**: `POST /api/treatments` verified that `patientId` existed, and if `appointmentId` was provided, attached it without checking that `appointment.patientId === patientId`.
- **Root Cause**: Missing relational ownership check between `Appointment` and `Patient` in `POST /api/treatments`.
- **Fix Implemented**: Added query verifying the linked `appointmentId` exists and `appt.patientId === d.patientId`, returning HTTP 400 (`"Appointment does not belong to the selected patient."`) when mismatched.
- **Verification**: Verified in `TC-022` (`tests/e2e/treatments.spec.ts`).

### `QA-DEF-002` — Invoice Line-Item / Discount / Tax Editing Support in `PATCH /api/invoices/[id]`
- **Affected Files**: [`lib/validation.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/lib/validation.ts), [`app/api/invoices/[id]/route.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/api/invoices/%5Bid%5D/route.ts)
- **Severity**: Medium (Feature Completeness & Financial Integrity)
- **Symptom**: `PATCH /api/invoices/[id]` previously only accepted `{ status: "CANCELLED" }` and did not support editing invoice items, discounts, or taxes on active invoices.
- **Root Cause**: `invoiceUpdateSchema` was restricted to `z.object({ status: z.literal("CANCELLED") })`.
- **Fix Implemented**: Expanded `invoiceUpdateSchema` into a discriminated union supporting both `{ status: "CANCELLED" }` and full invoice edits (`items`, `discountPaise`, `discountPercent`, `taxPaise`, `taxPercent`, `notes`). Inside a `Serializable` transaction, `PATCH /api/invoices/[id]` recalculates totals via `computeInvoiceTotals`, rejects edits on `CANCELLED` invoices or edits where new `totalPaise < paidPaise`, replaces `InvoiceItem` rows, recalculates `status` (`UNPAID` / `PARTIALLY_PAID` / `PAID`), records an `AuditLog`, and enqueues an `UPSERT` job in `SyncQueue`.
- **Verification**: Verified in `TC-030` (`tests/e2e/billing.spec.ts`).

### `QA-DEF-003` — Unexpected / Orphan Row Detection in Google Sheets Reconciliation
- **Affected File**: [`lib/sheets.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/lib/sheets.ts)
- **Severity**: Low (Observability & Reconciliation Completeness)
- **Symptom**: `reconcileEntitySheet` reported `missingIds` (in DB but missing in Sheet) and `mismatchedIds` (in both but cell values differed), but did not report `unexpectedIds` (stale/orphan rows present in the Google Sheet that do not exist in the authoritative database).
- **Root Cause**: `ReconciliationResult` only iterated over `expectedRows` from the database without checking `existingById.keys()` against the expected ID set.
- **Fix Implemented**: Added `unexpectedIds: string[]` to `ReconciliationResult` and populated it by filtering `existingById.keys()` against `expectedIdSet`.
- **Verification**: Verified in `TC-048` (`tests/e2e/google-sheets-sync.spec.ts`).

### `QA-DEF-004` — Archived Patient Appointments Blocking Active Slot Scheduling
- **Affected Files**: [`app/api/appointments/route.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/api/appointments/route.ts), [`app/api/appointments/[id]/route.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/api/appointments/%5Bid%5D/route.ts)
- **Severity**: Low (Scheduling Edge Case)
- **Symptom**: When a patient was archived (`deletedAt != null`), their historical `SCHEDULED` appointments remained non-cancelled in SQLite and could trigger a 409 slot conflict when scheduling an active patient at the same time.
- **Root Cause**: The appointment overlap query filtered `status: { not: "CANCELLED" }` without filtering `patient: { deletedAt: null }`.
- **Fix Implemented**: Added `patient: { deletedAt: null }` to the overlap query in both `POST /api/appointments` and `PATCH /api/appointments/[id]`.
- **Verification**: Verified in `TC-018` (`tests/e2e/appointments.spec.ts`).

---

## 5. Build, Lint, TypeScript, and Production Database Integrity

- **`npm test`**: 15 test suites passed, **91 / 91 tests passed** (`0` failures).
- **`npx tsc --noEmit`**: `0` TypeScript errors.
- **`npm run lint`**: `✔ No ESLint warnings or errors`.
- **`npm run build`**: Next.js 15 production build succeeded cleanly (`0` build or SSR errors).
- **Production SQLite (`prisma/dev.db`) Audit**:
  - Active Patients: `11` (all original records preserved, `0` synthetic test rows leaked into `prisma/dev.db`)
  - Appointments: `3`
  - Treatments: `1`
  - Prescriptions: `1`
  - Invoices: `1` (`INV-2026-94875345`, Total `₹2,418.00` / `241,800 paise`, Paid `₹2,418.00`, Status `PAID`)
  - Payments: `1` (`₹2,418.00` `UPI`)
  - SyncQueue Jobs: `16` (`16 SYNCED`, `0 FAILED`)

