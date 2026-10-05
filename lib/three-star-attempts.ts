import {createHash} from 'node:crypto'
import {object,keys,integer,text,uuid,date,registeredPuzzle,boardHash,validateGameplaySession,GameplayValidationError,type GameplaySession} from './gameplay-validation'
import {GameplayConflictError} from './gameplay-db'
import type {ThreeStarChallengeRecord} from './three-star-validation'
import {readGameplayBody,TooLargeError} from './gameplay-http'
export type ChallengeManifest = Omit<ThreeStarChallengeRecord,'sessions'>
export interface ChallengeAttempt {protocolVersion:2;challenge:ChallengeManifest;sessionIndex:number;session:GameplaySession}
export const hash = (value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const manifestKeys=['schemaVersion','source','challengeId','firstSessionId','playerId','datasetKind','packId','levelId','boardHash','rulesVersion','capacity','startedAt','achievedAt','optimalMoves','elapsedMs','totalMoves','restarts','undos','attemptCount','completedCount','clientVersion']
function fail(message:string):never {throw new GameplayValidationError(message)}
export function validateChallengeAttempt(raw:unknown):ChallengeAttempt {
  const part=object(raw);keys(part,['protocolVersion','challenge','sessionIndex','session'])
  if(part.protocolVersion!==2)fail('Unknown attempt protocol')
  const v=object(part.challenge);keys(v,manifestKeys)
  const puzzle=registeredPuzzle(v)
  if(!puzzle?.optimalMoves || v.schemaVersion!==1 || v.source!=='ios' || v.rulesVersion!=='classic-v1' || v.optimalMoves!==puzzle.optimalMoves || v.capacity!==puzzle.capacity || v.boardHash!==boardHash(puzzle.capacity,puzzle.board))fail('Mismatched challenge puzzle')
  const challengeId=uuid(v.challengeId,'challengeId'),firstSessionId=uuid(v.firstSessionId,'firstSessionId'),playerId=uuid(v.playerId,'playerId')
  const startedAt=date(v.startedAt,'startedAt'),achievedAt=date(v.achievedAt,'achievedAt'),clientVersion=text(v.clientVersion,'clientVersion',100)
  const completedCount=integer(v.completedCount,'completedCount',100000)
  if(!completedCount)fail('Empty challenge')
  const sessionIndex=integer(part.sessionIndex,'sessionIndex',completedCount-1)
  const session=validateGameplaySession(part.session,puzzle)
  if(session.playerId!==playerId || session.startedAt<startedAt || (sessionIndex===0 && session.sessionId!==firstSessionId) ||
    (sessionIndex===completedCount-1 && (session.sessionId!==challengeId || session.completedAt!==achievedAt)) ||
    (sessionIndex===completedCount-1 ? session.currentMoves>puzzle.optimalMoves : session.currentMoves<=puzzle.optimalMoves))fail('Invalid attempt position or first win')
  const elapsedMs=integer(v.elapsedMs,'elapsedMs'),totalMoves=integer(v.totalMoves,'totalMoves'),restarts=integer(v.restarts,'restarts'),undos=integer(v.undos,'undos'),attemptCount=integer(v.attemptCount,'attemptCount')
  if(attemptCount!==completedCount+restarts || session.elapsedMs>elapsedMs || session.totalMoves>totalMoves || session.restarts>restarts || session.undos>undos)fail('Invalid challenge totals')
  const challenge:ChallengeManifest={schemaVersion:1,source:'ios',challengeId,firstSessionId,playerId,datasetKind:session.datasetKind,packId:session.packId,levelId:session.levelId,boardHash:session.boardHash,rulesVersion:'classic-v1',capacity:session.capacity,startedAt,achievedAt,optimalMoves:puzzle.optimalMoves,elapsedMs,totalMoves,restarts,undos,attemptCount,completedCount,clientVersion}
  return {protocolVersion:2,challenge,sessionIndex,session}
}
export function confirmAttemptDuplicate(existing:ChallengeAttempt,incoming:ChallengeAttempt):void {
  if(hash(existing)!==hash(incoming))throw new GameplayConflictError('An immutable challenge attempt already exists')
}
export function confirmCompleteAttempts(manifest:ChallengeManifest,attempts:GameplaySession[]):void {
  function sum(key:'elapsedMs'|'totalMoves'|'restarts'|'undos') {return attempts.reduce((a,s)=>Math.min(Number.MAX_SAFE_INTEGER-a,s[key])+a,0)}
  if(attempts.length!==manifest.completedCount || new Set(attempts.map(s=>s.sessionId)).size!==attempts.length ||
    attempts[0].sessionId!==manifest.firstSessionId || attempts.at(-1)!.sessionId!==manifest.challengeId ||
    attempts.reduce((a,s)=>a<s.startedAt?a:s.startedAt,attempts[0].startedAt)!==manifest.startedAt ||
    ['elapsedMs','totalMoves','restarts','undos'].some(k=>sum(k as 'elapsedMs')!==manifest[k as 'elapsedMs']))fail('Challenge totals disagree with attempts')
}
export async function handleChallengeAttemptPost(request:Request,save:(part:ChallengeAttempt)=>Promise<boolean>):Promise<Response> {
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return Response.json({error:'Expected application/json'},{status:415})
  try {
    const part=validateChallengeAttempt(await readGameplayBody(request))
    const key=request.headers.get('idempotency-key')
    if(key && key.toLowerCase()!==part.challenge.challengeId)fail('Idempotency key must match challengeId')
    const complete=await save(part)
    return Response.json({ok:true,challengeId:part.challenge.challengeId,sessionIndex:part.sessionIndex,sessionId:part.session.sessionId,complete})
  } catch(error) {
    if(error instanceof TooLargeError)return Response.json({error:'Attempt too large'},{status:413})
    if(error instanceof GameplayConflictError)return Response.json({error:error.message},{status:409})
    if(error instanceof GameplayValidationError || error instanceof SyntaxError)return Response.json({error:'Invalid challenge attempt'},{status:400})
    console.error('Challenge attempt storage unavailable',error instanceof Error?error.name:'unknown')
    return Response.json({error:'Attempt storage unavailable'},{status:503,headers:{'Retry-After':'60'}})
  }
}
