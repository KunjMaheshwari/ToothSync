/**
 * Authoritative integer-paise financial engine for DentalCare.
 *
 * All monetary amounts are represented as exact integer paise (₹1.00 = 100 paise).
 * Invariants enforced for every active invoice:
 *   1. subtotalPaise = sum(item.quantity * item.unitPaise)
 *   2. 0 <= discountPaise <= subtotalPaise
 *   3. totalAmountPaise = subtotalPaise - discountPaise + taxPaise
 *   4. totalPaidPaise = sum(payments.amountPaise)
 *   5. outstandingPaise = status === "CANCELLED" ? 0 : totalAmountPaise - totalPaidPaise
 */

export type InvoiceStatus = "PENDING" | "PARTIAL" | "PAID" | "CANCELLED";

export interface LineItemInput {
  description?: string;
  quantity: number;
  unitPaise: number;
}

export interface InvoiceCalculationInput {
  items: LineItemInput[];
  discountPaise?: number;
  discountPercent?: number;
  taxPaise?: number;
  taxPercent?: number;
}

export interface InvoiceCalculationResult {
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
  initialStatus: InvoiceStatus;
}

export interface InvoiceFinancialSummary {
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  status: InvoiceStatus;
  invariantsValid: boolean;
  violations: string[];
}

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formats integer paise in standard Indian Rupee format (e.g., 12500000 -> "₹1,25,000.00").
 * Never visually rounds away non-zero paise.
 */
export function formatINR(paise: number): string {
  const safePaise = Number.isFinite(paise) ? Math.trunc(paise) : 0;
  return inrFormatter.format(safePaise / 100);
}

/**
 * Computes authoritative invoice totals in integer paise.
 * Throws a descriptive error if any financial rule is violated.
 */
export function calculateInvoiceTotals(
  input: InvoiceCalculationInput
): InvoiceCalculationResult {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error("Invoice must contain at least one line item.");
  }

  let subtotalPaise = 0;
  for (const item of input.items) {
    if (
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 100
    ) {
      throw new Error("Line item quantity must be an integer between 1 and 100.");
    }
    if (
      !Number.isSafeInteger(item.unitPaise) ||
      item.unitPaise < 0 ||
      item.unitPaise > 10_000_000
    ) {
      throw new Error("Line item unit price must be a valid non-negative amount in paise.");
    }
    subtotalPaise += item.quantity * item.unitPaise;
  }

  let discountPaise = 0;
  if (
    input.discountPercent !== undefined &&
    input.discountPercent !== null &&
    input.discountPercent > 0
  ) {
    if (
      !Number.isFinite(input.discountPercent) ||
      input.discountPercent < 0 ||
      input.discountPercent > 100
    ) {
      throw new Error("Discount percentage must be between 0% and 100%.");
    }
    discountPaise = Math.round((subtotalPaise * input.discountPercent) / 100);
  } else if (input.discountPaise !== undefined && input.discountPaise !== null) {
    if (!Number.isSafeInteger(input.discountPaise) || input.discountPaise < 0) {
      throw new Error("Discount must be a non-negative integer in paise.");
    }
    discountPaise = input.discountPaise;
  }

  if (discountPaise > subtotalPaise) {
    throw new Error("Discount cannot exceed the invoice subtotal.");
  }

  const taxablePaise = subtotalPaise - discountPaise;

  let taxPaise = 0;
  if (
    input.taxPercent !== undefined &&
    input.taxPercent !== null &&
    input.taxPercent > 0
  ) {
    if (
      !Number.isFinite(input.taxPercent) ||
      input.taxPercent < 0 ||
      input.taxPercent > 100
    ) {
      throw new Error("Tax percentage must be between 0% and 100%.");
    }
    taxPaise = Math.round((taxablePaise * input.taxPercent) / 100);
  } else if (input.taxPaise !== undefined && input.taxPaise !== null) {
    if (!Number.isSafeInteger(input.taxPaise) || input.taxPaise < 0) {
      throw new Error("Tax must be a non-negative integer in paise.");
    }
    taxPaise = input.taxPaise;
  }

  const totalPaise = subtotalPaise - discountPaise + taxPaise;
  const initialStatus: InvoiceStatus = totalPaise === 0 ? "PAID" : "PENDING";

  return {
    subtotalPaise,
    discountPaise,
    taxPaise,
    totalPaise,
    initialStatus,
  };
}

/**
 * Determines the authoritative status of an invoice from its totalPaise, paidPaise, and cancellation state.
 */
export function deriveInvoiceStatus(
  totalPaise: number,
  paidPaise: number,
  currentStatus?: string
): InvoiceStatus {
  if (currentStatus === "CANCELLED") {
    return "CANCELLED";
  }
  if (totalPaise === 0 || paidPaise >= totalPaise) {
    return "PAID";
  }
  if (paidPaise > 0) {
    return "PARTIAL";
  }
  return "PENDING";
}

/**
 * Audits an invoice record (with items and payments) against all required financial invariants.
 */
export function auditInvoiceRecord(invoice: {
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
  paidPaise: number;
  status: string;
  items?: Array<{ quantity: number; unitPaise: number }>;
  payments?: Array<{ amountPaise: number }>;
}): InvoiceFinancialSummary {
  const violations: string[] = [];

  const subtotalPaise = Array.isArray(invoice.items)
    ? invoice.items.reduce((sum, item) => sum + item.quantity * item.unitPaise, 0)
    : invoice.totalPaise + invoice.discountPaise - invoice.taxPaise;

  const expectedTotalPaise =
    subtotalPaise - invoice.discountPaise + invoice.taxPaise;
  if (invoice.discountPaise > subtotalPaise) {
    violations.push(
      `discountPaise (${invoice.discountPaise}) exceeds subtotalPaise (${subtotalPaise})`
    );
  }
  if (invoice.totalPaise !== expectedTotalPaise) {
    violations.push(
      `totalPaise (${invoice.totalPaise}) !== subtotalPaise (${subtotalPaise}) - discountPaise (${invoice.discountPaise}) + taxPaise (${invoice.taxPaise}) = ${expectedTotalPaise}`
    );
  }

  const authoritativePaidPaise = Array.isArray(invoice.payments)
    ? invoice.payments.reduce((sum, p) => sum + p.amountPaise, 0)
    : invoice.paidPaise;

  if (invoice.paidPaise !== authoritativePaidPaise) {
    violations.push(
      `paidPaise (${invoice.paidPaise}) !== sum of payments (${authoritativePaidPaise})`
    );
  }

  if (authoritativePaidPaise > invoice.totalPaise) {
    violations.push(
      `authoritativePaidPaise (${authoritativePaidPaise}) exceeds totalPaise (${invoice.totalPaise})`
    );
  }

  if (invoice.status === "CANCELLED" && authoritativePaidPaise > 0) {
    violations.push(
      `CANCELLED invoice has non-zero paidPaise (${authoritativePaidPaise})`
    );
  }

  const expectedStatus = deriveInvoiceStatus(
    invoice.totalPaise,
    authoritativePaidPaise,
    invoice.status
  );
  if (invoice.status !== expectedStatus) {
    violations.push(
      `status (${invoice.status}) does not match expected status (${expectedStatus})`
    );
  }

  const outstandingPaise =
    invoice.status === "CANCELLED"
      ? 0
      : Math.max(0, invoice.totalPaise - authoritativePaidPaise);

  return {
    subtotalPaise,
    discountPaise: invoice.discountPaise,
    taxPaise: invoice.taxPaise,
    totalPaise: invoice.totalPaise,
    paidPaise: authoritativePaidPaise,
    outstandingPaise,
    status: expectedStatus,
    invariantsValid: violations.length === 0,
    violations,
  };
}

