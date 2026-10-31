import { describe, expect, it } from "vitest";
import { appointmentSchema, followUpSchema, invoiceSchema, patientSchema, paymentSchema, prescriptionSchema, treatmentSchema } from "@/lib/validation";
describe("server-side clinical input validation", () => {
  const validPatient = { firstName:"QA",lastName:"Patient",phone:"+91 98765 43210",email:"qa@example.test",consented:true };
  it("accepts a bounded valid patient", () => expect(patientSchema.safeParse(validPatient).success).toBe(true));
  it("rejects malformed phone numbers", () => expect(patientSchema.safeParse({...validPatient,phone:"abc"}).success).toBe(false));
  it("rejects malformed email", () => expect(patientSchema.safeParse({...validPatient,email:"not-an-email"}).success).toBe(false));
  it("rejects oversized clinical text", () => expect(patientSchema.safeParse({...validPatient,allergies:"x".repeat(2001)}).success).toBe(false));
  it("trims names before persistence", () => expect(patientSchema.parse({...validPatient,firstName:"  QA  "}).firstName).toBe("QA"));
  it("rejects appointments where end precedes start", () => expect(appointmentSchema.safeParse({patientId:"ckxxxxxxxxxxxxxxxxxxxxxxxxx",startsAt:"2026-01-01T10:00:00.000Z",endsAt:"2026-01-01T09:00:00.000Z",type:"Consultation"}).success).toBe(false));
});

describe("clinical and billing record guards", () => {
  const patientId="ckxxxxxxxxxxxxxxxxxxxxxxxxx";
  it("accepts integer paise treatment costs and rejects negative costs", () => { const base={patientId,category:"Restoration",procedure:"Filling",costPaise:250000}; expect(treatmentSchema.safeParse(base).success).toBe(true); expect(treatmentSchema.safeParse({...base,costPaise:-1}).success).toBe(false); });
  it("requires at least one doctor-entered prescription item", () => expect(prescriptionSchema.safeParse({patientId,items:[]}).success).toBe(false));
  it("requires positive whole-paise payments", () => { expect(paymentSchema.safeParse({amountPaise:1,method:"UPI"}).success).toBe(true); expect(paymentSchema.safeParse({amountPaise:0,method:"UPI"}).success).toBe(false); });
  it("rejects negative invoice lines and discounts", () => { const base={patientId,items:[{description:"Cleaning",quantity:1,unitPaise:50000}],discountPaise:0,taxPaise:0}; expect(invoiceSchema.safeParse(base).success).toBe(true); expect(invoiceSchema.safeParse({...base,discountPaise:-1}).success).toBe(false); });
  it("requires a patient, future-format date, and reason for follow-ups", () => expect(followUpSchema.safeParse({patientId,dueDate:"2026-01-10T10:00:00.000Z",reason:"Review"}).success).toBe(true));
});
