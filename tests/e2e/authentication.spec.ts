import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { makeRequest, resetTestDatabase } from "./helpers";

let authenticatedState = false;

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    isAuthenticated: vi.fn(async () => authenticatedState),
  };
});

import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { GET as patientsGET, POST as patientsPOST } from "@/app/api/patients/route";
import { GET as invoicesGET } from "@/app/api/invoices/route";
import { POST as paymentsPOST } from "@/app/api/invoices/[id]/payments/route";
import { GET as dashboardGET } from "@/app/api/dashboard/route";
import Home from "@/app/page";

(globalThis as unknown as { React: typeof React }).React = React;
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

describe("PHASE 3 — Authentication & Authorization (TC-001 to TC-004)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    authenticatedState = false;
    process.env.AUTH_USERNAME = "doctorkinjal";
    process.env.AUTH_PASSWORD_HASH = await bcrypt.hash("QaSecretPass!2026", 4);
  });

  it("TC-001: Valid login and logout workflow issues and clears HTTP-only session cookie and records audit logs", async () => {
    const loginReq = makeRequest(
      "http://localhost:3000/api/auth/login",
      "POST",
      {
        username: "doctorkinjal",
        password: "QaSecretPass!2026",
      },
      { "x-forwarded-for": "10.0.0.101" }
    );
    const loginRes = await loginPOST(loginReq);
    expect(loginRes.status).toBe(200);
    const loginBody = await loginRes.json();
    expect(loginBody.ok).toBe(true);

    const setCookie = loginRes.headers.get("set-cookie") || "";
    expect(setCookie).toContain("dentalcare_session=");
    expect(setCookie.toLowerCase()).toContain("httponly");

    const loginAudit = await db.auditLog.findFirst({
      where: { action: "LOGIN", entity: "Doctor" },
    });
    expect(loginAudit?.entityId).toBe("doctorkinjal");

    const logoutReq = makeRequest("http://localhost:3000/api/auth/logout", "POST");
    const logoutRes = await logoutPOST(logoutReq);
    expect(logoutRes.status).toBe(200);
    const logoutCookie = logoutRes.headers.get("set-cookie") || "";
    expect(logoutCookie).toContain("Max-Age=0");

    const logoutAudit = await db.auditLog.findFirst({
      where: { action: "LOGOUT", entity: "Doctor" },
    });
    expect(logoutAudit?.entityId).toBe("doctorkinjal");
  });

  it("TC-002: Invalid credentials and brute-force attempts return appropriate 401/429 error messages without session cookies", async () => {
    const badUserReq = makeRequest(
      "http://localhost:3000/api/auth/login",
      "POST",
      { username: "wrongdoctor", password: "QaSecretPass!2026" },
      { "x-forwarded-for": "10.0.0.102" }
    );
    const badUserRes = await loginPOST(badUserReq);
    expect(badUserRes.status).toBe(401);
    const badUserBody = await badUserRes.json();
    expect(badUserBody.error).toBe("Invalid username or password.");
    expect(badUserRes.headers.get("set-cookie")).toBeNull();

    const badPassReq = makeRequest(
      "http://localhost:3000/api/auth/login",
      "POST",
      { username: "doctorkinjal", password: "WrongPassword999" },
      { "x-forwarded-for": "10.0.0.103" }
    );
    const badPassRes = await loginPOST(badPassReq);
    expect(badPassRes.status).toBe(401);

    // Exhaust rate limit on IP 10.0.0.104 (8 failures -> 9th blocked with 429)
    for (let i = 0; i < 8; i++) {
      await loginPOST(
        makeRequest(
          "http://localhost:3000/api/auth/login",
          "POST",
          { username: "doctorkinjal", password: "Bad" },
          { "x-forwarded-for": "10.0.0.104" }
        )
      );
    }
    const rateLimitedRes = await loginPOST(
      makeRequest(
        "http://localhost:3000/api/auth/login",
        "POST",
        { username: "doctorkinjal", password: "QaSecretPass!2026" },
        { "x-forwarded-for": "10.0.0.104" }
      )
    );
    expect(rateLimitedRes.status).toBe(429);
    const rateLimitedBody = await rateLimitedRes.json();
    expect(rateLimitedBody.error).toContain("Too many attempts");
  });

  it("TC-003: Accessing protected routes without authentication renders Login gate instead of clinical workspace", async () => {
    authenticatedState = false;
    const unauthElement = await Home();
    const unauthHtml = renderToStaticMarkup(unauthElement);
    expect(unauthHtml).toContain("Sign in to Patient Tracker");
    expect(unauthHtml).not.toContain("Here&#x27;s your clinic overview for today.");

    authenticatedState = true;
    const authElement = await Home();
    const authHtml = renderToStaticMarkup(authElement);
    expect(authHtml).toContain("Welcome Doctor Kinjal Maheshwari");
    expect(authHtml).toContain("Here&#x27;s your clinic overview for today.");
  });

  it("TC-004: Unauthorized and cross-origin access to protected API endpoints is strictly rejected (401 / 403)", async () => {
    authenticatedState = false;

    const getPatientsRes = await patientsGET(
      makeRequest("http://localhost:3000/api/patients")
    );
    expect(getPatientsRes.status).toBe(401);

    const getInvoicesRes = await invoicesGET(
      makeRequest("http://localhost:3000/api/invoices")
    );
    expect(getInvoicesRes.status).toBe(401);

    const getDashRes = await dashboardGET();
    expect(getDashRes.status).toBe(401);

    const postPaymentUnauth = await paymentsPOST(
      makeRequest("http://localhost:3000/api/invoices/inv-1/payments", "POST", {
        amountPaise: 10000,
        method: "CASH",
      }),
      { params: Promise.resolve({ id: "inv-1" }) }
    );
    expect(postPaymentUnauth.status).toBe(401);

    // Even when authenticated, cross-origin POST (CSRF) must be rejected with 403
    authenticatedState = true;
    const csrfPatientRes = await patientsPOST(
      makeRequest(
        "http://localhost:3000/api/patients",
        "POST",
        {
          firstName: "Attacker",
          lastName: "Bot",
          phone: "+91 9000000001",
        },
        { origin: "https://evil.example.com" }
      )
    );
    expect(csrfPatientRes.status).toBe(403);
  });
});
