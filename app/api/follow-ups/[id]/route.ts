import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logAudit, protectedWrite, queueRecord } from "@/lib/api";
import { readJson } from "@/lib/security";
import { followUpUpdateSchema } from "@/lib/validation";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await protectedWrite(req);
  if (denied) return denied;
  const { id } = await params;

  const existing = await db.followUp.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Follow-up not found." }, { status: 404 });
  }

  const parsed = followUpUpdateSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message;
    return NextResponse.json(
      { error: firstIssue || "Invalid follow-up update." },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const updated = await db.$transaction(async (tx) => {
    const followUp = await tx.followUp.update({
      where: { id },
      data: {
        ...(d.status !== undefined ? { status: d.status } : {}),
        ...(d.dueDate !== undefined ? { dueDate: new Date(d.dueDate) } : {}),
        ...(d.reason !== undefined ? { reason: d.reason } : {}),
        ...(d.notes !== undefined ? { notes: d.notes || null } : {}),
      },
      include: { patient: true },
    });
    await queueRecord(tx, "FollowUp", followUp.id, followUp.patientId);
    await logAudit(tx, "UPDATE", "FollowUp", followUp.id);
    return followUp;
  });

  return NextResponse.json(updated);
}

