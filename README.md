<div align="center">

# Doctor Kinjal Maheshwari's Patient Tracker

**A Local-First, Clinical & Financial Operating System for Modern Dental Practice Management**

[![Next.js 15](https://img.shields.io/badge/Next.js-15.5-000000?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19.1-0071E3?style=flat-square&logo=react&logoColor=white)](https://react.dev/)
[![TypeScript 5](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Prisma + SQLite](https://img.shields.io/badge/Prisma_6-SQLite_Authority-2D3748?style=flat-square&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Google Sheets v4](https://img.shields.io/badge/Google_Sheets_API-v4_Outbox_Sync-1F9D55?style=flat-square&logo=googlesheets&logoColor=white)](https://developers.google.com/sheets/api)
[![QA Suite](https://img.shields.io/badge/QA_Suite-91%2F91_Passing_(50_E2E)-1F9D55?style=flat-square)](#quality-assurance--test-suite)

*Zero-latency SQLite authority • Integer-paise financial precision • Self-healing Google Sheets cloud mirror • Apple HIG visual craft*

---

[Overview](#overview) •
[System Architecture](#system-architecture) •
[Core Capabilities](#core-capabilities) •
[Financial Engine](#financial-engine--integer-paise-ledger) •
[Google Sheets Sync](#google-sheets-outbox--self-healing-reconciliation) •
[Quick Start](#getting-started) •
[API Reference](#api-reference) •
[QA & Testing](#quality-assurance--test-suite)

</div>

---

## Overview

**Doctor Kinjal Maheshwari's Patient Tracker** is a bespoke, clinical-grade dental practice management and financial accounting platform built specifically for **Doctor Kinjal Maheshwari**.

Unlike cloud-only SaaS tools that stall when clinic internet fluctuates—or legacy desktop software with dated interfaces—this platform combines three foundational pillars:

1. **Local-First Authoritative Speed**: Every patient profile, appointment slot, clinical chart, prescription, invoice, and payment is committed immediately to an ACID-compliant local **SQLite** database via **Prisma**, delivering sub-millisecond reads and writes on the clinic workstation and local Wi-Fi network.
2. **Self-Healing Google Sheets Cloud Mirror**: Every database mutation atomically enqueues an outbox job in `SyncQueue`. A background-capable synchronization and reconciliation engine mirrors all **6 clinical & financial entities** (`Patients`, `Appointments`, `Treatments`, `Prescriptions`, `Invoices`, `Payments`) into Google Sheets with exponential backoff, idempotent row upserts, and full-sheet drift repair.
3. **Apple Human Interface Design**: Crafted with translucent frosted-glass surfaces (`backdrop-filter: blur(20px)`), tabular financial numerals, crisp semantic status pills, dark/light theme parity, and an ergonomic slide-over **Patient 360° Workspace**.

---

## System Architecture

```mermaid
flowchart TB
    subgraph Client["Apple-Inspired Clinical UI (React 19 + Next.js 15 App Router)"]
        LoginGate["Signed JWT Session Gate\n(HttpOnly Cookie + CSRF Guard)"]
        Dashboard["Executive Clinic Overview\n'Welcome Doctor Kinjal Maheshwari'"]
        Workspace["Interactive Workspaces\nPatients • Appointments • Treatments • Prescriptions • Billing • Follow-ups"]
        Drawer360["Patient 360° Slide-Over Drawer\nOverview • Clinical • Prescriptions • Billing & Ledger"]
    end

    subgraph Server["Protected Route Handlers & Domain Engines"]
        AuthEngine["Security & Rate Limiter\nlib/auth.ts • lib/security.ts"]
        Validation["Zod Schema Boundary\nlib/validation.ts"]
        FinanceEngine["Deterministic Paise Billing Engine\nlib/finance.ts (Serializable Tx)"]
        SyncWorker["Outbox Worker & Reconciler\nlib/sync-queue.ts • lib/sheets.ts"]
    end

    subgraph Storage["Authoritative Local Persistence (SQLite)"]
        DB[("prisma/dev.db\nPatients • Appointments • Treatments\nPrescriptions • Invoices • InvoiceItems\nPayments • FollowUps • AuditLogs")]
        Outbox[("SyncQueue Table\nPENDING • PROCESSING • SYNCED • FAILED\nExponential Backoff & Retry")]
    end

    subgraph Cloud["Google Sheets v4 Cloud Replica (6 Worksheets)"]
        Sheets["Google Spreadsheet\n1. Patients (A:M)\n2. Appointments (A:I)\n3. Treatments (A:I)\n4. Prescriptions (A:F)\n5. Invoices (A:M)\n6. Payments (A:J)"]
    end

    Client -->|Same-Origin JSON + Cookie| AuthEngine
    AuthEngine --> Validation
    Validation --> FinanceEngine
    FinanceEngine -->|ACID Serializable Transaction| DB
    FinanceEngine -->|Atomic Enqueue| Outbox
    Outbox --> SyncWorker
    SyncWorker -->|Idempotent Row Upsert & Drift Repair| Sheets
    DB -.->|Authoritative Diff Check| SyncWorker
```

### Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Framework** | Next.js 15.5 (App Router) & React 19 | Server-rendered initial shell + instant client state transitions |
| **Language** | TypeScript 5.8 (Strict Mode) | End-to-end compile-time safety across UI, API, and database layers |
| **Database & ORM** | SQLite + Prisma 6.6 | Local-first relational persistence with `Serializable` financial transactions |
| **Styling & Motion** | Tailwind CSS 4 + Custom Apple HIG Tokens | Translucent glassmorphism, adaptive light/dark mode, tabular numerals |
| **Authentication** | `jose` (HS256 JWT) + `bcryptjs` | Signed 12-hour `HttpOnly` session cookies and IP brute-force protection |
| **Validation** | Zod 3.24 | Strict schema validation and sanitization on every API boundary |
| **Cloud Sync** | `googleapis` (Google Sheets API v4) | Service-account authenticated 6-tab synchronization & reconciliation |
| **Testing** | Vitest 3.2 (Isolated `prisma/test.db`) | 91 automated tests including 50 end-to-end clinical & financial QA specs |

---

## Core Capabilities

### 1. Personalized Executive Dashboard
- Greets the clinician with **"Welcome Doctor Kinjal Maheshwari"** and a live operational summary.
- **7 Real-Time Compact KPI Cards**:
  1. **Total patients** (active patient registry count)
  2. **Today’s appointments** (scheduled visits for the current clinic day)
  3. **Completed treatments** (cumulative procedures logged)
  4. **Pending follow-ups** (recall visits requiring attention)
  5. **Total billing** (gross invoiced value across active invoices)
  6. **Payments received** (net settled collections + collection rate `%`)
  7. **Outstanding balances** (uncollected receivables across `UNPAID` and `PARTIALLY_PAID` invoices)
- **Actionable Panels**: Upcoming appointments, recent patients, pending payment quick-collect triggers, recall follow-ups, and a live Google Sheets synchronization telemetry bar.

### 2. Patient Registry & 360° Slide-Over Workspace
- **Smart Registration**: Normalizes Indian and international phone numbers, detects duplicate phone numbers across family members (`409 DUPLICATE_PHONE` warning with explicit one-click family-share override), and captures allergies, systemic medical history, and clinical notes.
- **Instant Multi-Field Search**: Real-time filtering by full name, partial name, normalized phone digits, email, allergies, or clinical notes.
- **Patient 360° Drawer**: Clicking any patient opens a segmented slide-over drawer displaying their **Overview**, **Appointments**, **Clinical Treatments**, **Prescriptions**, and **Invoices & Payments** in one unified view.
- **Safe Archiving (Soft Delete)**: Archiving a patient sets `deletedAt`, hides them from active scheduling, blanks their row in the `Patients` sheet, and **preserves 100% of their historical invoices and payments** for accounting integrity.

### 3. Conflict-Aware Appointment Scheduling
- **Overlap Guard**: Automatically prevents double-booking overlapping time slots (`HTTP 409`) across active patients while ignoring cancelled appointments or archived patients.
- **One-Click Status Lifecycle**: Transition appointments cleanly between `SCHEDULED`, `COMPLETED`, `CANCELLED`, and `NO_SHOW`.

### 4. Clinical Charting, Dental Catalog & Prescriptions
- **Built-in Dental Procedure Catalog**: Pre-configured with 10 standard procedures (*Consultation, Scaling & Polishing, Composite Filling, Root Canal Treatment, Zirconia Crown, Tooth Extraction, Wisdom Tooth Impaction, Dental X-Ray IOPAR, Orthodontic Adjustment, Teeth Whitening*) with editable fees and FDI tooth notation (`#11`–`#48`).
- **Relational Integrity**: Validates that any appointment linked to a treatment belongs to the same patient.
- **Structured Prescriptions (Rx)**: Multi-medication builder capturing medicine name, dosage (`500mg`), frequency (`1-0-1 after meals`), and duration (`5 days`), linked directly to the patient and underlying treatment.

---

## Financial Engine & Integer-Paise Ledger

To eliminate IEEE-754 floating-point drift (e.g., `0.1 + 0.2 !== 0.3`), **every monetary value in the database and calculation engine is stored and computed as an exact integer in paise (`₹1.00 = 100 paise`)** inside [`lib/finance.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/lib/finance.ts).

### Deterministic Billing Formulas

$$\text{Line Total (paise)} = \operatorname{round}\!\left(\text{Quantity} \times \text{Unit Cost (paise)}\right)$$

$$\text{Subtotal (paise)} = \sum_{i=1}^{n} \text{Line Total}_i$$

$$\text{Discount (paise)} = \min\!\left(\text{Subtotal},\; \max\!\left(0,\; \text{Fixed Discount (paise)} + \operatorname{round}\!\left(\frac{\text{Subtotal} \times \text{Discount \%}}{100}\right)\right)\right)$$

$$\text{Taxable Amount (paise)} = \text{Subtotal (paise)} - \text{Discount (paise)}$$

$$\text{Tax (paise)} = \max\!\left(0,\; \text{Fixed Tax (paise)} + \operatorname{round}\!\left(\frac{\text{Taxable Amount} \times \text{Tax \%}}{100}\right)\right)$$

$$\text{Total Invoice (paise)} = \text{Taxable Amount (paise)} + \text{Tax (paise)}$$

$$\text{Net Paid (paise)} = \sum \text{Payments}_{\text{isRefund}=\text{false}} - \sum \text{Refunds}_{\text{isRefund}=\text{true}}$$

$$\text{Outstanding Balance (paise)} = \max\!\left(0,\; \text{Total Invoice (paise)} - \text{Net Paid (paise)}\right)$$

### Financial Invariants Enforced (`Serializable` Isolation)
- **Zero Overpayment**: Payments exceeding the exact remaining `balancePaise` are rejected (`HTTP 400`).
- **Zero Over-Refund**: Refunds (`isRefund: true`) exceeding net `paidPaise` are rejected (`HTTP 400`).
- **Cancelled Invoice Lock**: Cancelled invoices cannot receive payments or be edited, and an invoice with active payments (`paidPaise > 0`) cannot be cancelled until payments are refunded.
- **Protected Invoice Edits**: Editing line items, discounts, or taxes on a partially paid invoice recalculates `totalPaise` and status atomically, and rejects any edit that would drop `totalPaise` below `paidPaise`.

---

## Google Sheets Outbox & Self-Healing Reconciliation

SQLite is the operational source of truth; Google Sheets serves as a live, human-readable cloud mirror and reporting workbook across **6 auto-provisioned worksheets**:

| Worksheet Tab | Range | Exact Column Headers (`Column A` = Deterministic Primary Key) |
|---|---|---|
| **`Patients`** | `A:M` | `Record ID`, `First Name`, `Last Name`, `Phone`, `Email`, `Gender`, `Date of Birth`, `Address`, `Medical History`, `Allergies`, `Clinical Notes`, `Created At`, `Updated At` |
| **`Appointments`** | `A:I` | `Record ID`, `Patient ID`, `Patient Name`, `Scheduled At`, `Duration (Min)`, `Reason`, `Status`, `Notes`, `Updated At` |
| **`Treatments`** | `A:I` | `Record ID`, `Patient ID`, `Patient Name`, `Appointment ID`, `Diagnosis`, `Procedure`, `Tooth`, `Cost (INR)`, `Performed At` |
| **`Prescriptions`** | `A:F` | `Record ID`, `Patient ID`, `Patient Name`, `Treatment ID`, `Medications`, `Notes` |
| **`Invoices`** | `A:M` | `Record ID`, `Invoice Number`, `Patient ID`, `Patient Name`, `Subtotal (INR)`, `Discount (INR)`, `Tax (INR)`, `Total (INR)`, `Paid (INR)`, `Balance (INR)`, `Status`, `Issued At`, `Updated At` |
| **`Payments`** | `A:J` | `Record ID`, `Invoice ID`, `Invoice Number`, `Patient ID`, `Patient Name`, `Amount (INR)`, `Type`, `Method`, `Reference`, `Paid At` |

### How Synchronization & Self-Healing Work
1. **Transactional Outbox (`SyncQueue`)**: Every write operation upserts a job in `SyncQueue` (`unique(entity, entityId)`).
2. **Optimistic Worker Claim**: [`processSyncQueue()`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/lib/sync-queue.ts) atomically transitions eligible jobs to `PROCESSING` and always reads the **latest state from SQLite**, preventing stale out-of-order writes.
3. **Exponential Backoff**: Transient network or Google API errors mark the job `FAILED`, record `lastError`, and schedule automatic retry via:
   $$\text{Delay} = \min\!\left(30\text{ min},\; 15\text{ sec} \times 2^{\text{attempts}-1}\right)$$
4. **Self-Healing Reconciliation (`reconcileAllSheets`)**: Triggering **Sync Google Sheets** in the top bar (or `POST /api/sync`) drains the queue and compares every row in all 6 worksheets against SQLite—automatically appending missing rows (`missingIds`), overwriting tampered/drifted cells (`mismatchedIds`), and reporting orphan rows (`unexpectedIds`).

---

## Getting Started

### Prerequisites
- **Node.js** `>= 20.x` and **npm**

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Generate a bcrypt password hash for Doctor Kinjal Maheshwari's login and a cryptographic session secret:

```bash
node -e "require('bcryptjs').hash('YourStrongClinicPassword', 12).then(console.log)"
openssl rand -hex 32
```

Populate `.env`:

```dotenv
DATABASE_URL="file:./dev.db"
AUTH_USERNAME="doctorkinjal"
AUTH_PASSWORD_HASH="$2a$12$..."
AUTH_SECRET="your-64-char-hex-secret"

# Optional: Google Sheets v4 Cloud Mirror
GOOGLE_SERVICE_ACCOUNT_EMAIL="clinic-sync@your-project.iam.gserviceaccount.com"
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID="your-google-spreadsheet-id"
```

> **Google Sheets Setup Note**: Enable the **Google Sheets API** in Google Cloud Console, share your target Google Spreadsheet with `GOOGLE_SERVICE_ACCOUNT_EMAIL` as **Editor**, and paste the spreadsheet ID into `GOOGLE_SHEET_ID`. All 6 worksheet tabs (`Patients`, `Appointments`, `Treatments`, `Prescriptions`, `Invoices`, `Payments`) and their headers are created automatically on first sync.

### 3. Initialize the SQLite Database & Launch

```bash
npx prisma generate
npx prisma db push
npm run dev -- --hostname 0.0.0.0
```

- **Workstation Access**: Open `http://localhost:3000`
- **Clinic Wi-Fi (iPad / Chairside Access)**: Open `http://<MAC_LAN_IP>:3000` (e.g., `http://192.168.1.20:3000`) from any authorized device on the clinic's private network.

---

## Project Structure

```text
├── app/
│   ├── api/
│   │   ├── auth/login/route.ts          # Bcrypt verification, rate limit, JWT cookie issuance
│   │   ├── auth/logout/route.ts         # Session termination & audit logging
│   │   ├── dashboard/route.ts           # Executive KPIs, revenue & sync queue telemetry
│   │   ├── patients/route.ts            # Patient registry list, duplicate guard & creation
│   │   ├── patients/[id]/route.ts       # Patient profile update & soft-delete archive
│   │   ├── appointments/route.ts        # Conflict-checked appointment scheduling
│   │   ├── appointments/[id]/route.ts   # Rescheduling & status transitions
│   │   ├── treatments/route.ts          # Clinical charting & paise fee persistence
│   │   ├── prescriptions/route.ts       # Multi-medication Rx builder
│   │   ├── invoices/route.ts            # Multi-item invoice creation & paise math
│   │   ├── invoices/[id]/route.ts       # Serializable invoice editing & cancellation
│   │   ├── invoices/[id]/payments/      # Installment payments & refund reversals
│   │   ├── follow-ups/route.ts          # Patient recall tracking
│   │   └── sync/route.ts                # Manual & full-sheet reconciliation trigger
│   ├── globals.css                      # Apple HIG design tokens (light & dark themes)
│   ├── layout.tsx                       # Root metadata & typography setup
│   ├── loading.tsx                      # Branded skeleton loading state
│   └── page.tsx                         # Server-side authentication gate
├── components/
│   ├── clinic-app.tsx                   # Main workspace, 360° drawer, modals & state
│   └── login.tsx                        # Apple-inspired glassmorphic sign-in experience
├── lib/
│   ├── auth.ts                          # HS256 JWT signing & verification (jose)
│   ├── catalog.ts                       # Standard dental procedures & fee schedule
│   ├── db.ts                            # Prisma singleton client
│   ├── finance.ts                       # Integer-paise billing, status & ledger engine
│   ├── format.ts                        # INR currency & IST date/time formatters
│   ├── patient-search.ts                # Normalized multi-field patient search
│   ├── security.ts                      # Same-origin CSRF guard & brute-force rate limiter
│   ├── sheets.ts                        # Google Sheets v4 6-tab upsert & drift reconciler
│   ├── sync-queue.ts                    # Transactional outbox queue processor
│   └── validation.ts                    # Zod schemas for all API payloads
├── prisma/
│   └── schema.prisma                    # Relational schema (9 models)
├── reports/
│   ├── QA_TEST_PLAN.md                  # 50-test-case master QA plan & lifecycle map
│   ├── QA_TEST_EXECUTION_REPORT.md      # 50/50 execution results & root-cause defect log
│   └── GOOGLE_SHEETS_RECONCILIATION_REPORT.md
└── tests/
    ├── e2e/                             # 50 End-to-End QA test cases (TC-001 to TC-050)
    └── *.test.ts                        # Unit & integration tests (finance, sheets, auth, UI)
```

---

## API Reference

All endpoints (except `/api/auth/login`) require a valid `dentalcare_session` `HttpOnly` cookie and enforce same-origin CSRF verification on state-mutating methods (`POST`, `PATCH`, `DELETE`).

| Endpoint | Methods | Description |
|---|---|---|
| `/api/auth/login` | `POST` | Authenticates doctor credentials, enforces IP rate limit (8 attempts / 15m), sets `HttpOnly` JWT cookie |
| `/api/auth/logout` | `POST` | Clears session cookie and writes `LOGOUT` audit entry |
| `/api/dashboard` | `GET` | Aggregates clinic KPIs, today's schedule, receivables, follow-ups, and `SyncQueue` counters |
| `/api/patients` | `GET`, `POST` | Lists active patients with full relational history; creates patients with duplicate-phone detection |
| `/api/patients/[id]` | `PATCH`, `DELETE` | Updates patient demographics/medical history or soft-deletes (`deletedAt`) while preserving invoices |
| `/api/appointments` | `GET`, `POST` | Lists appointments chronologically; schedules new appointments with overlap conflict detection |
| `/api/appointments/[id]` | `PATCH` | Reschedules appointment time/duration or transitions status (`SCHEDULED`, `COMPLETED`, `CANCELLED`, `NO_SHOW`) |
| `/api/treatments` | `GET`, `POST` | Records dental procedures linked to patient & appointment in integer paise |
| `/api/treatments/[id]` | `PATCH`, `DELETE` | Updates or deletes clinical treatment records |
| `/api/prescriptions` | `GET`, `POST` | Records structured multi-medication prescriptions linked to patient and treatment |
| `/api/invoices` | `GET`, `POST` | Lists invoices with items/payments; issues new invoices with item quantities, discounts, and GST |
| `/api/invoices/[id]` | `PATCH` | Edits invoice items/discounts/taxes or cancels unpaid invoices inside a `Serializable` transaction |
| `/api/invoices/[id]/payments` | `POST` | Records full/partial installment payments (`CASH`, `UPI`, `CARD`, `BANK_TRANSFER`) or refunds (`isRefund`) |
| `/api/follow-ups` | `GET`, `POST` | Lists and schedules patient recall follow-ups |
| `/api/follow-ups/[id]` | `PATCH` | Marks recall follow-ups `COMPLETED` or `CANCELLED` |
| `/api/sync` | `GET`, `POST` | Returns `SyncQueue` diagnostics (`GET`) or drains the queue + runs 6-tab Google Sheets reconciliation (`POST`) |

---

## Quality Assurance & Test Suite

The repository includes a comprehensive automated test suite powered by **Vitest** running against an isolated SQLite test database (`prisma/test.db`), ensuring zero impact on live clinical data in `prisma/dev.db`.

| Suite Category | Files | Tests | Status |
|---|---|---:|---|
| **End-to-End Master QA Suite (`TC-001` – `TC-050`)** | 7 spec files in [`tests/e2e/`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests/e2e) | 50 | **50 / 50 PASS** |
| **Unit & Integration Suites** | 8 test files in [`tests/`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests) | 41 | **41 / 41 PASS** |
| **Total Automated Verification** | **15 Test Suites** | **91** | **100% PASS** |

### Run Verification Commands

```bash
# Execute all 91 automated tests (50 E2E QA cases + 41 unit/integration tests)
npm test

# Run strict TypeScript typecheck
npx tsc --noEmit

# Run ESLint code quality checks
npm run lint

# Build production bundle
npm run build
```

Detailed QA artifacts are available in the [`reports/`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/reports) directory:
- [`reports/QA_TEST_PLAN.md`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/reports/QA_TEST_PLAN.md)
- [`reports/QA_TEST_EXECUTION_REPORT.md`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/reports/QA_TEST_EXECUTION_REPORT.md)
- [`reports/GOOGLE_SHEETS_RECONCILIATION_REPORT.md`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/reports/GOOGLE_SHEETS_RECONCILIATION_REPORT.md)

---

## Data Care & Backup Protocol

- **Authoritative Storage**: [`prisma/dev.db`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/prisma/dev.db) is the primary clinical and financial source of truth.
- **Safe Backups**: Back up `prisma/dev.db` while the server is stopped or use SQLite's online backup command:
  ```bash
  sqlite3 prisma/dev.db ".backup 'prisma/backup-$(date +%Y%m%d-%H%M%S).db'"
  ```
- **Cloud Recovery**: Because every entity is mirrored by `Record ID` across the 6 Google Sheets tabs, the spreadsheet serves as both a real-time accounting ledger and an off-site human-readable disaster recovery replica.
