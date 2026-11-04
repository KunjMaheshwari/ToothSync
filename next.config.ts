import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  serverExternalPackages: [
    "@prisma/client",
    "prisma",
    "bcryptjs",
    "@prisma/adapter-libsql",
    "@libsql/client",
    "libsql",
  ],
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./node_modules/.prisma/client/**/*",
      "./node_modules/@prisma/client/**/*",
    ],
  },
};

export default nextConfig;
