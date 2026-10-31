import { describe, expect, it } from "vitest";
import { buildSheetRecord } from "@/lib/sheets";

describe("Google Sheets record mapping", () => {
  it("maps a patient using a stable local record ID", () => { const r=buildSheetRecord("Patient",{id:"local-1",patientId:"DNT-2026-0001",firstName:"QA",lastName:"Patient",phone:"9999999999",email:null,updatedAt:new Date("2026-01-01")}); expect(r.tab).toBe("Patients"); expect(r.values.slice(0,2)).toEqual(["local-1","DNT-2026-0001"]); });
  it("maps treatment money as integer paise", () => { const r=buildSheetRecord("Treatment",{id:"t-1",patientId:"p-1",patient:{firstName:"QA",lastName:"Patient"},date:new Date("2026-01-01"),category:"Filling",procedure:"Composite",costPaise:250000,status:"COMPLETED"}); expect(r.values).toContain(250000); });
  it("rejects unknown queue entities instead of falsely marking them synced", () => expect(()=>buildSheetRecord("Unknown",{})).toThrow("Unsupported sync entity"));
});
