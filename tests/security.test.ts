import { describe, expect, it } from "vitest";
import {
  clearLoginFailures,
  loginAllowed,
  recordLoginFailure,
  sameOrigin,
  sessionSecret,
} from "@/lib/security";

describe("request security controls", () => {
  it("rejects a cross-site state-changing request", () =>
    expect(
      sameOrigin(
        new Request("http://clinic.test/api/patients", {
          headers: { host: "clinic.test", origin: "https://attacker.test" },
        })
      )
    ).toBe(false));
  it("accepts same-origin browser requests", () =>
    expect(
      sameOrigin(
        new Request("http://clinic.test/api/patients", {
          headers: { host: "clinic.test", origin: "http://clinic.test" },
        })
      )
    ).toBe(true));
  it("uses a non-empty signing key in local development", () =>
    expect(sessionSecret().byteLength).toBeGreaterThan(20));
  it("enforces brute-force login rate limits and resets after clearing", () => {
    const ip = "192.0.2.99";
    clearLoginFailures(ip);
    expect(loginAllowed(ip)).toBe(true);
    for (let i = 0; i < 8; i++) {
      recordLoginFailure(ip);
    }
    expect(loginAllowed(ip)).toBe(false);
    clearLoginFailures(ip);
    expect(loginAllowed(ip)).toBe(true);
  });
});
