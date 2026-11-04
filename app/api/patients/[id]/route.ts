import { NextResponse } from "next/server";
import { db, storageConfig } from "@/lib/db";
import { hydrateDatabaseFromSheets, isSheetsConfigured } from "@/lib/sheets";
import {
  handleApiError,
  logAudit,
  protectedRead,
  protectedWrite,
  queueRecord,
  syncAfterWriteOnServerless,
} from "@/lib/api";
import { readJson } from "@/lib/security";
import { patientUpdateSchema } from "@/lib/validation";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await protectedRead();
  if (denied) return denied;
  const { id } = await params;
  try {
    let patient = await db.patient.findFirst({
      where: { id, deletedAt: null },
      include: {
        appointments: { orderBy: { startsAt: "desc" } },
        treatments: { orderBy: { date: "desc" } },
        prescriptions: { include: { items: true }, orderBy: { date: "desc" } },
        invoices: {
          include: { items: true, payments: { orderBy: { paidAt: "desc" } } },
          orderBy: { date: "desc" },
        },
        followUps: { orderBy: { dueDate: "asc" } },
      },
    });

    if (!patient && storageConfig.mode === "ephemeral-tmp" && isSheetsConfigured()) {
      await hydrateDatabaseFromSheets(db).catch(() => {});
      patient = await db.patient.findFirst({
        where: { id, deletedAt: null },
        include: {
          appointments: { orderBy: { startsAt: "desc" } },
          treatments: { orderBy: { date: "desc" } },
          prescriptions: { include: { items: true }, orderBy: { date: "desc" } },
          invoices: {
            include: { items: true, payments: { orderBy: { paidAt: "desc" } } },
            orderBy: { date: "desc" },
          },
          followUps: { orderBy: { dueDate: "asc" } },
        },
      });
    }

    return patient
      ? NextResponse.json(patient)
      : NextResponse.json({ error: "Patient not found." }, { status: 404 });
  } catch (error) {
    return handleApiError(error, "Unable to load patient profile.");
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await protectedWrite(req);
  if (denied) return denied;
  const { id } = await params;

  const parsed = patientUpdateSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message;
    return NextResponse.json(
      { error: firstIssue || "Invalid patient details." },
      { status: 400 }
    );
  }

  try {
    const existing = await db.patient.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Patient not found." },
        { status: 404 }
      );
    }

    const d = parsed.data;
    const identifiers = [
      ...(d.phone ? [{ phone: d.phone }] : []),
      ...(d.email ? [{ email: d.email }] : []),
      ...(d.referenceId ? [{ referenceId: d.referenceId }] : []),
    ];

    if (identifiers.length > 0) {
      const dup = await db.patient.findFirst({
        where: {
          id: { not: id },
          deletedAt: null,
          OR: identifiers,
        },
      });
      if (dup) {
        return NextResponse.json(
          {
            error: `Another patient already uses this phone, email, or reference ID (${dup.patientId}).`,
          },
          { status: 409 }
        );
      }
    }

    const updated = await db.$transaction(async (tx) => {
      const patient = await tx.patient.update({
        where: { id },
        data: {
          ...(d.firstName !== undefined ? { firstName: d.firstName } : {}),
          ...(d.lastName !== undefined ? { lastName: d.lastName } : {}),
          ...(d.phone !== undefined ? { phone: d.phone } : {}),
          ...(d.email !== undefined ? { email: d.email || null } : {}),
          ...(d.referenceId !== undefined
            ? { referenceId: d.referenceId || null }
            : {}),
          ...(d.dateOfBirth !== undefined
            ? { dateOfBirth: d.dateOfBirth ? new Date(d.dateOfBirth) : null }
            : {}),
          ...(d.gender !== undefined ? { gender: d.gender || null } : {}),
          ...(d.city !== undefined ? { city: d.city || null } : {}),
          ...(d.allergies !== undefined
            ? { allergies: d.allergies || null }
            : {}),
          ...(d.conditions !== undefined
            ? { conditions: d.conditions || null }
            : {}),
          ...(d.dentalHistory !== undefined
            ? { dentalHistory: d.dentalHistory || null }
            : {}),
          ...(d.consented !== undefined ? { consented: d.consented } : {}),
        },
      });
      await queueRecord(tx, "Patient", patient.id, patient.id);
      await logAudit(tx, "UPDATE", "Patient", patient.id);
      return patient;
    });

    await syncAfterWriteOnServerless("Patient", updated.id);
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error, "Unable to update patient details.");
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await protectedWrite(req);
  if (denied) return denied;
  const { id } = await params;

  try {
    const existing = await db.patient.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Patient not found." },
        { status: 404 }
      );
    }

    await db.$transaction(async (tx) => {
      await tx.patient.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await logAudit(tx, "ARCHIVE", "Patient", id);
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error, "Unable to archive patient record.");
  }
}
