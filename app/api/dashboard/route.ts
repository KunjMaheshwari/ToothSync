import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAuthenticated } from "@/lib/auth";

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const [
    patients,
    today,
    completed,
    upcoming,
    invoiceAgg,
    allInvoiceAgg,
    followups,
    recent,
    upcomingAppointments,
    dueFollowUps,
    treatmentsCount,
    prescriptionsCount,
    syncPending,
    syncFailed,
    syncSynced,
    lastSyncMeta,
    recentAudit,
  ] = await Promise.all([
    db.patient.count({ where: { deletedAt: null } }),
    db.appointment.count({
      where: {
        patient: { deletedAt: null },
        startsAt: { gte: start, lt: end },
      },
    }),
    db.appointment.count({
      where: {
        patient: { deletedAt: null },
        status: "COMPLETED",
      },
    }),
    db.appointment.count({
      where: {
        patient: { deletedAt: null },
        startsAt: { gte: now },
        status: { in: ["SCHEDULED", "CONFIRMED", "IN_PROGRESS"] },
      },
    }),
    db.invoice.aggregate({
      where: {
        patient: { deletedAt: null },
        status: { not: "PAID" },
      },
      _sum: { totalPaise: true, paidPaise: true },
    }),
    db.invoice.aggregate({
      where: { patient: { deletedAt: null } },
      _sum: { totalPaise: true, paidPaise: true, discountPaise: true },
      _count: { id: true },
    }),
    db.followUp.count({
      where: {
        patient: { deletedAt: null },
        dueDate: { lte: now },
        status: "PENDING",
      },
    }),
    db.appointment.findMany({
      where: {
        patient: { deletedAt: null },
        startsAt: { gte: start, lt: end },
      },
      include: { patient: true },
      orderBy: { startsAt: "asc" },
    }),
    db.appointment.findMany({
      where: {
        patient: { deletedAt: null },
        status: { in: ["SCHEDULED", "CONFIRMED", "IN_PROGRESS"] },
      },
      include: { patient: true },
      orderBy: { startsAt: "asc" },
      take: 8,
    }),
    db.followUp.findMany({
      where: {
        patient: { deletedAt: null },
        status: "PENDING",
      },
      include: { patient: true },
      orderBy: { dueDate: "asc" },
      take: 6,
    }),
    db.treatment.count({ where: { patient: { deletedAt: null } } }),
    db.prescription.count({ where: { patient: { deletedAt: null } } }),
    db.syncQueue.count({ where: { status: "PENDING" } }),
    db.syncQueue.count({ where: { status: "FAILED" } }),
    db.syncQueue.count({ where: { status: "SYNCED" } }),
    db.syncMetadata.findFirst({ orderBy: { syncedAt: "desc" } }),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
  ]);

  const pendingPaise = Math.max(
    0,
    (invoiceAgg._sum.totalPaise || 0) - (invoiceAgg._sum.paidPaise || 0)
  );

  return NextResponse.json(
    {
      patients,
      today,
      completed,
      upcoming,
      pending: pendingPaise,
      followups,
      recent,
      upcomingAppointments,
      dueFollowUps,
      treatmentsCount,
      prescriptionsCount,
      billingSummary: {
        totalBilledPaise: allInvoiceAgg._sum.totalPaise || 0,
        totalCollectedPaise: allInvoiceAgg._sum.paidPaise || 0,
        totalDiscountPaise: allInvoiceAgg._sum.discountPaise || 0,
        outstandingPaise: pendingPaise,
        invoicesCount: allInvoiceAgg._count.id || 0,
      },
      syncStatus: {
        pending: syncPending,
        failed: syncFailed,
        synced: syncSynced,
        lastSync: lastSyncMeta?.syncedAt ?? null,
      },
      recentAudit,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
