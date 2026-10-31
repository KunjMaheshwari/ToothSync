import { google, sheets_v4 } from "googleapis";

type SheetRecord = { tab:string; headers:string[]; id:string; values:(string|number)[] };

export function buildSheetRecord(entity:string, value:any): SheetRecord {
  const iso=(date:Date|string|undefined)=>date?new Date(date).toISOString():"";
  const name=value.patient?`${value.patient.firstName} ${value.patient.lastName}`:"";
  switch(entity) {
    case "Patient": return {tab:"Patients",headers:["Record ID","Patient ID","Reference ID","First Name","Last Name","Date of Birth","Gender","Phone","Email","City","Known Allergies","Medical Conditions","Dental History","Consented","Registered At","Updated At"],id:value.id,values:[value.id,value.patientId,value.referenceId??"",value.firstName,value.lastName,iso(value.dateOfBirth),value.gender??"",value.phone,value.email??"",value.city??"",value.allergies??"",value.conditions??"",value.dentalHistory??"",String(Boolean(value.consented)),iso(value.registeredAt),iso(value.updatedAt??new Date())]};
    case "Appointment": return {tab:"Appointments",headers:["Record ID","Patient Record ID","Patient","Start","End","Type","Status"],id:value.id,values:[value.id,value.patientId,name,iso(value.startsAt),iso(value.endsAt),value.type,value.status]};
    case "Treatment": return {tab:"Treatments",headers:["Record ID","Patient Record ID","Patient","Date","Category","Procedure","Tooth","Cost Paise","Status"],id:value.id,values:[value.id,value.patientId,name,iso(value.date),value.category,value.procedure,value.toothNumber??"",value.costPaise??0,value.status]};
    case "Prescription": return {tab:"Prescriptions",headers:["Record ID","Patient Record ID","Patient","Date","Items","Notes"],id:value.id,values:[value.id,value.patientId,name,iso(value.date),(value.items??[]).map((item:any)=>`${item.medication} | ${item.dosage} | ${item.frequency} | ${item.duration}`).join("; "),value.notes??""]};
    case "Invoice": return {tab:"Invoices",headers:["Record ID","Patient Record ID","Patient","Invoice Number","Date","Total Paise","Paid Paise","Status"],id:value.id,values:[value.id,value.patientId,name,value.invoiceNumber,iso(value.date),value.totalPaise,value.paidPaise,value.status]};
    case "Payment": return {tab:"Payments",headers:["Record ID","Invoice Record ID","Amount Paise","Method","Paid At"],id:value.id,values:[value.id,value.invoiceId,value.amountPaise,value.method,iso(value.paidAt)]};
    case "FollowUp": return {tab:"Follow-ups",headers:["Record ID","Patient Record ID","Patient","Due Date","Reason","Status"],id:value.id,values:[value.id,value.patientId,name,iso(value.dueDate),value.reason,value.status]};
    default: throw new Error(`Unsupported sync entity: ${entity}`);
  }
}

function configured() {
  const email=process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key=process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g,"\n"), sheetId=process.env.GOOGLE_SHEET_ID;
  if(!email||!key||!sheetId) throw new Error("Google Sheets credentials are not configured.");
  const auth=new google.auth.JWT({email,key,scopes:["https://www.googleapis.com/auth/spreadsheets"]});
  return {sheets:google.sheets({version:"v4",auth}),sheetId};
}
async function ensureTab(sheets:sheets_v4.Sheets,spreadsheetId:string,tab:string,headers:string[]) {
  const meta=await sheets.spreadsheets.get({spreadsheetId,fields:"sheets.properties"});
  const exists=meta.data.sheets?.some(sheet=>sheet.properties?.title===tab);
  if(!exists) await sheets.spreadsheets.batchUpdate({spreadsheetId,requestBody:{requests:[{addSheet:{properties:{title:tab}}}]}});
  const first=await sheets.spreadsheets.values.get({spreadsheetId,range:`'${tab}'!1:1`}); const current=first.data.values?.[0]??[];
  if(!current.length) await sheets.spreadsheets.values.update({spreadsheetId,range:`'${tab}'!A1`,valueInputOption:"RAW",requestBody:{values:[headers]}});
  else if(current.length!==headers.length||current.some((header,index)=>header!==headers[index])) throw new Error(`Sheet ${tab} has an incompatible header. Run its explicit data-preserving migration before syncing.`);
}
export async function syncRecordToSheets(entity:string, value:any) {
  const record=buildSheetRecord(entity,value); const {sheets,sheetId}=configured(); await ensureTab(sheets,sheetId,record.tab,record.headers);
  const range=`'${record.tab}'!A:A`; const existing=await sheets.spreadsheets.values.get({spreadsheetId:sheetId,range}); const row=(existing.data.values??[]).findIndex(r=>r[0]===record.id);
  if(row>=1) await sheets.spreadsheets.values.update({spreadsheetId:sheetId,range:`'${record.tab}'!A${row+1}`,valueInputOption:"RAW",requestBody:{values:[record.values]}});
  else await sheets.spreadsheets.values.append({spreadsheetId:sheetId,range:`'${record.tab}'!A:Z`,valueInputOption:"RAW",insertDataOption:"INSERT_ROWS",requestBody:{values:[record.values]}});
}
