import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logAudit, protectedRead, protectedWrite, queueRecord } from "@/lib/api";
import { appointmentSchema } from "@/lib/validation";
import { readJson } from "@/lib/security";

export async function GET(req: Request) {
  const denied = await protectedRead();
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const patientId = searchParams.get("patientId");

  const appointments = await db.appointment.findMany({
    where: {
      patient: { deletedAt: null },
      ...(status && status !== "ALL" ? { status } : {}),
      ...(patientId ? { patientId } : {}),
    },
    include: { patient: true },
    orderBy: { startsAt: "asc" },
    take: 100,
  });

  return NextResponse.json(appointments);
}

export async function POST(req: Request) {
  const denied = await protectedWrite(req);
  if (denied) return denied;

  const v = appointmentSchema.safeParse(await readJson(req));
  if (!v.success) {
    const firstIssue = v.error.issues[0]?.message;
    return NextResponse.json(
      { error: firstIssue || "Invalid appointment details." },
      { status: 400 }
    );
  }

  const d = v.data;
  const startsAt = new Date(d.startsAt);
  const endsAt = new Date(d.endsAt);

  const [patient, conflict] = await Promise.all([
    db.patient.findFirst({ where: { id: d.patientId, deletedAt: null } }),
    db.appointment.findFirst({
      where: {
        patient: { deletedAt: null },
        status: { notIn: ["CANCELLED", "COMPLETED"] },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
      include: { patient: true },
    }),
  ]);

  if (!patient) {
    return NextResponse.json({ error: "Patient not found." }, { status: 404 });
  }
  if (conflict) {
    return NextResponse.json(
      {
        error: `This overlaps an existing appointment (${conflict.patient.firstName} ${conflict.patient.lastName}).`,
      },
      { status: 409 }
    );
  }

  const created = await db.$transaction(async (tx) => {
    const appointment = await tx.appointment.create({
      data: {
        ...d,
        startsAt,
        endsAt,
      },
      include: { patient: true },
    });
    await queueRecord(tx, "Appointment", appointment.id, appointment.patientId);
    await logAudit(tx, "CREATE", "Appointment", appointment.id);
    return appointment;
  });

  return NextResponse.json(created, { status: 201 });
}
