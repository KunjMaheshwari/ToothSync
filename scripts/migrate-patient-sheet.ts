import { PrismaClient } from "@prisma/client";
import { google } from "googleapis";
import { buildSheetRecord } from "../lib/sheets";

const db = new PrismaClient();
async function main() {
  const email=process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key=process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g,"\n"), spreadsheetId=process.env.GOOGLE_SHEET_ID;
  if(!email||!key||!spreadsheetId) throw new Error("Google Sheets credentials are not configured.");
  const auth=new google.auth.JWT({email,key,scopes:["https://www.googleapis.com/auth/spreadsheets"]}); const sheets=google.sheets({version:"v4",auth});
  const existing=(await sheets.spreadsheets.values.get({spreadsheetId,range:"'Patients'!A:Z"})).data.values??[];
  const ids=existing.slice(1).map(row=>row[0]).filter(Boolean); const records=await db.patient.findMany({where:{id:{in:ids}}});
  if(records.length!==ids.length) throw new Error("Patient-sheet migration stopped: at least one existing row is not an application patient record.");
  const byId=new Map(records.map(record=>[record.id,record])); const prototype=buildSheetRecord("Patient",records[0]);
  const values=[prototype.headers,...ids.map(id=>buildSheetRecord("Patient",byId.get(id)).values)];
  await sheets.spreadsheets.values.update({spreadsheetId,range:`'Patients'!A1:P${values.length}`,valueInputOption:"RAW",requestBody:{values}});
  console.log(`Migrated ${ids.length} patient rows to the expanded, compatible schema without deleting rows.`);
}
main().finally(()=>db.$disconnect());
