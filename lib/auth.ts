import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { sessionSecret } from "@/lib/security";
export async function createSession() { return new SignJWT({ scope: "doctor" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("12h").sign(sessionSecret()); }
export async function isAuthenticated() { const token = (await cookies()).get("dentalcare_session")?.value; if (!token) return false; try { const payload = await jwtVerify(token,sessionSecret()); return payload.payload.scope === "doctor"; } catch { return false; } }
