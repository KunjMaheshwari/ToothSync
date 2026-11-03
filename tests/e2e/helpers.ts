import { db } from "@/lib/db";

/**
 * Builds a JSON Request with same-origin headers by default.
 */
export function makeRequest(
  url: string,
  method = "GET",
  body?: unknown,
  extraHeaders: Record<string, string> = {}
): Request {
  const headers: Record<string, string> = {
    origin: "http://localhost:3000",
    host: "localhost:3000",
    ...extraHeaders,
  };
  if (body !== undefined && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }
  return new Request(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/**
 * Independent reference financial calculation (used by QA tests as an external
 * oracle independent of `lib/finance.ts`).
 */
export function independentOracleInvoiceMath(params: {
  lineItems: Array<{ qty: number; unitPaise: number }>;
  discountFixedPaise?: number;
  discountPct?: number;
  taxFixedPaise?: number;
  taxPct?: number;
  paymentsPaise?: number[];
}) {
  const subtotalPaise = params.lineItems.reduce(
    (acc, item) => acc + item.qty * item.unitPaise,
    0
  );
  const discountPaise =
    params.discountPct !== undefined
      ? Math.round((subtotalPaise * params.discountPct) / 100)
      : params.discountFixedPaise ?? 0;
  const taxablePaise = subtotalPaise - discountPaise;
  const taxPaise =
    params.taxPct !== undefined
      ? Math.round((taxablePaise * params.taxPct) / 100)
      : params.taxFixedPaise ?? 0;
  const totalAmountPaise = subtotalPaise - discountPaise + taxPaise;
  const totalPaidPaise = (params.paymentsPaise ?? []).reduce(
    (acc, p) => acc + p,
    0
  );
  const outstandingPaise = totalAmountPaise - totalPaidPaise;
  const status =
    totalAmountPaise === 0 || totalPaidPaise >= totalAmountPaise
      ? "PAID"
      : totalPaidPaise > 0
      ? "PARTIAL"
      : "PENDING";

  return {
    subtotalPaise,
    discountPaise,
    taxPaise,
    totalAmountPaise,
    totalPaidPaise,
    outstandingPaise,
    status,
  };
}

/**
 * Resets all tables in the isolated `prisma/test.db` database between test suites.
 */
export async function resetTestDatabase() {
  await db.syncMetadata.deleteMany();
  await db.syncQueue.deleteMany();
  await db.auditLog.deleteMany();
  await db.payment.deleteMany();
  await db.invoiceItem.deleteMany();
  await db.invoice.deleteMany();
  await db.prescriptionItem.deleteMany();
  await db.prescription.deleteMany();
  await db.treatment.deleteMany();
  await db.followUp.deleteMany();
  await db.appointment.deleteMany();
  await db.patient.deleteMany();
}

/**
 * Creates a deterministic in-memory Google Sheets v4 API simulator for end-to-end
 * synchronization and reconciliation testing.
 */
export function createSheetsTestHarness() {
  const tabs = new Map<string, (string | number)[][]>();
  let failNextWriteCount = 0;

  const parseRange = (range: string) => {
    const match = range.match(/^'([^']+)'!(.+)$/);
    if (!match) throw new Error(`Invalid range: ${range}`);
    return { tab: match[1], cellRange: match[2] };
  };

  const sheets = {
    spreadsheets: {
      get: async () => ({
        data: {
          sheets: Array.from(tabs.keys()).map((title) => ({
            properties: { title },
          })),
        },
      }),
      batchUpdate: async ({ requestBody }: any) => {
        for (const req of requestBody?.requests ?? []) {
          const title = req.addSheet?.properties?.title;
          if (title && !tabs.has(title)) {
            tabs.set(title, []);
          }
        }
        return { data: {} };
      },
      values: {
        get: async ({ range }: { spreadsheetId: string; range: string }) => {
          const { tab, cellRange } = parseRange(range);
          const rows = tabs.get(tab) ?? [];
          if (cellRange === "1:1") {
            return { data: { values: rows.length ? [rows[0]] : [] } };
          }
          if (cellRange === "A:A") {
            return { data: { values: rows.map((r) => [r[0]]) } };
          }
          return { data: { values: rows } };
        },
        update: async ({
          range,
          requestBody,
        }: {
          spreadsheetId: string;
          range: string;
          valueInputOption: string;
          requestBody: { values: (string | number)[][] };
        }) => {
          if (failNextWriteCount > 0) {
            failNextWriteCount--;
            throw new Error("Simulated transient Google Sheets API 503 error");
          }
          const { tab, cellRange } = parseRange(range);
          const rows = tabs.get(tab) ?? [];
          const rowMatch = cellRange.match(/^A(\d+)$/);
          const rowIndex = rowMatch ? Number(rowMatch[1]) - 1 : 0;
          rows[rowIndex] = requestBody.values[0];
          tabs.set(tab, rows);
          return { data: {} };
        },
        append: async ({
          range,
          requestBody,
        }: {
          spreadsheetId: string;
          range: string;
          valueInputOption: string;
          insertDataOption: string;
          requestBody: { values: (string | number)[][] };
        }) => {
          if (failNextWriteCount > 0) {
            failNextWriteCount--;
            throw new Error("Simulated transient Google Sheets API 503 error");
          }
          const { tab } = parseRange(range);
          const rows = tabs.get(tab) ?? [];
          for (const v of requestBody.values) {
            rows.push(v);
          }
          tabs.set(tab, rows);
          return { data: {} };
        },
      },
    },
  } as any;

  return {
    client: { sheets, sheetId: "qa-test-spreadsheet-001" },
    tabs,
    injectTransientFailures(count: number) {
      failNextWriteCount = count;
    },
  };
}

