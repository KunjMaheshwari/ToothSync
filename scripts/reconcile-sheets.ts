import { PrismaClient } from "@prisma/client";
import { buildSheetRecord, configured, reconcileEntitySheet } from "../lib/sheets";

const db = new PrismaClient();

async function main() {
  const { sheets, sheetId } = configured();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "sheets.properties",
  });
  const existingTabs = new Set(
    meta.data.sheets?.map((s) => s.properties?.title).filter(Boolean)
  );

  const entities = [
    {
      entity: "Patient",
      tab: "Patients",
      records: await db.patient.findMany({ where: { deletedAt: null } }),
    },
    {
      entity: "Appointment",
      tab: "Appointments",
      records: await db.appointment.findMany({ include: { patient: true } }),
    },
    {
      entity: "Treatment",
      tab: "Treatments",
      records: await db.treatment.findMany({ include: { patient: true } }),
    },
    {
      entity: "Prescription",
      tab: "Prescriptions",
      records: await db.prescription.findMany({
        include: { patient: true, items: true },
      }),
    },
    {
      entity: "Invoice",
      tab: "Invoices",
      records: await db.invoice.findMany({
        include: { patient: true, items: true, payments: true },
      }),
    },
    {
      entity: "Payment",
      tab: "Payments",
      records: await db.payment.findMany({ include: { invoice: true } }),
    },
    {
      entity: "FollowUp",
      tab: "Follow-ups",
      records: await db.followUp.findMany({ include: { patient: true } }),
    },
  ];

  let allPass = true;
  for (const item of entities) {
    if (item.records.length === 0 && !existingTabs.has(item.tab)) {
      console.log(`PASS [${item.tab}]: 0 DB records, tab not yet needed.`);
      continue;
    }
    const response = existingTabs.has(item.tab)
      ? await sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: `'${item.tab}'!A:Z`,
        })
      : { data: { values: [] } };
    const report = reconcileEntitySheet(
      item.entity,
      item.records,
      (response.data.values ?? []) as (string | number)[][]
    );
    if (!report.pass) allPass = false;
    console.log(
      `${report.pass ? "PASS" : "FAIL"} [${report.tab}] DB=${
        report.totalDbRecords
      } Matched=${report.matchedCount} Missing=${
        report.missingIds.length
      } Duplicates=${report.duplicateIds.length} Mismatches=${
        report.mismatches.length
      }`
    );
    if (report.financialSummary) {
      console.log(`  Financial Summary:`, report.financialSummary);
    }
    for (const m of report.mismatches) {
      console.log(
        `  Mismatch on ${m.id} [${m.field}]: expected=${m.expected} actual=${m.actual}`
      );
    }
  }

  if (!allPass) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("Reconciliation error:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

