import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logAudit, protectedWrite, queueRecord } from "@/lib/api";
import { readJson } from "@/lib/security";
import { paymentSchema } from "@/lib/validation";
import { deriveInvoiceStatus } from "@/lib/finance";

// Per-invoice serialization mutex to prevent race conditions during concurrent payment requests
const invoiceLocks = new Map<string, Promise<unknown>>();

// Idempotency cache mapping `${invoiceId}:${idempotencyKey}` -> paymentId
const idempotencyRegistry = new Map<string, string>();

async function withInvoiceLock<T>(
  invoiceId: string,
  fn: () => Promise<T>
): Promise<T> {
  const previous = invoiceLocks.get(invoiceId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  invoiceLocks.set(
    invoiceId,
    previous.then(() => current)
  );
  try {
    await previous;
    return await fn();
  } finally {
    release();
    if (invoiceLocks.get(invoiceId) === current) {
      invoiceLocks.delete(invoiceId);
    }
  }
}

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
  const headerKey = req.headers.get("x-idempotency-key")?.trim();
  const idempotencyKey = d.idempotencyKey || headerKey || undefined;

  try {
    const outcome = await withInvoiceLock(id, async () => {
      // 1. Check explicit idempotency key registry
      if (idempotencyKey) {
        const existingPaymentId = idempotencyRegistry.get(
          `${id}:${idempotencyKey}`
        );
        if (existingPaymentId) {
          const existingPayment = await db.payment.findUnique({
            where: { id: existingPaymentId },
          });
          if (existingPayment) {
            return { payment: existingPayment, idempotent: true };
          }
        }
      }

      const payment = await db.$transaction(async (tx) => {
        const invoice = await tx.invoice.findUnique({
          where: { id },
          include: { items: true },
        });
        if (!invoice) throw new Error("NOT_FOUND");
        if (invoice.status === "CANCELLED") throw new Error("CANCELLED");

        // Check duplicate transaction reference on the same invoice if provided
        if (d.reference) {
          const dupRef = await tx.payment.findFirst({
            where: { invoiceId: id, reference: d.reference },
          });
          if (dupRef && dupRef.amountPaise === d.amountPaise && dupRef.method === d.method) {
            return { record: dupRef, isDuplicateRef: true };
          }
          if (dupRef) {
            throw new Error("DUPLICATE_REFERENCE");
          }
        }

        // Authoritative calculation of paidPaise from recorded Payment rows
        const agg = await tx.payment.aggregate({
          where: { invoiceId: id },
          _sum: { amountPaise: true },
        });
        const authoritativePaidPaise = agg._sum.amountPaise ?? 0;

        // Verify invoice totalPaise against line items if items exist
        const subtotalPaise = invoice.items.reduce(
          (sum, it) => sum + it.quantity * it.unitPaise,
          0
        );
        const authoritativeTotalPaise =
          invoice.items.length > 0
            ? subtotalPaise - invoice.discountPaise + invoice.taxPaise
            : invoice.totalPaise;

        const outstanding = authoritativeTotalPaise - authoritativePaidPaise;
        if (outstanding <= 0) throw new Error("OVERPAY");
        if (d.amountPaise > outstanding) throw new Error("OVERPAY");

        const newPaidPaise = authoritativePaidPaise + d.amountPaise;
        const newStatus = deriveInvoiceStatus(
          authoritativeTotalPaise,
          newPaidPaise,
          invoice.status
        );

        // Optimistic concurrency check on the invoice row
        const updatedInvoice = await tx.invoice.updateMany({
          where: {
            id,
            paidPaise: invoice.paidPaise,
            status: { not: "CANCELLED" },
          },
          data: {
            totalPaise: authoritativeTotalPaise,
            paidPaise: newPaidPaise,
            status: newStatus,
          },
        });

        if (updatedInvoice.count !== 1) {
          throw new Error("CONCURRENT_MODIFICATION");
        }

        const result = await tx.payment.create({
          data: {
            invoiceId: id,
            amountPaise: d.amountPaise,
            method: d.method,
            reference: d.reference || null,
            notes: d.notes || null,
          },
        });

        await queueRecord(tx, "Payment", result.id, invoice.patientId);
        await queueRecord(tx, "Invoice", id, invoice.patientId);
        await logAudit(tx, "PAYMENT", "Payment", result.id);
        return { record: result, isDuplicateRef: false };
      });

      if (idempotencyKey) {
        idempotencyRegistry.set(`${id}:${idempotencyKey}`, payment.record.id);
      }

      return {
        payment: payment.record,
        idempotent: payment.isDuplicateRef,
      };
    });

    return NextResponse.json(outcome.payment, {
      status: outcome.idempotent ? 200 : 201,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return NextResponse.json(
      {
        error:
          code === "NOT_FOUND"
            ? "Invoice not found."
            : code === "CANCELLED"
            ? "Cannot record payment on a cancelled invoice."
            : code === "OVERPAY"
            ? "Payment exceeds the outstanding balance."
            : code === "DUPLICATE_REFERENCE"
            ? "A different payment with this reference number already exists on this invoice."
            : "Unable to record payment.",
      },
      {
        status:
          code === "NOT_FOUND"
            ? 404
            : code === "CANCELLED" ||
              code === "OVERPAY" ||
              code === "DUPLICATE_REFERENCE"
            ? 400
            : 503,
      }
    );
  }
}
