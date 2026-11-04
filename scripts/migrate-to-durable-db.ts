/**
 * One-time, NON-DESTRUCTIVE copy of clinic records from a source SQLite file
 * (e.g. the preserved prisma/dev.db) into the durable libSQL/Turso database.
 *
 * - Dry run by default: prints counts only (no PHI). Pass --apply to write.
 * - Insert-only: a record whose id already exists in the target is skipped,
 *   never updated or overwritten. Nothing is ever deleted.
 * - Unique-constraint conflicts are reported by record id and skipped.
 *
 * Usage:
 *   SOURCE_DATABASE_URL=file:./prisma/dev.db TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... \
 *     npx tsx scripts/migrate-to-durable-db.ts [--apply]
 */
import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { initializeSchemaOnClient } from "../lib/db";

const apply = process.argv.includes("--apply");

async function main() {
  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  const targetUrl = process.env.TURSO_DATABASE_URL;
  if (!sourceUrl || !targetUrl) {
    throw new Error("SOURCE_DATABASE_URL and TURSO_DATABASE_URL are required.");
  }
  const source = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
  const target = new PrismaClient({
    adapter: new PrismaLibSQL({ url: targetUrl, authToken: process.env.TURSO_AUTH_TOKEN }),
  });
  if (apply) await initializeSchemaOnClient(target);

  const plan: Array<{
    name: string;
    read: () => Promise<any[]>;
    exists: (id: string) => Promise<unknown>;
    create: (row: any) => Promise<unknown>;
  }> = [
    {
      name: "Patient",
      read: () => source.patient.findMany(),
      exists: (id) => target.patient.findUnique({ where: { id } }),
      create: (row) => target.patient.create({ data: row }),
    },
    {
      name: "Appointment",
      read: () => source.appointment.findMany(),
      exists: (id) => target.appointment.findUnique({ where: { id } }),
      create: (row) => target.appointment.create({ data: row }),
    },
    {
      name: "Treatment",
      read: () => source.treatment.findMany(),
      exists: (id) => target.treatment.findUnique({ where: { id } }),
      create: (row) => target.treatment.create({ data: row }),
    },
    {
      name: "Prescription",
      read: () => source.prescription.findMany({ include: { items: true } }),
      exists: (id) => target.prescription.findUnique({ where: { id } }),
      create: ({ items, ...row }) =>
        target.prescription.create({
          data: {
            ...row,
            items: { create: items.map(({ prescriptionId: _p, ...i }: any) => i) },
          },
        }),
    },
    {
      name: "Invoice",
      read: () => source.invoice.findMany({ include: { items: true } }),
      exists: (id) => target.invoice.findUnique({ where: { id } }),
      create: ({ items, ...row }) =>
        target.invoice.create({
          data: {
            ...row,
            items: { create: items.map(({ invoiceId: _i, ...i }: any) => i) },
          },
        }),
    },
    {
      name: "Payment",
      read: () => source.payment.findMany(),
      exists: (id) => target.payment.findUnique({ where: { id } }),
      create: (row) => target.payment.create({ data: row }),
    },
    {
      name: "FollowUp",
      read: () => source.followUp.findMany(),
      exists: (id) => target.followUp.findUnique({ where: { id } }),
      create: (row) => target.followUp.create({ data: row }),
    },
  ];

  for (const step of plan) {
    const rows = await step.read();
    let created = 0;
    let skippedExisting = 0;
    const conflicts: string[] = [];
    for (const row of rows) {
      // In dry-run the target may not have tables yet; treat that as "absent".
      const found = await step.exists(row.id).catch((e: unknown) => {
        if (!apply && String(e).includes("no such table")) return null;
        throw e;
      });
      if (found) {
        skippedExisting++;
        continue;
      }
      if (!apply) {
        created++;
        continue;
      }
      try {
        await step.create(row);
        created++;
      } catch (e: any) {
        conflicts.push(`${row.id} (${e?.code ?? "error"})`);
      }
    }
    console.log(
      `${apply ? "APPLIED" : "DRY-RUN"} ${step.name}: source=${rows.length} ${apply ? "created" : "would-create"}=${created} skipped-existing=${skippedExisting} conflicts=${conflicts.length}`
    );
    for (const c of conflicts) console.log(`  conflict: ${c}`);
  }
  await source.$disconnect();
  await target.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
