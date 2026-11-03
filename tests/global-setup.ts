import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export default function setup() {
  process.env.DATABASE_URL = "file:./test.db";
  const testDbPath = path.resolve(__dirname, "../prisma/test.db");
  if (!fs.existsSync(testDbPath)) {
    execSync("npx prisma db push --skip-generate", {
      env: { ...process.env, DATABASE_URL: "file:./test.db" },
      stdio: "ignore",
    });
  }
}

