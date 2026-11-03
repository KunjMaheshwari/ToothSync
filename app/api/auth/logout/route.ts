import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { csrfFailure, sameOrigin } from "@/lib/security";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return csrfFailure();

  await db.auditLog
    .create({
      data: {
        action: "LOGOUT",
        entity: "Doctor",
        entityId: process.env.AUTH_USERNAME || "doctorkinjal",
      },
    })
    .catch(() => {});

  const res = NextResponse.json({ ok: true });
  res.cookies.set("dentalcare_session", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });
  return res;
}
