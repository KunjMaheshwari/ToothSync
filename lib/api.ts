import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";
import { csrfFailure, sameOrigin } from "@/lib/security";
import { isSheetsConfigured, syncRecordToSheets } from "@/lib/sheets";
import { loadSyncRecord } from "@/lib/sync-record";

export async function protectedWrite(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return sameOrigin(request) ? null : csrfFailure();
}

export async function protectedRead() {
  return (await isAuthenticated())
    ? null
    : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function queueRecord(
  tx: { syncQueue: { upsert: any } },
  entity: string,
  entityId: string,
  patientId?: string | null
) {
  return tx.syncQueue.upsert({
    where: {
      entity_entityId_operation: { entity, entityId, operation: "UPSERT" },
    },
    create: {
      patientId: patientId ?? null,
      entity,
      entityId,
      operation: "UPSERT",
      payload: JSON.stringify({ entityId }),
    },
    update: {
      status: "PENDING",
      nextAttemptAt: new Date(),
      lastError: null,
    },
  });
}

export function logAudit(
  tx: { auditLog: { create: any } },
  action:
    | "CREATE"
    | "UPDATE"
    | "ARCHIVE"
    | "PAYMENT"
    | "SYNC"
    | "LOGIN"
    | "LOGOUT",
  entity: string,
  entityId: string
) {
  return tx.auditLog.create({
    data: { action, entity, entityId },
  });
}

/**
 * Safe error handler for database/server exceptions in API routes.
 * Never exposes stack traces, connection strings, secrets, or patient PII.
 */
export function handleApiError(
  _error: unknown,
  fallbackMessage = "Database service is temporarily unavailable. Please retry."
) {
  return NextResponse.json({ error: fallbackMessage }, { status: 503 });
}

/**
 * On Vercel serverless instances, writes through to Google Sheets immediately
 * after a successful database transaction so records persist across cold starts.
 * Never throws or fails the caller if Google Sheets is unavailable.
 */
export async function syncAfterWriteOnServerless(
  entity: string,
  entityId: string
): Promise<void> {
  const isTest =
    Boolean(process.env.VITEST) || process.env.NODE_ENV === "test";
  if (!process.env.VERCEL || isTest || !isSheetsConfigured()) {
    return;
  }

  try {
    const record = await loadSyncRecord(entity, entityId);
    await syncRecordToSheets(entity, record);
    await db.$transaction([
      db.syncQueue.updateMany({
        where: { entity, entityId, operation: "UPSERT" },
        data: {
          status: "SYNCED",
          attempts: { increment: 1 },
          lastError: null,
        },
      }),
      db.syncMetadata.upsert({
        where: { entity_entityId: { entity, entityId } },
        create: { entity, entityId, syncedAt: new Date() },
        update: { syncedAt: new Date() },
      }),
    ]);
  } catch (err) {
    const safeMsg =
      err instanceof Error && err.message
        ? err.message.slice(0, 200)
        : "Automatic background sync deferred to retry queue.";
    await db.syncQueue
      .updateMany({
        where: { entity, entityId, operation: "UPSERT" },
        data: {
          status: "PENDING",
          lastError: safeMsg,
        },
      })
      .catch(() => {});
  }
}
