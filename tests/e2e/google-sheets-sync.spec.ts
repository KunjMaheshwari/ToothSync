import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import {
  reconcileEntitySheet,
  syncRecordToSheets,
} from "@/lib/sheets";
import { loadSyncRecord } from "@/lib/sync-record";
import {
  createSheetsTestHarness,
  makeRequest,
  resetTestDatabase,
} from "./helpers";

vi.mock("@/lib/auth", () => ({
  isAuthenticated: vi.fn(async () => true),
}));

import { POST as patientsPOST } from "@/app/api/patients/route";
import { PATCH as patientPATCH } from "@/app/api/patients/[id]/route";
import { POST as appointmentsPOST } from "@/app/api/appointments/route";
import { POST as treatmentsPOST } from "@/app/api/treatments/route";
import { POST as prescriptionsPOST } from "@/app/api/prescriptions/route";
import { POST as invoicesPOST } from "@/app/api/invoices/route";
import { POST as paymentsPOST } from "@/app/api/invoices/[id]/payments/route";

describe("PHASE 9 & 10 — Google Sheets Synchronization & Live Reconciliation (TC-041 to TC-050)", () => {
  let harness: ReturnType<typeof createSheetsTestHarness>;

  beforeEach(async () => {
    await resetTestDatabase();
    harness = createSheetsTestHarness();
  });

  async function drainSyncQueueToHarness() {
    const jobs = await db.syncQueue.findMany({
      where: { status: { in: ["PENDING", "FAILED"] } },
      orderBy: { updatedAt: "asc" },
    });
    for (const job of jobs) {
      try {
        const record = await loadSyncRecord(job.entity, job.entityId);
        await syncRecordToSheets(job.entity, record, harness.client);
        await db.syncQueue.update({
          where: { id: job.id },
          data: {
            status: "SYNCED",
            attempts: job.attempts + 1,
            lastError: null,
          },
        });
      } catch (err) {
        const attempts = job.attempts + 1;
        await db.syncQueue.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            attempts,
            lastError: err instanceof Error ? err.message : "Sync error",
          },
        });
      }
    }
  }

  it("TC-041: Create a patient and verify the corresponding Google Sheets row and 16-column mapping", async () => {
    const pat = await (
      await patientsPOST(
        makeRequest("http://localhost:3000/api/patients", "POST", {
          referenceId: "QA_GS_PAT_001",
          firstName: "Aditi",
          lastName: "Sharma",
          phone: "+91 97000 50001",
          email: "aditi.sharma.gs001@example.test",
          dateOfBirth: "1992-08-19",
          gender: "Female",
          city: "Jaipur",
          allergies: "Penicillin",
          conditions: "Asthma",
          dentalHistory: "Scaling 2024",
          consented: true,
        })
      )
    ).json();

    await drainSyncQueueToHarness();

    const rows = harness.tabs.get("Patients")!;
    expect(rows.length).toBe(2); // 1 header + 1 data row
    const dbPat = await db.patient.findUniqueOrThrow({ where: { id: pat.id } });
    const rec = reconcileEntitySheet("Patient", [dbPat], rows);
    expect(rec.pass).toBe(true);
    expect(rec.matchedCount).toBe(1);
    expect(rows[1][0]).toBe(pat.id);
    expect(rows[1][1]).toBe(pat.patientId);
    expect(rows[1][2]).toBe("QA_GS_PAT_001");
  });

  it("TC-042: Update a patient and verify that the existing Google Sheets row is updated in-place without duplication", async () => {
    const pat = await (
      await patientsPOST(
        makeRequest("http://localhost:3000/api/patients", "POST", {
          referenceId: "QA_GS_PAT_002",
          firstName: "Vivek",
          lastName: "Bansal",
          phone: "+91 97000 50002",
          city: "Surat",
        })
      )
    ).json();
    await drainSyncQueueToHarness();
    expect(harness.tabs.get("Patients")?.length).toBe(2);

    await patientPATCH(
      makeRequest(`http://localhost:3000/api/patients/${pat.id}`, "PATCH", {
        city: "Vadodara",
        allergies: "Aspirin",
      }),
      { params: Promise.resolve({ id: pat.id }) }
    );
    await drainSyncQueueToHarness();

    const rows = harness.tabs.get("Patients")!;
    expect(rows.length).toBe(2); // Updated in place, NOT 3 rows!
    const dbPat = await db.patient.findUniqueOrThrow({ where: { id: pat.id } });
    const rec = reconcileEntitySheet("Patient", [dbPat], rows);
    expect(rec.pass).toBe(true);
    expect(rows[1][9]).toBe("Vadodara");
    expect(rows[1][10]).toBe("Aspirin");
  });

  it("TC-043: Create an appointment and verify its patient relationship and ISO timestamps in Google Sheets", async () => {
    const pat = await (
      await patientsPOST(
        makeRequest("http://localhost:3000/api/patients", "POST", {
          referenceId: "QA_GS_PAT_003",
          firstName: "Gaurav",
          lastName: "Mehta",
          phone: "+91 97000 50003",
        })
      )
    ).json();

    const appt = await (
      await appointmentsPOST(
        makeRequest("http://localhost:3000/api/appointments", "POST", {
          patientId: pat.id,
          type: "Root Canal",
          startsAt: "2026-12-05T09:00:00.000Z",
          endsAt: "2026-12-05T09:45:00.000Z",
        })
      )
    ).json();

    await drainSyncQueueToHarness();

    const rows = harness.tabs.get("Appointments")!;
    expect(rows.length).toBe(2);
    const dbAppt = await db.appointment.findUniqueOrThrow({
      where: { id: appt.id },
      include: { patient: true },
    });
    const rec = reconcileEntitySheet("Appointment", [dbAppt], rows);
    expect(rec.pass).toBe(true);
    expect(rows[1][1]).toBe(pat.id);
    expect(rows[1][2]).toBe("Gaurav Mehta");
  });

  it("TC-044: Create a treatment and verify all 9 mapped columns including integer Cost Paise in Google Sheets", async () => {
    const pat = await (
      await patientsPOST(
        makeRequest("http://localhost:3000/api/patients", "POST", {
          referenceId: "QA_GS_PAT_004",
          firstName: "Priya",
          lastName: "Menon",
          phone: "+91 97000 50004",
        })
      )
    ).json();

    const trt = await (
      await treatmentsPOST(
        makeRequest("http://localhost:3000/api/treatments", "POST", {
          patientId: pat.id,
          category: "Prosthodontics",
          procedure: "All-Ceramic Crown",
          toothNumber: "#21",
          costPaise: 950000,
          status: "COMPLETED",
          date: "2026-11-04T10:30:00.000Z",
        })
      )
    ).json();

    await drainSyncQueueToHarness();

    const rows = harness.tabs.get("Treatments")!;
    expect(rows.length).toBe(2);
    const dbTrt = await db.treatment.findUniqueOrThrow({
      where: { id: trt.id },
      include: { patient: true },
    });
    const rec = reconcileEntitySheet("Treatment", [dbTrt], rows);
    expect(rec.pass).toBe(true);
    expect(rows[1][7]).toBe(950000);
    expect(rows[1][6]).toBe("#21");
  });

  it("TC-045: Create a prescription and verify serialized medication items and notes in Google Sheets", async () => {
    const pat = await (
      await patientsPOST(
        makeRequest("http://localhost:3000/api/patients", "POST", {
          referenceId: "QA_GS_PAT_005",
          firstName: "Harsh",
          lastName: "Vardhan",
          phone: "+91 97000 50005",
        })
      )
    ).json();

    const rx = await (
      await prescriptionsPOST(
        makeRequest("http://localhost:3000/api/prescriptions", "POST", {
          patientId: pat.id,
          notes: "Review after 5 days",
          items: [
            {
              medication: "Cap. Amoxicillin",
              dosage: "500 mg",
              frequency: "1-1-1",
              duration: "5 days",
            },
            {
              medication: "Tab. Paracetamol",
              dosage: "650 mg",
              frequency: "SOS",
              duration: "3 days",
            },
          ],
        })
      )
    ).json();

    await drainSyncQueueToHarness();

    const rows = harness.tabs.get("Prescriptions")!;
    expect(rows.length).toBe(2);
    const dbRx = await db.prescription.findUniqueOrThrow({
      where: { id: rx.id },
      include: { patient: true, items: true },
    });
    const rec = reconcileEntitySheet("Prescription", [dbRx], rows);
    expect(rec.pass).toBe(true);
    expect(String(rows[1][4])).toContain(
      "Cap. Amoxicillin | 500 mg | 1-1-1 | 5 days; Tab. Paracetamol | 650 mg | SOS | 3 days"
    );
  });

  it("TC-046: Create an invoice and verify authoritative Total Paise, Paid Paise, and Status in Google Sheets", async () => {
    const pat = await (
      await patientsPOST(
        makeRequest("http://localhost:3000/api/patients", "POST", {
          referenceId: "QA_GS_PAT_006",
          firstName: "Lakshmi",
          lastName: "Narayanan",
          phone: "+91 97000 50006",
        })
      )
    ).json();

    const inv = await (
      await invoicesPOST(
        makeRequest("http://localhost:3000/api/invoices", "POST", {
          patientId: pat.id,
          discountPaise: 25000,
          taxPaise: 15000,
          items: [
            { description: "Surgical Extraction", quantity: 1, unitPaise: 500000 },
          ],
        })
      )
    ).json();

    await drainSyncQueueToHarness();

    const rows = harness.tabs.get("Invoices")!;
    expect(rows.length).toBe(2);
    const dbInv = await db.invoice.findUniqueOrThrow({
      where: { id: inv.id },
      include: { patient: true, items: true, payments: true },
    });
    const rec = reconcileEntitySheet("Invoice", [dbInv], rows);
    expect(rec.pass).toBe(true);
    expect(rec.financialSummary).toEqual({
      dbTotalPaise: 490000,
      sheetTotalPaise: 490000,
      dbPaidPaise: 0,
      sheetPaidPaise: 0,
      dbOutstandingPaise: 490000,
      sheetOutstandingPaise: 490000,
      balancesMatch: true,
    });
  });

  it("TC-047: Record a payment and verify its Payment row in Google Sheets with exact paise and invoice relationship", async () => {
    const pat = await (
      await patientsPOST(
        makeRequest("http://localhost:3000/api/patients", "POST", {
          referenceId: "QA_GS_PAT_007",
          firstName: "Deepak",
          lastName: "Chopra",
          phone: "+91 97000 50007",
        })
      )
    ).json();

    const inv = await (
      await invoicesPOST(
        makeRequest("http://localhost:3000/api/invoices", "POST", {
          patientId: pat.id,
          items: [{ description: "Root Canal", quantity: 1, unitPaise: 500000 }],
        })
      )
    ).json();

    const pay = await (
      await paymentsPOST(
        makeRequest(`http://localhost:3000/api/invoices/${inv.id}/payments`, "POST", {
          amountPaise: 125000,
          method: "UPI",
          reference: "GS-PAY-001",
        }),
        { params: Promise.resolve({ id: inv.id }) }
      )
    ).json();

    await drainSyncQueueToHarness();

    const payRows = harness.tabs.get("Payments")!;
    expect(payRows.length).toBe(2);
    const dbPay = await db.payment.findUniqueOrThrow({ where: { id: pay.id } });
    const rec = reconcileEntitySheet("Payment", [dbPay], payRows);
    expect(rec.pass).toBe(true);
    expect(payRows[1][0]).toBe(pay.id);
    expect(payRows[1][1]).toBe(inv.id);
    expect(payRows[1][2]).toBe(125000);
  });

  it("TC-048: Update an invoice after partial and full payments and verify the Google Sheets Invoice row reflects updated Paid Paise and Status", async () => {
    const pat = await (
      await patientsPOST(
        makeRequest("http://localhost:3000/api/patients", "POST", {
          referenceId: "QA_GS_PAT_008",
          firstName: "Kavya",
          lastName: "Madhavan",
          phone: "+91 97000 50008",
        })
      )
    ).json();

    const inv = await (
      await invoicesPOST(
        makeRequest("http://localhost:3000/api/invoices", "POST", {
          patientId: pat.id,
          items: [{ description: "Implant Crown", quantity: 1, unitPaise: 1250075 }],
        })
      )
    ).json();
    await drainSyncQueueToHarness();

    // Partial payment: ₹2,500.75 (250075 paise)
    await paymentsPOST(
      makeRequest(`http://localhost:3000/api/invoices/${inv.id}/payments`, "POST", {
        amountPaise: 250075,
        method: "UPI",
      }),
      { params: Promise.resolve({ id: inv.id }) }
    );
    await drainSyncQueueToHarness();

    let invRows = harness.tabs.get("Invoices")!;
    expect(invRows.length).toBe(2); // Still 1 data row, updated in place
    expect(invRows[1][6]).toBe(250075);
    expect(invRows[1][7]).toBe("PARTIAL");

    // Remaining payment: ₹10,000.00 (1000000 paise)
    await paymentsPOST(
      makeRequest(`http://localhost:3000/api/invoices/${inv.id}/payments`, "POST", {
        amountPaise: 1000000,
        method: "BANK_TRANSFER",
      }),
      { params: Promise.resolve({ id: inv.id }) }
    );
    await drainSyncQueueToHarness();

    invRows = harness.tabs.get("Invoices")!;
    expect(invRows.length).toBe(2);
    expect(invRows[1][6]).toBe(1250075);
    expect(invRows[1][7]).toBe("PAID");

    const dbInv = await db.invoice.findUniqueOrThrow({
      where: { id: inv.id },
      include: { patient: true, items: true, payments: true },
    });
    const rec = reconcileEntitySheet("Invoice", [dbInv], invRows);
    expect(rec.pass).toBe(true);
    expect(rec.financialSummary?.dbOutstandingPaise).toBe(0);
    expect(rec.financialSummary?.sheetOutstandingPaise).toBe(0);
  });

  it("TC-049: Retry the same synchronization multiple times concurrently and sequentially and verify zero duplicate rows", async () => {
    const pat = await (
      await patientsPOST(
        makeRequest("http://localhost:3000/api/patients", "POST", {
          referenceId: "QA_GS_PAT_009",
          firstName: "Manish",
          lastName: "Tiwari",
          phone: "+91 97000 50009",
        })
      )
    ).json();

    const record = await loadSyncRecord("Patient", pat.id);
    // Execute 5 concurrent sync calls + 3 sequential retries for the same record
    await Promise.all([
      syncRecordToSheets("Patient", record, harness.client),
      syncRecordToSheets("Patient", record, harness.client),
      syncRecordToSheets("Patient", record, harness.client),
      syncRecordToSheets("Patient", record, harness.client),
      syncRecordToSheets("Patient", record, harness.client),
    ]);
    await syncRecordToSheets("Patient", record, harness.client);
    await syncRecordToSheets("Patient", record, harness.client);

    const rows = harness.tabs.get("Patients")!;
    expect(rows.length).toBe(2); // 1 header + 1 unique patient row
    const rec = reconcileEntitySheet("Patient", [record], rows);
    expect(rec.pass).toBe(true);
    expect(rec.duplicateIds).toEqual([]);
    expect(rec.unexpectedIds).toEqual([]);
  });

  it("TC-050: Simulate transient Google Sheets failure, verify FAILED status & retry counter, retry sync, and verify eventual consistency & anomaly detection", async () => {
    const pat = await (
      await patientsPOST(
        makeRequest("http://localhost:3000/api/patients", "POST", {
          referenceId: "QA_GS_PAT_010",
          firstName: "Ritika",
          lastName: "Sen",
          phone: "+91 97000 50010",
        })
      )
    ).json();

    // Inject 1 transient API failure on next sheet write
    harness.injectTransientFailures(1);
    await drainSyncQueueToHarness();

    const failedJob = await db.syncQueue.findFirstOrThrow({
      where: { entity: "Patient", entityId: pat.id },
    });
    expect(failedJob.status).toBe("FAILED");
    expect(failedJob.attempts).toBe(1);
    expect(failedJob.lastError).toContain("Simulated transient Google Sheets API 503 error");

    // Retry synchronization now that transient failure cleared -> transitions to SYNCED
    await drainSyncQueueToHarness();
    const syncedJob = await db.syncQueue.findFirstOrThrow({
      where: { entity: "Patient", entityId: pat.id },
    });
    expect(syncedJob.status).toBe("SYNCED");
    expect(syncedJob.attempts).toBe(2);
    expect(syncedJob.lastError).toBeNull();

    const dbPat = await db.patient.findUniqueOrThrow({ where: { id: pat.id } });
    const rows = harness.tabs.get("Patients")!;
    const rec = reconcileEntitySheet("Patient", [dbPat], rows);
    expect(rec.pass).toBe(true);

    // Also verify reconciliation detects unexpected / orphan rows if injected into sheet
    const corruptedRows = [
      ...rows,
      ["unexpected-orphan-id", "DNT-9999", "", "Ghost", "Row"],
    ];
    const anomalyCheck = reconcileEntitySheet("Patient", [dbPat], corruptedRows);
    expect(anomalyCheck.pass).toBe(false);
    expect(anomalyCheck.unexpectedIds).toEqual(["unexpected-orphan-id"]);
  });
});

