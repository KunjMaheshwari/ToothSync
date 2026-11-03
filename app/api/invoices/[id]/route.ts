import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logAudit, protectedRead, protectedWrite, queueRecord } from "@/lib/api";
import { readJson } from "@/lib/security";
import { invoiceUpdateSchema } from "@/lib/validation";
import { auditInvoiceRecord } from "@/lib/finance";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await protectedRead();
  if (denied) return denied;
  const { id } = await params;

  const invoice = await db.invoice.findUnique({
    where: { id },
    include: {
      patient: true,
      items: true,
      payments: { orderBy: { paidAt: "desc" } },
    },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  return NextResponse.json({
    ...invoice,
    financialSummary: auditInvoiceRecord(invoice),
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await protectedWrite(req);
  if (denied) return denied;
  const { id } = await params;

  const parsed = invoiceUpdateSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message;
    return NextResponse.json(
      { error: firstIssue || "Invalid invoice update." },
      { status: 400 }
    );
  }

  try {
    const updated = await db.$transaction(async (tx) => {
      const existing = await tx.invoice.findUnique({
        where: { id },
        include: { payments: true },
      });
      if (!existing) throw new Error("NOT_FOUND");

      const sumPaid = existing.payments.reduce((s, p) => s + p.amountPaise, 0);
      if (existing.paidPaise > 0 || sumPaid > 0) {
        throw new Error("HAS_PAYMENTS");
      }

      const invoice = await tx.invoice.update({
        where: { id },
        data: { status: "CANCELLED" },
        include: {
          patient: true,
          items: true,
          payments: { orderBy: { paidAt: "desc" } },
        },
      });
      await queueRecord(tx, "Invoice", invoice.id, invoice.patientId);
      await logAudit(tx, "UPDATE", "Invoice", invoice.id);
      return invoice;
    });

    return NextResponse.json(updated);
  } catch (err) {
    const code = err instanceof Error ? err.message : "";
    if (code === "NOT_FOUND") {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }
    if (code === "HAS_PAYMENTS") {
      return NextResponse.json(
        {
          error:
            "Cannot cancel an invoice that already has recorded payments.",
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Unable to update invoice." },
      { status: 503 }
    );
  }
}

