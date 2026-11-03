import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAuthenticated } from "@/lib/auth";
import { syncRecordToSheets } from "@/lib/sheets";
import { loadSyncRecord } from "@/lib/sync-record";
import { csrfFailure, sameOrigin } from "@/lib/security";

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [pending, failed, synced, last, jobs] = await Promise.all([
    db.syncQueue.count({ where: { status: "PENDING" } }),
    db.syncQueue.count({ where: { status: "FAILED" } }),
    db.syncQueue.count({ where: { status: "SYNCED" } }),
    db.syncMetadata.findFirst({ orderBy: { syncedAt: "desc" } }),
    db.syncQueue.findMany({
      orderBy: { updatedAt: "desc" },
      take: 15,
    }),
  ]);
  const configured = Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_PRIVATE_KEY &&
      process.env.GOOGLE_SHEET_ID
  );
  return NextResponse.json({
    pending,
    failed,
    synced,
    lastSync: last?.syncedAt ?? null,
    configured,
    jobs,
  });
}

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!sameOrigin(req)) return csrfFailure();

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

  const jobs = await db.syncQueue.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      nextAttemptAt: { lte: now },
    },
    take: 50,
    orderBy: { nextAttemptAt: "asc" },
  });

  let synced = 0;
  let failedCount = 0;
  let lastError: string | null = null;

  for (const job of jobs) {
    const claim = await db.syncQueue.updateMany({
      where: { id: job.id, status: { in: ["PENDING", "FAILED"] } },
      data: { status: "SYNCING" },
    });
    if (!claim.count) continue;

    try {
      const record = await loadSyncRecord(job.entity, job.entityId);
      await syncRecordToSheets(job.entity, record);
      await db.$transaction([
        db.syncQueue.update({
          where: { id: job.id },
          data: {
            status: "SYNCED",
            attempts: { increment: 1 },
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
      await db.syncQueue.update({
        where: { id: job.id },
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
}
