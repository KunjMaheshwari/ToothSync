import { describe, expect, it, vi, beforeEach } from "vitest";

let mockToken = "";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "dentalcare_session" && mockToken
        ? { value: mockToken }
        : undefined,
  }),
}));

import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import {
  auditInvoiceRecord,
  calculateInvoiceTotals,
  formatINR,
} from "@/lib/finance";
import { POST as postPatient } from "@/app/api/patients/route";
import { POST as postInvoice } from "@/app/api/invoices/route";
import {
  GET as getInvoiceById,
  PATCH as patchInvoiceById,
} from "@/app/api/invoices/[id]/route";
import { POST as postPayment } from "@/app/api/invoices/[id]/payments/route";
import { GET as getDashboard } from "@/app/api/dashboard/route";

describe("Financial calculation engine & INR formatting", () => {
  it("formats paise into Indian Rupee notation without hiding exact paise", () => {
    expect(formatINR(10050)).toBe("₹100.50");
    expect(formatINR(12500000)).toBe("₹1,25,000.00");
    expect(formatINR(0)).toBe("₹0.00");
    expect(formatINR(99)).toBe("₹0.99");
  });

  it("computes subtotal, fixed/percentage discounts, and fixed/percentage taxes in integer paise", () => {
    const fixed = calculateInvoiceTotals({
      items: [
        { quantity: 2, unitPaise: 150050 }, // 300100
        { quantity: 1, unitPaise: 49950 }, // 49950
      ],
      discountPaise: 50050,
      taxPaise: 54000,
    });
    expect(fixed.subtotalPaise).toBe(350050);
    expect(fixed.discountPaise).toBe(50050);
    expect(fixed.taxPaise).toBe(54000);
    expect(fixed.totalPaise).toBe(354000); // 350050 - 50050 + 54000
    expect(fixed.initialStatus).toBe("PENDING");

    const pct = calculateInvoiceTotals({
      items: [{ quantity: 1, unitPaise: 333300 }], // ₹3,333.00
      discountPercent: 12.5, // 333300 * 0.125 = 41662.5 -> 41663 paise
      taxPercent: 18, // (333300 - 41663) * 0.18 = 291637 * 0.18 = 52494.66 -> 52495 paise
    });
    expect(pct.subtotalPaise).toBe(333300);
    expect(pct.discountPaise).toBe(41663);
    expect(pct.taxPaise).toBe(52495);
    expect(pct.totalPaise).toBe(333300 - 41663 + 52495);
  });

  it("rejects discounts that exceed the invoice subtotal", () => {
    expect(() =>
      calculateInvoiceTotals({
        items: [{ quantity: 1, unitPaise: 100000 }],
        discountPaise: 100001,
      })
    ).toThrow("Discount cannot exceed the invoice subtotal");
  });
});

describe("Comprehensive 14-scenario Billing & Payment Integration Audit", () => {
  const headers = {
    "content-type": "application/json",
    host: "clinic.test",
    origin: "http://clinic.test",
  };

  beforeEach(async () => {
    mockToken = await createSession();
  });

  async function inspectAndVerifyInvoice(invoiceId: string) {
    const res = await getInvoiceById(
      new Request(`http://clinic.test/api/invoices/${invoiceId}`),
      { params: Promise.resolve({ id: invoiceId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    const audit = auditInvoiceRecord(data);
    expect(audit.invariantsValid).toBe(true);
    expect(audit.violations).toEqual([]);
    expect(data.totalPaise).toBe(
      audit.subtotalPaise - audit.discountPaise + audit.taxPaise
    );
    expect(data.paidPaise).toBe(audit.paidPaise);
    return { data, audit };
  }

  it("executes all 14 billing, payment, idempotency, concurrency, and cancellation scenarios while preserving invariants", async () => {
    // Create an isolated patient in test.db
    const patRes = await postPatient(
      new Request("http://clinic.test/api/patients", {
        method: "POST",
        headers,
        body: JSON.stringify({
          firstName: "Finance",
          lastName: "AuditPatient",
          phone: `+91 91111${String(Math.floor(10000 + Math.random() * 89999))}`,
          consented: true,
        }),
      })
    );
    expect(patRes.status).toBe(201);
    const patient = await patRes.json();

    // SCENARIO 1: Create an invoice with one treatment
    const inv1Res = await postInvoice(
      new Request("http://clinic.test/api/invoices", {
        method: "POST",
        headers,
        body: JSON.stringify({
          patientId: patient.id,
          discountPaise: 0,
          taxPaise: 0,
          items: [
            {
              description: "Single Root Canal Treatment",
              quantity: 1,
              unitPaise: 250050, // ₹2,500.50
            },
          ],
        }),
      })
    );
    expect(inv1Res.status).toBe(201);
    const inv1 = await inv1Res.json();
    const check1 = await inspectAndVerifyInvoice(inv1.id);
    expect(check1.audit.subtotalPaise).toBe(250050);
    expect(check1.audit.totalPaise).toBe(250050);
    expect(check1.audit.paidPaise).toBe(0);
    expect(check1.audit.outstandingPaise).toBe(250050);
    expect(check1.audit.status).toBe("PENDING");

    // SCENARIO 2 & 3: Create an invoice with multiple treatments, discount, and tax
    const inv2Res = await postInvoice(
      new Request("http://clinic.test/api/invoices", {
        method: "POST",
        headers,
        body: JSON.stringify({
          patientId: patient.id,
          discountPaise: 50000, // ₹500.00
          taxPaise: 18000, // ₹180.00
          items: [
            { description: "Zirconia Crown", quantity: 2, unitPaise: 450000 }, // ₹9,000.00
            { description: "Ultrasonic Scaling", quantity: 1, unitPaise: 150000 }, // ₹1,500.00
          ],
        }),
      })
    );
    expect(inv2Res.status).toBe(201);
    const inv2 = await inv2Res.json();
    const check2 = await inspectAndVerifyInvoice(inv2.id);
    expect(check2.audit.subtotalPaise).toBe(1050000);
    expect(check2.audit.discountPaise).toBe(50000);
    expect(check2.audit.taxPaise).toBe(18000);
    expect(check2.audit.totalPaise).toBe(1018000); // 1050000 - 50000 + 18000
    expect(check2.audit.outstandingPaise).toBe(1018000);
    expect(check2.audit.status).toBe("PENDING");

    // SCENARIO 4: Record a first partial payment (₹4,000.00 = 400000 paise)
    const pay1Res = await postPayment(
      new Request(`http://clinic.test/api/invoices/${inv2.id}/payments`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          amountPaise: 400000,
          method: "UPI",
          reference: "UPI-REF-001",
        }),
      }),
      { params: Promise.resolve({ id: inv2.id }) }
    );
    expect(pay1Res.status).toBe(201);
    const pay1 = await pay1Res.json();
    const check4 = await inspectAndVerifyInvoice(inv2.id);
    expect(check4.audit.paidPaise).toBe(400000);
    expect(check4.audit.outstandingPaise).toBe(618000);
    expect(check4.audit.status).toBe("PARTIAL");

    // SCENARIO 5: Record a second partial payment (₹3,000.00 = 300000 paise)
    const pay2Res = await postPayment(
      new Request(`http://clinic.test/api/invoices/${inv2.id}/payments`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          amountPaise: 300000,
          method: "CARD",
          reference: "CARD-REF-002",
        }),
      }),
      { params: Promise.resolve({ id: inv2.id }) }
    );
    expect(pay2Res.status).toBe(201);
    const check5 = await inspectAndVerifyInvoice(inv2.id);
    expect(check5.audit.paidPaise).toBe(700000);
    expect(check5.audit.outstandingPaise).toBe(318000);
    expect(check5.audit.status).toBe("PARTIAL");

    // SCENARIO 11: Attempt to submit the same payment twice (Idempotency & duplicate reference guard)
    const dupRefRes = await postPayment(
      new Request(`http://clinic.test/api/invoices/${inv2.id}/payments`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          amountPaise: 400000,
          method: "UPI",
          reference: "UPI-REF-001",
        }),
      }),
      { params: Promise.resolve({ id: inv2.id }) }
    );
    expect(dupRefRes.status).toBe(200);
    const dupPayment = await dupRefRes.json();
    expect(dupPayment.id).toBe(pay1.id);
    const checkAfterDup = await inspectAndVerifyInvoice(inv2.id);
    expect(checkAfterDup.audit.paidPaise).toBe(700000); // Unchanged!

    // SCENARIO 7: Attempt to record an excessive payment (318001 > 318000 remaining)
    const overpayRes = await postPayment(
      new Request(`http://clinic.test/api/invoices/${inv2.id}/payments`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          amountPaise: 318001,
          method: "CASH",
        }),
      }),
      { params: Promise.resolve({ id: inv2.id }) }
    );
    expect(overpayRes.status).toBe(400);
    expect((await overpayRes.json()).error).toContain("exceeds the outstanding");
    const checkAfterOverpay = await inspectAndVerifyInvoice(inv2.id);
    expect(checkAfterOverpay.audit.paidPaise).toBe(700000);

    // SCENARIO 8: Attempt to record a negative payment
    const negRes = await postPayment(
      new Request(`http://clinic.test/api/invoices/${inv2.id}/payments`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          amountPaise: -1000,
          method: "CASH",
        }),
      }),
      { params: Promise.resolve({ id: inv2.id }) }
    );
    expect(negRes.status).toBe(400);

    // SCENARIO 9: Attempt to record a zero payment
    const zeroRes = await postPayment(
      new Request(`http://clinic.test/api/invoices/${inv2.id}/payments`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          amountPaise: 0,
          method: "CASH",
        }),
      }),
      { params: Promise.resolve({ id: inv2.id }) }
    );
    expect(zeroRes.status).toBe(400);

    // SCENARIO 10: Attempt to record an invalid payment method
    const invalidMethodRes = await postPayment(
      new Request(`http://clinic.test/api/invoices/${inv2.id}/payments`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          amountPaise: 5000,
          method: "BITCOIN",
        }),
      }),
      { params: Promise.resolve({ id: inv2.id }) }
    );
    expect(invalidMethodRes.status).toBe(400);

    // SCENARIO 6: Pay the exact remaining balance (318000 paise) with idempotencyKey
    const pay3Res = await postPayment(
      new Request(`http://clinic.test/api/invoices/${inv2.id}/payments`, {
        method: "POST",
        headers: { ...headers, "x-idempotency-key": "idem-final-pay-inv2" },
        body: JSON.stringify({
          amountPaise: 318000,
          method: "CASH",
          idempotencyKey: "idem-final-pay-inv2",
        }),
      }),
      { params: Promise.resolve({ id: inv2.id }) }
    );
    expect(pay3Res.status).toBe(201);
    const pay3 = await pay3Res.json();
    const check6 = await inspectAndVerifyInvoice(inv2.id);
    expect(check6.audit.paidPaise).toBe(1018000);
    expect(check6.audit.outstandingPaise).toBe(0);
    expect(check6.audit.status).toBe("PAID");
    expect(check6.data.payments.length).toBe(3);

    // Retry same idempotencyKey even after invoice is PAID -> returns 200 OK with original payment
    const retryIdemRes = await postPayment(
      new Request(`http://clinic.test/api/invoices/${inv2.id}/payments`, {
        method: "POST",
        headers: { ...headers, "x-idempotency-key": "idem-final-pay-inv2" },
        body: JSON.stringify({
          amountPaise: 318000,
          method: "CASH",
          idempotencyKey: "idem-final-pay-inv2",
        }),
      }),
      { params: Promise.resolve({ id: inv2.id }) }
    );
    expect(retryIdemRes.status).toBe(200);
    expect((await retryIdemRes.json()).id).toBe(pay3.id);

    // New non-idempotent payment on PAID invoice -> rejected with 400
    const extraPayRes = await postPayment(
      new Request(`http://clinic.test/api/invoices/${inv2.id}/payments`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          amountPaise: 100,
          method: "CASH",
        }),
      }),
      { params: Promise.resolve({ id: inv2.id }) }
    );
    expect(extraPayRes.status).toBe(400);

    // SCENARIO 12: Concurrent payments against the same invoice
    // Two concurrent 60,000 paise payments against a 100,000 paise invoice -> exactly 1 succeeds and 1 fails with OVERPAY
    const invConcurrentRes = await postInvoice(
      new Request("http://clinic.test/api/invoices", {
        method: "POST",
        headers,
        body: JSON.stringify({
          patientId: patient.id,
          discountPaise: 0,
          taxPaise: 0,
          items: [{ description: "Concurrency Test", quantity: 1, unitPaise: 100000 }],
        }),
      })
    );
    const invConc = await invConcurrentRes.json();

    const [concA, concB] = await Promise.all([
      postPayment(
        new Request(`http://clinic.test/api/invoices/${invConc.id}/payments`, {
          method: "POST",
          headers,
          body: JSON.stringify({ amountPaise: 60000, method: "UPI" }),
        }),
        { params: Promise.resolve({ id: invConc.id }) }
      ),
      postPayment(
        new Request(`http://clinic.test/api/invoices/${invConc.id}/payments`, {
          method: "POST",
          headers,
          body: JSON.stringify({ amountPaise: 60000, method: "CARD" }),
        }),
        { params: Promise.resolve({ id: invConc.id }) }
      ),
    ]);

    const statuses = [concA.status, concB.status].sort();
    expect(statuses).toEqual([201, 400]);
    const checkConc = await inspectAndVerifyInvoice(invConc.id);
    expect(checkConc.audit.paidPaise).toBe(60000);
    expect(checkConc.audit.outstandingPaise).toBe(40000);
    expect(checkConc.audit.status).toBe("PARTIAL");

    // SCENARIO 13: Cancel unpaid invoice & attempt to pay a cancelled invoice
    // First verify paid invoice cannot be cancelled
    const cancelPaidRes = await patchInvoiceById(
      new Request(`http://clinic.test/api/invoices/${inv2.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "CANCELLED" }),
      }),
      { params: Promise.resolve({ id: inv2.id }) }
    );
    expect(cancelPaidRes.status).toBe(400);

    // Cancel unpaid inv1 (from Scenario 1)
    const cancelUnpaidRes = await patchInvoiceById(
      new Request(`http://clinic.test/api/invoices/${inv1.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "CANCELLED" }),
      }),
      { params: Promise.resolve({ id: inv1.id }) }
    );
    expect(cancelUnpaidRes.status).toBe(200);
    const checkCancelled = await inspectAndVerifyInvoice(inv1.id);
    expect(checkCancelled.audit.status).toBe("CANCELLED");
    expect(checkCancelled.audit.outstandingPaise).toBe(0);

    // Attempt to pay cancelled inv1 -> rejected with 400
    const payCancelledRes = await postPayment(
      new Request(`http://clinic.test/api/invoices/${inv1.id}/payments`, {
        method: "POST",
        headers,
        body: JSON.stringify({ amountPaise: 10000, method: "CASH" }),
      }),
      { params: Promise.resolve({ id: inv1.id }) }
    );
    expect(payCancelledRes.status).toBe(400);
    expect((await payCancelledRes.json()).error).toContain("cancelled invoice");

    // SCENARIO 14: Verify Dashboard financial aggregation excludes cancelled invoices
    const dashRes = await getDashboard();
    expect(dashRes.status).toBe(200);
    const dash = await dashRes.json();
    expect(dash.pending).toBeGreaterThanOrEqual(40000);
  });
});

