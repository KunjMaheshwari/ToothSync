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
  unexpectedIds: string[];
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

function stripQuotes(raw: string | undefined): string {
  if (!raw) return "";
  return raw.trim().replace(/^["']|["']$/g, "");
}

export function normalizePemPrivateKey(raw: string | undefined): string {
  const unquoted = stripQuotes(raw).replace(/\\n/g, "\n").replace(/\r/g, "");
  if (!unquoted) return "";
  const match = unquoted.match(
    /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/
  );
  if (match) {
    const keyType = match[1];
    const base64Body = match[2].replace(/\s+/g, "");
    const wrapped = base64Body.match(/.{1,64}/g) || [];
    return `-----BEGIN ${keyType}-----\n${wrapped.join("\n")}\n-----END ${keyType}-----\n`;
  }
  return unquoted;
}

export function isSheetsConfigured(): boolean {
  return Boolean(
    stripQuotes(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) &&
      normalizePemPrivateKey(process.env.GOOGLE_PRIVATE_KEY) &&
      stripQuotes(process.env.GOOGLE_SHEET_ID)
  );
}

export function configured() {
  const email = stripQuotes(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
  const key = normalizePemPrivateKey(process.env.GOOGLE_PRIVATE_KEY);
  const sheetId = stripQuotes(process.env.GOOGLE_SHEET_ID);
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
  const unexpectedIds: string[] = [];
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

  const knownDbIds = new Set<string>();

  for (const dbRecord of dbRecords) {
    const expected = buildSheetRecord(entity, dbRecord);
    knownDbIds.add(expected.id);
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

  for (const row of rows) {
    const rowId = String(row[0] ?? "").trim();
    if (rowId && !knownDbIds.has(rowId) && !unexpectedIds.includes(rowId)) {
      unexpectedIds.push(rowId);
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
    unexpectedIds,
    mismatches,
    financialSummary,
    pass:
      missingIds.length === 0 &&
      duplicateIds.length === 0 &&
      unexpectedIds.length === 0 &&
      mismatches.length === 0 &&
      (financialSummary ? financialSummary.balancesMatch : true),
  };
}

function parseDateOrNull(val: unknown): Date | null {
  if (!val) return null;
  const d = new Date(String(val));
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDateOrNow(val: unknown): Date {
  return parseDateOrNull(val) ?? new Date();
}

function strOrNull(val: unknown): string | null {
  if (val === undefined || val === null) return null;
  const trimmed = String(val).trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Hydrates an empty SQLite database from the authoritative Google Sheets tabs on
 * serverless cold starts so existing clinical and financial records remain available.
 */
export async function hydrateDatabaseFromSheets(
  prisma: any,
  customClient?: {
    sheets: Pick<sheets_v4.Sheets, "spreadsheets">;
    sheetId: string;
  }
): Promise<{ hydratedPatients: number }> {
  const { sheets, sheetId } = customClient ?? configured();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "sheets.properties",
  });
  const existingTabs = new Set(
    meta.data.sheets?.map((s) => s.properties?.title).filter(Boolean)
  );

  async function readTabRows(tab: string): Promise<(string | number)[][]> {
    if (!existingTabs.has(tab)) return [];
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${tab}'!A:Z`,
    });
    const rows = (res.data.values ?? []) as (string | number)[][];
    return rows.slice(1).filter((r) => r && String(r[0] ?? "").trim().length > 0);
  }

  const [
    patientRows,
    appointmentRows,
    treatmentRows,
    prescriptionRows,
    invoiceRows,
    paymentRows,
    followUpRows,
  ] = await Promise.all([
    readTabRows("Patients"),
    readTabRows("Appointments"),
    readTabRows("Treatments"),
    readTabRows("Prescriptions"),
    readTabRows("Invoices"),
    readTabRows("Payments"),
    readTabRows("Follow-ups"),
  ]);

  const patientIds = new Set<string>();
  const invoiceIds = new Set<string>();
  const now = new Date();

  async function markSynced(
    entity: string,
    entityId: string,
    patientId: string | null
  ) {
    await prisma.syncQueue
      .upsert({
        where: {
          entity_entityId_operation: {
            entity,
            entityId,
            operation: "UPSERT",
          },
        },
        create: {
          patientId,
          entity,
          entityId,
          operation: "UPSERT",
          payload: JSON.stringify({ entityId }),
          status: "SYNCED",
          attempts: 1,
          nextAttemptAt: now,
        },
        update: {
          status: "SYNCED",
          lastError: null,
        },
      })
      .catch(() => {});

    await prisma.syncMetadata
      .upsert({
        where: { entity_entityId: { entity, entityId } },
        create: { entity, entityId, syncedAt: now },
        update: { syncedAt: now },
      })
      .catch(() => {});
  }

  for (const r of patientRows) {
    const id = String(r[0]).trim();
    const patientId = String(r[1] || "").trim() || `DNT-2026-${id.slice(-8)}`;
    const referenceId = strOrNull(r[2]);
    const firstName = String(r[3] || "Patient").trim();
    const lastName = String(r[4] || "").trim();
    const dateOfBirth = parseDateOrNull(r[5]);
    const gender = strOrNull(r[6]);
    const phone = String(r[7] || "").trim();
    const email = strOrNull(r[8]);
    const city = strOrNull(r[9]);
    const allergies = strOrNull(r[10]);
    const conditions = strOrNull(r[11]);
    const dentalHistory = strOrNull(r[12]);
    const consented = String(r[13]).toLowerCase() === "true";
    const registeredAt = parseDateOrNow(r[14]);
    const updatedAt = parseDateOrNow(r[15]);

    if (!id || !phone) continue;
    try {
      await prisma.patient.upsert({
        where: { id },
        create: {
          id,
          patientId,
          referenceId,
          firstName,
          lastName,
          dateOfBirth,
          gender,
          phone,
          email,
          city,
          allergies,
          conditions,
          dentalHistory,
          consented,
          registeredAt,
          updatedAt,
        },
        update: {
          patientId,
          referenceId,
          firstName,
          lastName,
          dateOfBirth,
          gender,
          phone,
          email,
          city,
          allergies,
          conditions,
          dentalHistory,
          consented,
          updatedAt,
        },
      });
      patientIds.add(id);
      await markSynced("Patient", id, id);
    } catch {
      // Skip conflicting row without aborting hydration
    }
  }

  for (const r of appointmentRows) {
    const id = String(r[0]).trim();
    const patientId = String(r[1] || "").trim();
    if (!id || !patientIds.has(patientId)) continue;
    const startsAt = parseDateOrNow(r[3]);
    const endsAt =
      parseDateOrNull(r[4]) ?? new Date(startsAt.getTime() + 30 * 60_000);
    const type = String(r[5] || "General Consultation").trim();
    const status = String(r[6] || "SCHEDULED").trim();
    try {
      await prisma.appointment.upsert({
        where: { id },
        create: { id, patientId, startsAt, endsAt, type, status },
        update: { startsAt, endsAt, type, status },
      });
      await markSynced("Appointment", id, patientId);
    } catch {}
  }

  for (const r of treatmentRows) {
    const id = String(r[0]).trim();
    const patientId = String(r[1] || "").trim();
    if (!id || !patientIds.has(patientId)) continue;
    const date = parseDateOrNow(r[3]);
    const category = String(r[4] || "General").trim();
    const procedure = String(r[5] || "Procedure").trim();
    const toothNumber = strOrNull(r[6]);
    const costPaise = Math.max(0, Number(r[7] || 0));
    const status = String(r[8] || "PLANNED").trim();
    try {
      await prisma.treatment.upsert({
        where: { id },
        create: {
          id,
          patientId,
          date,
          category,
          procedure,
          toothNumber,
          costPaise,
          status,
        },
        update: {
          date,
          category,
          procedure,
          toothNumber,
          costPaise,
          status,
        },
      });
      await markSynced("Treatment", id, patientId);
    } catch {}
  }

  for (const r of prescriptionRows) {
    const id = String(r[0]).trim();
    const patientId = String(r[1] || "").trim();
    if (!id || !patientIds.has(patientId)) continue;
    const date = parseDateOrNow(r[3]);
    const itemsStr = String(r[4] || "").trim();
    const notes = strOrNull(r[5]);
    const parsedItems = itemsStr
      ? itemsStr
          .split(";")
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => {
            const [medication = "Medication", dosage = "", frequency = "", duration = ""] =
              part.split("|").map((s) => s.trim());
            return {
              medication,
              dosage: dosage || "As directed",
              frequency: frequency || "Daily",
              duration: duration || "5 days",
            };
          })
      : [];
    try {
      const existing = await prisma.prescription.findUnique({ where: { id } });
      if (!existing) {
        await prisma.prescription.create({
          data: {
            id,
            patientId,
            date,
            notes,
            ...(parsedItems.length > 0 ? { items: { create: parsedItems } } : {}),
          },
        });
      }
      await markSynced("Prescription", id, patientId);
    } catch {}
  }

  for (const r of invoiceRows) {
    const id = String(r[0]).trim();
    const patientId = String(r[1] || "").trim();
    if (!id || !patientIds.has(patientId)) continue;
    const invoiceNumber =
      String(r[3] || "").trim() || `INV-2026-${id.slice(-8)}`;
    const date = parseDateOrNow(r[4]);
    const totalPaise = Math.max(0, Number(r[5] || 0));
    const paidPaise = Math.max(0, Number(r[6] || 0));
    const status = String(r[7] || "PENDING").trim();
    try {
      const existing = await prisma.invoice.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!existing) {
        await prisma.invoice.create({
          data: {
            id,
            patientId,
            invoiceNumber,
            date,
            totalPaise,
            paidPaise,
            status,
            ...(totalPaise > 0
              ? {
                  items: {
                    create: [
                      {
                        description: "Dental Clinical Services",
                        quantity: 1,
                        unitPaise: totalPaise,
                      },
                    ],
                  },
                }
              : {}),
          },
        });
      } else {
        await prisma.invoice.update({
          where: { id },
          data: { totalPaise, paidPaise, status },
        });
      }
      invoiceIds.add(id);
      await markSynced("Invoice", id, patientId);
    } catch {}
  }

  for (const r of paymentRows) {
    const id = String(r[0]).trim();
    const invoiceId = String(r[1] || "").trim();
    if (!id || !invoiceIds.has(invoiceId)) continue;
    const amountPaise = Math.max(0, Number(r[2] || 0));
    const method = String(r[3] || "CASH").trim();
    const paidAt = parseDateOrNow(r[4]);
    try {
      await prisma.payment.upsert({
        where: { id },
        create: { id, invoiceId, amountPaise, method, paidAt },
        update: { amountPaise, method, paidAt },
      });
      await markSynced("Payment", id, null);
    } catch {}
  }

  for (const r of followUpRows) {
    const id = String(r[0]).trim();
    const patientId = String(r[1] || "").trim();
    if (!id || !patientIds.has(patientId)) continue;
    const dueDate = parseDateOrNow(r[3]);
    const reason = String(r[4] || "Clinical follow-up").trim();
    const status = String(r[5] || "PENDING").trim();
    try {
      await prisma.followUp.upsert({
        where: { id },
        create: { id, patientId, dueDate, reason, status },
        update: { dueDate, reason, status },
      });
      await markSynced("FollowUp", id, patientId);
    } catch {}
  }

  return { hydratedPatients: patientIds.size };
}
