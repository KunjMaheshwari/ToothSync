import { describe, expect, it } from "vitest";
import { sameOrigin, sessionSecret } from "@/lib/security";
describe("request security controls", () => {
  it("rejects a cross-site state-changing request", () => expect(sameOrigin(new Request("http://clinic.test/api/patients",{headers:{host:"clinic.test",origin:"https://attacker.test"}}))).toBe(false));
  it("accepts same-origin browser requests", () => expect(sameOrigin(new Request("http://clinic.test/api/patients",{headers:{host:"clinic.test",origin:"http://clinic.test"}}))).toBe(true));
  it("uses a non-empty signing key in local development", () => expect(sessionSecret().byteLength).toBeGreaterThan(20));
});
