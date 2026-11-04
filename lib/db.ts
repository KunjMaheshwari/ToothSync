import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { hydrateDatabaseFromSheets, isSheetsConfigured } from "@/lib/sheets";

function isDirectoryWritable(dirPath: string): boolean {
  try {
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveDatabaseUrl(): string {
  const configuredUrl = process.env.DATABASE_URL?.trim();
  const isVercel = Boolean(process.env.VERCEL);
  const isTest =
    Boolean(process.env.VITEST) ||
    process.env.NODE_ENV === "test" ||
    Boolean(configuredUrl && configuredUrl.includes("test"));

  if (isTest && configuredUrl) {
    return configuredUrl;
  }

  if (isVercel) {
    if (configuredUrl && configuredUrl.startsWith("file:/tmp/")) {
      return configuredUrl;
    }
    return "file:/tmp/dentalcare.db";
  }

  if (!configuredUrl) {
    const prismaDir = path.join(process.cwd(), "prisma");
    return isDirectoryWritable(prismaDir)
      ? "file:./dev.db"
      : "file:/tmp/dentalcare.db";
  }

  if (
    configuredUrl.startsWith("file:./") ||
    configuredUrl.startsWith("file:prisma/")
  ) {
    const prismaDir = path.join(process.cwd(), "prisma");
    if (!isDirectoryWritable(prismaDir)) {
      return "file:/tmp/dentalcare.db";
    }
  }

  return configuredUrl;
}

const resolvedDatabaseUrl = resolveDatabaseUrl();
if (!process.env.DATABASE_URL || process.env.VERCEL) {
  process.env.DATABASE_URL = resolvedDatabaseUrl;
}

const BOOTSTRAP_DDL_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS "Doctor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS "Patient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "referenceId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" DATETIME,
    "gender" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "city" TEXT,
    "allergies" TEXT,
    "conditions" TEXT,
    "dentalHistory" TEXT,
    "consented" BOOLEAN NOT NULL DEFAULT false,
    "registeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME
  )`,
  `CREATE TABLE IF NOT EXISTS "Appointment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "type" TEXT NOT NULL,
    "complaint" TEXT,
    "plannedTreatment" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "Treatment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "category" TEXT NOT NULL,
    "procedure" TEXT NOT NULL,
    "toothNumber" TEXT,
    "description" TEXT,
    "costPaise" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Treatment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Treatment_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "Prescription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    CONSTRAINT "Prescription_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "PrescriptionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prescriptionId" TEXT NOT NULL,
    "medication" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "duration" TEXT NOT NULL,
    "instructions" TEXT,
    CONSTRAINT "PrescriptionItem_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "discountPaise" INTEGER NOT NULL DEFAULT 0,
    "taxPaise" INTEGER NOT NULL DEFAULT 0,
    "totalPaise" INTEGER NOT NULL DEFAULT 0,
    "paidPaise" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    CONSTRAINT "Invoice_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "InvoiceItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPaise" INTEGER NOT NULL,
    CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "paidAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "FollowUp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    CONSTRAINT "FollowUp_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS "SyncQueue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SyncQueue_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "SyncMetadata" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "syncedAt" DATETIME
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Doctor_username_key" ON "Doctor"("username")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Patient_patientId_key" ON "Patient"("patientId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Patient_referenceId_key" ON "Patient"("referenceId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Patient_phone_key" ON "Patient"("phone")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Patient_email_key" ON "Patient"("email")`,
  `CREATE INDEX IF NOT EXISTS "Patient_firstName_lastName_idx" ON "Patient"("firstName", "lastName")`,
  `CREATE INDEX IF NOT EXISTS "Patient_registeredAt_idx" ON "Patient"("registeredAt")`,
  `CREATE INDEX IF NOT EXISTS "Appointment_startsAt_idx" ON "Appointment"("startsAt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "SyncQueue_entity_entityId_operation_key" ON "SyncQueue"("entity", "entityId", "operation")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "SyncMetadata_entity_entityId_key" ON "SyncMetadata"("entity", "entityId")`,
];

export async function initializeSchemaOnClient(client: PrismaClient): Promise<void> {
  for (const stmt of BOOTSTRAP_DDL_STATEMENTS) {
    await client.$executeRawUnsafe(stmt);
  }
  const doctorUsername = (process.env.AUTH_USERNAME || "doctorkinjal").trim();
  await client.$executeRawUnsafe(
    `INSERT OR IGNORE INTO "Doctor" ("id", "username", "createdAt") VALUES ('doctor-default', ?, CURRENT_TIMESTAMP)`,
    doctorUsername
  );
}

const globalForPrisma = globalThis as unknown as {
  prismaBase?: PrismaClient;
  prismaExtended?: PrismaClient;
  prismaInitPromise?: Promise<void> | null;
};

const baseClient =
  globalForPrisma.prismaBase ??
  new PrismaClient({
    datasources: {
      db: {
        url: resolvedDatabaseUrl,
      },
    },
  });

export async function ensureDatabaseReady(): Promise<void> {
  if (!globalForPrisma.prismaInitPromise) {
    globalForPrisma.prismaInitPromise = (async () => {
      try {
        await initializeSchemaOnClient(baseClient);
        const isEphemeralTmp = resolvedDatabaseUrl.startsWith("file:/tmp/");
        const isTest =
          Boolean(process.env.VITEST) || process.env.NODE_ENV === "test";
        if (isEphemeralTmp && !isTest && isSheetsConfigured()) {
          const existingCount = await baseClient.patient.count();
          if (existingCount === 0) {
            await hydrateDatabaseFromSheets(baseClient).catch(() => {});
          }
        }
      } catch (err) {
        globalForPrisma.prismaInitPromise = null;
        throw err;
      }
    })();
  }
  return globalForPrisma.prismaInitPromise;
}

export function resetDatabaseInitializationForTests(): void {
  globalForPrisma.prismaInitPromise = null;
}

function createExtendedClient(base: PrismaClient): PrismaClient {
  const extended = base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          await ensureDatabaseReady();
          return query(args);
        },
      },
    },
  });

  return new Proxy(extended as unknown as PrismaClient, {
    get(target, prop, receiver) {
      if (prop === "$transaction") {
        return async (...txArgs: unknown[]) => {
          await ensureDatabaseReady();
          return (target.$transaction as (...a: unknown[]) => unknown)(...txArgs);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export const db: PrismaClient =
  globalForPrisma.prismaExtended ?? createExtendedClient(baseClient);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaBase = baseClient;
  globalForPrisma.prismaExtended = db;
}
