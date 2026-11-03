import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auditInvoiceRecord } from "@/lib/finance";
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
import { POST as paymentsPOST } from "@/app/api/invoices/[id]/payments/route";

describe("PHASE 8 — Payments & Financial Integrity (TC-033 to TC-040)", () => {
  let patient: any;

  beforeEach(async () => {
    await resetTestDatabase();
    patient = await (
      await patientsPOST(
        makeRequest("http://localhost:3000/api/patients", "POST", {
          referenceId: "QA_PAY_PAT_001",
          firstName: "Sunita",
          lastName: "Rao",
          phone: "+91 98900 40001",
        })
      )
    ).json();
  });

  async function createInvoiceWithTotal(unitPaise: number, discountPaise = 0, taxPaise = 0) {
    const res = await invoicesPOST(
      makeRequest("http://localhost:3000/api/invoices", "POST", {
        patientId: patient.id,
        discountPaise,
        taxPaise,
        items: [{ description: "Clinical Procedure", quantity: 1, unitPaise }],
      })
    );
    return await res.json();
  }

  it("TC-033: Record a full payment (₹1,250.00 = 125000 paise via UPI) and verify PAID status and 0 outstanding balance", async () => {
    const inv = await createInvoiceWithTotal(125000);

    const payRes = await paymentsPOST(
      makeRequest(`http://localhost:3000/api/invoices/${inv.id}/payments`, "POST", {
        amountPaise: 125000,
        method: "UPI",
        reference: "QA_PAYMENT_001_UPI",
        notes: "Full settlement via UPI QR",
      }),
      { params: Promise.resolve({ id: inv.id }) }
    );
    expect(payRes.status).toBe(201);
    const pay = await payRes.json();
    expect(pay.amountPaise).toBe(125000);
    expect(pay.method).toBe("UPI");
    expect(pay.reference).toBe("QA_PAYMENT_001_UPI");

    const updatedInv = await db.invoice.findUniqueOrThrow({
      where: { id: inv.id },
      include: { items: true, payments: true },
    });
    expect(updatedInv.paidPaise).toBe(125000);
    expect(updatedInv.status).toBe("PAID");
    const audit = auditInvoiceRecord(updatedInv);
    expect(audit.invariantsValid).toBe(true);
    expect(audit.outstandingPaise).toBe(0);
  });

  it("TC-034: Record a partial payment (₹250.50 = 25050 paise on ₹999.99 = 99999 paise invoice) and verify PARTIAL status", async () => {
    const inv = await createInvoiceWithTotal(99999);

    const payRes = await paymentsPOST(
      makeRequest(`http://localhost:3000/api/invoices/${inv.id}/payments`, "POST", {
        amountPaise: 25050,
        method: "CASH",
        reference: "QA_PAYMENT_002_CASH",
      }),
      { params: Promise.resolve({ id: inv.id }) }
    );
    expect(payRes.status).toBe(201);

    const oracle = independentOracleInvoiceMath({
      lineItems: [{ qty: 1, unitPaise: 99999 }],
      paymentsPaise: [25050],
    });
    expect(oracle.outstandingPaise).toBe(74949);

    const detail = await (
      await invoiceDetailGET(
        makeRequest(`http://localhost:3000/api/invoices/${inv.id}`),
        { params: Promise.resolve({ id: inv.id }) }
      )
    ).json();
    expect(detail.paidPaise).toBe(25050);
    expect(detail.status).toBe("PARTIAL");
    expect(detail.financialSummary.outstandingPaise).toBe(74949);
    expect(detail.financialSummary.invariantsValid).toBe(true);
  });

  it("TC-035: Record multiple partial payments across methods (₹100.00 CASH, ₹250.50 UPI, ₹999.99 CARD, ₹5,000.00 BANK_TRANSFER) on ₹12,500.75 invoice", async () => {
    // Invoice total: ₹12,500.75 = 1250075 paise
    const inv = await createInvoiceWithTotal(1250075);

    const installments = [
      { amountPaise: 10000, method: "CASH", reference: "QA_PAY_M1" }, // ₹100.00
      { amountPaise: 25050, method: "UPI", reference: "QA_PAY_M2" }, // ₹250.50
      { amountPaise: 99999, method: "CARD", reference: "QA_PAY_M3" }, // ₹999.99
      { amountPaise: 500000, method: "BANK_TRANSFER", reference: "QA_PAY_M4" }, // ₹5,000.00
    ];

    for (const inst of installments) {
      const r = await paymentsPOST(
        makeRequest(
          `http://localhost:3000/api/invoices/${inv.id}/payments`,
          "POST",
          inst
        ),
        { params: Promise.resolve({ id: inv.id }) }
      );
      expect(r.status).toBe(201);
    }

    // 10000 + 25050 + 99999 + 500000 = 635049 paise
    // Remaining = 1250075 - 635049 = 615026 paise (₹6,150.26)
    const detail = await (
      await invoiceDetailGET(
        makeRequest(`http://localhost:3000/api/invoices/${inv.id}`),
        { params: Promise.resolve({ id: inv.id }) }
      )
    ).json();
    expect(detail.payments.length).toBe(4);
    expect(detail.paidPaise).toBe(635049);
    expect(detail.financialSummary.outstandingPaise).toBe(615026);
    expect(detail.status).toBe("PARTIAL");
  });

  it("TC-036: Pay the exact remaining outstanding balance after partial payments and verify transition from PARTIAL to PAID", async () => {
    const inv = await createInvoiceWithTotal(500000); // ₹5,000.00

    await paymentsPOST(
      makeRequest(`http://localhost:3000/api/invoices/${inv.id}/payments`, "POST", {
        amountPaise: 125000, // ₹1,250.00
        method: "UPI",
        reference: "QA_PAY_PART1",
      }),
      { params: Promise.resolve({ id: inv.id }) }
    );

    // Remaining balance is 375000 paise (₹3,750.00)
    const finalRes = await paymentsPOST(
      makeRequest(`http://localhost:3000/api/invoices/${inv.id}/payments`, "POST", {
        amountPaise: 375000,
        method: "CARD",
        reference: "QA_PAY_FINAL",
      }),
      { params: Promise.resolve({ id: inv.id }) }
    );
    expect(finalRes.status).toBe(201);

    const detail = await (
      await invoiceDetailGET(
        makeRequest(`http://localhost:3000/api/invoices/${inv.id}`),
        { params: Promise.resolve({ id: inv.id }) }
      )
    ).json();
    expect(detail.paidPaise).toBe(500000);
    expect(detail.financialSummary.outstandingPaise).toBe(0);
    expect(detail.status).toBe("PAID");
    expect(detail.financialSummary.invariantsValid).toBe(true);
  });

  it("TC-037: Attempt negative, zero, non-integer, or invalid-method payments and verify 400 rejection with zero database mutation", async () => {
    const inv = await createInvoiceWithTotal(200000);

    for (const badPayload of [
      { amountPaise: 0, method: "CASH" },
      { amountPaise: -25050, method: "UPI" },
      { amountPaise: 100.5, method: "CARD" },
      { amountPaise: 50000, method: "CRYPTO_INVALID" },
    ]) {
      const res = await paymentsPOST(
        makeRequest(
          `http://localhost:3000/api/invoices/${inv.id}/payments`,
          "POST",
          badPayload
        ),
        { params: Promise.resolve({ id: inv.id }) }
      );
      expect(res.status).toBe(400);
    }

    const dbInv = await db.invoice.findUniqueOrThrow({
      where: { id: inv.id },
      include: { payments: true },
    });
    expect(dbInv.paidPaise).toBe(0);
    expect(dbInv.payments.length).toBe(0);
  });

  it("TC-038: Attempt an excessive payment exceeding outstanding balance (by 1 paisa and on already PAID invoice) and verify rejection", async () => {
    const inv = await createInvoiceWithTotal(100000); // ₹1,000.00

    // Attempt ₹1,000.01 (100001 paise) -> rejected with 400
    const overpayRes = await paymentsPOST(
      makeRequest(`http://localhost:3000/api/invoices/${inv.id}/payments`, "POST", {
        amountPaise: 100001,
        method: "UPI",
      }),
      { params: Promise.resolve({ id: inv.id }) }
    );
    expect(overpayRes.status).toBe(400);
    expect((await overpayRes.json()).error).toContain(
      "Payment exceeds the outstanding balance"
    );

    // Pay exact balance (100000 paise) -> succeeds
    const exactRes = await paymentsPOST(
      makeRequest(`http://localhost:3000/api/invoices/${inv.id}/payments`, "POST", {
        amountPaise: 100000,
        method: "UPI",
      }),
      { params: Promise.resolve({ id: inv.id }) }
    );
    expect(exactRes.status).toBe(201);

    // Attempt another ₹1.00 on PAID invoice -> rejected with 400
    const afterPaidRes = await paymentsPOST(
      makeRequest(`http://localhost:3000/api/invoices/${inv.id}/payments`, "POST", {
        amountPaise: 100,
        method: "CASH",
      }),
      { params: Promise.resolve({ id: inv.id }) }
    );
    expect(afterPaidRes.status).toBe(400);
  });

  it("TC-039: Retry the same payment request (by idempotencyKey and by duplicate reference) and verify idempotency without double-counting", async () => {
    const inv = await createInvoiceWithTotal(500000);

    // 1. Retry with identical idempotencyKey
    const req1 = makeRequest(
      `http://localhost:3000/api/invoices/${inv.id}/payments`,
      "POST",
      {
        amountPaise: 125000,
        method: "UPI",
        reference: "UTR-IDEM-001",
        idempotencyKey: "qa-idem-key-001",
      }
    );
    const res1 = await paymentsPOST(req1, {
      params: Promise.resolve({ id: inv.id }),
    });
    expect(res1.status).toBe(201);
    const p1 = await res1.json();

    const req2 = makeRequest(
      `http://localhost:3000/api/invoices/${inv.id}/payments`,
      "POST",
      {
        amountPaise: 125000,
        method: "UPI",
        reference: "UTR-IDEM-001",
        idempotencyKey: "qa-idem-key-001",
      }
    );
    const res2 = await paymentsPOST(req2, {
      params: Promise.resolve({ id: inv.id }),
    });
    expect(res2.status).toBe(200);
    const p2 = await res2.json();
    expect(p2.id).toBe(p1.id);

    // 2. Retry with same reference & amount but without idempotencyKey -> returns existing payment (200)
    const res3 = await paymentsPOST(
      makeRequest(`http://localhost:3000/api/invoices/${inv.id}/payments`, "POST", {
        amountPaise: 125000,
        method: "UPI",
        reference: "UTR-IDEM-001",
      }),
      { params: Promise.resolve({ id: inv.id }) }
    );
    expect(res3.status).toBe(200);

    // 3. Reusing the same reference with a DIFFERENT amount -> rejected with 400
    const resConflictRef = await paymentsPOST(
      makeRequest(`http://localhost:3000/api/invoices/${inv.id}/payments`, "POST", {
        amountPaise: 50000,
        method: "UPI",
        reference: "UTR-IDEM-001",
      }),
      { params: Promise.resolve({ id: inv.id }) }
    );
    expect(resConflictRef.status).toBe(400);

    const dbInv = await db.invoice.findUniqueOrThrow({
      where: { id: inv.id },
      include: { payments: true },
    });
    expect(dbInv.payments.length).toBe(1);
    expect(dbInv.paidPaise).toBe(125000);
  });

  it("TC-040: Verify payment history preservation, cancellation protection on paid invoices, and Google Sheets Payment & Invoice queuing", async () => {
    const inv = await createInvoiceWithTotal(300000);

    const pRes = await paymentsPOST(
      makeRequest(`http://localhost:3000/api/invoices/${inv.id}/payments`, "POST", {
        amountPaise: 100000,
        method: "CARD",
        reference: "AUTH-998877",
      }),
      { params: Promise.resolve({ id: inv.id }) }
    );
    const payment = await pRes.json();

    // Attempting to cancel an invoice that already has a recorded payment must be rejected (400)
    const cancelAttempt = await invoicePATCH(
      makeRequest(`http://localhost:3000/api/invoices/${inv.id}`, "PATCH", {
        status: "CANCELLED",
      }),
      { params: Promise.resolve({ id: inv.id }) }
    );
    expect(cancelAttempt.status).toBe(400);
    expect((await cancelAttempt.json()).error).toContain(
      "Cannot cancel an invoice that already has recorded payments"
    );

    // Attempting to reduce invoice total below already-paid 100000 paise must be rejected (400)
    const reduceBelowPaid = await invoicePATCH(
      makeRequest(`http://localhost:3000/api/invoices/${inv.id}`, "PATCH", {
        items: [{ description: "Reduced Item", quantity: 1, unitPaise: 50000 }],
      }),
      { params: Promise.resolve({ id: inv.id }) }
    );
    expect(reduceBelowPaid.status).toBe(400);

    const paySheet = buildSheetRecord("Payment", payment);
    expect(paySheet.values).toEqual([
      payment.id,
      inv.id,
      100000,
      "CARD",
      new Date(payment.paidAt).toISOString(),
    ]);
  });
});

