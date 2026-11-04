# Google Sheets Synchronization Verification Report

> **Application:** Doctor Kinjal Maheshwari’s Patient Tracker  
> **Integration Target:** Google Sheets API v4 (`googleapis`)  
> **Date:** 2026-11-04  
> **Status:** VERIFIED & HARDENED

---

## 1. Overview & Sync Architecture

Doctor Kinjal Maheshwari’s Patient Tracker synchronizes clinical, operational, and financial records to a Google Spreadsheet using the Google Sheets API v4 with Service Account JWT authentication.

### Tab Layout & Header Inventory

| Tab Name | Total Columns | Column A (Primary Key) | Tombstone Column | Data Entity |
|---|:---:|---|---|---|
| **Patients** | **17** *(Updated)* | `Record ID` | **Column 17 (`Archived At`)** | Patient demographics, medical/dental history, deletion status |
| **Appointments** | 10 | `Record ID` | `Status` (`CANCELLED`) | Scheduled, confirmed, completed, and cancelled appointments |
| **Treatments** | 9 | `Record ID` | `Status` (`CANCELLED`) | Dental procedures, tooth number, cost in paise |
| **Prescriptions** | 6 | `Record ID` | N/A (Permanent clinical record) | Medications, dosage, frequency, duration |
| **Invoices** | 9 | `Record ID` | N/A (Financial ledger) | Amounts, taxes, discounts, balance, status |
| **Payments** | 7 | `Record ID` | N/A (Financial ledger) | Payment receipts, methods, references |
| **Follow-ups** | 6 | `Record ID` | `Status` (`CANCELLED`) | Recalls, due dates, contact status |

---

## 2. The 17th Column Schema Expansion (`Patients` Tab)

### Pre-Fix State (16 Columns)
```
Columns 1-16: Record ID, First Name, Last Name, Phone, Email, Date of Birth, Gender, Blood Group, Medical History, Dental History, Allergies, Emergency Contact Name, Emergency Contact Phone, Notes, Created At, Updated At
```
*Issue:* No column tracked whether a patient was deleted or archived. Whenever a container hydrated from Google Sheets, every row was assumed to be an active patient (`deletedAt: null`), causing deleted patients to reappear on cold-starts.

### Hardened State (17 Columns)
```
Columns 1-17: Record ID, First Name, Last Name, Phone, Email, Date of Birth, Gender, Blood Group, Medical History, Dental History, Allergies, Emergency Contact Name, Emergency Contact Phone, Notes, Created At, Updated At, Archived At
```
*Fix:*
1. When a patient is active, `row[16]` is an empty string `""`.
2. When a patient is archived, `row[16]` contains the ISO 8601 deletion timestamp (e.g. `2026-11-04T12:00:00.000Z`).
3. [`ensureTab`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/lib/sheets.ts#L304-L345) dynamically detects when an existing sheet header row (`1:1`) has 16 columns and updates the header range `1:1` to add `"Archived At"` without altering existing row data.

---

## 3. Hydration & Reconciliation Logic

### 3.1 Non-Destructive Hydration (`hydrateDatabaseFromSheets`)
```ts
// lib/sheets.ts
const archivedAt = r[16] ? new Date(String(r[16])) : null;
await prisma.patient.upsert({
  where: { id },
  update: {
    firstName: String(r[1] || ""),
    lastName: String(r[2] || ""),
    // ...
    deletedAt: archivedAt,
  },
  create: {
    id,
    patientId: `P-${id.slice(-6).toUpperCase()}`,
    firstName: String(r[1] || ""),
    lastName: String(r[2] || ""),
    // ...
    deletedAt: archivedAt,
  },
});
```
*Result:* Archived patient rows in Google Sheets are hydrated with their exact `deletedAt` timestamp preserved. They are excluded from `/api/patients` queries and cannot resurrect in the UI.

### 3.2 Reconciliation Engine (`reconcileEntitySheet`)
When reconciling local database rows with Google Sheets:
- Local active records are compared with Google Sheets rows where `Archived At` is empty.
- Local soft-deleted records are compared with Google Sheets rows where `Archived At` is populated.
- Tombstones are recognized as normal state transitions rather than data corruption or orphan records.

---

## 4. Environment & Verification Status

1. **In-Memory & Simulated Sheets Client Verification:**
   - Evaluated via [`tests/sheets.test.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests/sheets.test.ts) (5 passing tests) and [`tests/patient-archive-lifecycle.test.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/tests/patient-archive-lifecycle.test.ts) (3 passing tests).
   - Validated: Tab creation, column headers count (17), idempotent upserting, header migration from 16 to 17 columns, and hydration of archived tombstones.
2. **Live Google Sheets API Note:**
   - In automated CI and isolated local test environments without production service account credentials, tests execute against the strict Google Sheets v4 API simulator.
   - On the live production deployment where `GOOGLE_SHEETS_SPREADSHEET_ID` and `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` are provided, the runtime uses the authenticated Google Sheets API client with write-through sync via `syncAfterWriteOnServerless()`.
