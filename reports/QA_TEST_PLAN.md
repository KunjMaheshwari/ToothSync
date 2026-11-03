# QA Master Test Plan — Doctor Kinjal Maheshwari's Patient Tracker

**Application**: Doctor Kinjal Maheshwari's Patient Tracker  
**Architecture**: Next.js 15 App Router, React 19, TypeScript 5, Prisma 6 + SQLite (`paise`-integer financial storage), Google Sheets v4 Outbox Sync Queue  
**Total QA Test Cases**: 50 Distinct End-to-End Test Cases (`TC-001` through `TC-050`) + 41 Unit & Integration Tests (91 Total Automated Assertions)  
**Test Database Isolation**: Dedicated SQLite test instance (`prisma/test.db` via `vitest.config.ts`) ensuring zero mutation of production `prisma/dev.db`.

---

## 1. System Lifecycle & Data Traceability Map

```
Patient Registration (POST /api/patients)
  ├─► SQLite Patient Record (UUID, normalized phone, medical history, notes, deletedAt = null)
  ├─► AuditLog (CREATE Patient)
  └─► SyncQueue Outbox (UPSERT Patient) ──► Google Sheets "Patients" Tab (Row Upsert by Record ID)
        │
        ▼
Appointment Scheduling (POST /api/appointments, PATCH /api/appointments/[id])
  ├─► Conflict Detection (Overlapping active appointments for non-deleted patients)
  ├─► SQLite Appointment Record (scheduledAt, durationMin, reason, status, notes)
  ├─► AuditLog (CREATE / UPDATE Appointment)
  └─► SyncQueue Outbox (UPSERT Appointment) ──► Google Sheets "Appointments" Tab
        │
        ▼
Clinical Treatment & Prescription (POST /api/treatments, POST /api/prescriptions)
  ├─► Cross-Patient Integrity Guard (appointment.patientId === treatment.patientId)
  ├─► Integer Paise Cost Conversion (costPaise)
  ├─► SQLite Treatment & Prescription Records (JSON items array for Rx)
  ├─► AuditLog (CREATE Treatment / Prescription)
  └─► SyncQueue Outbox (UPSERT Treatment / Prescription) ──► Google Sheets "Treatments" & "Prescriptions" Tabs
        │
        ▼
Billing & Invoice Issuance (POST /api/invoices, PATCH /api/invoices/[id])
  ├─► Deterministic Financial Engine (computeInvoiceTotals in integer paise)
  │     subtotalPaise = Σ round(quantity * unitCostPaise)
  │     discountPaise = clamp(fixedDiscountPaise + round((subtotal * discountPercent) / 100), 0..subtotal)
  │     taxablePaise  = subtotalPaise - discountPaise
  │     taxPaise      = fixedTaxPaise + round((taxablePaise * taxPercent) / 100)
  │     totalPaise    = taxablePaise + taxPaise
  ├─► SQLite Invoice + InvoiceItem Records (UNPAID / PARTIALLY_PAID / PAID / CANCELLED)
  ├─► AuditLog (CREATE / UPDATE / CANCEL Invoice)
  └─► SyncQueue Outbox (UPSERT Invoice) ──► Google Sheets "Invoices" Tab
        │
        ▼
Payment Collection & Refund Reversal (POST /api/invoices/[id]/payments)
  ├─► Serializable Transaction Guard (Overpayment & Cancelled-Invoice Rejection)
  ├─► Payment / Refund Ledger Record (isRefund, method, reference, notes)
  ├─► Atomic Recalculation of Invoice paidPaise & Status
  ├─► SyncQueue Outbox (UPSERT Payment + UPSERT Invoice) ──► Google Sheets "Payments" & "Invoices" Tabs
  └─► Full Reconciliation Engine (POST /api/sync -> reconcileAllSheets)
```

---

## 2. Test Case Distribution Across Modules

| Module | Test Case IDs | Count | Spec File |
|---|---|---:|---|
| Authentication and authorization | `TC-001` – `TC-004` | 4 | `tests/e2e/authentication.spec.ts` |
| Patient management | `TC-005` – `TC-012` | 8 | `tests/e2e/patients.spec.ts` |
| Appointments | `TC-013` – `TC-018` | 6 | `tests/e2e/appointments.spec.ts` |
| Treatments and prescriptions | `TC-019` – `TC-024` | 6 | `tests/e2e/treatments.spec.ts` |
| Billing and invoices | `TC-025` – `TC-032` | 8 | `tests/e2e/billing.spec.ts` |
| Payments and financial integrity | `TC-033` – `TC-040` | 8 | `tests/e2e/payments.spec.ts` |
| Google Sheets synchronization and reconciliation | `TC-041` – `TC-050` | 10 | `tests/e2e/google-sheets-sync.spec.ts` |
| **Total** | **`TC-001` – `TC-050`** | **50** | **7 E2E Spec Suites** |

---

## 3. Realistic Synthetic Test Dataset

All 50 test cases use realistic Indian clinical scenarios, Indian phone formatting (`+91`), realistic dental procedures, and exact paise/rupee amounts:
- **Patients**:
  - `Aarav Sharma` (`+91 98201 11223`, DOB `1988-05-14`, Penicillin allergy, Hypertension history)
  - `Priya Patel` (`+91 98765 43210`, Female, Orthodontic Ceramic Braces)
  - `Rohan Mehta` (`+91 98111 22334`, Male, Diabetic — HbA1c 6.8%, Root Canal Treatment)
  - `Ananya Iyer` (`+91 97654 32109`, Female, Crown & Bridge Prosthodontics)
  - `Vikram सिंह (Singh)` (`+91 99001 12233`, Unicode/Devanagari + special characters `"Allergic to 'NSAIDs' & Latex; notes: <check BP> & INR 2.1"`)
  - `Neha Desai`, `Kabir Verma`, `Meera Nair`, `Aditya Joshi`, `Kavita Kulkarni`, `Siddharth Rao`, `Pooja Malhotra`
- **Dental Procedures & Fee Schedule**:
  - Consultation (`₹500.00` / `50,000 paise`)
  - Scaling and Polishing (`₹1,500.00` / `150,000 paise`)
  - Composite Filling (`₹2,200.00` / `220,000 paise`)
  - Root Canal Treatment (`₹6,500.00` / `650,000 paise`)
  - Zirconia Dental Crown (`₹9,500.00` / `950,000 paise`)
  - Tooth Extraction (`₹1,800.00` / `180,000 paise`)
  - Wisdom Tooth Impaction (`₹4,500.00` / `450,000 paise`)
  - Dental X-Ray IOPAR (`₹350.00` / `35,000 paise`)
  - Orthodontic Adjustment (`₹2,000.00` / `200,000 paise`)
  - Teeth Whitening (`₹7,500.00` / `750,000 paise`)

---

## 4. Detailed 50-Test-Case Specification (`TC-001` – `TC-050`)

### Module 1: Authentication and Authorization (`TC-001` – `TC-004`)

| ID | Name | Preconditions | Test Data | Step-by-Step Execution | Expected Result |
|---|---|---|---|---|---|
| `TC-001` | Valid login and logout workflow | Configured `AUTH_USERNAME=doctorkinjal` & bcrypt `AUTH_PASSWORD_HASH` | User: `doctorkinjal`, Pass: `QaSecretPass!2026`, IP: `10.0.0.101` | 1. POST `/api/auth/login` with valid credentials.<br>2. Inspect HTTP status & `Set-Cookie`.<br>3. Verify `AuditLog` entry.<br>4. POST `/api/auth/logout`. | HTTP 200 on login; `dentalcare_session` HttpOnly cookie issued; `LOGIN` & `LOGOUT` audit logs persisted; cookie cleared (`Max-Age=0`) on logout. |
| `TC-002` | Invalid login credentials & brute-force rate limit | Fresh rate-limit bucket for test IPs | Wrong user `wrongdoctor`, wrong pass `WrongPassword999`, 8 rapid failures from `10.0.0.104` | 1. POST `/api/auth/login` with wrong username.<br>2. POST with wrong password.<br>3. Send 8 failed attempts from `10.0.0.104` followed by 9th attempt. | Steps 1–2 return HTTP 401 without cookie; 9th attempt from `10.0.0.104` returns HTTP 429 (`Too many attempts`). |
| `TC-003` | Protected route gate without authentication | Server component `app/page.tsx` | Unauthenticated vs. authenticated session state | 1. Render `Home()` with `isAuthenticated = false`.<br>2. Render `Home()` with `isAuthenticated = true`. | Unauthenticated render outputs `<Login />` (`Sign in to Patient Tracker`) and hides clinical dashboard; authenticated render displays `Welcome Doctor Kinjal Maheshwari`. |
| `TC-004` | Unauthorized & cross-origin (CSRF) API rejection | Protected API routes | Unauthenticated GET/POST requests; authenticated POST with `Origin: https://evil.example.com` | 1. Call `GET /api/patients`, `GET /api/invoices`, `GET /api/dashboard`, `POST /api/invoices/inv-1/payments` unauthenticated.<br>2. Call `POST /api/patients` authenticated with foreign `Origin`. | All unauthenticated calls return HTTP 401; foreign-origin mutation returns HTTP 403 (`Invalid request origin.`). |

### Module 2: Patient Management (`TC-005` – `TC-012`)

| ID | Name | Preconditions | Test Data | Step-by-Step Execution | Expected Result |
|---|---|---|---|---|---|
| `TC-005` | Create patient with complete valid details | Authenticated doctor session | `Aarav Sharma`, `+91 98201 11223`, `aarav.sharma@example.in`, Male, DOB `1988-05-14`, Penicillin allergy | 1. POST `/api/patients` with full payload.<br>2. Query SQLite `Patient` & `SyncQueue`. | HTTP 201; all fields persisted accurately; `SyncQueue` has `PENDING` `UPSERT` job for `Patient`. |
| `TC-006` | Create patient with minimum required fields | Authenticated session | `Priya Patel`, `+91 9876543210` | 1. POST `/api/patients` with only `firstName`, `lastName`, `phone`. | HTTP 201; optional fields default cleanly (`gender: "Other"`, empty strings for email/address/notes). |
| `TC-007` | Patient validation for missing/invalid fields | Authenticated session | Missing firstName, 4-digit phone `1234`, malformed email `not-an-email` | 1. POST `/api/patients` with each invalid payload.<br>2. Check DB count. | HTTP 400 with field validation error; 0 invalid records created in DB. |
| `TC-008` | Duplicate phone warning & force-create override | `Rohan Mehta` exists with `+91 98111 22334` | `Rohan Jr Mehta` with formatted phone `98111-22334` | 1. POST `/api/patients` without `allowDuplicatePhone`.<br>2. Retry with `allowDuplicatePhone: true`. | Step 1 returns HTTP 409 `DUPLICATE_PHONE` warning identifying `Rohan Mehta`; Step 2 succeeds with HTTP 201. |
| `TC-009` | Edit patient details & re-queue sync | Existing patient `Ananya Iyer` | Updated phone `+91 97654 99999`, email, medicalHistory, allergies, notes | 1. PATCH `/api/patients/[id]`.<br>2. Inspect DB record and `SyncQueue`. | HTTP 200; updated fields persisted; `SyncQueue` updated to `PENDING` `UPSERT`. |
| `TC-010` | Search & filter patients by name, phone, email | Seeded patients (`Vikram Singh`, `Neha Desai`, `Kabir Verma`) | Queries: `neha`, `9900112233`, `kabir.v@example.in` | 1. GET `/api/patients` and verify search matching across name, normalized phone digits, and email. | Matches exact expected patient in each search modality. |
| `TC-011` | Patient detail view relational aggregation | Patient `Meera Nair` with appointment, treatment, Rx, invoice | 1 appointment, 1 scaling treatment, 1 Rx, 1 invoice | 1. Create linked clinical records.<br>2. GET `/api/patients` and inspect relational arrays. | Patient payload includes ordered `appointments`, `treatments`, `prescriptions`, and `invoices`. |
| `TC-012` | Archive (soft-delete) patient & preserve financial history | Patient `Aditya Joshi` with paid invoice (`₹500.00`) | `DELETE /api/patients/[id]` | 1. DELETE `/api/patients/[id]`.<br>2. Check active list (`GET /api/patients`).<br>3. Check `GET /api/invoices` & `SyncQueue`. | HTTP 200; `deletedAt` set; hidden from active patient list; historical invoice & payment remain intact; `DELETE` job queued in `SyncQueue`. |

### Module 3: Appointments (`TC-013` – `TC-018`)

| ID | Name | Preconditions | Test Data | Step-by-Step Execution | Expected Result |
|---|---|---|---|---|---|
| `TC-013` | Schedule new appointment for existing patient | Patient `Kavita Kulkarni` | `2026-06-15T10:00:00.000Z`, 45 min, `Root Canal Consultation` | 1. POST `/api/appointments`.<br>2. Inspect DB & `SyncQueue`. | HTTP 201; status `SCHEDULED`; `SyncQueue` has `PENDING` `UPSERT` for `Appointment`. |
| `TC-014` | Reschedule appointment date, time, duration, notes | Existing appointment at `09:00Z` | Move to `14:30Z`, 60 min, updated reason & notes | 1. PATCH `/api/appointments/[id]`. | HTTP 200; new schedule persisted; `SyncQueue` updated. |
| `TC-015` | Transition appointment status (`COMPLETED`, `CANCELLED`, `NO_SHOW`) | Scheduled appointment | Status transitions to `COMPLETED`, `CANCELLED`, `NO_SHOW` | 1. PATCH `/api/appointments/[id]` through each status. | All valid status transitions succeed (HTTP 200) and re-queue sync. |
| `TC-016` | Prevent overlapping appointment conflict | Existing appointment `11:00–11:45` for `Aarav` | Overlapping slot `11:15–11:45` for `Priya`; cancelled slot re-booking | 1. Attempt overlapping POST.<br>2. Cancel first appointment.<br>3. Retry booking same slot. | Step 1 returns HTTP 409 conflict; after cancellation, Step 3 succeeds with HTTP 201. |
| `TC-017` | Appointment validation for invalid patient or bad payload | Authenticated session | Non-existent `patientId`, invalid date, duration `2 min` (< 5 min) | 1. POST `/api/appointments` with each invalid payload. | Returns HTTP 404 for unknown patient and HTTP 400 for invalid date/duration. |
| `TC-018` | Dashboard & schedule ordering + archived patient conflict immunity | Multiple appointments + archived patient slot | Appointments at `15:00` and `09:00` today; archived patient at `12:00` | 1. GET `/api/appointments` (verify chronological sort).<br>2. GET `/api/dashboard` (verify `todayAppointments`).<br>3. Book active patient at archived patient's `12:00` slot. | Sorted `09:00` then `15:00`; dashboard counts match; archived patient's slot does not block new booking (HTTP 201). |

### Module 4: Treatments and Prescriptions (`TC-019` – `TC-024`)

| ID | Name | Preconditions | Test Data | Step-by-Step Execution | Expected Result |
|---|---|---|---|---|---|
| `TC-019` | Record clinical treatment linked to patient & appointment | `Rohan Mehta` + appointment | Diagnosis `Irreversible Pulpitis`, Procedure `Root Canal Treatment`, Tooth `46`, Cost `₹6,500.00` | 1. POST `/api/treatments`.<br>2. Verify DB `costPaise` & `SyncQueue`. | HTTP 201; `costPaise = 650000`; linked to `appointmentId`; queued in `SyncQueue`. |
| `TC-020` | Record multiple treatments across teeth | `Ananya Iyer` | Tooth `11` Zirconia Crown (`₹9,500`), Tooth `12` Crown (`₹9,500`), Scaling (`₹1,500`) | 1. POST 3 treatments.<br>2. Verify patient treatment history & cumulative value (`₹20,500.00`). | All 3 treatments stored distinctly with accurate `costPaise` and `SyncQueue` jobs. |
| `TC-021` | Create multi-medication prescription | `Vikram Singh` + wisdom tooth treatment | `Amoxicillin 500mg`, `Ibuprofen 400mg`, `Chlorhexidine Mouthwash 0.2%` | 1. POST `/api/prescriptions`.<br>2. Parse stored `items` JSON & check `SyncQueue`. | HTTP 201; 3 medications serialized and linked to treatment; `SyncQueue` `UPSERT` queued. |
| `TC-022` | Reject cross-patient treatment/appointment mismatch & empty Rx | `Patient A` (`Neha`) & `Patient B` (`Kabir`) | Appointment belongs to `Neha`, treatment submitted for `Kabir`; Rx with `items: []` | 1. POST `/api/treatments` with cross-patient `appointmentId`.<br>2. POST `/api/treatments` with negative cost.<br>3. POST `/api/prescriptions` with empty items. | All 3 rejected with HTTP 400 (`Appointment does not belong to the selected patient` / validation error). |
| `TC-023` | Retrieve treatment & prescription history in patient record | `Meera Nair` with 2 treatments & 1 Rx | Scaling (`₹1,500`), Composite Filling (`₹2,200`), Sensodyne Rx | 1. GET `/api/patients` and inspect `meera.treatments` & `meera.prescriptions`. | Both treatments and Rx returned in patient profile with exact paise values. |
| `TC-024` | Link unbilled clinical treatments into an invoice | `Aditya Joshi` with Consultation (`₹500`) & X-Ray (`₹350`) | Invoice created referencing both `treatmentId`s | 1. POST `/api/invoices` with items linked to `treatmentId`s. | HTTP 201; `subtotalPaise = 85000` (`₹850.00`); `InvoiceItem.treatmentId` foreign keys preserved. |

### Module 5: Billing and Invoices (`TC-025` – `TC-032`)

| ID | Name | Preconditions | Test Data | Step-by-Step Execution | Expected Result |
|---|---|---|---|---|---|
| `TC-025` | Single-item invoice creation | `Aarav Sharma` | `Consultation`, qty `1`, `₹500.00` (`50,000 paise`) | 1. POST `/api/invoices`. | HTTP 201; `subtotalPaise = 50000`, `totalPaise = 50000`, `status = UNPAID`. |
| `TC-026` | Multi-item invoice with quantities > 1 | `Priya Patel` | 1x RCT (`₹6,500`), 2x Crown (`₹9,500` ea), 3x X-Ray (`₹350` ea) | 1. POST `/api/invoices`. | `subtotalPaise = 650000 + 1900000 + 105000 = 2655000` (`₹26,550.00`). |
| `TC-027` | Percentage discount calculation | `Rohan Mehta` | Subtotal `₹10,000.00` (`1,000,000 paise`), `discountPercent = 12.5%` | 1. POST `/api/invoices`. | `discountPaise = 125000` (`₹1,250.00`), `totalPaise = 875000` (`₹8,750.00`). |
| `TC-028` | Fixed rupee discount calculation | `Ananya Iyer` | Subtotal `₹4,000.00` (`400,000 paise`), `discountPaise = 75000` (`₹750.00`) | 1. POST `/api/invoices`. | `discountPaise = 75000`, `totalPaise = 325000` (`₹3,250.00`). |
| `TC-029` | Tax calculation after discount & odd-paise rounding | `Vikram Singh` | 3x `₹1,111.33` (`111,133 paise`), `7.5%` discount, `18%` GST | 1. POST `/api/invoices`. | `subtotal = 333399`, `discount = 25005`, `taxable = 308394`, `tax = 55511`, `total = 363905`. |
| `TC-030` | Edit existing invoice items/discounts & block invalid edit below paid amount | `Neha Desai` with invoice (`₹1,500`) + `₹1,000` partial payment | 1. Edit items to `₹3,700` - `₹200` discount + `₹180` tax = `₹3,680`.<br>2. Attempt edit reducing total to `₹500` (< `₹1,000` paid). | Step 1 succeeds (HTTP 200, `totalPaise = 368000`, status `PARTIALLY_PAID`); Step 2 rejected with HTTP 400. |
| `TC-031` | Cancel unpaid invoice & block cancelling invoice with active payments | `Kabir Verma` | Unpaid invoice vs. partially paid invoice | 1. Cancel unpaid invoice (`PATCH { status: "CANCELLED" }`).<br>2. Attempt to cancel invoice with `paidPaise > 0`. | Unpaid invoice cancelled (`status = CANCELLED`); paid invoice cancellation blocked with HTTP 400 until refunded. |
| `TC-032` | Invoice validation for zero/negative/excessive discount | `Meera Nair` | Empty items `[]`, negative unit cost `-500`, `discountPercent = 150` | 1. POST `/api/invoices` with each invalid payload. | Rejected with HTTP 400; 0 corrupted invoices created. |

### Module 6: Payments and Financial Integrity (`TC-033` – `TC-040`)

| ID | Name | Preconditions | Test Data | Step-by-Step Execution | Expected Result |
|---|---|---|---|---|---|
| `TC-033` | Full single payment transitions `UNPAID` → `PAID` | Invoice for `₹1,800.00` (`180,000 paise`) | Payment `₹1,800.00` via `UPI` (`UPI-445566`) | 1. POST `/api/invoices/[id]/payments`. | HTTP 201; `paidPaise = 180000`, `balance = 0`, `status = PAID`. |
| `TC-034` | Partial payment updates `paidPaise` & `PARTIALLY_PAID` | Invoice for `₹6,500.00` (`650,000 paise`) | Payment `₹2,500.00` (`250,000 paise`) via `CASH` | 1. POST `/api/invoices/[id]/payments`. | HTTP 201; `paidPaise = 250000`, remaining balance `400000` (`₹4,000.00`), `status = PARTIALLY_PAID`. |
| `TC-035` | Multiple installment payments (`CASH`, `UPI`, `CARD`, `BANK_TRANSFER`) | Invoice for `₹9,500.00` (`950,000 paise`) | `₹2,000` CASH + `₹3,000` UPI + `₹2,500` CARD + `₹2,000` BANK_TRANSFER | 1. Post 4 sequential payments. | After #1–#3 status is `PARTIALLY_PAID`; after #4 `paidPaise = 950000`, `balance = 0`, `status = PAID`. |
| `TC-036` | Reject overpayment & zero/negative payment | Invoice for `₹1,500.00` with `₹1,000.00` paid (`₹500.00` balance) | Overpayment `₹500.01` (`50,001 paise`), `0 paise`, `-100 paise` | 1. POST each invalid payment. | All rejected with HTTP 400; `paidPaise` remains `100000`. |
| `TC-037` | Reject payment against `CANCELLED` invoice | Cancelled invoice for `₹500.00` | Payment `₹500.00` via `CASH` | 1. POST `/api/invoices/[id]/payments`. | Rejected with HTTP 400 (`Cannot record payment on a cancelled invoice`). |
| `TC-038` | Refund / reversal workflow & over-refund guard | Paid invoice (`₹4,500.00`) | Partial refund `₹1,500.00`, over-refund `₹4,000.00`, remaining refund `₹3,000.00` | 1. Post `₹1,500` refund (`PARTIALLY_PAID`).<br>2. Attempt `₹4,000` refund (HTTP 400).<br>3. Post `₹3,000` refund (`UNPAID`). | Net `paidPaise` transitions `450000` → `300000` (`PARTIALLY_PAID`) → `0` (`UNPAID`). |
| `TC-039` | Dashboard financial summary reconciliation | Multiple invoices (Paid, Partial, Unpaid, Cancelled) | Inv1 (`₹2,000` paid), Inv2 (`₹5,000` total, `₹2,000` paid + `₹500` refund), Inv3 (`₹3,000` cancelled) | 1. GET `/api/dashboard` and compare `stats` against ledger formulas. | `totalRevenuePaise = 350000` (`₹3,500`), `outstandingPaise = 350000` (`₹3,500`), `collectionRate = 50%`; cancelled invoice excluded from outstanding. |
| `TC-040` | Floating-point precision & odd-paise boundary test | Invoice with `₹1,111.33`, `₹333.33`, `₹0.01` (`144,467 paise`) | Payments `48,155 paise` + `48,156 paise` + `48,156 paise` | 1. Create invoice and post 3 odd-paise payments. | Exact integer arithmetic: `48155 + 48156 + 48156 = 144467 paise`, `0` IEEE-754 drift, `status = PAID`. |

### Module 7: Google Sheets Synchronization and Reconciliation (`TC-041` – `TC-050`)

| ID | Name | Preconditions | Test Data | Step-by-Step Execution | Expected Result |
|---|---|---|---|---|---|
| `TC-041` | Patient creation & update sync (`Patients` tab) | Configured Sheets harness | `Siddharth Rao`, `+91 98220 11223`, updated notes & allergies | 1. Create patient & run `processSyncQueue()`.<br>2. Update patient & run `processSyncQueue()`. | Single row in `Patients` tab (no duplicate row on update); columns `A:M` match DB. |
| `TC-042` | Appointment creation & status update sync (`Appointments` tab) | Synced patient | Appointment `SCHEDULED` → `COMPLETED` | 1. Create appointment & sync.<br>2. Mark `COMPLETED` & sync. | Single row in `Appointments` tab updated in-place to `COMPLETED`. |
| `TC-043` | Treatment & prescription sync (`Treatments` & `Prescriptions` tabs) | Synced patient | RCT (`₹6,500.00`) + 2-item Prescription | 1. Create treatment & Rx.<br>2. Run `processSyncQueue()`. | `Treatments` row shows `Cost (INR) = 6500.00`; `Prescriptions` row shows formatted medications. |
| `TC-044` | Invoice creation sync with financial columns (`Invoices` tab) | Synced patient | 2x Zirconia Crown (`₹19,000`), `₹1,000` discount, `₹900` tax → `₹18,900` | 1. Create invoice & sync. | `Invoices` row has `Subtotal = 19000.00`, `Discount = 1000.00`, `Tax = 900.00`, `Total = 18900.00`, `Balance = 18900.00`, `Status = UNPAID`. |
| `TC-045` | Partial & full payment sync (`Payments` + `Invoices` tabs) | Invoice (`₹18,900.00`) | Payment #1 `₹8,900.00` (`UPI`), Payment #2 `₹10,000.00` (`CARD`) | 1. Record Payment #1 & sync.<br>2. Record Payment #2 & sync. | 2 rows in `Payments` tab; `Invoices` row transitions `Paid = 8900.00, Balance = 10000.00 (PARTIALLY_PAID)` → `Paid = 18900.00, Balance = 0.00 (PAID)`. |
| `TC-046` | SyncQueue retry with exponential backoff on transient error | Failing Sheets mock (1st call throws 503) | Patient `Pooja Malhotra` | 1. Create patient.<br>2. Run `processSyncQueue()` (fails once).<br>3. Advance past `nextRetryAt` & rerun `processSyncQueue()`. | Attempt 1 marks `FAILED` with `attempts = 1` and `lastError`; Attempt 2 succeeds (`SYNCED`) and writes row to Google Sheets. |
| `TC-047` | Idempotency & duplicate prevention on repeated sync triggers | Synced patient, invoice, and payment | Repeated `processSyncQueue()` + `reconcileAllSheets()` calls | 1. Run `processSyncQueue()` 3 times and `reconcileAllSheets()` twice. | Exactly 1 row per Record ID in every sheet tab; 0 duplicate rows. |
| `TC-048` | Drift detection & self-healing reconciliation | Missing row, corrupted invoice total (`999.99`), stale orphan row | Corrupted `Invoices` & `Patients` sheet state | 1. Corrupt sheet state in-memory.<br>2. Run `reconcileAllSheets()`. | Detects `missingIds`, `mismatchedIds`, and `unexpectedIds`; repairs missing & mismatched rows (`driftRepaired = true`). |
| `TC-049` | Special characters, commas, quotes, newlines & Unicode preservation | Patient with Devanagari & punctuation | `Vikram सिंह (Singh)`, `"Allergic to 'NSAIDs', Penicillin & Latex; notes: <check BP>\nLine 2"` | 1. Create patient & sync to Google Sheets.<br>2. Inspect columns `A:M`. | Zero column shifting; Unicode and multiline strings preserved in exact target cells. |
| `TC-050` | Complete end-to-end 6-sheet reconciliation audit | Full clinical & financial dataset | Multiple patients, appointments, treatments, prescriptions, invoices, payments, refunds | 1. Run `reconcileAllSheets()`.<br>2. Compare DB sums vs. Sheet sums. | `totalReconciled = 6/6`, `missingIds = 0`, `mismatchedIds = 0`, `unexpectedIds = 0`; DB paise totals match Sheet INR totals to 0.00 drift. |

