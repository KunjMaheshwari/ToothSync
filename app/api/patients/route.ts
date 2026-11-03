import { NextResponse } from "next/server";
import { randomInt } from "crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isAuthenticated } from "@/lib/auth";
import { patientSchema } from "@/lib/validation";
import { patientSearchWhere } from "@/lib/patient-search";
import { csrfFailure, readJson, sameOrigin } from "@/lib/security";

async function guard() {
  return await isAuthenticated();
}

function makeId() {
  return `DNT-${new Date().getFullYear()}-${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
}

export async function GET(req: Request) {
  if (!(await guard())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const q = new URL(req.url).searchParams.get("q") || "";
  const patients = await db.patient.findMany({
    where: patientSearchWhere(q),
    include: {
      _count: {
        select: {
          appointments: true,
          treatments: true,
          invoices: true,
          followUps: true,
        },
      },
    },
    orderBy: { registeredAt: "desc" },
    take: 50,
  });
  return NextResponse.json(patients, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  if (!(await guard())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!sameOrigin(req)) return csrfFailure();

  const body = await readJson(req);
  const parsed = patientSchema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message;
    return NextResponse.json(
      { error: firstIssue || "Please check the required fields." },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const identifiers = [
    { phone: d.phone },
    ...(d.email ? [{ email: d.email }] : []),
    ...(d.referenceId ? [{ referenceId: d.referenceId }] : []),
  ];
  const dup = await db.patient.findFirst({
    where: { deletedAt: null, OR: identifiers },
  });
  if (dup) {
    return NextResponse.json(
      {
        error: `Possible duplicate found (${dup.firstName} ${dup.lastName} · ${dup.patientId}).`,
        patient: { patientId: dup.patientId, id: dup.id },
      },
      { status: 409 }
    );
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const p = await db.$transaction(async (tx) => {
        const patient = await tx.patient.create({
          data: {
            ...d,
            referenceId: d.referenceId || null,
            email: d.email || null,
            dateOfBirth: d.dateOfBirth ? new Date(d.dateOfBirth) : null,
            patientId: makeId(),
          },
        });
        await tx.syncQueue.create({
          data: {
            patientId: patient.id,
            entity: "Patient",
            entityId: patient.id,
            operation: "UPSERT",
            payload: JSON.stringify({ patientId: patient.patientId }),
          },
        });
        await tx.auditLog.create({
          data: { action: "CREATE", entity: "Patient", entityId: patient.id },
        });
        return patient;
      });
      return NextResponse.json(p, { status: 201 });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2002"
      ) {
        throw error;
      }
    }
  }

  return NextResponse.json(
    { error: "Unable to allocate a unique patient ID. Please retry." },
    { status: 503 }
  );
}
