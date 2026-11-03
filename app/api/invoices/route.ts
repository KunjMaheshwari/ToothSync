import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logAudit, protectedRead, protectedWrite, queueRecord } from "@/lib/api";
import { readJson } from "@/lib/security";
import { invoiceSchema } from "@/lib/validation";
import { randomInt } from "crypto";

function number() {
  return `INV-${new Date().getFullYear()}-${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
}

export async function GET(req: Request) {
  const denied = await protectedRead();
  if (denied) return denied;
  const patientId = new URL(req.url).searchParams.get("patientId");
  return NextResponse.json(
    await db.invoice.findMany({
      where: {
        patient: { deletedAt: null },
        ...(patientId ? { patientId } : {}),
      },
      include: {
        patient: true,
        items: true,
        payments: { orderBy: { paidAt: "desc" } },
      },
      orderBy: { date: "desc" },
      take: 100,
    })
  );
}

export async function POST(req: Request) {
  const denied = await protectedWrite(req);
  if (denied) return denied;

  const parsed = invoiceSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message;
    return NextResponse.json(
      { error: firstIssue || "Invalid invoice details." },
      { status: 400 }
    );
  }

  const d = parsed.data;
  if (!(await db.patient.findFirst({ where: { id: d.patientId, deletedAt: null } }))) {
    return NextResponse.json({ error: "Patient not found." }, { status: 404 });
  }

  const lineTotal = d.items.reduce(
    (sum, item) => sum + item.quantity * item.unitPaise,
    0
  );
  const total = Math.max(0, lineTotal + d.taxPaise - d.discountPaise);

  for (let tries = 0; tries < 3; tries++) {
    try {
      const record = await db.$transaction(async (tx) => {
        const invoice = await tx.invoice.create({
          data: {
            patientId: d.patientId,
            invoiceNumber: number(),
            discountPaise: d.discountPaise,
            taxPaise: d.taxPaise,
            totalPaise: total,
            status: total === 0 ? "PAID" : "PENDING",
            items: { create: d.items },
          },
          include: {
            patient: true,
            items: true,
            payments: true,
          },
        });
        await queueRecord(tx, "Invoice", invoice.id, invoice.patientId);
        await logAudit(tx, "CREATE", "Invoice", invoice.id);
        return invoice;
      });
      return NextResponse.json(record, { status: 201 });
    } catch {
      if (tries === 2) {
        return NextResponse.json(
          { error: "Unable to create invoice. Please retry." },
          { status: 503 }
        );
      }
    }
  }
  return NextResponse.json(
    { error: "Unable to create invoice. Please retry." },
    { status: 503 }
  );
}
