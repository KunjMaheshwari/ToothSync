import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logAudit, protectedRead, protectedWrite, queueRecord } from "@/lib/api";
import { readJson } from "@/lib/security";
import { treatmentSchema } from "@/lib/validation";

export async function GET(req: Request) {
  const denied = await protectedRead();
  if (denied) return denied;
  const patientId = new URL(req.url).searchParams.get("patientId");
  return NextResponse.json(
    await db.treatment.findMany({
      where: {
        patient: { deletedAt: null },
        ...(patientId ? { patientId } : {}),
      },
      include: { patient: true, appointment: true },
      orderBy: { date: "desc" },
      take: 100,
    })
  );
}

export async function POST(req: Request) {
  const denied = await protectedWrite(req);
  if (denied) return denied;

  const parsed = treatmentSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message;
    return NextResponse.json(
      { error: firstIssue || "Invalid treatment details." },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const patient = await db.patient.findFirst({
    where: { id: d.patientId, deletedAt: null },
  });
  if (!patient) {
    return NextResponse.json({ error: "Patient not found." }, { status: 404 });
  }

  if (d.appointmentId) {
    const appt = await db.appointment.findUnique({ where: { id: d.appointmentId } });
    if (!appt) {
      return NextResponse.json({ error: "Linked appointment not found." }, { status: 404 });
    }
    if (appt.patientId !== d.patientId) {
      return NextResponse.json(
        { error: "Linked appointment does not belong to the selected patient." },
        { status: 400 }
      );
    }
  }

  const record = await db.$transaction(async (tx) => {
    const treatment = await tx.treatment.create({
      data: {
        ...d,
        appointmentId: d.appointmentId || null,
        date: d.date ? new Date(d.date) : undefined,
      },
      include: { patient: true },
    });
    await queueRecord(tx, "Treatment", treatment.id, treatment.patientId);
    await logAudit(tx, "CREATE", "Treatment", treatment.id);
    return treatment;
  });

  return NextResponse.json(record, { status: 201 });
}
