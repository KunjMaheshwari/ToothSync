# Production Repair Report — Doctor Kinjal Maheshwari's Patient Tracker

**Date**: November 4, 2026  
**Application**: Doctor Kinjal Maheshwari's Patient Tracker (`https://doctor-kinjal.vercel.app/`)

---

## 1. Database Architecture: Before vs. After

### Before
- **Datasource**: `provider = "sqlite"` with `DATABASE_URL="file:./dev.db"`.
- **Migrations**: No `prisma/migrations/` directory tracked in Git.
- **Vercel Serverless Behavior**: `prisma/dev.db` is gitignored (`prisma/*.db`), and `/var/task` on Vercel Lambda is read-only. Every database read or write failed with `HTTP 500`.

### After
- **Runtime-Aware Database Resolution ([`lib/db.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/lib/db.ts))**:
  - **Local Development**: Continues using `file:./dev.db` (`prisma/dev.db`), preserving all existing local records and workflows.
  - **Automated Tests**: Continues using the isolated `file:./test.db` (`prisma/test.db`), ensuring tests never touch production or local development data.
  - **Vercel Serverless Production (`process.env.VERCEL === "1"` or read-only bundle directory)**: Automatically routes SQLite to the writable `file:/tmp/dentalcare.db` path without requiring manual database server provisioning.
- **Automatic Idempotent Schema Bootstrap ([`lib/db.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/lib/db.ts))**:
  - Tracked baseline migration created at [`prisma/migrations/20261104000000_init/migration.sql`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/prisma/migrations/20261104000000_init/migration.sql).
  - Before any Prisma query or `$transaction` executes, `ensureDatabaseReady()` runs idempotent `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` statements for all 13 models (`Doctor`, `Patient`, `Appointment`, `Treatment`, `Prescription`, `PrescriptionItem`, `Invoice`, `InvoiceItem`, `Payment`, `FollowUp`, `AuditLog`, `SyncQueue`, `SyncMetadata`).
- **Cold-Start Hydration & Write-Through Persistence via Google Sheets ([`lib/sheets.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/lib/sheets.ts) & [`lib/api.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/lib/api.ts))**:
  - When a Vercel serverless instance initializes an empty `/tmp/dentalcare.db` on cold start and Google Sheets credentials (`GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`) are configured, `hydrateDatabaseFromSheets()` automatically restores all patients, appointments, treatments, prescriptions, invoices, payments, and follow-ups from the authoritative Google Sheet.
  - On every mutation (`POST` / `PATCH`) on Vercel serverless, `syncAfterWriteOnServerless()` immediately writes the committed record through to Google Sheets in a non-blocking `try/catch` block. If Google Sheets is temporarily unavailable, the database save still succeeds (`HTTP 201`/`200`) and the record remains `PENDING` in `SyncQueue` for retry.

---

## 2. Data Preservation & Verification

1. **Local SQLite Backup**:
   - Verified existing records in `prisma/dev.db` before any changes: **11 patients** (10 active, 1 archived), **3 appointments**, **1 invoice** (`241800` paise / `₹2,418.00`), and **1 payment** (`241800` paise / `₹2,418.00`).
   - Created a verified local backup at `prisma/dev.db.backup` (gitignored via `prisma/*.db.*`).
2. **Google Sheets Reconciliation**:
   - Flushed the 1 pending appointment (`cmw11d7mb000cpi9bo5ozw1uz`) to Google Sheets and verified via `npm run qa:reconcile` that all 11 patients, 3 appointments, 1 invoice (`241800` paise), and 1 payment (`241800` paise) are present and reconciled in the live Google Sheet.

---

## 3. Complete List of Files Changed

- [`.gitignore`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/.gitignore) — Excluded `prisma/*.db-*` and `prisma/*.db.*` backups from Git tracking.
- [`.env.example`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/.env.example) — Documented all required environment variable names with safe placeholders.
- [`package.json`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/package.json) — Added `"postinstall": "prisma generate"`, updated `"build": "prisma generate && next build"`, and added `"db:migrate:deploy": "prisma migrate deploy"`.
- [`prisma/migrations/migration_lock.toml`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/prisma/migrations/migration_lock.toml) — Added Prisma migration lockfile.
- [`prisma/migrations/20261104000000_init/migration.sql`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/prisma/migrations/20261104000000_init/migration.sql) — Added baseline idempotent schema migration for all 13 models and indexes.
- [`lib/db.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/lib/db.ts) — Implemented `resolveDatabaseUrl()`, `initializeSchemaOnClient()`, `ensureDatabaseReady()`, and Prisma `$extends` + `$transaction` proxy with cold-start Google Sheets hydration.
- [`lib/sheets.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/lib/sheets.ts) — Added `isSheetsConfigured()`, credential quote/whitespace normalization in `configured()`, and `hydrateDatabaseFromSheets()`.
- [`lib/api.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/lib/api.ts) — Added `handleApiError()` and `syncAfterWriteOnServerless()`.
- [`app/api/auth/login/route.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/api/auth/login/route.ts) — Added `resolvePasswordHash()` to normalize escaped `\$` and surrounding quotes in `AUTH_PASSWORD_HASH`, plus username trimming.
- [`app/api/dashboard/route.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/api/dashboard/route.ts) — Added structured `try/catch` error handling via `handleApiError()`.
- [`app/api/patients/route.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/api/patients/route.ts) — Added `try/catch` error handling, field-specific `P2002` conflict detection (`409`), and `syncAfterWriteOnServerless()`.
- [`app/api/patients/[id]/route.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/api/patients/%5Bid%5D/route.ts) — Added `try/catch` error handling and `syncAfterWriteOnServerless()`.
- [`app/api/appointments/route.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/api/appointments/route.ts) & [`app/api/appointments/[id]/route.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/api/appointments/%5Bid%5D/route.ts) — Added `try/catch` error handling and `syncAfterWriteOnServerless()`.
- [`app/api/treatments/route.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/api/treatments/route.ts) & [`app/api/treatments/[id]/route.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/api/treatments/%5Bid%5D/route.ts) — Added `try/catch` error handling and `syncAfterWriteOnServerless()`.
- [`app/api/prescriptions/route.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/api/prescriptions/route.ts) — Added `try/catch` error handling and `syncAfterWriteOnServerless()`.
- [`app/api/follow-ups/route.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/api/follow-ups/route.ts) & [`app/api/follow-ups/[id]/route.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/api/follow-ups/%5Bid%5D/route.ts) — Added `try/catch` error handling and `syncAfterWriteOnServerless()`.
- [`app/api/invoices/route.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/api/invoices/route.ts), [`app/api/invoices/[id]/route.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/api/invoices/%5Bid%5D/route.ts), & [`app/api/invoices/[id]/payments/route.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/api/invoices/%5Bid%5D/payments/route.ts) — Added `try/catch` error handling and `syncAfterWriteOnServerless()`.
- [`app/api/sync/route.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/api/sync/route.ts) — Added `try/catch` error handling and `isSheetsConfigured()`.
- [`components/clinic-app.tsx`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/components/clinic-app.tsx) — Fixed `AddPatient` error handling so 5xx errors display the safe server error message instead of `"Please check required fields."`
- [`tests/production-incident-reliability.test.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests/production-incident-reliability.test.ts) — Added 5 comprehensive automated tests covering Vercel database URL resolution, `/tmp` schema bootstrap + Google Sheets cold-start hydration, `503` safe database error responses, resilient patient creation when Google Sheets fails, and full CRUD/auth status codes.

