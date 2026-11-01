import {createHash} from 'node:crypto'
import {object,keys,integer,uuid,text,GameplayValidationError} from './gameplay-validation'
import {GameplayConflictError} from './gameplay-db'
import {readGameplayBody,TooLargeError} from './gameplay-http'
export const FRAGMENT_BYTES=256*1024
export interface ChallengeFragment {
 protocolVersion:3;challengeId:string;sessionIndex:number;partIndex:number;partCount:number;byteCount:number
 payloadHash:string;partHash:string;data:string
}
export interface FragmentReceipt {attemptComplete:boolean;complete:boolean}
const checksum=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
export function validateChallengeFragment(raw:unknown):ChallengeFragment {
 const v=object(raw);keys(v,['protocolVersion','challengeId','sessionIndex','partIndex','partCount','byteCount','payloadHash','partHash','data'])
 if(v.protocolVersion!==3)throw new GameplayValidationError('Unknown fragment protocol')
 const challengeId=uuid(v.challengeId,'challengeId'),sessionIndex=integer(v.sessionIndex,'sessionIndex',99999)
 const byteCount=integer(v.byteCount,'byteCount',8*1024*1024),partCount=integer(v.partCount,'partCount',32)
 if(!byteCount || partCount!==Math.ceil(byteCount/FRAGMENT_BYTES))throw new GameplayValidationError('Invalid fragment count')
 const partIndex=integer(v.partIndex,'partIndex',partCount-1),payloadHash=text(v.payloadHash,'payloadHash',64),partHash=text(v.partHash,'partHash',64)
 if(!/^[a-f0-9]{64}$/.test(payloadHash) || !/^[a-f0-9]{64}$/.test(partHash))throw new GameplayValidationError('Invalid fragment hash')
 const data=text(v.data,'data',Math.ceil(FRAGMENT_BYTES/3)*4),bytes=Buffer.from(data,'base64')
 if(bytes.toString('base64')!==data || bytes.length!==Math.min(FRAGMENT_BYTES,byteCount-partIndex*FRAGMENT_BYTES) || checksum(bytes)!==partHash)throw new GameplayValidationError('Fragment bytes disagree')
 return {protocolVersion:3,challengeId,sessionIndex,partIndex,partCount,byteCount,payloadHash,partHash,data}
}
export function assembleChallengeFragments(parts:ChallengeFragment[]):unknown {
 if(!parts.length)throw new GameplayValidationError('Missing fragments')
 const first=parts[0],ordered=[...parts].sort((a,b)=>a.partIndex-b.partIndex)
 if(ordered.length!==first.partCount || ordered.some((p,i)=>p.partIndex!==i || p.challengeId!==first.challengeId || p.sessionIndex!==first.sessionIndex || p.payloadHash!==first.payloadHash || p.byteCount!==first.byteCount || p.partCount!==first.partCount))throw new GameplayValidationError('Mixed or missing fragments')
 const bytes=Buffer.concat(ordered.map(p=>Buffer.from(p.data,'base64')))
 if(bytes.length!==first.byteCount || checksum(bytes)!==first.payloadHash)throw new GameplayValidationError('Payload hash mismatch')
 let text:string
 try {text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)} catch {throw new GameplayValidationError('Invalid payload UTF-8')}
 return JSON.parse(text)
}
export async function handleChallengeFragmentPost(request:Request,save:(part:ChallengeFragment)=>Promise<FragmentReceipt>):Promise<Response> {
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return Response.json({error:'Expected application/json'},{status:415})
 try {
  const part=validateChallengeFragment(await readGameplayBody(request,512*1024))
  const key=request.headers.get('idempotency-key')
  if(key && key.toLowerCase()!==part.challengeId)throw new GameplayValidationError('Idempotency key mismatch')
  const receipt=await save(part)
  return Response.json({ok:true,challengeId:part.challengeId,sessionIndex:part.sessionIndex,partIndex:part.partIndex,partCount:part.partCount,payloadHash:part.payloadHash,...receipt})
 } catch(error) {
  if(error instanceof TooLargeError)return Response.json({error:'Fragment request too large'},{status:413})
  if(error instanceof GameplayConflictError)return Response.json({error:error.message},{status:409})
  if(error instanceof GameplayValidationError || error instanceof SyntaxError)return Response.json({error:'Invalid challenge fragment'},{status:400})
  console.error('Challenge fragment storage unavailable',error instanceof Error?error.name:'unknown')
  return Response.json({error:'Fragment storage unavailable'},{status:503,headers:{'Retry-After':'60'}})
 }
}
