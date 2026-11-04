import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPrismaClient,
  initializeSchemaOnClient,
  resolveStorageConfig,
} from "@/lib/db";
import { handleApiError } from "@/lib/api";
import { describeProfileLoadFailure } from "@/lib/client-errors";
import * as auth from "@/lib/auth";
import { POST as patientsPOST } from "@/app/api/patients/route";
import { GET as patientGET } from "@/app/api/patients/[id]/route";
import { POST as appointmentsPOST } from "@/app/api/appointments/route";
import { makeRequest, resetTestDatabase } from "./e2e/helpers";

// Regression suite for the production incident:
// "Could not load patient profile." caused by per-instance /tmp SQLite on Vercel.

const SYNTHETIC = {
  firstName: "Synthetic",
  lastName: "ProfileRegression",
  consented: true,
};

function profileQuery(client: PrismaClient, id: string) {
  return client.patient.findFirst({
    where: { id, deletedAt: null },
    include: {
      appointments: true,
      treatments: true,
      prescriptions: { include: { items: true } },
      invoices: { include: { items: true, payments: true } },
      followUps: true,
    },
  });
}

describe("storage configuration (root cause guard)", () => {
  it("falls back to ephemeral /tmp SQLite on Vercel when remote database is not configured", () => {
    const cfg = resolveStorageConfig({ VERCEL: "1", DATABASE_URL: "file:./dev.db" } as any);
    expect(cfg.mode).toBe("ephemeral-tmp");
    expect(cfg.durable).toBe(false);
  });

  it("prohibits ephemeral /tmp when ALLOW_EPHEMERAL_DATABASE=false is set", () => {
    const cfg = resolveStorageConfig({ VERCEL: "1", ALLOW_EPHEMERAL_DATABASE: "false" } as any);
    expect(cfg.mode).toBe("unconfigured");
    expect(cfg.durable).toBe(false);
  });

  it("uses the shared libSQL/Turso database when configured", () => {
    const cfg = resolveStorageConfig({
      VERCEL: "1",
      TURSO_DATABASE_URL: "libsql://example.turso.io",
      TURSO_AUTH_TOKEN: "x",
    } as any);
    expect(cfg.mode).toBe("libsql");
    expect(cfg.durable).toBe(true);
  });

  it("keeps the local SQLite file for local development", () => {
    const cfg = resolveStorageConfig({ DATABASE_URL: "file:./dev.db" } as any);
    expect(cfg.mode).toBe("sqlite-file");
    expect(cfg.durable).toBe(true);
  });
});

describe("cross-instance profile consistency", () => {
  const files: string[] = [];
  const clients: PrismaClient[] = [];
  afterEach(async () => {
    for (const c of clients.splice(0)) await c.$disconnect();
    for (const f of files.splice(0)) for (const s of ["", "-wal", "-shm", "-journal"]) fs.rmSync(f + s, { force: true });
  });

  it("reproduces the original defect: separate /tmp files per instance -> profile 404", async () => {
    const a = `/tmp/regress-a-${Date.now()}.db`;
    const b = `/tmp/regress-b-${Date.now()}.db`;
    files.push(a, b);
    const listInstance = createPrismaClient({ mode: "ephemeral-tmp", url: `file:${a}`, durable: false });
    const profileInstance = createPrismaClient({ mode: "ephemeral-tmp", url: `file:${b}`, durable: false });
    clients.push(listInstance, profileInstance);
    await initializeSchemaOnClient(listInstance);
    await initializeSchemaOnClient(profileInstance);
    const p = await listInstance.patient.create({
      data: { ...SYNTHETIC, patientId: "REG-A-0001", phone: "+910000000101" },
    });
    expect(await profileQuery(profileInstance, p.id)).toBeNull();
  });

  it("fix: two independent instances on one shared libSQL database both see the patient profile", async () => {
    const shared = `/tmp/regress-shared-${Date.now()}.db`;
    files.push(shared);
    const cfg = { mode: "libsql" as const, url: `file:${shared}`, durable: true };
    const listInstance = createPrismaClient(cfg);
    const profileInstance = createPrismaClient(cfg);
    clients.push(listInstance, profileInstance);
    await initializeSchemaOnClient(listInstance);
    await initializeSchemaOnClient(profileInstance); // idempotent second bootstrap
    const p = await listInstance.patient.create({
      data: { ...SYNTHETIC, patientId: "REG-S-0001", phone: "+910000000102" },
    });
    await listInstance.appointment.create({
      data: {
        patientId: p.id,
        startsAt: new Date("2030-01-01T05:00:00Z"),
        endsAt: new Date("2030-01-01T05:30:00Z"),
        type: "Consultation",
      },
    });
    const profile = await profileQuery(profileInstance, p.id);
    expect(profile?.id).toBe(p.id);
    expect(profile?.appointments).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(profile)).registeredAt).toMatch(/T/);
  });
});

describe("GET /api/patients/[id] contract", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(auth, "isAuthenticated").mockResolvedValue(true);
    await resetTestDatabase();
  });

  it("returns 200 with all relation arrays for a patient created via the API", async () => {
    const created = await patientsPOST(
      makeRequest("http://localhost:3000/api/patients", "POST", {
        ...SYNTHETIC,
        phone: `+91 98${String(Date.now()).slice(-8)}`,
      })
    );
    expect(created.status).toBe(201);
    const patient = await created.json();
    const appt = await appointmentsPOST(
      makeRequest("http://localhost:3000/api/appointments", "POST", {
        patientId: patient.id,
        startsAt: "2030-02-01T05:00:00.000Z",
        endsAt: "2030-02-01T05:30:00.000Z",
        type: "Consultation",
      })
    );
    expect(appt.status).toBeLessThan(300);

    const res = await patientGET(makeRequest(`http://localhost:3000/api/patients/${patient.id}`), {
      params: Promise.resolve({ id: patient.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(patient.id);
    for (const rel of ["appointments", "treatments", "prescriptions", "invoices", "followUps"]) {
      expect(Array.isArray(body[rel])).toBe(true);
    }
    expect(body.appointments).toHaveLength(1);
  });

  it("returns 404 (not 500) for an unknown id", async () => {
    const res = await patientGET(makeRequest("http://localhost:3000/api/patients/does-not-exist"), {
      params: Promise.resolve({ id: "does-not-exist" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("error reporting", () => {
  it("maps database-not-configured and Prisma codes to accurate statuses", async () => {
    const notConfigured = handleApiError(Object.assign(new Error("x"), { code: "DATABASE_NOT_CONFIGURED" }));
    expect(notConfigured.status).toBe(503);
    expect((await notConfigured.json()).code).toBe("DATABASE_NOT_CONFIGURED");
    expect(handleApiError({ code: "P2025" }).status).toBe(404);
    expect(handleApiError({ code: "P2002" }).status).toBe(409);
    expect(handleApiError({ code: "P2003" }).status).toBe(400);
    expect(handleApiError(new Error("boom")).status).toBe(503);
  });

  it("frontend profile toast reflects the real failure instead of a generic message", () => {
    expect(describeProfileLoadFailure(401, null)).toMatch(/session has expired/i);
    expect(describeProfileLoadFailure(404, { error: "Patient not found." })).toMatch(/could not be found/i);
    expect(describeProfileLoadFailure(503, { error: "Patient records are unavailable: x" })).toBe(
      "Patient records are unavailable: x"
    );
    expect(describeProfileLoadFailure(0, null)).toMatch(/reach the server/i);
  });
});

describe("unconfigured Vercel deployment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns an explicit 503 instead of serving an empty database when ALLOW_EPHEMERAL_DATABASE=false", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("TURSO_DATABASE_URL", "");
    vi.stubEnv("ALLOW_EPHEMERAL_DATABASE", "false");
    // Drop the dev-mode cached extended client so lib/db re-evaluates its storage config.
    const g = globalThis as { prismaExtended?: unknown };
    const cachedExtended = g.prismaExtended;
    delete g.prismaExtended;
    vi.resetModules();
    const authMod = await import("@/lib/auth");
    vi.spyOn(authMod, "isAuthenticated").mockResolvedValue(true);
    const route = await import("@/app/api/patients/[id]/route");
    const res = await route.GET(makeRequest("http://localhost:3000/api/patients/abc"), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("DATABASE_NOT_CONFIGURED");
    g.prismaExtended = cachedExtended;
  });
});
