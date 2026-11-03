import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logAudit, protectedWrite, queueRecord } from "@/lib/api";
import { readJson } from "@/lib/security";
import { paymentSchema } from "@/lib/validation";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await protectedWrite(req);
  if (denied) return denied;

  const parsed = paymentSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message;
    return NextResponse.json(
      { error: firstIssue || "Invalid payment details." },
      { status: 400 }
    );
  }

  const { id } = await params;
  const d = parsed.data;

  try {
    const payment = await db.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id } });
      if (!invoice) throw new Error("NOT_FOUND");
      const outstanding = invoice.totalPaise - invoice.paidPaise;
      if (d.amountPaise > outstanding) throw new Error("OVERPAY");

      const result = await tx.payment.create({
        data: {
          invoiceId: id,
          amountPaise: d.amountPaise,
          method: d.method,
          reference: d.reference || null,
          notes: d.notes || null,
        },
      });

      const paid = invoice.paidPaise + d.amountPaise;
      await tx.invoice.update({
        where: { id },
        data: {
          paidPaise: paid,
          status: paid >= invoice.totalPaise ? "PAID" : "PARTIAL",
        },
      });

      await queueRecord(tx, "Payment", result.id, invoice.patientId);
      await queueRecord(tx, "Invoice", id, invoice.patientId);
      await logAudit(tx, "PAYMENT", "Payment", result.id);
      return result;
    });
    return NextResponse.json(payment, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return NextResponse.json(
      {
        error:
          code === "NOT_FOUND"
            ? "Invoice not found."
            : code === "OVERPAY"
            ? "Payment exceeds the outstanding balance."
            : "Unable to record payment.",
      },
      { status: code === "NOT_FOUND" ? 404 : code === "OVERPAY" ? 400 : 503 }
    );
  }
}
