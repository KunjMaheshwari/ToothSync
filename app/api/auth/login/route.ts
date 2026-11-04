import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  clearLoginFailures,
  loginAllowed,
  readJson,
  recordLoginFailure,
  sameOrigin,
} from "@/lib/security";

const initialPasswordHash =
  "$2b$12$lGtjiRHlOzC5z1eeUYlJBeOjza2V2bRd9hbNL9mrblE9QtLqDP4F2";

function resolvePasswordHash(): string {
  const raw = process.env.AUTH_PASSWORD_HASH;
  if (!raw) return initialPasswordHash;
  const cleaned = raw
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\\$/g, "$");
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(cleaned)
    ? cleaned
    : initialPasswordHash;
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) {
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 }
    );
  }
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!loginAllowed(ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429 }
    );
  }
  const body = await readJson(req);
  const username =
    typeof body === "object" && body ? Reflect.get(body, "username") : undefined;
  const password =
    typeof body === "object" && body ? Reflect.get(body, "password") : undefined;
  const expected = (process.env.AUTH_USERNAME || "doctorkinjal")
    .trim()
    .replace(/^["']|["']$/g, "");
  const hash = resolvePasswordHash();
  const valid =
    typeof username === "string" &&
    typeof password === "string" &&
    username.trim() === expected &&
    (await bcrypt.compare(password, hash));

  if (!valid) {
    recordLoginFailure(ip);
    return NextResponse.json(
      { error: "Invalid username or password." },
      { status: 401 }
    );
  }

  clearLoginFailures(ip);
  await db.auditLog
    .create({
      data: { action: "LOGIN", entity: "Doctor", entityId: expected },
    })
    .catch(() => {});

  const res = NextResponse.json({ ok: true });
  res.cookies.set("dentalcare_session", await createSession(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 43200,
  });
  return res;
}
