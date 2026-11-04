import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  db,
  initializeSchemaOnClient,
  resolveDatabaseUrl,
} from "@/lib/db";
import * as auth from "@/lib/auth";
import * as sheets from "@/lib/sheets";
import { GET as dashboardGET } from "@/app/api/dashboard/route";
import {
  GET as patientsGET,
  POST as patientsPOST,
} from "@/app/api/patients/route";
import {
  DELETE as patientDELETE,
  GET as patientGET,
  PATCH as patientPATCH,
} from "@/app/api/patients/[id]/route";
import {
  createSheetsTestHarness,
  makeRequest,
  resetTestDatabase,
} from "./e2e/helpers";

describe("Production Incident Reliability — Database, Hydration & API Error Handling", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(auth, "isAuthenticated").mockResolvedValue(true);
    await resetTestDatabase();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves DATABASE_URL to writable /tmp/dentalcare.db on Vercel serverless while preserving isolated test DB", () => {
    const origVercel = process.env.VERCEL;
    const origVitest = process.env.VITEST;
    const origNodeEnv = process.env.NODE_ENV;
    const origDbUrl = process.env.DATABASE_URL;

    try {
      // In test mode, test.db is preserved
      expect(resolveDatabaseUrl()).toContain("test.db");

      // Simulate Vercel serverless production runtime with relative file:./dev.db
      delete process.env.VITEST;
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      process.env.VERCEL = "1";
      process.env.DATABASE_URL = "file:./dev.db";

      expect(resolveDatabaseUrl()).toBe("file:/tmp/dentalcare.db");
    } finally {
      if (origVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = origVercel;
      if (origVitest === undefined) delete process.env.VITEST;
      else process.env.VITEST = origVitest;
      (process.env as Record<string, string | undefined>).NODE_ENV = origNodeEnv;
      if (origDbUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = origDbUrl;
    }
  });

  it("initializes all 13 schema tables on a brand-new empty /tmp SQLite file and hydrates clinical & financial records from Google Sheets", async () => {
    const tmpDbPath = `/tmp/dentalcare_hydration_test_${Date.now()}.db`;
    const tmpClient = new PrismaClient({
      datasources: { db: { url: `file:${tmpDbPath}` } },
    });

    try {
      await initializeSchemaOnClient(tmpClient);

      // Populate a simulated Google Sheet with realistic clinical and financial records
      const harness = createSheetsTestHarness();
      const nowIso = new Date().toISOString();

      await sheets.syncRecordToSheets(
        "Patient",
        {
          id: "pat_hydrated_1",
          patientId: "DNT-2026-88880001",
          referenceId: "HYD_REF_001",
          firstName: "Ananya",
          lastName: "Sharma",
          dateOfBirth: new Date("1992-05-14"),
          gender: "Female",
          phone: "+91 98111 22334",
          email: "ananya.hydrated@example.test",
          city: "Mumbai",
          allergies: "None known",
          conditions: "None",
          dentalHistory: "Routine scaling",
          consented: true,
          registeredAt: new Date(nowIso),
          updatedAt: new Date(nowIso),
        },
        harness.client
      );

      await sheets.syncRecordToSheets(
        "Appointment",
        {
          id: "appt_hydrated_1",
          patientId: "pat_hydrated_1",
          patient: { firstName: "Ananya", lastName: "Sharma" },
          startsAt: new Date(nowIso),
          endsAt: new Date(Date.now() + 1800_000),
          type: "Consultation",
          status: "COMPLETED",
        },
        harness.client
      );

      await sheets.syncRecordToSheets(
        "Invoice",
        {
          id: "inv_hydrated_1",
          patientId: "pat_hydrated_1",
          patient: { firstName: "Ananya", lastName: "Sharma" },
          invoiceNumber: "INV-2026-88880001",
          date: new Date(nowIso),
          totalPaise: 150000,
          paidPaise: 150000,
          status: "PAID",
        },
        harness.client
      );

      await sheets.syncRecordToSheets(
        "Payment",
        {
          id: "pay_hydrated_1",
          invoiceId: "inv_hydrated_1",
          amountPaise: 150000,
          method: "UPI",
          paidAt: new Date(nowIso),
        },
        harness.client
      );

      const result = await sheets.hydrateDatabaseFromSheets(
        tmpClient,
        harness.client
      );
      expect(result.hydratedPatients).toBe(1);

      const hydratedPatient = await tmpClient.patient.findUnique({
        where: { id: "pat_hydrated_1" },
        include: {
          appointments: true,
          invoices: { include: { items: true, payments: true } },
        },
      });

      expect(hydratedPatient).not.toBeNull();
      expect(hydratedPatient?.firstName).toBe("Ananya");
      expect(hydratedPatient?.appointments).toHaveLength(1);
      expect(hydratedPatient?.invoices).toHaveLength(1);
      expect(hydratedPatient?.invoices[0].totalPaise).toBe(150000);
      expect(hydratedPatient?.invoices[0].payments).toHaveLength(1);
      expect(hydratedPatient?.invoices[0].payments[0].amountPaise).toBe(150000);
    } finally {
      await tmpClient.$disconnect();
      try {
        fs.unlinkSync(tmpDbPath);
      } catch {}
    }
  });

  it("returns HTTP 503 with a safe database error message (and never 'Please check required fields' or stack traces) when the database is unavailable during POST /api/patients and GET /api/dashboard", async () => {
    const origFindFirst = db.patient.findFirst;
    const origCount = db.patient.count;
    try {
      (db.patient as any).findFirst = vi
        .fn()
        .mockRejectedValueOnce(
          new Error(
            "PrismaClientInitializationError: Unable to open database file /var/task/prisma/dev.db"
          )
        );

      const createRes = await patientsPOST(
        makeRequest("http://localhost:3000/api/patients", "POST", {
          firstName: "Vikram",
          lastName: "Patel",
          phone: "+91 98765 43219",
          consented: true,
        })
      );

      expect(createRes.status).toBe(503);
      const createBody = await createRes.json();
      expect(createBody.error).toBe(
        "Unable to save patient record due to a database error. Please retry."
      );
      expect(createBody.error).not.toContain("Please check");
      expect(createBody.error).not.toContain("/var/task");

      (db.patient as any).count = vi
        .fn()
        .mockRejectedValueOnce(
          new Error(
            "PrismaClientInitializationError: Unable to open database file"
          )
        );

      const dashRes = await dashboardGET();
      expect(dashRes.status).toBe(503);
      const dashBody = await dashRes.json();
      expect(dashBody.error).toBe(
        "Unable to load dashboard metrics. Please retry."
      );
      expect(dashBody.error).not.toContain("PrismaClientInitializationError");
    } finally {
      (db.patient as any).findFirst = origFindFirst;
      (db.patient as any).count = origCount;
    }
  });

  it("preserves patient creation (HTTP 201) and marks SyncQueue as PENDING when Google Sheets is unavailable during Vercel serverless write-through", async () => {
    const origVercel = process.env.VERCEL;
    const origVitest = process.env.VITEST;
    const origNodeEnv = process.env.NODE_ENV;

    try {
      process.env.VERCEL = "1";
      delete process.env.VITEST;
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";

      vi.spyOn(sheets, "isSheetsConfigured").mockReturnValue(true);
      vi.spyOn(sheets, "syncRecordToSheets").mockRejectedValue(
        new Error("Google Sheets API 503 Service Unavailable")
      );

      const res = await patientsPOST(
        makeRequest("http://localhost:3000/api/patients", "POST", {
          firstName: "Kavita",
          lastName: "Joshi",
          phone: "+91 98222 33445",
          consented: true,
        })
      );

      expect(res.status).toBe(201);
      const patient = await res.json();
      expect(patient.firstName).toBe("Kavita");

      const queueEntry = await db.syncQueue.findFirst({
        where: { entity: "Patient", entityId: patient.id },
      });
      expect(queueEntry).not.toBeNull();
      expect(queueEntry?.status).toBe("PENDING");
      expect(queueEntry?.lastError).toContain("Google Sheets API 503");
    } finally {
      if (origVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = origVercel;
      if (origVitest === undefined) delete process.env.VITEST;
      else process.env.VITEST = origVitest;
      (process.env as Record<string, string | undefined>).NODE_ENV = origNodeEnv;
    }
  });

  it("validates patient creation, update, retrieval, archive, and unauthorized access with proper HTTP status codes", async () => {
    // 1. Missing required fields -> 400
    const badRes = await patientsPOST(
      makeRequest("http://localhost:3000/api/patients", "POST", {
        firstName: "",
        lastName: "Test",
        phone: "123",
      })
    );
    expect(badRes.status).toBe(400);

    // 2. Valid creation -> 201
    const okRes = await patientsPOST(
      makeRequest("http://localhost:3000/api/patients", "POST", {
        firstName: "Neha",
        lastName: "Kulkarni",
        phone: "+91 98333 44556",
        email: "neha.kulkarni@example.test",
        consented: true,
      })
    );
    expect(okRes.status).toBe(201);
    const created = await okRes.json();

    // 3. Duplicate phone/email -> 409
    const dupRes = await patientsPOST(
      makeRequest("http://localhost:3000/api/patients", "POST", {
        firstName: "Neha",
        lastName: "Kulkarni",
        phone: "+91 98333 44556",
        consented: true,
      })
    );
    expect(dupRes.status).toBe(409);

    // 4. Update patient -> 200
    const patchRes = await patientPATCH(
      makeRequest(
        `http://localhost:3000/api/patients/${created.id}`,
        "PATCH",
        { city: "Pune" }
      ),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect(patchRes.status).toBe(200);
    const updated = await patchRes.json();
    expect(updated.city).toBe("Pune");

    // 5. Retrieve patient -> 200
    const getRes = await patientGET(
      makeRequest(`http://localhost:3000/api/patients/${created.id}`),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect(getRes.status).toBe(200);

    // 6. Archive patient -> 200 and no longer returned in active GET
    const delRes = await patientDELETE(
      makeRequest(
        `http://localhost:3000/api/patients/${created.id}`,
        "DELETE"
      ),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect(delRes.status).toBe(200);

    const afterArchiveRes = await patientGET(
      makeRequest(`http://localhost:3000/api/patients/${created.id}`),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect(afterArchiveRes.status).toBe(404);

    // 7. Unauthorized access -> 401
    vi.spyOn(auth, "isAuthenticated").mockResolvedValueOnce(false);
    const unauthRes = await patientsGET(
      makeRequest("http://localhost:3000/api/patients")
    );
    expect(unauthRes.status).toBe(401);
  });
});
