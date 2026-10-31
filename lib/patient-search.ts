import type { Prisma } from "@prisma/client";

/** Builds a bounded, parameterized Prisma filter; SQLite remains the search authority. */
export function patientSearchWhere(rawQuery: string): Prisma.PatientWhereInput {
  const query = rawQuery.trim().replace(/\s+/g, " ").slice(0, 100);
  const base: Prisma.PatientWhereInput = { deletedAt: null };
  if (!query) return base;
  const terms = query.split(" ");
  const fields: Prisma.PatientWhereInput[] = [
    { firstName: { contains: query } }, { lastName: { contains: query } },
    { phone: { contains: query } }, { patientId: { contains: query } }, { referenceId: { contains: query } }, { email: { contains: query } },
  ];
  if (terms.length >= 2) fields.push({ AND: [{ firstName: { contains: terms[0] } }, { lastName: { contains: terms.slice(1).join(" ") } }] });
  return { ...base, OR: fields };
}
