# Release Notes — `v1.0.0`

**Product**: Doctor Kinjal Maheshwari's Patient Tracker  
**Release Tag**: `v1.0.0`  
**Release Date**: 2026-11-04

---

## Highlights of `v1.0.0`

### 1. Personalized Apple-Inspired Clinical Workspace
- Unified branding as **Doctor Kinjal Maheshwari's Patient Tracker** across page metadata, loading screens, authentication gate, navigation sidebar, and printable clinical sheets.
- Prominent dashboard header greeting **"Welcome Doctor Kinjal Maheshwari"** paired with a 7-card real-time operational KPI strip (*Total patients, Today’s appointments, Completed treatments, Pending follow-ups, Total billing, Payments received, Outstanding balances*) and adaptive Light/Dark mode.
- Full responsive layout support verified across **Mobile (`402 × 874`)**, **Tablet (`820 × 1180`)**, and **Desktop (`1440 × 900`)** viewports.

### 2. Complete Patient, Chairside & Clinical Workflow
- **Patient 360° Registry & Drawer**: Multi-field search (name, patient ID, reference ID, phone digits, email), duplicate phone detection (`409` conflict guard), medical alert filtering, and soft-delete archiving that preserves historical financial records.
- **Conflict-Checked Appointments**: Automatic overlap detection for active appointments (`HTTP 409`), cancelled-slot release, and status lifecycle tracking (`SCHEDULED`, `CONFIRMED`, `COMPLETED`, `CANCELLED`).
- **Treatments & Prescriptions**: Integer-paise procedure logging with cross-patient appointment ownership validation (`QA-DEF-001`), one-click invoice drafting from treatments, and multi-medication prescriptions with printable `℞` sheets.

### 3. Integer-Paise Financial Engine & Serializable Ledger
- All monetary values stored and computed in exact integer **paise** (`₹1.00 = 100 paise`) via [`lib/finance.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/lib/finance.ts).
- Support for multi-line invoices, fixed and percentage discounts, fixed and percentage GST/tax, full invoice editing (`QA-DEF-002`), and unpaid invoice cancellation.
- Concurrency-safe payment recording (`Prisma.TransactionIsolationLevel.Serializable`) with `idempotencyKey` deduplication across `CASH`, `UPI`, `CARD`, `BANK_TRANSFER`, and `OTHER`.

### 4. Transactional Outbox & Google Sheets v4 Synchronization
- Local SQLite (`prisma/dev.db`) is the authoritative source of truth; every write enqueues an outbox job in `SyncQueue`.
- Idempotent row upserts by `Record ID`, exponential backoff retry on transient errors, and anomaly detection across all 6 worksheets (`Patients`, `Appointments`, `Treatments`, `Prescriptions`, `Invoices`, `Payments`).

### 5. Verification & Quality Gates
- **Automated Test Suite (`CI=true npm test`)**: 15 test suites, **91 / 91 tests passing** (50 E2E test cases `TC-001`–`TC-050` + 41 unit/integration tests) running against an isolated SQLite database (`prisma/test.db`).
- **TypeScript (`npx tsc --noEmit`)**: `0` errors.
- **ESLint (`npm run lint`)**: `0` warnings or errors.
- **Production Build (`npm run build`)**: Clean Next.js 15.5.28 production build.
