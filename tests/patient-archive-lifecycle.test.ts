import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

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
import { buildSheetRecord, hydrateDatabaseFromSheets } from "@/lib/sheets";
import {
  GET as getPatientById,
  DELETE as deletePatientById,
} from "@/app/api/patients/[id]/route";
import { GET as getPatients } from "@/app/api/patients/route";

describe("Patient Archive Lifecycle & Resurrection Prevention", () => {
  const trackedPatientIds: string[] = [];

  beforeEach(async () => {
    mockToken = await createSession();
  });

  afterEach(async () => {
    // Clean up created test entities
    if (trackedPatientIds.length > 0) {
      const pids = [...trackedPatientIds];
      trackedPatientIds.length = 0;
      await db.syncQueue.deleteMany({ where: { entityId: { in: pids } } });
      await db.payment.deleteMany({
        where: { invoice: { patientId: { in: pids } } },
      });
      await db.invoice.deleteMany({ where: { patientId: { in: pids } } });
      await db.prescription.deleteMany({ where: { patientId: { in: pids } } });
      await db.treatment.deleteMany({ where: { patientId: { in: pids } } });
      await db.appointment.deleteMany({ where: { patientId: { in: pids } } });
      await db.followUp.deleteMany({ where: { patientId: { in: pids } } });
      await db.auditLog.deleteMany({ where: { entityId: { in: pids } } });
      await db.patient.deleteMany({ where: { id: { in: pids } } });
    }
  });

  it("archive sets deletedAt, cancels scheduled appointments and follow-ups, and preserves financial history", async () => {
    // 1. Create a patient
    const patient = await db.patient.create({
      data: {
        patientId: `PAT-ARCH-${Date.now()}`,
        firstName: "Archival",
        lastName: "TestUser",
        phone: "+919999900001",
        email: "archival.test@example.com",
        dateOfBirth: new Date("1990-01-01"),
        gender: "OTHER",
        allergies: "Penicillin",
        conditions: "Hypertension",
        dentalHistory: "Routine checkup",
      },
    });
    trackedPatientIds.push(patient.id);

    // 2. Attach scheduled appointment, completed appointment, pending follow up, planned treatment, and invoice
    const tomorrow = new Date(Date.now() + 86400000);
    const tomorrowEnd = new Date(tomorrow.getTime() + 30 * 60000);
    const scheduledAppt = await db.appointment.create({
      data: {
        patientId: patient.id,
        startsAt: tomorrow,
        endsAt: tomorrowEnd,
        type: "CONSULTATION",
        status: "SCHEDULED",
        complaint: "Regular checkup",
      },
    });

    const yesterday = new Date(Date.now() - 86400000);
    const yesterdayEnd = new Date(yesterday.getTime() + 30 * 60000);
    const completedAppt = await db.appointment.create({
      data: {
        patientId: patient.id,
        startsAt: yesterday,
        endsAt: yesterdayEnd,
        type: "TREATMENT",
        status: "COMPLETED",
        complaint: "Cleaning",
      },
    });

    const pendingFollowUp = await db.followUp.create({
      data: {
        patientId: patient.id,
        dueDate: new Date(Date.now() + 86400000 * 3),
        status: "PENDING",
        reason: "Check healing",
      },
    });

    const plannedTreatment = await db.treatment.create({
      data: {
        patientId: patient.id,
        category: "PROSTHODONTICS",
        procedure: "Crown Placement",
        status: "PLANNED",
        costPaise: 500000,
      },
    });

    const completedTreatment = await db.treatment.create({
      data: {
        patientId: patient.id,
        category: "RESTORATIVE",
        procedure: "Composite Filling",
        status: "COMPLETED",
        costPaise: 150000,
      },
    });

    const invoice = await db.invoice.create({
      data: {
        patientId: patient.id,
        invoiceNumber: `INV-ARCHIVE-${Date.now()}`,
        totalPaise: 150000,
        paidPaise: 150000,
        status: "PAID",
      },
    });

    // 3. Call DELETE /api/patients/[id]
    const req = new Request(`http://clinic.test/api/patients/${patient.id}`, {
      method: "DELETE",
    });
    const res = await deletePatientById(req, {
      params: Promise.resolve({ id: patient.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.archivedAt).toBeTruthy();

    // 4. Verify patient in DB has deletedAt set
    const updatedPatient = await db.patient.findUnique({
      where: { id: patient.id },
    });
    expect(updatedPatient?.deletedAt).not.toBeNull();

    // 5. Verify scheduled appointment was cancelled, but completed appointment remained intact
    const appts = await db.appointment.findMany({
      where: { patientId: patient.id },
    });
    const sched = appts.find((a) => a.id === scheduledAppt.id);
    const comp = appts.find((a) => a.id === completedAppt.id);
    expect(sched?.status).toBe("CANCELLED");
    expect(comp?.status).toBe("COMPLETED");

    // 6. Verify pending follow-up was cancelled
    const fup = await db.followUp.findUnique({
      where: { id: pendingFollowUp.id },
    });
    expect(fup?.status).toBe("CANCELLED");

    // 7. Verify planned treatment was cancelled, but completed treatment remained intact
    const trts = await db.treatment.findMany({
      where: { patientId: patient.id },
    });
    const plTrt = trts.find((t) => t.id === plannedTreatment.id);
    const coTrt = trts.find((t) => t.id === completedTreatment.id);
    expect(plTrt?.status).toBe("CANCELLED");
    expect(coTrt?.status).toBe("COMPLETED");

    // 8. Verify invoice & financial history remain intact
    const inv = await db.invoice.findUnique({ where: { id: invoice.id } });
    expect(inv?.status).toBe("PAID");
    expect(inv?.totalPaise).toBe(150000);

    // 9. Verify GET /api/patients does NOT list the archived patient
    const listReq = new Request("http://clinic.test/api/patients?q=Archival");
    const listRes = await getPatients(listReq);
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(Array.isArray(listData)).toBe(true);
    const found = listData.find(
      (p: { id: string }) => p.id === patient.id
    );
    expect(found).toBeUndefined();

    // 10. Verify GET /api/patients/[id] returns 404
    const detailReq = new Request(
      `http://clinic.test/api/patients/${patient.id}`
    );
    const detailRes = await getPatientById(detailReq, {
      params: Promise.resolve({ id: patient.id }),
    });
    expect(detailRes.status).toBe(404);

    // 11. Verify DELETE idempotency (subsequent delete returns 200 with alreadyArchived)
    const secondDeleteRes = await deletePatientById(req, {
      params: Promise.resolve({ id: patient.id }),
    });
    expect(secondDeleteRes.status).toBe(200);
    const secondBody = await secondDeleteRes.json();
    expect(secondBody.alreadyArchived).toBe(true);
  });

  it("Google Sheets record contains 17 columns with 'Archived At' tombstone", async () => {
    const deletedTime = new Date("2026-11-04T12:00:00.000Z");
    const patient = {
      id: "pat-tombstone-123",
      firstName: "Tombstone",
      lastName: "Tester",
      phone: "+919876543210",
      email: "tombstone@example.com",
      dateOfBirth: new Date("1985-05-15"),
      gender: "FEMALE",
      bloodGroup: "A_POS",
      medicalHistory: "None",
      dentalHistory: "None",
      allergies: "Penicillin",
      emergencyContactName: "Emergency Contact",
      emergencyContactPhone: "+919876543211",
      notes: "Test notes",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: deletedTime,
      deletedAt: deletedTime,
    };

    const sheetRow = buildSheetRecord("Patient", patient);
    expect(sheetRow.tab).toBe("Patients");
    expect(sheetRow.headers.length).toBe(17);
    expect(sheetRow.headers[16]).toBe("Archived At");
    expect(sheetRow.values.length).toBe(17);
    expect(sheetRow.values[0]).toBe("pat-tombstone-123");
    expect(sheetRow.values[16]).toBe("2026-11-04T12:00:00.000Z");
  });

  it("hydrateDatabaseFromSheets preserves deletedAt and never resurrects archived patient", async () => {
    const patientId = "pat-hydrated-archive-999";
    const archivedIso = "2026-11-04T10:00:00.000Z";
    trackedPatientIds.push(patientId);

    // Mock sheets client returning an archived patient row
    const mockSheetsClient: any = {
      spreadsheets: {
        get: async () => ({
          data: {
            sheets: [{ properties: { title: "Patients" } }],
          },
        }),
        values: {
          get: async ({ range }: { range: string }) => {
            if (range.includes("Patients")) {
              return {
                data: {
                  values: [
                    // Row 0: Headers (17 columns)
                    [
                      "Record ID",
                      "First Name",
                      "Last Name",
                      "Phone",
                      "Email",
                      "Date of Birth",
                      "Gender",
                      "Blood Group",
                      "Medical History",
                      "Dental History",
                      "Allergies",
                      "Emergency Contact Name",
                      "Emergency Contact Phone",
                      "Notes",
                      "Created At",
                      "Updated At",
                      "Archived At",
                    ],
                    // Row 1: The archived patient
                    [
                      patientId,
                      "Ghost",
                      "Patient",
                      "+919800000000",
                      "ghost@example.com",
                      "1992-02-02",
                      "OTHER",
                      "B_POS",
                      "",
                      "",
                      "",
                      "",
                      "",
                      "",
                      "2026-01-01T00:00:00.000Z",
                      archivedIso,
                      archivedIso,
                    ],
                  ],
                },
              };
            }
            return { data: { values: [] } };
          },
        },
      },
    };

    // Run hydrateDatabaseFromSheets
    const result = await hydrateDatabaseFromSheets(db, {
      sheets: mockSheetsClient,
      sheetId: "test-sheet-id",
    });
    expect(result.hydratedPatients).toBeGreaterThanOrEqual(1);

    // Verify patient in DB is soft-deleted, not active
    const hydratedPatient = await db.patient.findUnique({
      where: { id: patientId },
    });
    expect(hydratedPatient).not.toBeNull();
    expect(hydratedPatient?.deletedAt).not.toBeNull();
    expect(hydratedPatient?.deletedAt?.toISOString()).toBe(archivedIso);

    // Verify GET /api/patients does not return this hydrated archived patient
    const listReq = new Request("http://clinic.test/api/patients?q=Ghost");
    const listRes = await getPatients(listReq);
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(Array.isArray(listData)).toBe(true);
    const found = listData.find(
      (p: { id: string }) => p.id === patientId
    );
    expect(found).toBeUndefined();
  });
});
