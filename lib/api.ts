import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { csrfFailure, sameOrigin } from "@/lib/security";
export async function protectedWrite(request:Request){if(!await isAuthenticated())return NextResponse.json({error:"Unauthorized"},{status:401});return sameOrigin(request)?null:csrfFailure()}
export async function protectedRead(){return await isAuthenticated()?null:NextResponse.json({error:"Unauthorized"},{status:401})}
export function queueRecord(tx:{syncQueue:{upsert:Function}},entity:string,entityId:string){return tx.syncQueue.upsert({where:{entity_entityId_operation:{entity,entityId,operation:"UPSERT"}},create:{entity,entityId,operation:"UPSERT",payload:JSON.stringify({entityId})},update:{status:"PENDING",nextAttemptAt:new Date(),lastError:null}})}
