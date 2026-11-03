import { describe, expect, it } from "vitest";
import { buildSheetRecord } from "@/lib/sheets";

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
