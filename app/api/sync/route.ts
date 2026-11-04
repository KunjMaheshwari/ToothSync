import { NextResponse } from "next/server";
import { db, storageConfig } from "@/lib/db";
import { isAuthenticated } from "@/lib/auth";
import { handleApiError } from "@/lib/api";
import {
  hydrateDatabaseFromSheets,
  isSheetsConfigured,
  syncRecordToSheets,
} from "@/lib/sheets";
import { loadSyncRecord } from "@/lib/sync-record";
import { csrfFailure, sameOrigin } from "@/lib/security";

const ENTITY_PRIORITY: Record<string, number> = {
  Patient: 1,
  Appointment: 2,
  Treatment: 3,
  Prescription: 4,
  Invoice: 5,
  Payment: 6,
  FollowUp: 7,
};

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const [pending, failed, synced, last, jobs] = await Promise.all([
      db.syncQueue.count({ where: { status: "PENDING" } }),
      db.syncQueue.count({ where: { status: "FAILED" } }),
      db.syncQueue.count({ where: { status: "SYNCED" } }),
      db.syncMetadata.findFirst({ orderBy: { syncedAt: "desc" } }),
      db.syncQueue.findMany({
        orderBy: { updatedAt: "desc" },
        take: 20,
      }),
    ]);
    return NextResponse.json({
      pending,
      failed,
      synced,
      lastSync: last?.syncedAt ?? null,
      configured: isSheetsConfigured(),
      storage: { mode: storageConfig.mode, durable: storageConfig.durable },
      jobs,
    });
  } catch (error) {
    return handleApiError(error, "Unable to load synchronization status.");
  }
}

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!sameOrigin(req)) return csrfFailure();

  try {
    const now = new Date();
    await db.syncQueue.updateMany({
      where: {
        status: "SYNCING",
        updatedAt: { lt: new Date(Date.now() - 10 * 60_000) },
      },
      data: {
        status: "FAILED",
        lastError: "Synchronization lease expired after interruption.",
        nextAttemptAt: now,
      },
    });

    const rawJobs = await db.syncQueue.findMany({
      where: {
        status: { in: ["PENDING", "FAILED"] },
        nextAttemptAt: { lte: now },
      },
      take: 50,
      orderBy: { nextAttemptAt: "asc" },
    });

    // Sort by relational dependency priority first (Patient -> Invoice -> Payment)
    const jobs = [...rawJobs].sort((a, b) => {
      const pa = ENTITY_PRIORITY[a.entity] ?? 99;
      const pb = ENTITY_PRIORITY[b.entity] ?? 99;
      if (pa !== pb) return pa - pb;
      return a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime();
    });

    let synced = 0;
    let failedCount = 0;
    let lastError: string | null = null;

    if (
      jobs.length === 0 &&
      storageConfig.mode === "ephemeral-tmp" &&
      isSheetsConfigured() &&
      (await db.patient.count()) === 0
    ) {
      try {
        const res = await hydrateDatabaseFromSheets(db);
        synced += res.hydratedPatients;
      } catch (e) {
        lastError =
          e instanceof Error && e.message
            ? e.message.slice(0, 240)
            : "Unable to hydrate from Google Sheets.";
      }
    }

    for (const job of jobs) {
      const claim = await db.syncQueue.updateMany({
        where: { id: job.id, status: { in: ["PENDING", "FAILED"] } },
        data: { status: "SYNCING" },
      });
      if (!claim.count) continue;

      try {
        const record = await loadSyncRecord(job.entity, job.entityId);
        await syncRecordToSheets(job.entity, record);

        // Stale-data guard: Only transition SYNCING -> SYNCED.
        await db.$transaction([
          db.syncQueue.updateMany({
            where: { id: job.id, status: "SYNCING" },
            data: {
              status: "SYNCED",
              attempts: job.attempts + 1,
              lastError: null,
            },
          }),
          db.syncMetadata.upsert({
            where: {
              entity_entityId: { entity: job.entity, entityId: job.entityId },
            },
            create: {
              entity: job.entity,
              entityId: job.entityId,
              syncedAt: new Date(),
            },
            update: { syncedAt: new Date() },
          }),
          db.auditLog.create({
            data: {
              action: "SYNC",
              entity: job.entity,
              entityId: job.entityId,
            },
          }),
        ]);
        synced++;
      } catch (e) {
        failedCount++;
        const attempts = job.attempts + 1;
        const errMsg =
          e instanceof Error && e.message
            ? e.message.slice(0, 240)
            : "Synchronization failed. Check configuration and retry.";
        lastError = errMsg;
        await db.syncQueue.updateMany({
          where: { id: job.id, status: "SYNCING" },
          data: {
            status: "FAILED",
            attempts,
            lastError: errMsg,
            nextAttemptAt: new Date(
              Date.now() + Math.min(3_600_000, 1000 * 2 ** attempts)
            ),
          },
        });
      }
    }

    const [pending, failed, last] = await Promise.all([
      db.syncQueue.count({ where: { status: "PENDING" } }),
      db.syncQueue.count({ where: { status: "FAILED" } }),
      db.syncMetadata.findFirst({ orderBy: { syncedAt: "desc" } }),
    ]);

    return NextResponse.json({
      synced,
      failedCount,
      pending,
      failed,
      lastSync: last?.syncedAt ?? null,
      lastError,
    });
  } catch (error) {
    return handleApiError(
      error,
      "Unable to process synchronization queue at the moment."
    );
  }
}
