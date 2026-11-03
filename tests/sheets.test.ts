import { describe, expect, it } from "vitest";
import {
  buildSheetRecord,
  reconcileEntitySheet,
  syncRecordToSheets,
} from "@/lib/sheets";

/**
 * Stateful in-memory simulator of the Google Sheets v4 values & batchUpdate API
 * used to deterministically validate tab creation, header verification,
 * idempotent row upserts, concurrency, and financial reconciliation.
 */
function createInMemorySheetsClient() {
  const store = new Map<string, (string | number)[][]>();

  const parseTabAndRange = (range: string) => {
    const match = range.match(/^'([^']+)'!(.+)$/);
    if (!match) throw new Error(`Invalid range: ${range}`);
    return { tab: match[1], cellRange: match[2] };
  };

  const sheets = {
    spreadsheets: {
      get: async () => ({
        data: {
          sheets: Array.from(store.keys()).map((title) => ({
            properties: { title },
          })),
        },
      }),
      batchUpdate: async ({ requestBody }: any) => {
        for (const req of requestBody?.requests ?? []) {
          const title = req.addSheet?.properties?.title;
          if (title && !store.has(title)) {
            store.set(title, []);
          }
        }
        return { data: {} };
      },
      values: {
        get: async ({ range }: { spreadsheetId: string; range: string }) => {
          const { tab, cellRange } = parseTabAndRange(range);
          const rows = store.get(tab) ?? [];
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
          const { tab, cellRange } = parseTabAndRange(range);
          const rows = store.get(tab) ?? [];
          const rowMatch = cellRange.match(/^A(\d+)$/);
          const rowIndex = rowMatch ? Number(rowMatch[1]) - 1 : 0;
          rows[rowIndex] = requestBody.values[0];
          store.set(tab, rows);
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
          const { tab } = parseTabAndRange(range);
          const rows = store.get(tab) ?? [];
          for (const v of requestBody.values) {
            rows.push(v);
          }
          store.set(tab, rows);
          return { data: {} };
        },
      },
    },
  } as any;

  return { sheets, sheetId: "test-spreadsheet-id", store };
}

describe("Google Sheets record mapping", () => {
  it("maps a patient using a stable local record ID", () => {
    const r = buildSheetRecord("Patient", {
      id: "local-1",
      patientId: "DNT-2026-0001",
      firstName: "QA",
      lastName: "Patient",
      phone: "9999999999",
      email: null,
      updatedAt: new Date("2026-01-01"),
    });
    expect(r.tab).toBe("Patients");
    expect(r.values.slice(0, 2)).toEqual(["local-1", "DNT-2026-0001"]);
  });

  it("maps treatment money as integer paise", () => {
    const r = buildSheetRecord("Treatment", {
      id: "t-1",
      patientId: "p-1",
      patient: { firstName: "QA", lastName: "Patient" },
      date: new Date("2026-01-01"),
      category: "Filling",
      procedure: "Composite",
      costPaise: 250000,
      status: "COMPLETED",
    });
    expect(r.values).toContain(250000);
  });

  it("maps appointments, prescriptions, invoices, payments, and follow-ups accurately", () => {
    const appt = buildSheetRecord("Appointment", {
      id: "a-1",
      patientId: "p-1",
      patient: { firstName: "QA", lastName: "Patient" },
      startsAt: new Date("2026-02-01T10:00:00.000Z"),
      endsAt: new Date("2026-02-01T10:30:00.000Z"),
      type: "Consultation",
      status: "SCHEDULED",
    });
    expect(appt.tab).toBe("Appointments");
    expect(appt.values[2]).toBe("QA Patient");

    const rx = buildSheetRecord("Prescription", {
      id: "rx-1",
      patientId: "p-1",
      patient: { firstName: "QA", lastName: "Patient" },
      date: new Date("2026-02-01T10:00:00.000Z"),
      items: [
        {
          medication: "Amoxicillin",
          dosage: "500mg",
          frequency: "TID",
          duration: "5d",
        },
      ],
      notes: "After meals",
    });
    expect(rx.tab).toBe("Prescriptions");
    expect(rx.values[4]).toContain("Amoxicillin | 500mg | TID | 5d");

    const inv = buildSheetRecord("Invoice", {
      id: "inv-1",
      patientId: "p-1",
      patient: { firstName: "QA", lastName: "Patient" },
      invoiceNumber: "INV-2026-00000001",
      date: new Date("2026-02-01T10:00:00.000Z"),
      totalPaise: 150000,
      paidPaise: 50000,
      status: "PARTIAL",
    });
    expect(inv.tab).toBe("Invoices");
    expect(inv.values).toContain("INV-2026-00000001");

    const pay = buildSheetRecord("Payment", {
      id: "pay-1",
      invoiceId: "inv-1",
      amountPaise: 50000,
      method: "UPI",
      paidAt: new Date("2026-02-01T10:05:00.000Z"),
    });
    expect(pay.tab).toBe("Payments");
    expect(pay.values).toContain("UPI");

    const fu = buildSheetRecord("FollowUp", {
      id: "fu-1",
      patientId: "p-1",
      patient: { firstName: "QA", lastName: "Patient" },
      dueDate: new Date("2026-02-08T10:00:00.000Z"),
      reason: "Suture removal",
      status: "PENDING",
    });
    expect(fu.tab).toBe("Follow-ups");
    expect(fu.values).toContain("Suture removal");
  });

  it("rejects unknown queue entities instead of falsely marking them synced", () =>
    expect(() => buildSheetRecord("Unknown", {})).toThrow(
      "Unsupported sync entity"
    ));
});

describe("Idempotent Google Sheets Synchronization & Financial Reconciliation", () => {
  it("synchronizes patients, invoices, and payments idempotently without duplicate rows and reconciles 100% of balances", async () => {
    const client = createInMemorySheetsClient();

    const patient = {
      id: "pat-sync-1",
      patientId: "DNT-2026-77770001",
      referenceId: "REF-001",
      firstName: "Aarav",
      lastName: "Mehta",
      dateOfBirth: new Date("1990-01-14T00:00:00.000Z"),
      gender: "Male",
      phone: "+91 9876543210",
      email: "aarav@example.test",
      city: "Ahmedabad",
      allergies: "None",
      conditions: "None",
      dentalHistory: "Cleanings",
      consented: true,
      registeredAt: new Date("2026-10-01T10:00:00.000Z"),
      updatedAt: new Date("2026-10-01T10:00:00.000Z"),
    };

    // 1. Sync patient multiple times concurrently -> must create only 1 row (plus 1 header row = 2 rows total)
    await Promise.all([
      syncRecordToSheets("Patient", patient, client),
      syncRecordToSheets("Patient", patient, client),
      syncRecordToSheets("Patient", patient, client),
    ]);
    expect(client.store.get("Patients")?.length).toBe(2);

    // 2. Update patient city -> updates existing row in place
    const updatedPatient = {
      ...patient,
      city: "Vadodara",
      updatedAt: new Date("2026-10-02T10:00:00.000Z"),
    };
    await syncRecordToSheets("Patient", updatedPatient, client);
    expect(client.store.get("Patients")?.length).toBe(2);
    const patReconcile = reconcileEntitySheet(
      "Patient",
      [updatedPatient],
      client.store.get("Patients")!
    );
    expect(patReconcile.pass).toBe(true);
    expect(patReconcile.duplicateIds).toEqual([]);

    // 3. Create Invoice (₹5,000.00 subtotal - ₹500.00 discount + ₹180.00 tax = ₹4,680.00 = 468000 paise)
    const invoice = {
      id: "inv-sync-1",
      patientId: updatedPatient.id,
      patient: updatedPatient,
      invoiceNumber: "INV-2026-00001001",
      date: new Date("2026-10-05T12:00:00.000Z"),
      discountPaise: 50000,
      taxPaise: 18000,
      totalPaise: 468000,
      paidPaise: 0,
      status: "PENDING",
      items: [{ quantity: 1, unitPaise: 500000 }],
      payments: [] as any[],
    };
    await syncRecordToSheets("Invoice", invoice, client);
    expect(client.store.get("Invoices")?.length).toBe(2);

    // 4. Record Partial Payment 1 (200000 paise via UPI) and re-sync Invoice + Payment
    const payment1 = {
      id: "pay-sync-1",
      invoiceId: invoice.id,
      amountPaise: 200000,
      method: "UPI",
      paidAt: new Date("2026-10-05T12:15:00.000Z"),
    };
    invoice.payments = [payment1];
    invoice.paidPaise = 200000;
    invoice.status = "PARTIAL";

    await syncRecordToSheets("Payment", payment1, client);
    await syncRecordToSheets("Invoice", invoice, client);

    const partialReconcile = reconcileEntitySheet(
      "Invoice",
      [invoice],
      client.store.get("Invoices")!
    );
    expect(partialReconcile.pass).toBe(true);
    expect(partialReconcile.financialSummary).toEqual({
      dbTotalPaise: 468000,
      sheetTotalPaise: 468000,
      dbPaidPaise: 200000,
      sheetPaidPaise: 200000,
      dbOutstandingPaise: 268000,
      sheetOutstandingPaise: 268000,
      balancesMatch: true,
    });

    // 5. Record Final Payment 2 (268000 paise via CARD) and re-sync Invoice + Payment twice
    const payment2 = {
      id: "pay-sync-2",
      invoiceId: invoice.id,
      amountPaise: 268000,
      method: "CARD",
      paidAt: new Date("2026-10-06T09:00:00.000Z"),
    };
    invoice.payments = [payment1, payment2];
    invoice.paidPaise = 468000;
    invoice.status = "PAID";

    await syncRecordToSheets("Payment", payment2, client);
    await syncRecordToSheets("Payment", payment2, client); // Idempotent retry
    await syncRecordToSheets("Invoice", invoice, client);
    await syncRecordToSheets("Invoice", invoice, client); // Idempotent retry

    // Verify Invoices tab still has exactly 1 data row (total 2 with header)
    expect(client.store.get("Invoices")?.length).toBe(2);
    // Verify Payments tab has exactly 2 data rows (total 3 with header)
    expect(client.store.get("Payments")?.length).toBe(3);

    const finalInvoiceReconcile = reconcileEntitySheet(
      "Invoice",
      [invoice],
      client.store.get("Invoices")!
    );
    expect(finalInvoiceReconcile.pass).toBe(true);
    expect(finalInvoiceReconcile.financialSummary).toEqual({
      dbTotalPaise: 468000,
      sheetTotalPaise: 468000,
      dbPaidPaise: 468000,
      sheetPaidPaise: 468000,
      dbOutstandingPaise: 0,
      sheetOutstandingPaise: 0,
      balancesMatch: true,
    });

    const finalPaymentReconcile = reconcileEntitySheet(
      "Payment",
      [payment1, payment2],
      client.store.get("Payments")!
    );
    expect(finalPaymentReconcile.pass).toBe(true);
    expect(finalPaymentReconcile.financialSummary?.dbPaidPaise).toBe(468000);
    expect(finalPaymentReconcile.financialSummary?.sheetPaidPaise).toBe(468000);
  });
});
