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
import { prescriptionSchema } from "@/lib/validation";

export async function GET(req: Request) {
  const denied = await protectedRead();
  if (denied) return denied;
  const patientId = new URL(req.url).searchParams.get("patientId");
  try {
    return NextResponse.json(
      await db.prescription.findMany({
        where: {
          patient: { deletedAt: null },
          ...(patientId ? { patientId } : {}),
        },
        include: { patient: true, items: true },
        orderBy: { date: "desc" },
        take: 100,
      })
    );
  } catch (error) {
    return handleApiError(error, "Unable to load prescriptions.");
  }
}

export async function POST(req: Request) {
  const denied = await protectedWrite(req);
  if (denied) return denied;

  const parsed = prescriptionSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message;
    return NextResponse.json(
      { error: firstIssue || "Invalid prescription details." },
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
      const prescription = await tx.prescription.create({
        data: {
          patientId: d.patientId,
          notes: d.notes || null,
          date: d.date ? new Date(d.date) : undefined,
          items: { create: d.items },
        },
        include: { patient: true, items: true },
      });
      await queueRecord(
        tx,
        "Prescription",
        prescription.id,
        prescription.patientId
      );
      await logAudit(tx, "CREATE", "Prescription", prescription.id);
      return prescription;
    });

    await syncAfterWriteOnServerless("Prescription", record.id);
    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    return handleApiError(error, "Unable to save prescription.");
  }
}
