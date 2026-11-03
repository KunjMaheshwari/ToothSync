import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  await db.doctor.upsert({
    where: { username: process.env.AUTH_USERNAME || "doctorkinjal" },
    create: { username: process.env.AUTH_USERNAME || "doctorkinjal" },
    update: {},
  });
  console.log("Doctor profile ensured without modifying existing clinical records.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

