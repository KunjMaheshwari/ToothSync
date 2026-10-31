import { NextResponse } from "next/server";

const production = process.env.NODE_ENV === "production";

export function sessionSecret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value && production) throw new Error("AUTH_SECRET must be configured in production.");
  return new TextEncoder().encode(value || "local-development-secret-not-for-production");
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // non-browser/API clients authenticate independently
  const host = request.headers.get("host");
  try { return new URL(origin).host === host; } catch { return false; }
}

export function csrfFailure() { return NextResponse.json({ error: "Invalid request origin." }, { status: 403 }); }

export async function readJson(request: Request): Promise<unknown | null> {
  try { return await request.json(); } catch { return null; }
}

type Attempt = { count: number; resetAt: number };
const attempts = new Map<string, Attempt>();
export function loginAllowed(ip: string): boolean {
  const now = Date.now(); const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) return true;
  return entry.count < 8;
}
export function recordLoginFailure(ip: string) {
  const now = Date.now(); const current = attempts.get(ip);
  if (!current || current.resetAt < now) attempts.set(ip, { count: 1, resetAt: now + 15 * 60_000 });
  else attempts.set(ip, { ...current, count: current.count + 1 });
}
export function clearLoginFailures(ip: string) { attempts.delete(ip); }
