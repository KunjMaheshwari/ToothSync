# Doctor Kinjal Maheshwari’s Patient Tracker — Project Context

> Verified architectural and operational documentation. Contains **no** real patient details, credentials, tokens, or secret values.
> Updated: 2026-11-04 (Patient Archival Lifecycle & Google Sheets Tombstone Hardening).

---

## 1. Purpose

Doctor Kinjal Maheshwari’s Patient Tracker is a modern, high-precision dental clinic management application designed for Doctor Kinjal Maheshwari and authorized practice personnel.

- **Production URL:** `https://doctor-kinjal.vercel.app/`
- **GitHub Repository:** `KunjMaheshwari/ToothSync` (branch `main`)
- **Hosting Environment:** Vercel (Serverless Edge & Node.js Lambda Functions, region observed: `iad1`)
- **Primary Domain:** Clinical patient management, dental charts/history, appointments, treatments, prescriptions, follow-ups, billing, invoices, payments, audit logs, and Google Sheets practice sync.
- **Data Confidentiality:** All production patient records, financial transactions, and credentials are confidential and protected by strict safety boundaries.

---

## 2. Technology & Architecture

- **Web Framework:** Next.js 15 (App Router, Server Actions, Route Handlers), React 19, TypeScript
- **Styling & UI:** Tailwind CSS, Framer Motion, Lucide React
- **ORM & Database Layer:** Prisma Client v6.19.3
  - **Local Development:** SQLite (`file:./prisma/dev.db` - git-ignored)
  - **Automated Tests:** Isolated SQLite (`file:./prisma/test.db`)
  - **Production Architecture (Hardened):** Remote shared libSQL/Turso database (`@prisma/adapter-libsql` + `@libsql/client`) providing durable cross-instance transactional consistency across all Vercel serverless functions.
- **External Synchronization:** Google Sheets API v4 via Service Account JWT (`googleapis`)
- **Authentication & Security:** 
  - Single-practice practitioner authentication via `AUTH_USERNAME` and bcrypt-hashed password in `AUTH_PASSWORD_HASH`
  - Signed, tamper-evident HS256 stateless session cookies (`dentalcare_session`) using `jose` and `AUTH_SECRET`
  - Strict same-origin CSRF validation (`sameOrigin` header inspection) on state-changing API endpoints
  - In-memory rate limiting on authentication attempts

---

## 3. Implemented Application Modules & API Inventory

The entire clinic interface operates as a responsive single-page clinical console in `components/clinic-app.tsx` backed by dedicated Next.js App Route handlers:

| Module | UI View | API Endpoint(s) | HTTP Methods | Database Models | External Integration |
|---|---|---|---|---|---|
| **Authentication** | `components/login.tsx` | `/api/auth/login`<br>`/api/auth/logout` | `POST` | `Doctor`, `AuditLog` | None |
| **Dashboard** | `Dashboard` tab | `/api/dashboard` | `GET` | `Patient`, `Appointment`, `Treatment`, `Invoice`, `Payment`, `FollowUp`, `SyncQueue` | Sync status |
| **Patients** | `Patients` tab | `/api/patients`<br>`/api/patients/[id]` | `GET`, `POST`<br>`GET`, `PATCH`, `DELETE` | `Patient`, `Appointment`, `Treatment`, `Prescription`, `Invoice`, `FollowUp`, `SyncQueue`, `AuditLog` | Google Sheets (`Patients`) |
| **Appointments** | `Appointments` tab | `/api/appointments`<br>`/api/appointments/[id]` | `GET`, `POST`, `PATCH` | `Appointment`, `Patient`, `SyncQueue`, `AuditLog` | Google Sheets (`Appointments`) |
| **Treatments** | `Treatments` tab | `/api/treatments`<br>`/api/treatments/[id]` | `GET`, `POST`, `PATCH` | `Treatment`, `Patient`, `Appointment`, `SyncQueue`, `AuditLog` | Google Sheets (`Treatments`) |
| **Prescriptions**| `Prescriptions` tab | `/api/prescriptions` | `GET`, `POST` | `Prescription`, `PrescriptionItem`, `Patient`, `SyncQueue`, `AuditLog` | Google Sheets (`Prescriptions`) |
| **Follow-ups** | `Follow-ups` tab | `/api/follow-ups`<br>`/api/follow-ups/[id]` | `GET`, `POST`, `PATCH` | `FollowUp`, `Patient`, `SyncQueue`, `AuditLog` | Google Sheets (`Follow-ups`) |
| **Billing & Invoices** | `Billing` tab | `/api/invoices`<br>`/api/invoices/[id]`<br>`/api/invoices/[id]/payments` | `GET`, `POST`, `PATCH`<br>`POST` | `Invoice`, `InvoiceItem`, `Payment`, `Patient`, `SyncQueue`, `AuditLog` | Google Sheets (`Invoices`, `Payments`) |
| **Reports** | `Reports` tab | In-memory aggregations over `/api/dashboard`, `/api/invoices`, `/api/patients` | `GET` | All financial & clinical models | Practice metrics |
| **Sync Engine** | `Sync` tab & status indicator | `/api/sync` | `GET`, `POST` | `SyncQueue`, `SyncMetadata`, `Patient`, `Appointment`, `Treatment`, `Prescription`, `Invoice`, `Payment`, `FollowUp` | Google Sheets v4 API |

---

## 4. Production History & Incident Context

### A. Authentication
- Production previously returned `401 Unauthorized` due to environment variable configuration issues.
- The authentication logic was verified to use bcrypt against `AUTH_PASSWORD_HASH` and `AUTH_USERNAME`.

### B. Patient & Dashboard 500 Incident
- In deployment `f-tK-V8CnBlDfhcwE8n-S` (commits `bcf8592`, `aa769f3`, `60f130b`), API requests to `/api/dashboard` and `POST /api/patients` failed with HTTP 500 because the default SQLite path pointed to `/var/task/prisma/dev.db` on a read-only serverless filesystem.
- Mitigated temporarily by redirecting Vercel serverless SQLite to `file:/tmp/dentalcare.db` with auto-DDL schema initialization and error handling.

### C. Patient Profile Loading Failure Incident
- **Symptom:** The patient list rendered, but clicking any patient profile displayed:
  `Could not load patient profile.`
- **Root Cause Identified & Replicated:**
  - Vercel routes lambdas independently. Serverless containers do not share `/tmp`.
  - A query to `/api/patients` (listing) hit Lambda Instance A.
  - A query to `/api/patients/[id]` (detail profile) hit Lambda Instance B.
  - Because each instance had its own isolated, ephemeral SQLite database in `/tmp`, Lambda Instance B did not have the patient record created or hydrated on Instance A, returning `404 Not Found`.
  - The frontend generic error handler collapsed any non-200 response into `"Could not load patient profile."`
- **Resolution:**
  - Enabled `@prisma/adapter-libsql` and `@libsql/client` for a unified, durable remote database.
  - Prevented silent ephemeral database split-brains in production: unconfigured Vercel environments return an explicit `503 Service Unavailable` with `DATABASE_NOT_CONFIGURED` instead of creating isolated `/tmp` databases.
  - Created `lib/client-errors.ts` for descriptive, PHI-free UI feedback on network/session/record status.

### D. Patient Deletion Reappearance Bug Incident
- **Symptom:** When a patient was deleted, the UI initially removed the patient, but after 3–4 seconds, the same patient reappeared.
- **Root Cause Identified & Replicated:**
  - Google Sheets `Patients` tab only contained 16 columns (`Record ID` through `Updated At`), lacking any archival or deletion marker.
  - Cold starts or multi-container serverless re-hydration invoked `hydrateDatabaseFromSheets()`, reading all rows and executing `prisma.patient.upsert()`, resurrecting archived patients as active (`deletedAt: null`).
  - `DELETE /api/patients/[id]` was not synchronizing tombstones to Google Sheets and left scheduled appointments/recalls active.
- **Resolution:**
  - Expanded Google Sheets `Patients` tab to 17 columns with `"Archived At"` tombstone.
  - Updated `ensureTab` for non-destructive header expansion.
  - Updated `hydrateDatabaseFromSheets` to parse column 17 and preserve `deletedAt`.
  - Enforced transactional soft-deletion cascading to cancel upcoming appointments, pending follow-ups, and planned treatments while strictly preserving clinical and billing history.
  - Updated UI with immediate optimistic removal and safe rollback.

---

## 5. Google Sheets Integration Architecture

- **Protocol:** Google Sheets API v4 using Service Account JWT via `googleapis`.
- **Sync Strategy:**
  - Database writes enqueue a record in `SyncQueue` (`PENDING`).
  - Serverless environment immediately triggers `syncAfterWriteOnServerless()`, attempting direct append/update to Google Sheets with automatic status promotion to `SYNCED`.
  - If network or API limits interrupt sync, records remain in `SyncQueue` with exponential backoff (`nextAttemptAt`) for retry during scheduled or manual `/api/sync` calls.
- **Tab Layout & Keying:**
  - Tabs: `Patients` (17 columns with `Archived At` tombstone), `Appointments`, `Treatments`, `Prescriptions`, `Invoices`, `Payments`, `Follow-ups`.
  - Column A is always the authoritative Prisma database `Record ID` (cuid).
  - Row lookups inspect Column A: existing IDs are updated in-place; new IDs are appended.
  - Archived tombstones in Column 17 prevent resurrection during hydration.
  - The application code contains zero destructive deletion operations (`deleteSheet`, `deleteDimension`, `batchClear` are absent).

---

## 6. QA & Test Coverage

- **Total Automated Test Suites:** 19 test suites
- **Total Test Cases:** 111 tests (100% passing)
- **Key Test Areas Covered:**
  - Patient archival lifecycle, cascade cancellations, and Google Sheets tombstone hydration (`tests/patient-archive-lifecycle.test.ts`)
  - End-to-end clinical workflows (patients, appointments, treatments, prescriptions, follow-ups)
  - Financial calculations, tax/discount paise rounding, and payment balance invariants
  - Google Sheets synchronization retry, queue ordering, and error isolation
  - Security, authentication rate limiting, CSRF protections, and session signing
  - Serverless database bootstrap, concurrent initialization, and libSQL shared storage regression

---

## 7. Production Data & Safety Mandates

1. **Zero Destructive Actions:** Never execute `prisma migrate reset`, table drops, truncations, or destructive seed scripts in production.
2. **Confidentiality:** Never print or log real patient PII, passwords, bcrypt hashes, JWT secrets, private keys, or database credentials.
3. **Audit Isolation:** Any production audit operations must use synthetic test data prefixed with a traceable audit tag (e.g., `PROD-AUDIT-<timestamp>`) recorded in a cleanup ledger.
4. **Google Sheets Safety:** Never write synthetic test rows into the live clinical Google Sheets tabs without dedicated test sheet isolation.

---

## 8. Deployment & Operational Runbook

1. **Environment Variables on Vercel:**
   - `TURSO_DATABASE_URL`: `libsql://<db-name>-<org>.turso.io`
   - `TURSO_AUTH_TOKEN`: `<turso-jwt-token>`
   - `AUTH_USERNAME`: Doctor portal username
   - `AUTH_PASSWORD_HASH`: `$2b$12$...` bcrypt hash
   - `AUTH_SECRET`: Min 32-character random string for session signing
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`: Service account email
   - `GOOGLE_PRIVATE_KEY`: PEM private key (with `\n` or standard linebreaks)
   - `GOOGLE_SHEET_ID`: Target Google Sheets document identifier
2. **Data Migration to Durable Database:**
   - Execute `scripts/migrate-to-durable-db.ts` to copy existing records from `prisma/dev.db` into the remote libSQL instance safely with insert-only idempotency.
