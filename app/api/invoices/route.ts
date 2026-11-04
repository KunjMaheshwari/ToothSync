import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  handleApiError,
  logAudit,
  protectedRead,
  protectedWrite,
  queueRecord,
  syncAfterWriteOnServerless,
} from "@/lib/api";
import { readJson } from "@/lib/security";
import { invoiceSchema } from "@/lib/validation";
import { calculateInvoiceTotals } from "@/lib/finance";
import { randomInt } from "crypto";

function number() {
  return `INV-${new Date().getFullYear()}-${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
}

export async function GET(req: Request) {
  const denied = await protectedRead();
  if (denied) return denied;
  const patientId = new URL(req.url).searchParams.get("patientId");
  try {
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
  } catch (error) {
    return handleApiError(error, "Unable to load invoices.");
  }
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
  let totals;
  try {
    totals = calculateInvoiceTotals(d);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid invoice totals." },
      { status: 400 }
    );
  }

  try {
    if (
      !(await db.patient.findFirst({
        where: { id: d.patientId, deletedAt: null },
      }))
    ) {
      return NextResponse.json(
        { error: "Patient not found." },
        { status: 404 }
      );
    }

    for (let tries = 0; tries < 3; tries++) {
      try {
        const record = await db.$transaction(async (tx) => {
          const invoice = await tx.invoice.create({
            data: {
              patientId: d.patientId,
              invoiceNumber: number(),
              discountPaise: totals.discountPaise,
              taxPaise: totals.taxPaise,
              totalPaise: totals.totalPaise,
              paidPaise: 0,
              status: totals.initialStatus,
              items: {
                create: d.items.map((item) => ({
                  description: item.description,
                  quantity: item.quantity,
                  unitPaise: item.unitPaise,
                })),
              },
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

        await syncAfterWriteOnServerless("Invoice", record.id);
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
  } catch (error) {
    return handleApiError(error, "Unable to create invoice. Please retry.");
  }
}
