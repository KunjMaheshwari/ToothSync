import { PrismaClient } from "@prisma/client";
import { google } from "googleapis";

const db = new PrismaClient();
const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:3000";
const pad = (value: number) => String(value).padStart(3, "0");
const patientSeeds = [
  ["Aarav", "Mehta", "Male", "1990-01-14", "Ahmedabad", "Penicillin", "Mild asthma", "Routine cleanings; no prior surgery"],
  ["Diya", "Shah", "Female", "1988-03-22", "Surat", "None known", "None", "Orthodontic assessment in 2018"],
  ["Kabir", "Patel", "Male", "1979-07-09", "Vadodara", "Latex", "Type 2 diabetes", "Root canal on upper molar in 2020"],
  ["Anaya", "Desai", "Female", "1995-11-30", "Rajkot", "None known", "Hypothyroidism", "Annual scaling; sensitivity to cold"],
  ["Vivaan", "Joshi", "Male", "1984-05-17", "Gandhinagar", "Ibuprofen", "Hypertension", "Crown fitted in 2019"],
  ["Ishita", "Rao", "Female", "1992-09-04", "Bhavnagar", "None known", "Migraine", "Composite filling in 2022"],
  ["Arjun", "Kapoor", "Male", "1981-12-12", "Jamnagar", "Sulfa drugs", "None", "Wisdom tooth extraction in 2015"],
  ["Myra", "Nair", "Female", "1997-02-26", "Anand", "None known", "Iron deficiency", "Fluoride treatment in 2023"],
  ["Reyansh", "Iyer", "Male", "1986-08-18", "Nadiad", "None known", "Seasonal allergies", "Night guard recommended in 2021"],
  ["Kiara", "Singh", "Female", "1993-06-05", "Valsad", "Aspirin", "None", "Routine dental history unremarkable"],
] as const;

const patients = patientSeeds.map(([firstName, lastName, gender, dateOfBirth, city, allergies, conditions, dentalHistory], index) => ({
  referenceId: `QA-DENTAL-${pad(index + 1)}`,
  firstName, lastName, gender, dateOfBirth, city, allergies, conditions, dentalHistory,
  phone: `+91 900000${String(index + 1).padStart(3, "0")}`,
  email: `qa.dental.${pad(index + 1)}@example.test`,
  consented: true,
}));

function iso(value: Date | string | null | undefined) { return value ? new Date(value).toISOString() : ""; }
function value(row: string[], columns: Record<string, number>, column: string) { return row[columns[column]] ?? ""; }
async function request(path: string, init: RequestInit) {
  const result = await fetch(`${baseUrl}${path}`, init);
  const body = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(`${init.method || "GET"} ${path}: ${result.status} ${JSON.stringify(body)}`);
  return { result, body };
}

async function getSheetRows() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!email || !key || !spreadsheetId) throw new Error("Google Sheets credentials are not configured.");
  const auth = new google.auth.JWT({ email, key, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Patients'!A:Z" });
  const [headers = [], ...rows] = response.data.values ?? [];
  return { headers: headers as string[], rows: rows as string[][] };
}

async function main() {
  const preexisting = await db.patient.findMany({ where: { referenceId: { in: patients.map(patient => patient.referenceId) } } });
  for (const row of preexisting) {
    const expected = patients.find(patient => patient.referenceId === row.referenceId)!;
    if (!expected || row.firstName !== expected.firstName || row.lastName !== expected.lastName || row.phone !== expected.phone || row.email !== expected.email) throw new Error(`Existing QA fixture ${row.referenceId} does not match this synthetic test and will not be overwritten.`);
  }
  const login = await request("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: baseUrl }, body: JSON.stringify({ username: "doctorkinjal", password: "kunj123" }) });
  const cookie = login.result.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Login succeeded without a session cookie.");
  const headers = { "Content-Type": "application/json", Origin: baseUrl, Cookie: cookie };

  for (const patient of patients) if (!preexisting.some(row => row.referenceId === patient.referenceId)) await request("/api/patients", { method: "POST", headers, body: JSON.stringify(patient) });
  const saved = await db.patient.findMany({ where: { referenceId: { in: patients.map(patient => patient.referenceId) } }, orderBy: { referenceId: "asc" } });
  if (saved.length !== 10) throw new Error(`SQLite verification failed: expected 10 QA patients, found ${saved.length}.`);

  await db.syncQueue.updateMany({ where: { entity: "Patient", entityId: { in: saved.map(patient => patient.id) } }, data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastError: null } });
  await request("/api/sync", { method: "POST", headers: { Origin: baseUrl, Cookie: cookie } });
  let { headers: sheetHeaders, rows } = await getSheetRows();
  const columns = Object.fromEntries(sheetHeaders.map((header, index) => [header, index]));
  const required = ["Record ID", "Patient ID", "Reference ID", "First Name", "Last Name", "Date of Birth", "Gender", "Phone", "Email", "City", "Known Allergies", "Medical Conditions", "Dental History", "Consented", "Registered At", "Updated At"];
  const missingHeaders = required.filter(header => columns[header] === undefined);
  if (missingHeaders.length) throw new Error(`Patients sheet headers are incomplete: ${missingHeaders.join(", ")}`);

  let synchronized = 0, validated = 0, missing = 0, duplicates = 0, mismatches = 0;
  const reports: Array<{ referenceId: string; pass: boolean; rowNumbers: number[]; details: Record<string, string>; errors: string[] }> = [];
  for (const patient of saved) {
    const matched = rows.map((row, index) => ({ row, rowNumber: index + 2 })).filter(item => value(item.row, columns, "Reference ID") === patient.referenceId);
    const expected: Record<string, string> = {
      "Record ID": patient.id, "Patient ID": patient.patientId, "Reference ID": patient.referenceId ?? "", "First Name": patient.firstName, "Last Name": patient.lastName,
      "Date of Birth": iso(patient.dateOfBirth), "Gender": patient.gender ?? "", "Phone": patient.phone, "Email": patient.email ?? "", "City": patient.city ?? "",
      "Known Allergies": patient.allergies ?? "", "Medical Conditions": patient.conditions ?? "", "Dental History": patient.dentalHistory ?? "", "Consented": String(patient.consented),
      "Registered At": iso(patient.registeredAt), "Updated At": iso(patient.updatedAt),
    };
    const errors: string[] = [];
    if (matched.length === 0) { missing++; errors.push("missing from Google Sheets"); }
    if (matched.length > 1) { duplicates += matched.length - 1; errors.push(`duplicate rows: ${matched.map(item => item.rowNumber).join(", ")}`); }
    if (matched.length === 1) {
      synchronized++;
      for (const [field, expectedValue] of Object.entries(expected)) if (value(matched[0].row, columns, field) !== expectedValue) errors.push(`${field} expected ${JSON.stringify(expectedValue)} got ${JSON.stringify(value(matched[0].row, columns, field))}`);
    }
    if (errors.some(error => error.includes(" expected "))) mismatches++;
    const pass = errors.length === 0;
    if (pass) validated++;
    reports.push({ referenceId: patient.referenceId ?? "", pass, rowNumbers: matched.map(item => item.rowNumber), details: expected, errors });
  }
  for (const report of reports) {
    console.log(`\n${report.pass ? "PASS" : "FAIL"} ${report.referenceId} | Google Sheets row(s): ${report.rowNumbers.join(", ") || "none"}`);
    console.log(JSON.stringify(report.details));
    for (const error of report.errors) console.log(`  - ${error}`);
  }

  await request("/api/sync", { method: "POST", headers: { Origin: baseUrl, Cookie: cookie } });
  ({ rows } = await getSheetRows());
  for (const report of reports) {
    const count = rows.filter(row => value(row, columns, "Reference ID") === report.referenceId).length;
    if (count !== 1 && !report.errors.some(error => error.startsWith("duplicate rows"))) { duplicates += Math.max(0, count - 1); if (count === 0) missing++; report.pass = false; report.errors.push(`second sync count was ${count}`); }
  }
  const finalPass = synchronized === 10 && validated === 10 && missing === 0 && duplicates === 0 && mismatches === 0 && reports.every(report => report.pass);
  console.log(`\nTotal patients created: 10\nSuccessfully synchronized: ${synchronized}/10\nSuccessfully validated in Google Sheets: ${validated}/10\nMissing records: ${missing}\nDuplicate records: ${duplicates}\nField mismatches: ${mismatches}\nFinal result: ${finalPass ? "PASS" : "FAIL"}`);
  if (!finalPass) process.exitCode = 1;
}

main().catch(error => { console.error(`\nFinal result: FAIL\n${error instanceof Error ? error.stack : error}`); process.exitCode = 1; }).finally(() => db.$disconnect());
