import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  handleApiError,
  logAudit,
  protectedRead,
  protectedWrite,
  queueRecord,
  syncAfterWriteOnServerless,
} from "@/lib/api";
import { readJson } from "@/lib/security";
import { followUpSchema } from "@/lib/validation";

export async function GET(req: Request) {
  const denied = await protectedRead();
  if (denied) return denied;
  const patientId = new URL(req.url).searchParams.get("patientId");
  try {
    return NextResponse.json(
      await db.followUp.findMany({
        where: {
          patient: { deletedAt: null },
          ...(patientId ? { patientId } : {}),
        },
        include: { patient: true },
        orderBy: { dueDate: "asc" },
        take: 100,
      })
    );
  } catch (error) {
    return handleApiError(error, "Unable to load follow-ups.");
  }
}

export async function POST(req: Request) {
  const denied = await protectedWrite(req);
  if (denied) return denied;

  const parsed = followUpSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message;
    return NextResponse.json(
      { error: firstIssue || "Invalid follow-up details." },
      { status: 400 }
    );
  }

  const d = parsed.data;
  try {
    if (
      !(await db.patient.findFirst({
        where: { id: d.patientId, deletedAt: null },
      }))
    ) {
      return NextResponse.json(
        { error: "Patient not found." },
        { status: 404 }
      );
    }

    const record = await db.$transaction(async (tx) => {
      const followUp = await tx.followUp.create({
        data: {
          ...d,
          notes: d.notes || null,
          dueDate: new Date(d.dueDate),
        },
        include: { patient: true },
      });
      await queueRecord(tx, "FollowUp", followUp.id, followUp.patientId);
      await logAudit(tx, "CREATE", "FollowUp", followUp.id);
      return followUp;
    });

    await syncAfterWriteOnServerless("FollowUp", record.id);
    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    return handleApiError(error, "Unable to save follow-up.");
  }
}
