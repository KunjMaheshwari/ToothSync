import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { buildSheetRecord } from "@/lib/sheets";
import { makeRequest, resetTestDatabase } from "./helpers";

vi.mock("@/lib/auth", () => ({
  isAuthenticated: vi.fn(async () => true),
}));

import { POST as patientsPOST } from "@/app/api/patients/route";
import { POST as appointmentsPOST } from "@/app/api/appointments/route";
import {
  GET as treatmentsGET,
  POST as treatmentsPOST,
} from "@/app/api/treatments/route";
import { PATCH as treatmentPATCH } from "@/app/api/treatments/[id]/route";
import {
  GET as prescriptionsGET,
  POST as prescriptionsPOST,
} from "@/app/api/prescriptions/route";

describe("PHASE 6 — Treatments & Prescriptions (TC-019 to TC-024)", () => {
  let patient1: any;
  let patient2: any;

  beforeEach(async () => {
    await resetTestDatabase();
    patient1 = await (
      await patientsPOST(
        makeRequest("http://localhost:3000/api/patients", "POST", {
          referenceId: "QA_TRT_PAT_001",
          firstName: "Nikhil",
          lastName: "Verma",
          phone: "+91 98300 20001",
        })
      )
    ).json();
    patient2 = await (
      await patientsPOST(
        makeRequest("http://localhost:3000/api/patients", "POST", {
          referenceId: "QA_TRT_PAT_002",
          firstName: "Sneha",
          lastName: "Kulkarni",
          phone: "+91 98300 20002",
        })
      )
    ).json();
  });

  it("TC-019: Create a treatment with valid category, procedure, toothNumber, description, and integer costPaise", async () => {
    const res = await treatmentsPOST(
      makeRequest("http://localhost:3000/api/treatments", "POST", {
        patientId: patient1.id,
        category: "Endodontics",
        procedure: "Single-Sitting Root Canal Treatment",
        toothNumber: "#16",
        description: "Rotary instrumentation, obturation with gutta-percha",
        costPaise: 450000,
        status: "IN_PROGRESS",
        date: "2026-11-04T11:00:00.000Z",
      })
    );
    expect(res.status).toBe(201);
    const trt = await res.json();
    expect(trt.costPaise).toBe(450000);
    expect(trt.toothNumber).toBe("#16");
    expect(trt.patient.id).toBe(patient1.id);
  });

  it("TC-020: Create multiple treatments for the same patient and verify ordering and cost preservation", async () => {
    await treatmentsPOST(
      makeRequest("http://localhost:3000/api/treatments", "POST", {
        patientId: patient1.id,
        category: "Periodontics",
        procedure: "Full Mouth Scaling & Polishing",
        costPaise: 180000,
        status: "COMPLETED",
        date: "2026-11-01T10:00:00.000Z",
      })
    );
    await treatmentsPOST(
      makeRequest("http://localhost:3000/api/treatments", "POST", {
        patientId: patient1.id,
        category: "Restorative",
        procedure: "Nanohybrid Composite Restoration",
        toothNumber: "#24",
        costPaise: 220000,
        status: "COMPLETED",
        date: "2026-11-02T10:00:00.000Z",
      })
    );
    await treatmentsPOST(
      makeRequest("http://localhost:3000/api/treatments", "POST", {
        patientId: patient1.id,
        category: "Prosthodontics",
        procedure: "Zirconia Crown Preparation",
        toothNumber: "#16",
        costPaise: 850000,
        status: "PLANNED",
        date: "2026-11-03T10:00:00.000Z",
      })
    );

    const listRes = await treatmentsGET(
      makeRequest(`http://localhost:3000/api/treatments?patientId=${patient1.id}`)
    );
    const list = await listRes.json();
    expect(list.length).toBe(3);
    expect(list.map((t: any) => t.costPaise)).toEqual([850000, 220000, 180000]);
  });

  it("TC-021: Validate treatment required fields, negative costPaise rejection, and cross-patient appointment mismatch guard", async () => {
    const negCost = await treatmentsPOST(
      makeRequest("http://localhost:3000/api/treatments", "POST", {
        patientId: patient1.id,
        category: "Restorative",
        procedure: "Composite",
        costPaise: -500,
      })
    );
    expect(negCost.status).toBe(400);

    const emptyProc = await treatmentsPOST(
      makeRequest("http://localhost:3000/api/treatments", "POST", {
        patientId: patient1.id,
        category: "Restorative",
        procedure: "",
        costPaise: 100000,
      })
    );
    expect(emptyProc.status).toBe(400);

    // Create appointment for patient2 and attempt to link it to patient1's treatment -> 400
    const appt2 = await (
      await appointmentsPOST(
        makeRequest("http://localhost:3000/api/appointments", "POST", {
          patientId: patient2.id,
          type: "Consultation",
          startsAt: "2026-11-25T10:00:00.000Z",
          endsAt: "2026-11-25T10:30:00.000Z",
        })
      )
    ).json();

    const mismatchRes = await treatmentsPOST(
      makeRequest("http://localhost:3000/api/treatments", "POST", {
        patientId: patient1.id,
        appointmentId: appt2.id,
        category: "Restorative",
        procedure: "Composite",
        costPaise: 100000,
      })
    );
    expect(mismatchRes.status).toBe(400);
    expect((await mismatchRes.json()).error).toContain(
      "does not belong to the selected patient"
    );
  });

  it("TC-022: Update treatment status and costPaise without creating duplicate database or SyncQueue records", async () => {
    const createRes = await treatmentsPOST(
      makeRequest("http://localhost:3000/api/treatments", "POST", {
        patientId: patient1.id,
        category: "Oral Surgery",
        procedure: "Impacted Third Molar Extraction",
        toothNumber: "#38",
        costPaise: 550000,
        status: "PLANNED",
      })
    );
    const created = await createRes.json();

    const patchRes = await treatmentPATCH(
      makeRequest(`http://localhost:3000/api/treatments/${created.id}`, "PATCH", {
        status: "COMPLETED",
        costPaise: 600000,
        description: "Surgical extraction with 3-0 silk sutures placed",
      }),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect(patchRes.status).toBe(200);
    const updated = await patchRes.json();
    expect(updated.status).toBe("COMPLETED");
    expect(updated.costPaise).toBe(600000);

    const countInDb = await db.treatment.count({
      where: { patientId: patient1.id },
    });
    expect(countInDb).toBe(1);

    const queueCount = await db.syncQueue.count({
      where: { entity: "Treatment", entityId: created.id },
    });
    expect(queueCount).toBe(1);
  });

  it("TC-023: Create multi-item prescription with distinct medications, dosages, frequencies, durations, and instructions", async () => {
    const rxRes = await prescriptionsPOST(
      makeRequest("http://localhost:3000/api/prescriptions", "POST", {
        patientId: patient1.id,
        notes: "Soft cold diet for 24 hours; warm saline rinses after 24 hours",
        date: "2026-11-04T12:00:00.000Z",
        items: [
          {
            medication: "Cap. Amoxicillin + Clavulanic Acid",
            dosage: "625 mg",
            frequency: "1-0-1 (Every 12 hrs)",
            duration: "5 days",
            instructions: "Take after food",
          },
          {
            medication: "Tab. Aceclofenac + Paracetamol",
            dosage: "100mg / 325mg",
            frequency: "1-0-1",
            duration: "3 days",
            instructions: "After meals for pain relief",
          },
          {
            medication: "Tab. Pantoprazole",
            dosage: "40 mg",
            frequency: "1-0-0",
            duration: "5 days",
            instructions: "30 mins before breakfast",
          },
        ],
      })
    );
    expect(rxRes.status).toBe(201);
    const rx = await rxRes.json();
    expect(rx.items.length).toBe(3);
    expect(rx.patientId).toBe(patient1.id);
  });

  it("TC-024: Verify treatment and prescription patient isolation and Google Sheets serialization accuracy", async () => {
    await prescriptionsPOST(
      makeRequest("http://localhost:3000/api/prescriptions", "POST", {
        patientId: patient1.id,
        notes: "Rx for Nikhil",
        items: [
          {
            medication: "Tab. Ibuprofen",
            dosage: "400 mg",
            frequency: "1-0-1",
            duration: "3 days",
          },
        ],
      })
    );
    await prescriptionsPOST(
      makeRequest("http://localhost:3000/api/prescriptions", "POST", {
        patientId: patient2.id,
        notes: "Rx for Sneha",
        items: [
          {
            medication: "Chlorhexidine Mouthwash",
            dosage: "10 ml",
            frequency: "BID",
            duration: "7 days",
          },
        ],
      })
    );

    const p1RxList = await (
      await prescriptionsGET(
        makeRequest(`http://localhost:3000/api/prescriptions?patientId=${patient1.id}`)
      )
    ).json();
    const p2RxList = await (
      await prescriptionsGET(
        makeRequest(`http://localhost:3000/api/prescriptions?patientId=${patient2.id}`)
      )
    ).json();

    expect(p1RxList.length).toBe(1);
    expect(p1RxList[0].items[0].medication).toBe("Tab. Ibuprofen");
    expect(p2RxList.length).toBe(1);
    expect(p2RxList[0].items[0].medication).toBe("Chlorhexidine Mouthwash");

    const sheetRow = buildSheetRecord("Prescription", p1RxList[0]);
    expect(sheetRow.values[2]).toBe("Nikhil Verma");
    expect(sheetRow.values[4]).toBe("Tab. Ibuprofen | 400 mg | 1-0-1 | 3 days");
  });
});

