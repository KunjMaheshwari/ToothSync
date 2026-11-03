import { NextResponse } from "next/server";
import { csrfFailure, sameOrigin } from "@/lib/security";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return csrfFailure();
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
