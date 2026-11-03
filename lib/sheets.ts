import { google, sheets_v4 } from "googleapis";
import { deriveInvoiceStatus } from "@/lib/finance";

export type SheetRecord = {
  tab: string;
  headers: string[];
  id: string;
  values: (string | number)[];
};

export interface ReconciliationResult {
  entity: string;
  tab: string;
  totalDbRecords: number;
  matchedCount: number;
  missingIds: string[];
  duplicateIds: string[];
  mismatches: Array<{
    id: string;
    field: string;
    expected: string;
    actual: string;
  }>;
  financialSummary?: {
    dbTotalPaise: number;
    sheetTotalPaise: number;
    dbPaidPaise: number;
    sheetPaidPaise: number;
    dbOutstandingPaise: number;
    sheetOutstandingPaise: number;
    balancesMatch: boolean;
  };
  pass: boolean;
}

export function buildSheetRecord(entity: string, value: any): SheetRecord {
  const iso = (date: Date | string | undefined | null) =>
    date ? new Date(date).toISOString() : "";
  const name = value.patient
    ? `${value.patient.firstName} ${value.patient.lastName}`.trim()
    : "";

  switch (entity) {
    case "Patient":
      return {
        tab: "Patients",
        headers: [
          "Record ID",
          "Patient ID",
          "Reference ID",
          "First Name",
          "Last Name",
          "Date of Birth",
          "Gender",
          "Phone",
          "Email",
          "City",
          "Known Allergies",
          "Medical Conditions",
          "Dental History",
          "Consented",
          "Registered At",
          "Updated At",
        ],
        id: value.id,
        values: [
          value.id,
          value.patientId,
          value.referenceId ?? "",
          value.firstName,
          value.lastName,
          iso(value.dateOfBirth),
          value.gender ?? "",
          value.phone,
          value.email ?? "",
          value.city ?? "",
          value.allergies ?? "",
          value.conditions ?? "",
          value.dentalHistory ?? "",
          String(Boolean(value.consented)),
          iso(value.registeredAt),
          iso(value.updatedAt ?? new Date()),
        ],
      };

    case "Appointment":
      return {
        tab: "Appointments",
        headers: [
          "Record ID",
          "Patient Record ID",
          "Patient",
          "Start",
          "End",
          "Type",
          "Status",
        ],
        id: value.id,
        values: [
          value.id,
          value.patientId,
          name,
          iso(value.startsAt),
          iso(value.endsAt),
          value.type,
          value.status,
        ],
      };

    case "Treatment":
      return {
        tab: "Treatments",
        headers: [
          "Record ID",
          "Patient Record ID",
          "Patient",
          "Date",
          "Category",
          "Procedure",
          "Tooth",
          "Cost Paise",
          "Status",
        ],
        id: value.id,
        values: [
          value.id,
          value.patientId,
          name,
          iso(value.date),
          value.category,
          value.procedure,
          value.toothNumber ?? "",
          value.costPaise ?? 0,
          value.status,
        ],
      };

    case "Prescription":
      return {
        tab: "Prescriptions",
        headers: [
          "Record ID",
          "Patient Record ID",
          "Patient",
          "Date",
          "Items",
          "Notes",
        ],
        id: value.id,
        values: [
          value.id,
          value.patientId,
          name,
          iso(value.date),
          (value.items ?? [])
            .map(
              (item: any) =>
                `${item.medication} | ${item.dosage} | ${item.frequency} | ${item.duration}`
            )
            .join("; "),
          value.notes ?? "",
        ],
      };

    case "Invoice": {
      const authoritativePaidPaise = Array.isArray(value.payments)
        ? value.payments.reduce(
            (sum: number, p: any) => sum + (p.amountPaise || 0),
            0
          )
        : value.paidPaise ?? 0;
      const authoritativeTotalPaise =
        Array.isArray(value.items) && value.items.length > 0
          ? value.items.reduce(
              (sum: number, it: any) =>
                sum + (it.quantity || 1) * (it.unitPaise || 0),
              0
            ) -
            (value.discountPaise || 0) +
            (value.taxPaise || 0)
          : value.totalPaise ?? 0;
      const status = deriveInvoiceStatus(
        authoritativeTotalPaise,
        authoritativePaidPaise,
        value.status
      );
      return {
        tab: "Invoices",
        headers: [
          "Record ID",
          "Patient Record ID",
          "Patient",
          "Invoice Number",
          "Date",
          "Total Paise",
          "Paid Paise",
          "Status",
        ],
        id: value.id,
        values: [
          value.id,
          value.patientId,
          name,
          value.invoiceNumber,
          iso(value.date),
          authoritativeTotalPaise,
          authoritativePaidPaise,
          status,
        ],
      };
    }

    case "Payment":
      return {
        tab: "Payments",
        headers: [
          "Record ID",
          "Invoice Record ID",
          "Amount Paise",
          "Method",
          "Paid At",
        ],
        id: value.id,
        values: [
          value.id,
          value.invoiceId,
          value.amountPaise,
          value.method,
          iso(value.paidAt),
        ],
      };

    case "FollowUp":
      return {
        tab: "Follow-ups",
        headers: [
          "Record ID",
          "Patient Record ID",
          "Patient",
          "Due Date",
          "Reason",
          "Status",
        ],
        id: value.id,
        values: [
          value.id,
          value.patientId,
          name,
          iso(value.dueDate),
          value.reason,
          value.status,
        ],
      };

    default:
      throw new Error(`Unsupported sync entity: ${entity}`);
  }
}

export function configured() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!email || !key || !sheetId) {
    throw new Error("Google Sheets credentials are not configured.");
  }
  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return { sheets: google.sheets({ version: "v4", auth }), sheetId };
}

export async function ensureTab(
  sheets: Pick<sheets_v4.Sheets, "spreadsheets">,
  spreadsheetId: string,
  tab: string,
  headers: string[]
) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties",
  });
  const exists = meta.data.sheets?.some(
    (sheet) => sheet.properties?.title === tab
  );
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
    });
  }
  const first = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tab}'!1:1`,
  });
  const current = first.data.values?.[0] ?? [];
  if (!current.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tab}'!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  } else if (
    current.length !== headers.length ||
    current.some((header, index) => header !== headers[index])
  ) {
    throw new Error(
      `Sheet ${tab} has an incompatible header. Run its explicit data-preserving migration before syncing.`
    );
  }
}

// Per-tab lock to guarantee concurrent sync calls never race on row index lookup + append
const tabLocks = new Map<string, Promise<unknown>>();

async function withTabLock<T>(tab: string, fn: () => Promise<T>): Promise<T> {
  const prev = tabLocks.get(tab) ?? Promise.resolve();
  let release!: () => void;
  const curr = new Promise<void>((r) => {
    release = r;
  });
  tabLocks.set(
    tab,
    prev.then(() => curr)
  );
  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (tabLocks.get(tab) === curr) {
      tabLocks.delete(tab);
    }
  }
}

export async function syncRecordToSheets(
  entity: string,
  value: any,
  customClient?: {
    sheets: Pick<sheets_v4.Sheets, "spreadsheets">;
    sheetId: string;
  }
) {
  const record = buildSheetRecord(entity, value);
  const { sheets, sheetId } = customClient ?? configured();

  await withTabLock(record.tab, async () => {
    await ensureTab(sheets, sheetId, record.tab, record.headers);
    const range = `'${record.tab}'!A:A`;
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range,
    });
    const row = (existing.data.values ?? []).findIndex(
      (r) => r[0] === record.id
    );
    if (row >= 1) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `'${record.tab}'!A${row + 1}`,
        valueInputOption: "RAW",
        requestBody: { values: [record.values] },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `'${record.tab}'!A:Z`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [record.values] },
      });
    }
  });
}

/**
 * Reconciles authoritative database records for an entity against Google Sheets rows.
 */
export function reconcileEntitySheet(
  entity: string,
  dbRecords: any[],
  sheetData: (string | number)[][]
): ReconciliationResult {
  const sample =
    dbRecords.length > 0
      ? buildSheetRecord(entity, dbRecords[0])
      : { tab: entity, headers: [] as string[] };
  const [headerRow = [], ...rows] = sheetData;
  const colIndex = Object.fromEntries(
    headerRow.map((h, idx) => [String(h), idx])
  );

  const missingIds: string[] = [];
  const duplicateIds: string[] = [];
  const mismatches: Array<{
    id: string;
    field: string;
    expected: string;
    actual: string;
  }> = [];
  let matchedCount = 0;

  let dbTotalPaise = 0;
  let sheetTotalPaise = 0;
  let dbPaidPaise = 0;
  let sheetPaidPaise = 0;

  for (const dbRecord of dbRecords) {
    const expected = buildSheetRecord(entity, dbRecord);
    const matchingRows = rows.filter((r) => String(r[0]) === expected.id);

    if (matchingRows.length === 0) {
      missingIds.push(expected.id);
      continue;
    }
    if (matchingRows.length > 1) {
      duplicateIds.push(expected.id);
    }

    const row = matchingRows[0];
    let rowExactMatch = matchingRows.length === 1;

    expected.headers.forEach((header, idx) => {
      const sheetCol = colIndex[header] ?? idx;
      const expectedStr = String(expected.values[idx] ?? "");
      const actualStr = String(row[sheetCol] ?? "");
      if (expectedStr !== actualStr) {
        rowExactMatch = false;
        mismatches.push({
          id: expected.id,
          field: header,
          expected: expectedStr,
          actual: actualStr,
        });
      }
    });

    if (entity === "Invoice") {
      const expTotal = Number(expected.values[5] || 0);
      const expPaid = Number(expected.values[6] || 0);
      const actTotal = Number(row[colIndex["Total Paise"] ?? 5] || 0);
      const actPaid = Number(row[colIndex["Paid Paise"] ?? 6] || 0);
      dbTotalPaise += expTotal;
      dbPaidPaise += expPaid;
      sheetTotalPaise += actTotal;
      sheetPaidPaise += actPaid;
    } else if (entity === "Payment") {
      const expAmt = Number(expected.values[2] || 0);
      const actAmt = Number(row[colIndex["Amount Paise"] ?? 2] || 0);
      dbPaidPaise += expAmt;
      sheetPaidPaise += actAmt;
    }

    if (rowExactMatch) {
      matchedCount++;
    }
  }

  const financialSummary =
    entity === "Invoice" || entity === "Payment"
      ? {
          dbTotalPaise,
          sheetTotalPaise,
          dbPaidPaise,
          sheetPaidPaise,
          dbOutstandingPaise: Math.max(0, dbTotalPaise - dbPaidPaise),
          sheetOutstandingPaise: Math.max(0, sheetTotalPaise - sheetPaidPaise),
          balancesMatch:
            dbTotalPaise === sheetTotalPaise && dbPaidPaise === sheetPaidPaise,
        }
      : undefined;

  return {
    entity,
    tab: sample.tab,
    totalDbRecords: dbRecords.length,
    matchedCount,
    missingIds,
    duplicateIds,
    mismatches,
    financialSummary,
    pass:
      missingIds.length === 0 &&
      duplicateIds.length === 0 &&
      mismatches.length === 0 &&
      (financialSummary ? financialSummary.balancesMatch : true),
  };
}
