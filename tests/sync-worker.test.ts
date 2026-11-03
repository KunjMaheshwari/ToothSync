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

const syncRecordMock = vi.fn();

vi.mock("@/lib/sheets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sheets")>();
  return {
    ...actual,
    syncRecordToSheets: (...args: any[]) => syncRecordMock(...args),
  };
});

import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { queueRecord } from "@/lib/api";
import { POST as postSync } from "@/app/api/sync/route";
import { POST as postPatient } from "@/app/api/patients/route";

describe("SyncQueue worker failure isolation, retry backoff, and stale-data protection", () => {
  const headers = {
    "content-type": "application/json",
    host: "clinic.test",
    origin: "http://clinic.test",
  };

  beforeEach(async () => {
    mockToken = await createSession();
    syncRecordMock.mockReset();
    // Clear any leftover queue items in isolated test.db before this suite
    await db.syncQueue.deleteMany({});
  });

  it("isolates a failing sync job with exponential backoff while allowing subsequent valid records to synchronize", async () => {
    const p1Res = await postPatient(
      new Request("http://clinic.test/api/patients", {
        method: "POST",
        headers,
        body: JSON.stringify({
          firstName: "FailFirst",
          lastName: "Patient",
          phone: `+91 92222${String(Math.floor(10000 + Math.random() * 89999))}`,
          consented: true,
        }),
      })
    );
    const p1 = await p1Res.json();

    const p2Res = await postPatient(
      new Request("http://clinic.test/api/patients", {
        method: "POST",
        headers,
        body: JSON.stringify({
          firstName: "SucceedSecond",
          lastName: "Patient",
          phone: `+91 93333${String(Math.floor(10000 + Math.random() * 89999))}`,
          consented: true,
        }),
      })
    );
    const p2 = await p2Res.json();

    syncRecordMock.mockImplementation(async (_entity: string, record: any) => {
      if (record.id === p1.id) {
        throw new Error("Simulated transient network error");
      }
    });

    const syncRes1 = await postSync(
      new Request("http://clinic.test/api/sync", {
        method: "POST",
        headers,
      })
    );
    expect(syncRes1.status).toBe(200);
    const syncData1 = await syncRes1.json();
    expect(syncData1.synced).toBe(1);
    expect(syncData1.failedCount).toBe(1);

    const job1 = await db.syncQueue.findFirst({ where: { entityId: p1.id } });
    const job2 = await db.syncQueue.findFirst({ where: { entityId: p2.id } });
    expect(job1?.status).toBe("FAILED");
    expect(job1?.attempts).toBe(1);
    expect(job1?.lastError).toContain("Simulated transient network error");
    expect(job1!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(job2?.status).toBe("SYNCED");

    // Now allow retry on job1 by fast-forwarding nextAttemptAt and resolving network error
    await db.syncQueue.update({
      where: { id: job1!.id },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    syncRecordMock.mockResolvedValue(undefined);

    const syncRes2 = await postSync(
      new Request("http://clinic.test/api/sync", {
        method: "POST",
        headers,
      })
    );
    const syncData2 = await syncRes2.json();
    expect(syncData2.synced).toBe(1);

    const job1AfterRetry = await db.syncQueue.findFirst({
      where: { entityId: p1.id },
    });
    expect(job1AfterRetry?.status).toBe("SYNCED");
    expect(job1AfterRetry?.lastError).toBeNull();
  });

  it("prevents a slow in-flight sync from overwriting a newer PENDING local update", async () => {
    const pRes = await postPatient(
      new Request("http://clinic.test/api/patients", {
        method: "POST",
        headers,
        body: JSON.stringify({
          firstName: "ConcurrentWrite",
          lastName: "Patient",
          phone: `+91 94444${String(Math.floor(10000 + Math.random() * 89999))}`,
          consented: true,
        }),
      })
    );
    const p = await pRes.json();

    // Simulate a local database update occurring while syncRecordToSheets is awaiting network I/O
    syncRecordMock.mockImplementationOnce(async () => {
      await queueRecord(db, "Patient", p.id, p.id);
    });

    await postSync(
      new Request("http://clinic.test/api/sync", {
        method: "POST",
        headers,
      })
    );

    const job = await db.syncQueue.findFirst({ where: { entityId: p.id } });
    // Because a concurrent local write re-queued the record during SYNCING,
    // its status MUST remain PENDING so the fresh state is synced on the next pass!
    expect(job?.status).toBe("PENDING");
  });
});

