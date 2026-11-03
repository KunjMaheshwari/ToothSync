import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { buildSheetRecord } from "@/lib/sheets";
import {
  independentOracleInvoiceMath,
  makeRequest,
  resetTestDatabase,
} from "./helpers";

vi.mock("@/lib/auth", () => ({
  isAuthenticated: vi.fn(async () => true),
}));

import { POST as patientsPOST } from "@/app/api/patients/route";
import { POST as invoicesPOST } from "@/app/api/invoices/route";
import {
  GET as invoiceDetailGET,
  PATCH as invoicePATCH,
} from "@/app/api/invoices/[id]/route";

describe("PHASE 7 — Billing & Invoices (TC-025 to TC-032)", () => {
  let patient: any;

  beforeEach(async () => {
    await resetTestDatabase();
    patient = await (
      await patientsPOST(
        makeRequest("http://localhost:3000/api/patients", "POST", {
          referenceId: "QA_BILL_PAT_001",
          firstName: "Rajesh",
          lastName: "war",
          phone: "+91 98700 30001",
        })
      )
    ).json();
  });

  it("TC-025: Create an invoice with a single treatment and verify independent oracle paise math", async () => {
    const oracle = independentOracleInvoiceMath({
      lineItems: [{ qty: 1, unitPaise: 350000 }],
    });
    expect(oracle.totalAmountPaise).toBe(350000);

    const res = await invoicesPOST(
      makeRequest("http://localhost:3000/api/invoices", "POST", {
        patientId: patient.id,
        discountPaise: 0,
        taxPaise: 0,
        items: [
          {
            description: "Ceramic Inlay Restoration (#36)",
            quantity: 1,
            unitPaise: 350000,
          },
        ],
      })
    );
    expect(res.status).toBe(201);
    const inv = await res.json();
    expect(inv.totalPaise).toBe(oracle.totalAmountPaise);
    expect(inv.discountPaise).toBe(0);
    expect(inv.taxPaise).toBe(0);
    expect(inv.paidPaise).toBe(0);
    expect(inv.status).toBe("PENDING");
  });

  it("TC-026: Create an invoice with multiple treatments and quantities > 1 and verify line item sum", async () => {
    const oracle = independentOracleInvoiceMath({
      lineItems: [
        { qty: 1, unitPaise: 450000 },
        { qty: 2, unitPaise: 125050 },
        { qty: 3, unitPaise: 35025 },
      ],
    });
    // 450000 + 250100 + 105075 = 805175 paise (₹8,051.75)
    expect(oracle.subtotalPaise).toBe(805175);

    const res = await invoicesPOST(
      makeRequest("http://localhost:3000/api/invoices", "POST", {
        patientId: patient.id,
        discountPaise: 0,
        taxPaise: 0,
        items: [
          { description: "Root Canal Therapy (#26)", quantity: 1, unitPaise: 450000 },
          { description: "Composite Build-up", quantity: 2, unitPaise: 125050 },
          { description: "Digital Periapical X-Ray", quantity: 3, unitPaise: 35025 },
        ],
      })
    );
    expect(res.status).toBe(201);
    const inv = await res.json();
    expect(inv.totalPaise).toBe(oracle.totalAmountPaise);
    expect(inv.items.length).toBe(3);
  });

  it("TC-027: Create an invoice with discount + GST tax and verify totalPaise = subtotalPaise - discountPaise + taxPaise", async () => {
    const oracle = independentOracleInvoiceMath({
      lineItems: [{ qty: 2, unitPaise: 500000 }], // 1,000,000 paise (₹10,000.00)
      discountFixedPaise: 100000, // ₹1,000.00
      taxFixedPaise: 45000, // ₹450.00
    });
    expect(oracle.totalAmountPaise).toBe(945000);

    const res = await invoicesPOST(
      makeRequest("http://localhost:3000/api/invoices", "POST", {
        patientId: patient.id,
        discountPaise: 100000,
        taxPaise: 45000,
        items: [{ description: "Zirconia Crown", quantity: 2, unitPaise: 500000 }],
      })
    );
    expect(res.status).toBe(201);
    const inv = await res.json();
    expect(inv.discountPaise).toBe(100000);
    expect(inv.taxPaise).toBe(45000);
    expect(inv.totalPaise).toBe(945000);
  });

  it("TC-028: Create an invoice with a percentage discount (12.5% on ₹2,500.50) and verify half-up paise rounding", async () => {
    // 250050 * 12.5 / 100 = 31256.25 -> rounds to 31256 paise
    const oracle = independentOracleInvoiceMath({
      lineItems: [{ qty: 1, unitPaise: 250050 }],
      discountPct: 12.5,
      taxPct: 5,
    });
    expect(oracle.discountPaise).toBe(31256);
    // taxable = 250050 - 31256 = 218794; 5% tax = 10939.7 -> 10940 paise
    expect(oracle.taxPaise).toBe(10940);
    expect(oracle.totalAmountPaise).toBe(229734);

    const res = await invoicesPOST(
      makeRequest("http://localhost:3000/api/invoices", "POST", {
        patientId: patient.id,
        discountPercent: 12.5,
        taxPercent: 5,
        items: [
          {
            description: "Periodontal Flap Surgery",
            quantity: 1,
            unitPaise: 250050,
          },
        ],
      })
    );
    expect(res.status).toBe(201);
    const inv = await res.json();
    expect(inv.discountPaise).toBe(oracle.discountPaise);
    expect(inv.taxPaise).toBe(oracle.taxPaise);
    expect(inv.totalPaise).toBe(oracle.totalAmountPaise);
  });

  it("TC-029: Create an invoice with a fixed discount and verify exact deduction and 100% full-waiver status (PAID at 0 paise)", async () => {
    const resPartialDisc = await invoicesPOST(
      makeRequest("http://localhost:3000/api/invoices", "POST", {
        patientId: patient.id,
        discountPaise: 25050,
        taxPaise: 0,
        items: [{ description: "Consultation & Charting", quantity: 1, unitPaise: 100000 }],
      })
    );
    expect(resPartialDisc.status).toBe(201);
    const inv1 = await resPartialDisc.json();
    expect(inv1.totalPaise).toBe(74950);
    expect(inv1.status).toBe("PENDING");

    // 100% complimentary follow-up invoice -> totalPaise = 0 -> initial status PAID
    const resWaiver = await invoicesPOST(
      makeRequest("http://localhost:3000/api/invoices", "POST", {
        patientId: patient.id,
        discountPaise: 50000,
        taxPaise: 0,
        items: [{ description: "Post-Op Suture Removal", quantity: 1, unitPaise: 50000 }],
      })
    );
    expect(resWaiver.status).toBe(201);
    const inv2 = await resWaiver.json();
    expect(inv2.totalPaise).toBe(0);
    expect(inv2.status).toBe("PAID");
  });

  it("TC-030: Validate zero/empty items, negative prices/discounts, and discount exceeding subtotal (all rejected with 400)", async () => {
    const emptyItems = await invoicesPOST(
      makeRequest("http://localhost:3000/api/invoices", "POST", {
        patientId: patient.id,
        items: [],
      })
    );
    expect(emptyItems.status).toBe(400);

    const negPrice = await invoicesPOST(
      makeRequest("http://localhost:3000/api/invoices", "POST", {
        patientId: patient.id,
        items: [{ description: "Bad Item", quantity: 1, unitPaise: -100 }],
      })
    );
    expect(negPrice.status).toBe(400);

    const excessiveDiscount = await invoicesPOST(
      makeRequest("http://localhost:3000/api/invoices", "POST", {
        patientId: patient.id,
        discountPaise: 200000,
        items: [{ description: "Scaling", quantity: 1, unitPaise: 150000 }],
      })
    );
    expect(excessiveDiscount.status).toBe(400);
    expect((await excessiveDiscount.json()).error).toContain(
      "Discount cannot exceed the invoice subtotal"
    );

    const excessivePctDiscount = await invoicesPOST(
      makeRequest("http://localhost:3000/api/invoices", "POST", {
        patientId: patient.id,
        discountPercent: 120,
        items: [{ description: "Scaling", quantity: 1, unitPaise: 150000 }],
      })
    );
    expect(excessivePctDiscount.status).toBe(400);
  });

  it("TC-031: Update an invoice's line items, discount, and tax and verify recalculated totals and cancellation rules", async () => {
    const createRes = await invoicesPOST(
      makeRequest("http://localhost:3000/api/invoices", "POST", {
        patientId: patient.id,
        discountPaise: 0,
        taxPaise: 0,
        items: [{ description: "Initial Scaling", quantity: 1, unitPaise: 150000 }],
      })
    );
    const inv = await createRes.json();
    expect(inv.totalPaise).toBe(150000);

    // Update invoice with 2 line items, ₹250.00 discount, and ₹100.00 tax
    const updateRes = await invoicePATCH(
      makeRequest(`http://localhost:3000/api/invoices/${inv.id}`, "PATCH", {
        discountPaise: 25000,
        taxPaise: 10000,
        items: [
          { description: "Initial Scaling", quantity: 1, unitPaise: 150000 },
          { description: "Fluoride Varnish Application", quantity: 1, unitPaise: 100000 },
        ],
      }),
      { params: Promise.resolve({ id: inv.id }) }
    );
    expect(updateRes.status).toBe(200);
    const updated = await updateRes.json();
    // 250000 - 25000 + 10000 = 235000
    expect(updated.totalPaise).toBe(235000);
    expect(updated.discountPaise).toBe(25000);
    expect(updated.taxPaise).toBe(10000);
    expect(updated.items.length).toBe(2);

    // Cancel unpaid invoice -> transitions to CANCELLED
    const cancelRes = await invoicePATCH(
      makeRequest(`http://localhost:3000/api/invoices/${inv.id}`, "PATCH", {
        status: "CANCELLED",
      }),
      { params: Promise.resolve({ id: inv.id }) }
    );
    expect(cancelRes.status).toBe(200);
    expect((await cancelRes.json()).status).toBe("CANCELLED");
  });

  it("TC-032: Verify invoice persistence, financialSummary invariants, patient relationship, and Google Sheets serialization", async () => {
    const createRes = await invoicesPOST(
      makeRequest("http://localhost:3000/api/invoices", "POST", {
        patientId: patient.id,
        discountPaise: 50000,
        taxPaise: 25000,
        items: [
          { description: "Implant Fixture Placement", quantity: 1, unitPaise: 1250075 },
        ],
      })
    );
    const inv = await createRes.json();
    // 1250075 - 50000 + 25000 = 1225075
    expect(inv.totalPaise).toBe(1225075);

    const getRes = await invoiceDetailGET(
      makeRequest(`http://localhost:3000/api/invoices/${inv.id}`),
      { params: Promise.resolve({ id: inv.id }) }
    );
    expect(getRes.status).toBe(200);
    const detail = await getRes.json();
    expect(detail.financialSummary.invariantsValid).toBe(true);
    expect(detail.financialSummary.subtotalPaise).toBe(1250075);
    expect(detail.financialSummary.totalPaise).toBe(1225075);
    expect(detail.financialSummary.outstandingPaise).toBe(1225075);

    const syncJob = await db.syncQueue.findFirst({
      where: { entity: "Invoice", entityId: inv.id },
    });
    expect(syncJob?.status).toBe("PENDING");

    const sheetRow = buildSheetRecord("Invoice", detail);
    expect(sheetRow.values[5]).toBe(1225075);
    expect(sheetRow.values[6]).toBe(0);
    expect(sheetRow.values[7]).toBe("PENDING");
  });
});

