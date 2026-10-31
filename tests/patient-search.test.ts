import { describe, expect, it } from "vitest";
import { patientSearchWhere } from "@/lib/patient-search";

describe("patient search query builder", () => {
  it("returns only non-deleted patients for empty queries", () => expect(patientSearchWhere("   ")).toEqual({ deletedAt:null }));
  it("trims and searches patient identifiers safely", () => expect(patientSearchWhere("  DNT-2026-0001 ")).toMatchObject({ deletedAt:null, OR:expect.arrayContaining([{patientId:{contains:"DNT-2026-0001"}}]) }));
  it("adds a full-name match alongside direct partial matching", () => { const query=patientSearchWhere("  Anita   Shah "); expect(query).toMatchObject({OR:expect.arrayContaining([{firstName:{contains:"Anita Shah"}},{lastName:{contains:"Anita Shah"}},{AND:[{firstName:{contains:"Anita"}},{lastName:{contains:"Shah"}}]}])}); });
  it("bounds pathological input length", () => { const query=patientSearchWhere("x".repeat(200)); expect(query).toMatchObject({OR:expect.arrayContaining([{phone:{contains:"x".repeat(100)}}])}); });
});
