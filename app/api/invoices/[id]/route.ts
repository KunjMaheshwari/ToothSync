import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logAudit, protectedRead, protectedWrite, queueRecord } from "@/lib/api";
import { readJson } from "@/lib/security";
import { invoiceUpdateSchema } from "@/lib/validation";
import {
  auditInvoiceRecord,
  calculateInvoiceTotals,
  deriveInvoiceStatus,
} from "@/lib/finance";

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

  const d = parsed.data;

  try {
    const updated = await db.$transaction(async (tx) => {
      const existing = await tx.invoice.findUnique({
        where: { id },
        include: { items: true, payments: true },
      });
      if (!existing) throw new Error("NOT_FOUND");

      const sumPaid = existing.payments.reduce((s, p) => s + p.amountPaise, 0);
      const authoritativePaid = Math.max(existing.paidPaise, sumPaid);

      if (d.status === "CANCELLED") {
        if (authoritativePaid > 0) {
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
      }

      if (existing.status === "CANCELLED") {
        throw new Error("ALREADY_CANCELLED");
      }

      const nextItems = d.items
        ? d.items.map((it) => ({
            description: it.description,
            quantity: it.quantity,
            unitPaise: it.unitPaise,
          }))
        : existing.items.map((it) => ({
            description: it.description,
            quantity: it.quantity,
            unitPaise: it.unitPaise,
          }));

      const totals = calculateInvoiceTotals({
        items: nextItems,
        discountPaise:
          d.discountPercent !== undefined
            ? undefined
            : d.discountPaise ?? existing.discountPaise,
        discountPercent: d.discountPercent,
        taxPaise:
          d.taxPercent !== undefined
            ? undefined
            : d.taxPaise ?? existing.taxPaise,
        taxPercent: d.taxPercent,
      });

      if (totals.totalPaise < authoritativePaid) {
        throw new Error("BELOW_PAID_AMOUNT");
      }

      const nextStatus = deriveInvoiceStatus(
        totals.totalPaise,
        authoritativePaid,
        existing.status
      );

      if (d.items) {
        await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
      }

      const invoice = await tx.invoice.update({
        where: { id },
        data: {
          discountPaise: totals.discountPaise,
          taxPaise: totals.taxPaise,
          totalPaise: totals.totalPaise,
          paidPaise: authoritativePaid,
          status: nextStatus,
          ...(d.items
            ? {
                items: {
                  create: d.items.map((it) => ({
                    description: it.description,
                    quantity: it.quantity,
                    unitPaise: it.unitPaise,
                  })),
                },
              }
            : {}),
        },
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
    if (code === "ALREADY_CANCELLED") {
      return NextResponse.json(
        { error: "Cannot modify a cancelled invoice." },
        { status: 400 }
      );
    }
    if (code === "BELOW_PAID_AMOUNT") {
      return NextResponse.json(
        {
          error:
            "Updated invoice total cannot be less than the amount already paid.",
        },
        { status: 400 }
      );
    }
    if (
      code.includes("Discount") ||
      code.includes("Tax") ||
      code.includes("Line item") ||
      code.includes("Invoice must")
    ) {
      return NextResponse.json({ error: code }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Unable to update invoice." },
      { status: 503 }
    );
  }
}
