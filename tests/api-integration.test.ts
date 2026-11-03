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
import { createSession, isAuthenticated } from "@/lib/auth";
import { GET as getDashboard } from "@/app/api/dashboard/route";
import { GET as getPatients, POST as postPatient } from "@/app/api/patients/route";
import {
  GET as getPatientById,
  PATCH as patchPatientById,
  DELETE as deletePatientById,
} from "@/app/api/patients/[id]/route";
import {
  GET as getAppointments,
  POST as postAppointment,
} from "@/app/api/appointments/route";
import { PATCH as patchAppointment } from "@/app/api/appointments/[id]/route";
import {
  GET as getTreatments,
  POST as postTreatment,
} from "@/app/api/treatments/route";
import { PATCH as patchTreatment } from "@/app/api/treatments/[id]/route";
import {
  GET as getPrescriptions,
  POST as postPrescription,
} from "@/app/api/prescriptions/route";
import {
  GET as getInvoices,
  POST as postInvoice,
} from "@/app/api/invoices/route";
import { POST as postPayment } from "@/app/api/invoices/[id]/payments/route";
import {
  GET as getFollowUps,
  POST as postFollowUp,
} from "@/app/api/follow-ups/route";
import { PATCH as patchFollowUp } from "@/app/api/follow-ups/[id]/route";
import { GET as getSync } from "@/app/api/sync/route";
import { POST as postLogout } from "@/app/api/auth/logout/route";

describe("API authentication and route handlers", () => {
  beforeEach(() => {
    mockToken = "";
  });

  it("rejects unauthenticated requests across protected endpoints", async () => {
    expect(await isAuthenticated()).toBe(false);
    expect((await getDashboard()).status).toBe(401);
    expect(
      (await getPatients(new Request("http://clinic.test/api/patients"))).status
    ).toBe(401);
    expect(
      (
        await getAppointments(
          new Request("http://clinic.test/api/appointments")
        )
      ).status
    ).toBe(401);
    expect(
      (await getTreatments(new Request("http://clinic.test/api/treatments")))
        .status
    ).toBe(401);
    expect((await getSync()).status).toBe(401);
  });

  it("authenticates valid JWT sessions and serves dashboard, patients, clinical, and sync endpoints", async () => {
    mockToken = await createSession();
    expect(await isAuthenticated()).toBe(true);

    const dashRes = await getDashboard();
    expect(dashRes.status).toBe(200);
    const dashData = await dashRes.json();
    expect(typeof dashData.patients).toBe("number");
    expect(typeof dashData.today).toBe("number");
    expect(typeof dashData.pending).toBe("number");
    expect(dashData.billingSummary).toBeDefined();
    expect(dashData.syncStatus).toBeDefined();

    const patRes = await getPatients(
      new Request("http://clinic.test/api/patients?q=")
    );
    expect(patRes.status).toBe(200);
    const patients = await patRes.json();
    expect(Array.isArray(patients)).toBe(true);

    const apptRes = await getAppointments(
      new Request("http://clinic.test/api/appointments")
    );
    expect(apptRes.status).toBe(200);

    const trRes = await getTreatments(
      new Request("http://clinic.test/api/treatments")
    );
    expect(trRes.status).toBe(200);

    const rxRes = await getPrescriptions(
      new Request("http://clinic.test/api/prescriptions")
    );
    expect(rxRes.status).toBe(200);

    const invRes = await getInvoices(
      new Request("http://clinic.test/api/invoices")
    );
    expect(invRes.status).toBe(200);

    const fuRes = await getFollowUps(
      new Request("http://clinic.test/api/follow-ups")
    );
    expect(fuRes.status).toBe(200);

    const syncRes = await getSync();
    expect(syncRes.status).toBe(200);
    const syncData = await syncRes.json();
    expect(typeof syncData.pending).toBe("number");
    expect(typeof syncData.synced).toBe("number");
  });

  it("completes full clinical workflow (patient -> appointment -> treatment -> rx -> invoice -> payment -> follow-up) and cleans up ephemeral fixture", async () => {
    mockToken = await createSession();
    const headers = {
      "content-type": "application/json",
      host: "clinic.test",
      origin: "http://clinic.test",
    };

    let createdPatientId = "";
    let createdAppointmentId = "";
    let createdTreatmentId = "";
    let createdPrescriptionId = "";
    let createdInvoiceId = "";
    let createdPaymentId = "";
    let createdFollowUpId = "";

    try {
      // 1. Create Patient
      const createPatRes = await postPatient(
        new Request("http://clinic.test/api/patients", {
          method: "POST",
          headers,
          body: JSON.stringify({
            firstName: "Ephemeral",
            lastName: "TestPatient",
            phone: "+91 9999988877",
            email: "ephemeral.test.9999@example.test",
            city: "Pune",
            consented: true,
          }),
        })
      );
      expect(createPatRes.status).toBe(201);
      const createdPatient = await createPatRes.json();
      createdPatientId = createdPatient.id;

      // 2. Patch Patient
      const patchPatRes = await patchPatientById(
        new Request(`http://clinic.test/api/patients/${createdPatientId}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ allergies: "None known" }),
        }),
        { params: Promise.resolve({ id: createdPatientId }) }
      );
      expect(patchPatRes.status).toBe(200);

      // 3. Book Appointment (far in future to avoid conflict with real schedule)
      const apptRes = await postAppointment(
        new Request("http://clinic.test/api/appointments", {
          method: "POST",
          headers,
          body: JSON.stringify({
            patientId: createdPatientId,
            type: "Consultation",
            startsAt: "2032-05-10T10:00:00.000Z",
            endsAt: "2032-05-10T10:30:00.000Z",
            complaint: "Routine check",
          }),
        })
      );
      expect(apptRes.status).toBe(201);
      const appt = await apptRes.json();
      createdAppointmentId = appt.id;
      expect(appt.patient.firstName).toBe("Ephemeral");

      // 4. Complete Appointment
      const patchApptRes = await patchAppointment(
        new Request(
          `http://clinic.test/api/appointments/${createdAppointmentId}`,
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({ status: "COMPLETED" }),
          }
        ),
        { params: Promise.resolve({ id: createdAppointmentId }) }
      );
      expect(patchApptRes.status).toBe(200);
      expect((await patchApptRes.json()).status).toBe("COMPLETED");

      // 5. Log Treatment
      const trRes = await postTreatment(
        new Request("http://clinic.test/api/treatments", {
          method: "POST",
          headers,
          body: JSON.stringify({
            patientId: createdPatientId,
            appointmentId: createdAppointmentId,
            category: "Restorative",
            procedure: "Composite Filling",
            toothNumber: "16",
            costPaise: 150000,
            status: "PLANNED",
          }),
        })
      );
      expect(trRes.status).toBe(201);
      const tr = await trRes.json();
      createdTreatmentId = tr.id;

      const patchTrRes = await patchTreatment(
        new Request(`http://clinic.test/api/treatments/${createdTreatmentId}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ status: "COMPLETED" }),
        }),
        { params: Promise.resolve({ id: createdTreatmentId }) }
      );
      expect(patchTrRes.status).toBe(200);

      // 6. Issue Prescription
      const rxRes = await postPrescription(
        new Request("http://clinic.test/api/prescriptions", {
          method: "POST",
          headers,
          body: JSON.stringify({
            patientId: createdPatientId,
            notes: "Post-filling care",
            items: [
              {
                medication: "Tab. Paracetamol",
                dosage: "650 mg",
                frequency: "SOS",
                duration: "2 days",
              },
            ],
          }),
        })
      );
      expect(rxRes.status).toBe(201);
      createdPrescriptionId = (await rxRes.json()).id;

      // 7. Create Invoice & Record Payment
      const invRes = await postInvoice(
        new Request("http://clinic.test/api/invoices", {
          method: "POST",
          headers,
          body: JSON.stringify({
            patientId: createdPatientId,
            discountPaise: 10000,
            taxPaise: 0,
            items: [
              {
                description: "Composite Filling #16",
                quantity: 1,
                unitPaise: 150000,
              },
            ],
          }),
        })
      );
      expect(invRes.status).toBe(201);
      const inv = await invRes.json();
      createdInvoiceId = inv.id;
      expect(inv.totalPaise).toBe(140000);

      const payRes = await postPayment(
        new Request(
          `http://clinic.test/api/invoices/${createdInvoiceId}/payments`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              amountPaise: 140000,
              method: "UPI",
              reference: "UTR12345",
            }),
          }
        ),
        { params: Promise.resolve({ id: createdInvoiceId }) }
      );
      expect(payRes.status).toBe(201);
      createdPaymentId = (await payRes.json()).id;

      // 8. Schedule & Complete Follow-up
      const fuRes = await postFollowUp(
        new Request("http://clinic.test/api/follow-ups", {
          method: "POST",
          headers,
          body: JSON.stringify({
            patientId: createdPatientId,
            dueDate: "2032-05-17T10:00:00.000Z",
            reason: "Bite check",
          }),
        })
      );
      expect(fuRes.status).toBe(201);
      createdFollowUpId = (await fuRes.json()).id;

      const patchFuRes = await patchFollowUp(
        new Request(`http://clinic.test/api/follow-ups/${createdFollowUpId}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ status: "COMPLETED" }),
        }),
        { params: Promise.resolve({ id: createdFollowUpId }) }
      );
      expect(patchFuRes.status).toBe(200);

      // 9. Verify 360° Patient Profile GET and Soft-Delete
      const detailRes = await getPatientById(
        new Request(`http://clinic.test/api/patients/${createdPatientId}`),
        { params: Promise.resolve({ id: createdPatientId }) }
      );
      expect(detailRes.status).toBe(200);
      const fullProfile = await detailRes.json();
      expect(fullProfile.appointments.length).toBe(1);
      expect(fullProfile.treatments.length).toBe(1);
      expect(fullProfile.prescriptions.length).toBe(1);
      expect(fullProfile.invoices[0].status).toBe("PAID");

      const archiveRes = await deletePatientById(
        new Request(`http://clinic.test/api/patients/${createdPatientId}`, {
          method: "DELETE",
          headers,
        }),
        { params: Promise.resolve({ id: createdPatientId }) }
      );
      expect(archiveRes.status).toBe(200);
    } finally {
      // Clean up only the ephemeral test entities created by this test so existing DB state is untouched
      const entityIds = [
        createdPatientId,
        createdAppointmentId,
        createdTreatmentId,
        createdPrescriptionId,
        createdInvoiceId,
        createdPaymentId,
        createdFollowUpId,
      ].filter(Boolean);

      if (entityIds.length) {
        await db.syncQueue.deleteMany({ where: { entityId: { in: entityIds } } });
        await db.auditLog.deleteMany({ where: { entityId: { in: entityIds } } });
      }
      if (createdPaymentId)
        await db.payment.deleteMany({ where: { id: createdPaymentId } });
      if (createdInvoiceId)
        await db.invoice.deleteMany({ where: { id: createdInvoiceId } });
      if (createdPrescriptionId)
        await db.prescription.deleteMany({
          where: { id: createdPrescriptionId },
        });
      if (createdTreatmentId)
        await db.treatment.deleteMany({ where: { id: createdTreatmentId } });
      if (createdFollowUpId)
        await db.followUp.deleteMany({ where: { id: createdFollowUpId } });
      if (createdAppointmentId)
        await db.appointment.deleteMany({
          where: { id: createdAppointmentId },
        });
      if (createdPatientId)
        await db.patient.deleteMany({ where: { id: createdPatientId } });
    }
  });

  it("protects logout endpoint against cross-origin CSRF and clears session on same-origin", async () => {
    const crossSite = await postLogout(
      new Request("http://clinic.test/api/auth/logout", {
        method: "POST",
        headers: { host: "clinic.test", origin: "https://evil.test" },
      })
    );
    expect(crossSite.status).toBe(403);

    const sameSite = await postLogout(
      new Request("http://clinic.test/api/auth/logout", {
        method: "POST",
        headers: { host: "clinic.test", origin: "http://clinic.test" },
      })
    );
    expect(sameSite.status).toBe(200);
    expect(sameSite.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
