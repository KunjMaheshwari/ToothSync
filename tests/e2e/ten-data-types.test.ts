import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

const syncRecordMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/sheets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sheets")>();
  return {
    ...actual,
    syncRecordToSheets: (...args: any[]) => syncRecordMock(...args),
  };
});

import * as auth from "@/lib/auth";
import { POST as patientsPOST, GET as patientsGET } from "@/app/api/patients/route";
import { GET as patientIdGET, PATCH as patientIdPATCH } from "@/app/api/patients/[id]/route";
import { POST as appointmentsPOST, GET as appointmentsGET } from "@/app/api/appointments/route";
import { POST as treatmentsPOST, GET as treatmentsGET } from "@/app/api/treatments/route";
import { POST as prescriptionsPOST, GET as prescriptionsGET } from "@/app/api/prescriptions/route";
import { POST as invoicesPOST, GET as invoicesGET } from "@/app/api/invoices/route";
import { POST as paymentsPOST } from "@/app/api/invoices/[id]/payments/route";
import { POST as followUpsPOST, GET as followUpsGET } from "@/app/api/follow-ups/route";
import { POST as syncPOST, GET as syncGET } from "@/app/api/sync/route";
import { GET as dashboardGET } from "@/app/api/dashboard/route";
import { makeRequest, resetTestDatabase } from "./helpers";

describe("10 Distinct Clinical and Financial Data Types End-to-End Verification", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(auth, "isAuthenticated").mockResolvedValue(true);
    await resetTestDatabase();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates, validates, and links all 10 distinct data types without error", async () => {
    // 1. DATA TYPE 1: Patient (Clinical Demographics & Dental History)
    const patientRes = await patientsPOST(
      makeRequest("http://localhost:3000/api/patients", "POST", {
        firstName: "Aarav",
        lastName: "Patel",
        phone: "+91 9820012345",
        email: "aarav.patel@example.com",
        dateOfBirth: "1992-05-14",
        gender: "Male",
        city: "Mumbai",
        allergies: "Penicillin",
        conditions: "Mild Hypertension",
        dentalHistory: "Previous root canal on tooth 16",
        consented: true,
      })
    );
    expect(patientRes.status).toBe(201);
    const patient = await patientRes.json();
    expect(patient.id).toBeDefined();
    expect(patient.patientId).toMatch(/^DNT-\d{4}-\d{8}$/);
    expect(patient.firstName).toBe("Aarav");
    expect(patient.allergies).toBe("Penicillin");

    // Verify Patient Retrieval in List
    const patientsListRes = await patientsGET(
      makeRequest("http://localhost:3000/api/patients?q=Aarav")
    );
    expect(patientsListRes.status).toBe(200);
    const patientsList = await patientsListRes.json();
    expect(patientsList.length).toBe(1);
    expect(patientsList[0].id).toBe(patient.id);

    // 2. DATA TYPE 2: Appointment (Scheduled Consultation)
    const startIso = new Date(Date.now() + 86400000).toISOString();
    const endIso = new Date(Date.now() + 86400000 + 1800000).toISOString();
    const appointmentRes = await appointmentsPOST(
      makeRequest("http://localhost:3000/api/appointments", "POST", {
        patientId: patient.id,
        startsAt: startIso,
        endsAt: endIso,
        type: "Root Canal Follow-up",
        complaint: "Occasional mild sensitivity",
        plannedTreatment: "Evaluation of crown margins",
        notes: "First appointment after temporary crown",
      })
    );
    expect(appointmentRes.status).toBe(201);
    const appointment = await appointmentRes.json();
    expect(appointment.id).toBeDefined();
    expect(appointment.status).toBe("SCHEDULED");
    expect(appointment.patientId).toBe(patient.id);

    // Verify Appointments List
    const appointmentsListRes = await appointmentsGET(
      makeRequest(`http://localhost:3000/api/appointments?patientId=${patient.id}`)
    );
    expect(appointmentsListRes.status).toBe(200);
    const appointmentsList = await appointmentsListRes.json();
    expect(appointmentsList.length).toBe(1);
    expect(appointmentsList[0].type).toBe("Root Canal Follow-up");

    // 3. DATA TYPE 3: Treatment (Restorative Procedure & Tooth Mapping)
    const treatmentRes = await treatmentsPOST(
      makeRequest("http://localhost:3000/api/treatments", "POST", {
        patientId: patient.id,
        appointmentId: appointment.id,
        category: "Endodontics",
        procedure: "Permanent Crown Placement",
        toothNumber: "16",
        description: "Zirconia full contour crown cemented with resin cement",
        costPaise: 850000, // Rs 8,500.00
        status: "COMPLETED",
      })
    );
    expect(treatmentRes.status).toBe(201);
    const treatment = await treatmentRes.json();
    expect(treatment.id).toBeDefined();
    expect(treatment.costPaise).toBe(850000);
    expect(treatment.toothNumber).toBe("16");

    // Verify Treatments List
    const treatmentsListRes = await treatmentsGET(
      makeRequest(`http://localhost:3000/api/treatments?patientId=${patient.id}`)
    );
    expect(treatmentsListRes.status).toBe(200);
    const treatmentsList = await treatmentsListRes.json();
    expect(treatmentsList.length).toBe(1);
    expect(treatmentsList[0].procedure).toBe("Permanent Crown Placement");

    // 4. DATA TYPE 4: Prescription & Multi-Item Medication Schedule
    const prescriptionRes = await prescriptionsPOST(
      makeRequest("http://localhost:3000/api/prescriptions", "POST", {
        patientId: patient.id,
        notes: "Take post crown placement medications with meals.",
        items: [
          {
            medication: "Amoxicillin",
            dosage: "500 mg",
            frequency: "1-0-1",
            duration: "5 days",
            instructions: "Take after meals",
          },
          {
            medication: "Ibuprofen",
            dosage: "400 mg",
            frequency: "1-0-1 (SOS)",
            duration: "3 days",
            instructions: "For post-procedure soreness only",
          },
        ],
      })
    );
    expect(prescriptionRes.status).toBe(201);
    const prescription = await prescriptionRes.json();
    expect(prescription.id).toBeDefined();
    expect(prescription.items.length).toBe(2);
    expect(prescription.items[0].medication).toBe("Amoxicillin");
    expect(prescription.items[1].medication).toBe("Ibuprofen");

    // Verify Prescriptions List
    const prescriptionsListRes = await prescriptionsGET(
      makeRequest(`http://localhost:3000/api/prescriptions?patientId=${patient.id}`)
    );
    expect(prescriptionsListRes.status).toBe(200);
    const prescriptionsList = await prescriptionsListRes.json();
    expect(prescriptionsList.length).toBe(1);
    expect(prescriptionsList[0].items.length).toBe(2);

    // 5. DATA TYPE 5: Invoice with Multi-line Items, Discount, and Tax
    const invoiceRes = await invoicesPOST(
      makeRequest("http://localhost:3000/api/invoices", "POST", {
        patientId: patient.id,
        items: [
          {
            description: "Zirconia Crown (Tooth 16)",
            quantity: 1,
            unitPaise: 850000, // 8,500.00
          },
          {
            description: "Occlusal Adjustment & Polish",
            quantity: 1,
            unitPaise: 150000, // 1,500.00
          },
        ],
        // Subtotal = 10,000.00 (1,000,000 paise)
        discountPercent: 10, // 1,000.00 discount -> 9,000.00
        taxPercent: 5, // 5% of 9,000.00 = 450.00 tax -> Total = 9,450.00 (945,000 paise)
      })
    );
    expect(invoiceRes.status).toBe(201);
    const invoice = await invoiceRes.json();
    expect(invoice.id).toBeDefined();
    expect(invoice.totalPaise).toBe(945000);
    expect(invoice.paidPaise).toBe(0);
    expect(invoice.status).toBe("PENDING");
    expect(invoice.items.length).toBe(2);

    // Verify Invoices List
    const invoicesListRes = await invoicesGET(
      makeRequest(`http://localhost:3000/api/invoices?patientId=${patient.id}`)
    );
    expect(invoicesListRes.status).toBe(200);
    const invoicesList = await invoicesListRes.json();
    expect(invoicesList.length).toBe(1);
    expect(invoicesList[0].totalPaise).toBe(945000);

    // 6. DATA TYPE 6: Payment Recording with Partial & Complete Reconciliation
    const payment1Res = await paymentsPOST(
      makeRequest(`http://localhost:3000/api/invoices/${invoice.id}/payments`, "POST", {
        amountPaise: 500000, // Rs 5,000.00 via UPI
        method: "UPI",
        reference: "UPI-TXN-20261104-001",
        notes: "Advance payment at reception",
      }),
      { params: Promise.resolve({ id: invoice.id }) }
    );
    expect(payment1Res.status).toBe(201);
    const payment1 = await payment1Res.json();
    expect(payment1.amountPaise).toBe(500000);
    expect(payment1.method).toBe("UPI");

    // Verify invoice status after partial payment
    const invoiceAfterP1 = await invoicesGET(
      makeRequest(`http://localhost:3000/api/invoices?patientId=${patient.id}`)
    );
    const [inv1] = await invoiceAfterP1.json();
    expect(inv1.status).toBe("PARTIAL");
    expect(inv1.paidPaise).toBe(500000);

    // Complete the payment: remaining 445,000 paise
    const payment2Res = await paymentsPOST(
      makeRequest(`http://localhost:3000/api/invoices/${invoice.id}/payments`, "POST", {
        amountPaise: 445000, // Rs 4,450.00 via CARD
        method: "CARD",
        reference: "POS-SLIP-998822",
        notes: "Balance settlement",
      }),
      { params: Promise.resolve({ id: invoice.id }) }
    );
    expect(payment2Res.status).toBe(201);
    const payment2 = await payment2Res.json();
    expect(payment2.amountPaise).toBe(445000);

    // Verify invoice status after full payment
    const invoiceAfterP2 = await invoicesGET(
      makeRequest(`http://localhost:3000/api/invoices?patientId=${patient.id}`)
    );
    const [inv2] = await invoiceAfterP2.json();
    expect(inv2.status).toBe("PAID");
    expect(inv2.paidPaise).toBe(945000);

    // 7. DATA TYPE 7: Follow-Up Schedule
    const followUpDate = new Date(Date.now() + 14 * 86400000).toISOString();
    const followUpRes = await followUpsPOST(
      makeRequest("http://localhost:3000/api/follow-ups", "POST", {
        patientId: patient.id,
        dueDate: followUpDate,
        reason: "Two-week crown margin and bite evaluation",
        notes: "Check if any food lodgement or occlusal high spots occur",
        status: "PENDING",
      })
    );
    expect(followUpRes.status).toBe(201);
    const followUp = await followUpRes.json();
    expect(followUp.id).toBeDefined();
    expect(followUp.reason).toBe("Two-week crown margin and bite evaluation");
    expect(followUp.status).toBe("PENDING");

    // Verify Follow-ups List
    const followUpsListRes = await followUpsGET(
      makeRequest(`http://localhost:3000/api/follow-ups?patientId=${patient.id}`)
    );
    expect(followUpsListRes.status).toBe(200);
    const followUpsList = await followUpsListRes.json();
    expect(followUpsList.length).toBe(1);

    // 8. DATA TYPE 8: Patient Profile Mutation (PATCH) & Relational Deep Load
    const patchRes = await patientIdPATCH(
      makeRequest(`http://localhost:3000/api/patients/${patient.id}`, "PATCH", {
        allergies: "Penicillin, Latex",
        city: "Navi Mumbai",
      }),
      { params: Promise.resolve({ id: patient.id }) }
    );
    expect(patchRes.status).toBe(200);
    const updatedPatient = await patchRes.json();
    expect(updatedPatient.allergies).toBe("Penicillin, Latex");
    expect(updatedPatient.city).toBe("Navi Mumbai");

    // Full Profile Retrieval (The endpoint that failed in production earlier)
    const profileRes = await patientIdGET(
      makeRequest(`http://localhost:3000/api/patients/${patient.id}`),
      { params: Promise.resolve({ id: patient.id }) }
    );
    expect(profileRes.status).toBe(200);
    const profile = await profileRes.json();
    expect(profile.id).toBe(patient.id);
    expect(profile.appointments.length).toBe(1);
    expect(profile.treatments.length).toBe(1);
    expect(profile.prescriptions.length).toBe(1);
    expect(profile.prescriptions[0].items.length).toBe(2);
    expect(profile.invoices.length).toBe(1);
    expect(profile.invoices[0].payments.length).toBe(2);
    expect(profile.invoices[0].status).toBe("PAID");
    expect(profile.followUps.length).toBe(1);

    // 9. DATA TYPE 9: Sync Queue & Sync Metadata
    const syncStatusRes = await syncGET();
    expect(syncStatusRes.status).toBe(200);
    const syncStatus = await syncStatusRes.json();
    expect(syncStatus).toHaveProperty("pending");
    expect(syncStatus).toHaveProperty("jobs");
    expect(Array.isArray(syncStatus.jobs)).toBe(true);

    const syncProcessRes = await syncPOST(
      makeRequest("http://localhost:3000/api/sync", "POST")
    );
    expect(syncProcessRes.status).toBe(200);
    const syncProcess = await syncProcessRes.json();
    expect(syncProcess).toHaveProperty("synced");

    // 10. DATA TYPE 10: Dashboard Aggregations & Practice Health Metrics
    const dashboardRes = await dashboardGET();
    expect(dashboardRes.status).toBe(200);
    const dashboard = await dashboardRes.json();
    expect(dashboard.patients).toBe(1);
    expect(dashboard.treatmentsCount).toBe(1);
    expect(dashboard.prescriptionsCount).toBe(1);
    expect(dashboard.billingSummary.totalCollectedPaise).toBe(945000);
    expect(dashboard.billingSummary.outstandingPaise).toBe(0);
    expect(dashboard.recentPatients.length).toBe(1);
    expect(dashboard.upcomingAppointments.length).toBe(1);
    expect(dashboard.syncStatus).toBeDefined();
    expect(dashboard.recentAudit.length).toBeGreaterThan(0);
  });
});
