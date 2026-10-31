import { db } from "@/lib/db";

export async function loadSyncRecord(entity:string,id:string) {
  switch(entity) {
    case "Patient": return db.patient.findUniqueOrThrow({where:{id}});
    case "Appointment": return db.appointment.findUniqueOrThrow({where:{id},include:{patient:true}});
    case "Treatment": return db.treatment.findUniqueOrThrow({where:{id},include:{patient:true}});
    case "Prescription": return db.prescription.findUniqueOrThrow({where:{id},include:{patient:true,items:true}});
    case "Invoice": return db.invoice.findUniqueOrThrow({where:{id},include:{patient:true,items:true,payments:true}});
    case "Payment": return db.payment.findUniqueOrThrow({where:{id},include:{invoice:true}});
    case "FollowUp": return db.followUp.findUniqueOrThrow({where:{id},include:{patient:true}});
    default: throw new Error(`Unsupported sync entity: ${entity}`);
  }
}
