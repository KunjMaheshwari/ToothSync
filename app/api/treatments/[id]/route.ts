import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  handleApiError,
  logAudit,
  protectedWrite,
  queueRecord,
  syncAfterWriteOnServerless,
} from "@/lib/api";
import { readJson } from "@/lib/security";
import { treatmentUpdateSchema } from "@/lib/validation";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await protectedWrite(req);
  if (denied) return denied;
  const { id } = await params;

  const parsed = treatmentUpdateSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message;
    return NextResponse.json(
      { error: firstIssue || "Invalid treatment update." },
      { status: 400 }
    );
  }

  try {
    const existing = await db.treatment.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Treatment not found." },
        { status: 404 }
      );
    }

    const d = parsed.data;
    const updated = await db.$transaction(async (tx) => {
      const treatment = await tx.treatment.update({
        where: { id },
        data: {
          ...(d.status !== undefined ? { status: d.status } : {}),
          ...(d.category !== undefined ? { category: d.category } : {}),
          ...(d.procedure !== undefined ? { procedure: d.procedure } : {}),
          ...(d.toothNumber !== undefined
            ? { toothNumber: d.toothNumber || null }
            : {}),
          ...(d.description !== undefined
            ? { description: d.description || null }
            : {}),
          ...(d.costPaise !== undefined ? { costPaise: d.costPaise } : {}),
        },
        include: { patient: true },
      });
      await queueRecord(tx, "Treatment", treatment.id, treatment.patientId);
      await logAudit(tx, "UPDATE", "Treatment", treatment.id);
      return treatment;
    });

    await syncAfterWriteOnServerless("Treatment", updated.id);
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error, "Unable to update treatment.");
  }
}
