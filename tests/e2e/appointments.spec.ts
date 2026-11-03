import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { buildSheetRecord } from "@/lib/sheets";
import { makeRequest, resetTestDatabase } from "./helpers";

vi.mock("@/lib/auth", () => ({
  isAuthenticated: vi.fn(async () => true),
}));

import { POST as patientsPOST } from "@/app/api/patients/route";
import {
  GET as appointmentsGET,
  POST as appointmentsPOST,
} from "@/app/api/appointments/route";
import { PATCH as appointmentPATCH } from "@/app/api/appointments/[id]/route";

describe("PHASE 5 — Appointments (TC-013 to TC-018)", () => {
  let patientA: any;
  let patientB: any;

  beforeEach(async () => {
    await resetTestDatabase();
    patientA = await (
      await patientsPOST(
        makeRequest("http://localhost:3000/api/patients", "POST", {
          referenceId: "QA_APPT_PAT_001",
          firstName: "Karan",
          lastName: "Oberoi",
          phone: "+91 98100 10001",
        })
      )
    ).json();
    patientB = await (
      await patientsPOST(
        makeRequest("http://localhost:3000/api/patients", "POST", {
          referenceId: "QA_APPT_PAT_002",
          firstName: "Pooja",
          lastName: "Bhatt",
          phone: "+91 98100 10002",
        })
      )
    ).json();
  });

  it("TC-013: Create an appointment for an existing patient with complaint, planned treatment, and notes", async () => {
    const res = await appointmentsPOST(
      makeRequest("http://localhost:3000/api/appointments", "POST", {
        patientId: patientA.id,
        type: "Root Canal",
        startsAt: "2026-11-10T09:30:00.000Z",
        endsAt: "2026-11-10T10:15:00.000Z",
        complaint: "Acute sensitivity in lower right molar",
        plannedTreatment: "Access opening and working length determination (#46)",
        notes: "Verify pre-op IOPAR",
      })
    );
    expect(res.status).toBe(201);
    const appt = await res.json();
    expect(appt.patientId).toBe(patientA.id);
    expect(appt.status).toBe("SCHEDULED");
    expect(appt.complaint).toBe("Acute sensitivity in lower right molar");
  });

  it("TC-014: Create appointments across different dates/timezones and prevent overlapping time slots (409 Conflict)", async () => {
    // Appointment 1 using IST offset (+05:30 -> 04:30Z to 05:00Z)
    const first = await appointmentsPOST(
      makeRequest("http://localhost:3000/api/appointments", "POST", {
        patientId: patientA.id,
        type: "Dental Cleaning",
        startsAt: new Date("2026-11-12T10:00:00+05:30").toISOString(),
        endsAt: new Date("2026-11-12T10:30:00+05:30").toISOString(),
      })
    );
    expect(first.status).toBe(201);

    // Overlapping appointment for patientB (10:15 to 10:45 IST) -> must fail with 409
    const overlap = await appointmentsPOST(
      makeRequest("http://localhost:3000/api/appointments", "POST", {
        patientId: patientB.id,
        type: "Consultation",
        startsAt: new Date("2026-11-12T10:15:00+05:30").toISOString(),
        endsAt: new Date("2026-11-12T10:45:00+05:30").toISOString(),
      })
    );
    expect(overlap.status).toBe(409);

    // Non-overlapping adjacent slot (10:30 to 11:00 IST) -> succeeds
    const adjacent = await appointmentsPOST(
      makeRequest("http://localhost:3000/api/appointments", "POST", {
        patientId: patientB.id,
        type: "Crown & Bridge",
        startsAt: new Date("2026-11-12T10:30:00+05:30").toISOString(),
        endsAt: new Date("2026-11-12T11:00:00+05:30").toISOString(),
      })
    );
    expect(adjacent.status).toBe(201);
  });

  it("TC-015: Validate required appointment fields (patientId, startsAt, endsAt, type)", async () => {
    const missingPatient = await appointmentsPOST(
      makeRequest("http://localhost:3000/api/appointments", "POST", {
        patientId: "",
        type: "Consultation",
        startsAt: "2026-11-15T10:00:00.000Z",
        endsAt: "2026-11-15T10:30:00.000Z",
      })
    );
    expect(missingPatient.status).toBe(400);

    const missingType = await appointmentsPOST(
      makeRequest("http://localhost:3000/api/appointments", "POST", {
        patientId: patientA.id,
        type: "   ",
        startsAt: "2026-11-15T10:00:00.000Z",
        endsAt: "2026-11-15T10:30:00.000Z",
      })
    );
    expect(missingType.status).toBe(400);
  });

  it("TC-016: Validate invalid dates, inverted start/end times, and non-existent patient references", async () => {
    const inverted = await appointmentsPOST(
      makeRequest("http://localhost:3000/api/appointments", "POST", {
        patientId: patientA.id,
        type: "Consultation",
        startsAt: "2026-11-15T11:00:00.000Z",
        endsAt: "2026-11-15T10:30:00.000Z",
      })
    );
    expect(inverted.status).toBe(400);
    expect((await inverted.json()).error).toContain(
      "End time must be after start time"
    );

    const unknownPatient = await appointmentsPOST(
      makeRequest("http://localhost:3000/api/appointments", "POST", {
        patientId: "cm00000000000000000000000",
        type: "Consultation",
        startsAt: "2026-11-15T10:00:00.000Z",
        endsAt: "2026-11-15T10:30:00.000Z",
      })
    );
    expect(unknownPatient.status).toBe(404);
  });

  it("TC-017: Update appointment details and status transitions (SCHEDULED -> CONFIRMED -> COMPLETED) freeing overlapping slots", async () => {
    const createRes = await appointmentsPOST(
      makeRequest("http://localhost:3000/api/appointments", "POST", {
        patientId: patientA.id,
        type: "Consultation",
        startsAt: "2026-11-18T14:00:00.000Z",
        endsAt: "2026-11-18T14:30:00.000Z",
      })
    );
    const appt = await createRes.json();

    const confirmRes = await appointmentPATCH(
      makeRequest(`http://localhost:3000/api/appointments/${appt.id}`, "PATCH", {
        status: "CONFIRMED",
        notes: "Patient confirmed via phone",
      }),
      { params: Promise.resolve({ id: appt.id }) }
    );
    expect(confirmRes.status).toBe(200);
    expect((await confirmRes.json()).status).toBe("CONFIRMED");

    const completeRes = await appointmentPATCH(
      makeRequest(`http://localhost:3000/api/appointments/${appt.id}`, "PATCH", {
        status: "COMPLETED",
      }),
      { params: Promise.resolve({ id: appt.id }) }
    );
    expect(completeRes.status).toBe(200);
    expect((await completeRes.json()).status).toBe("COMPLETED");

    // Once COMPLETED, booking another patient in the same slot is allowed
    const rebookRes = await appointmentsPOST(
      makeRequest("http://localhost:3000/api/appointments", "POST", {
        patientId: patientB.id,
        type: "Emergency Visit",
        startsAt: "2026-11-18T14:00:00.000Z",
        endsAt: "2026-11-18T14:30:00.000Z",
      })
    );
    expect(rebookRes.status).toBe(201);
  });

  it("TC-018: Verify appointment-to-patient relationship, filtering, and single-row SyncQueue idempotency", async () => {
    const createRes = await appointmentsPOST(
      makeRequest("http://localhost:3000/api/appointments", "POST", {
        patientId: patientA.id,
        type: "Orthodontic Adjustment",
        startsAt: "2026-11-20T15:00:00.000Z",
        endsAt: "2026-11-20T15:45:00.000Z",
      })
    );
    const appt = await createRes.json();

    await appointmentPATCH(
      makeRequest(`http://localhost:3000/api/appointments/${appt.id}`, "PATCH", {
        status: "COMPLETED",
      }),
      { params: Promise.resolve({ id: appt.id }) }
    );

    const listRes = await appointmentsGET(
      makeRequest(
        `http://localhost:3000/api/appointments?patientId=${patientA.id}&status=COMPLETED`
      )
    );
    const list = await listRes.json();
    expect(list.length).toBe(1);
    expect(list[0].patient.firstName).toBe("Karan");

    // Verify SyncQueue has exactly 1 deduplicated UPSERT entry for this appointment
    const syncJobs = await db.syncQueue.findMany({
      where: { entity: "Appointment", entityId: appt.id },
    });
    expect(syncJobs.length).toBe(1);

    const sheetRow = buildSheetRecord("Appointment", list[0]);
    expect(sheetRow.values).toEqual([
      appt.id,
      patientA.id,
      "Karan Oberoi",
      "2026-11-20T15:00:00.000Z",
      "2026-11-20T15:45:00.000Z",
      "Orthodontic Adjustment",
      "COMPLETED",
    ]);
  });
});

