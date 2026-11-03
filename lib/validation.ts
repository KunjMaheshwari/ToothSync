import { z } from "zod";

const text = (max = 2_000) => z.string().trim().max(max);
const optionalText = (max?: number) => text(max).optional();
const dateString = z
  .string()
  .date()
  .optional()
  .or(z.literal(""))
  .refine((value) => !value || !Number.isNaN(Date.parse(value)), "Invalid date");

export const patientSchema = z.object({
  referenceId: optionalText(80),
  firstName: text(80).min(1, "First name is required"),
  lastName: text(80).min(1, "Last name is required"),
  phone: z
    .string()
    .trim()
    .regex(/^[+0-9() -]{8,20}$/, "Invalid phone number"),
  email: z.string().trim().email("Invalid email address").max(254).optional().or(z.literal("")),
  dateOfBirth: dateString,
  gender: optionalText(40),
  city: optionalText(100),
  allergies: optionalText(),
  conditions: optionalText(),
  dentalHistory: optionalText(),
  consented: z.boolean().default(false),
});

export const patientUpdateSchema = patientSchema.partial();

export const appointmentSchema = z
  .object({
    patientId: z.string().cuid("Please select a valid patient"),
    startsAt: z.string().datetime({ message: "Valid start time is required" }),
    endsAt: z.string().datetime({ message: "Valid end time is required" }),
    type: text(100).min(1, "Appointment type is required"),
    complaint: optionalText(),
    plannedTreatment: optionalText(),
    notes: optionalText(),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: "End time must be after start time",
  });

export const appointmentUpdateSchema = z
  .object({
    status: z.enum(["SCHEDULED", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    type: text(100).min(1).optional(),
    complaint: optionalText(),
    plannedTreatment: optionalText(),
    notes: optionalText(),
  })
  .refine(
    (v) => {
      if (v.startsAt && v.endsAt) {
        return new Date(v.endsAt) > new Date(v.startsAt);
      }
      return true;
    },
    { message: "End time must be after start time" }
  );

export const treatmentSchema = z.object({
  patientId: z.string().cuid("Please select a valid patient"),
  appointmentId: z.string().cuid().optional().or(z.literal("")),
  category: text(100).min(1, "Category is required"),
  procedure: text(200).min(1, "Procedure is required"),
  toothNumber: optionalText(20),
  description: optionalText(),
  costPaise: z.number().int().min(0).max(10_000_000),
  status: z.enum(["PLANNED", "IN_PROGRESS", "COMPLETED"]).default("PLANNED"),
  date: z.string().datetime().optional(),
});

export const treatmentUpdateSchema = z.object({
  status: z.enum(["PLANNED", "IN_PROGRESS", "COMPLETED"]).optional(),
  category: text(100).min(1).optional(),
  procedure: text(200).min(1).optional(),
  toothNumber: optionalText(20),
  description: optionalText(),
  costPaise: z.number().int().min(0).max(10_000_000).optional(),
});

export const prescriptionSchema = z.object({
  patientId: z.string().cuid("Please select a valid patient"),
  notes: optionalText(),
  date: z.string().datetime().optional(),
  items: z
    .array(
      z.object({
        medication: text(160).min(1, "Medication name is required"),
        dosage: text(80).min(1, "Dosage is required"),
        frequency: text(80).min(1, "Frequency is required"),
        duration: text(80).min(1, "Duration is required"),
        instructions: optionalText(),
      })
    )
    .min(1, "At least one medication item is required")
    .max(20),
});

export const invoiceSchema = z.object({
  patientId: z.string().cuid("Please select a valid patient"),
  discountPaise: z.number().int().min(0).default(0),
  taxPaise: z.number().int().min(0).default(0),
  items: z
    .array(
      z.object({
        description: text(200).min(1, "Description is required"),
        quantity: z.number().int().min(1).max(100),
        unitPaise: z.number().int().min(0).max(10_000_000),
      })
    )
    .min(1, "At least one line item is required")
    .max(100),
});

export const paymentSchema = z.object({
  amountPaise: z.number().int().positive("Amount must be greater than zero").max(10_000_000),
  method: z.enum(["CASH", "UPI", "CARD", "BANK_TRANSFER", "OTHER"]),
  reference: optionalText(120),
  notes: optionalText(),
});

export const followUpSchema = z.object({
  patientId: z.string().cuid("Please select a valid patient"),
  dueDate: z.string().datetime({ message: "Valid due date is required" }),
  reason: text(300).min(1, "Reason is required"),
  notes: optionalText(),
  status: z.enum(["PENDING", "COMPLETED", "RESCHEDULED", "CANCELLED"]).default("PENDING"),
});

export const followUpUpdateSchema = z.object({
  status: z.enum(["PENDING", "COMPLETED", "RESCHEDULED", "CANCELLED"]).optional(),
  dueDate: z.string().datetime().optional(),
  reason: text(300).min(1).optional(),
  notes: optionalText(),
});

/**
 * Safely converts a human-entered INR string (e.g., "1250", "1,250.50") to integer paise.
 * Returns null if the input is malformed or negative.
 */
export function parseRupeesToPaise(input: string | number): number | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) return null;
    return Math.round(input * 100);
  }
  const cleaned = input.replace(/,/g, "").trim();
  if (!cleaned) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, decimal = ""] = cleaned.split(".");
  const paise = Number(whole) * 100 + Number((decimal + "00").slice(0, 2));
  return Number.isSafeInteger(paise) && paise >= 0 ? paise : null;
}
