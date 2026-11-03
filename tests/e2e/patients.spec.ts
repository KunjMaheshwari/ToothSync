import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { makeRequest, resetTestDatabase } from "./helpers";

vi.mock("@/lib/auth", () => ({
  isAuthenticated: vi.fn(async () => true),
}));

import { GET as patientsGET, POST as patientsPOST } from "@/app/api/patients/route";
import {
  GET as patientDetailGET,
  PATCH as patientPATCH,
  DELETE as patientDELETE,
} from "@/app/api/patients/[id]/route";
import { POST as appointmentsPOST } from "@/app/api/appointments/route";
import { POST as treatmentsPOST } from "@/app/api/treatments/route";
import { POST as invoicesPOST } from "@/app/api/invoices/route";

describe("PHASE 4 — Patient Management (TC-005 to TC-012)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("TC-005: Create a patient (QA_PATIENT_001) with all valid demographic and clinical fields and verify SQLite + SyncQueue persistence", async () => {
    const res = await patientsPOST(
      makeRequest("http://localhost:3000/api/patients", "POST", {
        referenceId: "QA_PATIENT_001",
        firstName: "Rohan",
        lastName: "Deshmukh",
        phone: "+91 98201 11001",
        email: "rohan.deshmukh.qa001@example.test",
        dateOfBirth: "1988-05-14",
        gender: "Male",
        city: "Mumbai",
        allergies: "Sulfa drugs",
        conditions: "Mild hypertension",
        dentalHistory: "Prior RCT on #36 in 2022",
        consented: true,
      })
    );
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.patientId).toMatch(/^DNT-\d{4}-\d{8}$/);
    expect(created.referenceId).toBe("QA_PATIENT_001");
    expect(created.firstName).toBe("Rohan");
    expect(created.allergies).toBe("Sulfa drugs");
    expect(created.consented).toBe(true);

    const dbRecord = await db.patient.findUnique({ where: { id: created.id } });
    expect(dbRecord).not.toBeNull();
    expect(dbRecord?.email).toBe("rohan.deshmukh.qa001@example.test");

    const syncJob = await db.syncQueue.findFirst({
      where: { entity: "Patient", entityId: created.id },
    });
    expect(syncJob?.status).toBe("PENDING");
  });

  it("TC-006: Create a second patient (QA_PATIENT_002) with distinct demographic values and verify unique patientId allocation", async () => {
    const p1Res = await patientsPOST(
      makeRequest("http://localhost:3000/api/patients", "POST", {
        referenceId: "QA_PATIENT_001",
        firstName: "Rohan",
        lastName: "Deshmukh",
        phone: "+91 98201 11001",
      })
    );
    const p1 = await p1Res.json();

    const p2Res = await patientsPOST(
      makeRequest("http://localhost:3000/api/patients", "POST", {
        referenceId: "QA_PATIENT_002",
        firstName: "Meera",
        lastName: "Krishnan",
        phone: "+91 98450 22002",
        email: "meera.krishnan.qa002@example.test",
        dateOfBirth: "1995-11-23",
        gender: "Female",
        city: "Bengaluru",
        allergies: "None known",
        conditions: "None",
        dentalHistory: "Orthodontic braces completed 2019",
        consented: true,
      })
    );
    expect(p2Res.status).toBe(201);
    const p2 = await p2Res.json();
    expect(p2.id).not.toBe(p1.id);
    expect(p2.patientId).not.toBe(p1.patientId);
    expect(p2.city).toBe("Bengaluru");
  });

  it("TC-007: Validate required patient registration fields (missing firstName, lastName, or phone rejected with 400)", async () => {
    const noFirst = await patientsPOST(
      makeRequest("http://localhost:3000/api/patients", "POST", {
        firstName: "",
        lastName: "Patel",
        phone: "+91 98765 00001",
      })
    );
    expect(noFirst.status).toBe(400);

    const noLast = await patientsPOST(
      makeRequest("http://localhost:3000/api/patients", "POST", {
        firstName: "Kavita",
        lastName: "   ",
        phone: "+91 98765 00002",
      })
    );
    expect(noLast.status).toBe(400);

    const noPhone = await patientsPOST(
      makeRequest("http://localhost:3000/api/patients", "POST", {
        firstName: "Kavita",
        lastName: "Patel",
        phone: "",
      })
    );
    expect(noPhone.status).toBe(400);
  });

  it("TC-008: Validate invalid phone numbers, malformed email addresses, and invalid dates of birth", async () => {
    const badPhone = await patientsPOST(
      makeRequest("http://localhost:3000/api/patients", "POST", {
        firstName: "Vikram",
        lastName: "Sethi",
        phone: "12345",
      })
    );
    expect(badPhone.status).toBe(400);
    expect((await badPhone.json()).error).toContain("Invalid phone number");

    const badEmail = await patientsPOST(
      makeRequest("http://localhost:3000/api/patients", "POST", {
        firstName: "Vikram",
        lastName: "Sethi",
        phone: "+91 98111 22334",
        email: "not-an-email",
      })
    );
    expect(badEmail.status).toBe(400);
    expect((await badEmail.json()).error).toContain("Invalid email address");

    const badDob = await patientsPOST(
      makeRequest("http://localhost:3000/api/patients", "POST", {
        firstName: "Vikram",
        lastName: "Sethi",
        phone: "+91 98111 22334",
        dateOfBirth: "2026-99-99",
      })
    );
    expect(badDob.status).toBe(400);
  });

  it("TC-009: Search for patients using name, patientId, referenceId, phone digits, and email", async () => {
    const r1 = await patientsPOST(
      makeRequest("http://localhost:3000/api/patients", "POST", {
        referenceId: "QA_PATIENT_003",
        firstName: "Siddharth",
        lastName: "Malhotra",
        phone: "+91 99001 33003",
        email: "siddharth.qa003@example.test",
      })
    );
    const p1 = await r1.json();

    await patientsPOST(
      makeRequest("http://localhost:3000/api/patients", "POST", {
        referenceId: "QA_PATIENT_004",
        firstName: "Ananya",
        lastName: "Iyer",
        phone: "+91 99002 44004",
        email: "ananya.qa004@example.test",
      })
    );

    const byName = await (
      await patientsGET(makeRequest("http://localhost:3000/api/patients?q=Siddharth"))
    ).json();
    expect(byName.length).toBe(1);
    expect(byName[0].id).toBe(p1.id);

    const byPatientId = await (
      await patientsGET(
        makeRequest(`http://localhost:3000/api/patients?q=${p1.patientId}`)
      )
    ).json();
    expect(byPatientId.length).toBe(1);
    expect(byPatientId[0].id).toBe(p1.id);

    const byPhone = await (
      await patientsGET(makeRequest("http://localhost:3000/api/patients?q=44004"))
    ).json();
    expect(byPhone.length).toBe(1);
    expect(byPhone[0].firstName).toBe("Ananya");

    const byEmail = await (
      await patientsGET(
        makeRequest("http://localhost:3000/api/patients?q=ananya.qa004")
      )
    ).json();
    expect(byEmail.length).toBe(1);
    expect(byEmail[0].referenceId).toBe("QA_PATIENT_004");
  });

  it("TC-010: Update patient information and verify database persistence and SyncQueue re-queueing", async () => {
    const createRes = await patientsPOST(
      makeRequest("http://localhost:3000/api/patients", "POST", {
        referenceId: "QA_PATIENT_005",
        firstName: "Neha",
        lastName: "Kapoor",
        phone: "+91 97654 55005",
        city: "Pune",
        allergies: "None",
      })
    );
    const created = await createRes.json();

    // Mark initial sync job SYNCED to verify update flips it back to PENDING
    await db.syncQueue.updateMany({
      where: { entity: "Patient", entityId: created.id },
      data: { status: "SYNCED" },
    });

    const patchRes = await patientPATCH(
      makeRequest(`http://localhost:3000/api/patients/${created.id}`, "PATCH", {
        city: "Ahmedabad",
        allergies: "Latex, Local Lidocaine sensitivity",
        conditions: "Controlled hypothyroidism",
      }),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect(patchRes.status).toBe(200);
    const updated = await patchRes.json();
    expect(updated.city).toBe("Ahmedabad");
    expect(updated.allergies).toBe("Latex, Local Lidocaine sensitivity");

    const syncJob = await db.syncQueue.findFirst({
      where: { entity: "Patient", entityId: created.id },
    });
    expect(syncJob?.status).toBe("PENDING");
  });

  it("TC-011: Archive a patient and verify soft-deletion hides record from active directory while preserving database row", async () => {
    const createRes = await patientsPOST(
      makeRequest("http://localhost:3000/api/patients", "POST", {
        referenceId: "QA_PATIENT_006",
        firstName: "Arjun",
        lastName: "Reddy",
        phone: "+91 96543 66006",
      })
    );
    const created = await createRes.json();

    const delRes = await patientDELETE(
      makeRequest(`http://localhost:3000/api/patients/${created.id}`, "DELETE"),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect(delRes.status).toBe(200);

    const list = await (
      await patientsGET(makeRequest("http://localhost:3000/api/patients"))
    ).json();
    expect(list.find((p: any) => p.id === created.id)).toBeUndefined();

    const detailRes = await patientDetailGET(
      makeRequest(`http://localhost:3000/api/patients/${created.id}`),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect(detailRes.status).toBe(404);

    // Underlying row is preserved in SQLite with deletedAt populated
    const rawDb = await db.patient.findUnique({ where: { id: created.id } });
    expect(rawDb).not.toBeNull();
    expect(rawDb?.deletedAt).not.toBeNull();
  });

  it("TC-012: Verify patient 360° relationships (appointments, treatments, invoices) and duplicate prevention (409 Conflict)", async () => {
    const createRes = await patientsPOST(
      makeRequest("http://localhost:3000/api/patients", "POST", {
        referenceId: "QA_PATIENT_007",
        firstName: "Divya",
        lastName: "Nair",
        phone: "+91 95432 77007",
        email: "divya.qa007@example.test",
      })
    );
    const patient = await createRes.json();

    // Attempt duplicate registration with same phone -> 409 Conflict returning existing patient id
    const dupRes = await patientsPOST(
      makeRequest("http://localhost:3000/api/patients", "POST", {
        firstName: "Divya",
        lastName: "Duplicate",
        phone: "+91 95432 77007",
      })
    );
    expect(dupRes.status).toBe(409);
    const dupBody = await dupRes.json();
    expect(dupBody.patient.id).toBe(patient.id);

    // Attach appointment, treatment, and invoice
    await appointmentsPOST(
      makeRequest("http://localhost:3000/api/appointments", "POST", {
        patientId: patient.id,
        type: "Consultation",
        startsAt: "2026-12-01T10:00:00.000Z",
        endsAt: "2026-12-01T10:30:00.000Z",
      })
    );
    await treatmentsPOST(
      makeRequest("http://localhost:3000/api/treatments", "POST", {
        patientId: patient.id,
        category: "Preventive",
        procedure: "Ultrasonic Scaling",
        costPaise: 150000,
        status: "COMPLETED",
      })
    );
    await invoicesPOST(
      makeRequest("http://localhost:3000/api/invoices", "POST", {
        patientId: patient.id,
        discountPaise: 0,
        taxPaise: 0,
        items: [{ description: "Ultrasonic Scaling", quantity: 1, unitPaise: 150000 }],
      })
    );

    const profileRes = await patientDetailGET(
      makeRequest(`http://localhost:3000/api/patients/${patient.id}`),
      { params: Promise.resolve({ id: patient.id }) }
    );
    expect(profileRes.status).toBe(200);
    const profile = await profileRes.json();
    expect(profile.appointments.length).toBe(1);
    expect(profile.treatments.length).toBe(1);
    expect(profile.invoices.length).toBe(1);
  });
});

