import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logAudit, protectedWrite, queueRecord } from "@/lib/api";
import { readJson } from "@/lib/security";
import { appointmentUpdateSchema } from "@/lib/validation";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await protectedWrite(req);
  if (denied) return denied;
  const { id } = await params;

  const existing = await db.appointment.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Appointment not found." }, { status: 404 });
  }

  const parsed = appointmentUpdateSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message;
    return NextResponse.json(
      { error: firstIssue || "Invalid appointment update." },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const nextStartsAt = d.startsAt ? new Date(d.startsAt) : existing.startsAt;
  const nextEndsAt = d.endsAt ? new Date(d.endsAt) : existing.endsAt;
  const nextStatus = d.status ?? existing.status;

  if (nextEndsAt <= nextStartsAt) {
    return NextResponse.json(
      { error: "End time must be after start time." },
      { status: 400 }
    );
  }

  if (
    (d.startsAt || d.endsAt) &&
    !["CANCELLED", "COMPLETED"].includes(nextStatus)
  ) {
    const conflict = await db.appointment.findFirst({
      where: {
        id: { not: id },
        status: { notIn: ["CANCELLED", "COMPLETED"] },
        startsAt: { lt: nextEndsAt },
        endsAt: { gt: nextStartsAt },
      },
    });
    if (conflict) {
      return NextResponse.json(
        { error: "Rescheduled time overlaps an existing appointment." },
        { status: 409 }
      );
    }
  }

  const updated = await db.$transaction(async (tx) => {
    const appointment = await tx.appointment.update({
      where: { id },
      data: {
        ...(d.status !== undefined ? { status: d.status } : {}),
        ...(d.type !== undefined ? { type: d.type } : {}),
        ...(d.startsAt !== undefined ? { startsAt: nextStartsAt } : {}),
        ...(d.endsAt !== undefined ? { endsAt: nextEndsAt } : {}),
        ...(d.complaint !== undefined ? { complaint: d.complaint || null } : {}),
        ...(d.plannedTreatment !== undefined
          ? { plannedTreatment: d.plannedTreatment || null }
          : {}),
        ...(d.notes !== undefined ? { notes: d.notes || null } : {}),
      },
      include: { patient: true },
    });
    await queueRecord(tx, "Appointment", appointment.id, appointment.patientId);
    await logAudit(tx, "UPDATE", "Appointment", appointment.id);
    return appointment;
  });

  return NextResponse.json(updated);
}

