import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import swift from './swift-three-star-challenge.json'
import {validateChallengeAttempt,confirmAttemptDuplicate,confirmCompleteAttempts,handleChallengeAttemptPost,hash,type ChallengeAttempt} from '../lib/three-star-attempts'
import {validateThreeStarChallenge} from '../lib/three-star-validation'
import {GameplayConflictError} from '../lib/gameplay-db'
import {MAX_GAMEPLAY_BYTES} from '../lib/gameplay-http'
const request=(raw:unknown)=>new Request('https://example.test/api/three-star-attempts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(raw)})
function parts() {const {sessions,...challenge}=structuredClone(swift);return sessions.map((session,sessionIndex)=>({protocolVersion:2,challenge,sessionIndex,session}))}
function storage() {
 const saved=new Map<number,ChallengeAttempt>();let manifestHash:string|undefined;let completed=false
 return {saved,save:async(part:ChallengeAttempt)=>{
  if(manifestHash && manifestHash!==hash(part.challenge))throw new GameplayConflictError('immutable manifest')
  manifestHash=hash(part.challenge)
  const old=saved.get(part.sessionIndex)
  if(old)confirmAttemptDuplicate(old,part)
  else {
   if([...saved.values()].some(p=>p.session.sessionId===part.session.sessionId))throw new GameplayConflictError('duplicate session')
   saved.set(part.sessionIndex,part)
  }
  if(saved.size===part.challenge.completedCount) {
   try {confirmCompleteAttempts(part.challenge,[...saved.values()].sort((a,b)=>a.sessionIndex-b.sessionIndex).map(p=>p.session))}
   catch(error) {if(!old)saved.delete(part.sessionIndex);throw error}
   completed=true
  }
  return completed
 }}
}
test('out-of-order receipt, lost responses, and duplicates preserve one immutable completion',async()=>{
 const rows=parts(),db=storage()
 for(const i of [2,0,0,1,2]) {
  const result=await handleChallengeAttemptPost(request(rows[i]),db.save);assert.equal(result.status,200)
  const ack=await result.json();assert.equal(ack.sessionIndex,i);assert.equal(ack.complete,db.saved.size===3)
 }
 assert.equal(db.saved.size,3)
 const changed=structuredClone(rows[0]);changed.session.clientVersion='different'
 assert.equal((await handleChallengeAttemptPost(request(changed),db.save)).status,409)
 const different=structuredClone(rows[0]);different.challenge.clientVersion='different'
 assert.equal((await handleChallengeAttemptPost(request(different),db.save)).status,409)
})
test('large legal 201614-action challenge exceeds old aggregate and whole-body limits without truncation',async()=>{
 const raw=structuredClone(swift);const base=structuredClone(raw.sessions[1])
 const sessions=Array.from({length:100},(_,i)=>{
  const session=structuredClone(base);session.sessionId=i===0?raw.firstSessionId:randomUUID()
  const move=structuredClone(session.actions[0])
  session.actions=[]
  for(let j=0;j<1000;j++)session.actions.push({...move,atMs:2*j+1},{type:'undo',atMs:2*j+2})
  session.actions.push(...base.actions.map((a,j)=>({...a,atMs:2001+j})))
  session.elapsedMs=2016;session.totalMoves=base.totalMoves+1000;session.undos=base.undos+1000
  return session
 });const winner=structuredClone(raw.sessions.at(-1)!);winner.actions=winner.actions.slice(4);winner.totalMoves=14;winner.undos=0;winner.restarts=0;sessions.push(winner)
 raw.sessions=sessions;raw.completedCount=sessions.length;raw.restarts=sessions.reduce((a,s)=>a+s.restarts,0)
 raw.attemptCount=sessions.length+raw.restarts
 for(const key of ['elapsedMs','totalMoves','undos'] as const)raw[key]=sessions.reduce((a,s)=>a+s[key],0)
 raw.startedAt=sessions.reduce((a,s)=>a<s.startedAt?a:s.startedAt,sessions[0].startedAt)
 assert.equal(sessions.reduce((a,s)=>a+s.actions.length,0),201614)
 assert.ok(Buffer.byteLength(JSON.stringify(raw))>MAX_GAMEPLAY_BYTES)
 assert.throws(()=>validateThreeStarChallenge(raw))
 const {sessions:attempts,...challenge}=raw,db=storage()
 for(let sessionIndex=0;sessionIndex<attempts.length;sessionIndex++) {
  const part={protocolVersion:2,challenge,sessionIndex,session:attempts[sessionIndex]}
  assert.ok(Buffer.byteLength(JSON.stringify(part))<MAX_GAMEPLAY_BYTES)
  const result=await handleChallengeAttemptPost(request(part),db.save);assert.equal(result.status,200)
  assert.equal((await result.json()).complete,sessionIndex===attempts.length-1)
 }
 assert.equal([...db.saved.values()].reduce((a,p)=>a+p.session.actions.length,0),201614)
})
test('invalid position, wrong identity, premature win, duplicate session, sums, and outage remain safe',async()=>{
 const rows=parts()
 for(const bad of [ {...rows[0],sessionIndex:-1},{...rows[0],sessionIndex:3},{...rows[0],protocolVersion:1},{...rows[0],session:rows[2].session} ])assert.throws(()=>validateChallengeAttempt(bad))
 const badTotals=parts();badTotals.forEach(p=>p.challenge.totalMoves++)
 const db=storage()
 for(const p of badTotals.slice(0,2))assert.equal((await handleChallengeAttemptPost(request(p),db.save)).status,200)
 assert.equal((await handleChallengeAttemptPost(request(badTotals[2]),db.save)).status,400);assert.equal(db.saved.size,2)
 const down=await handleChallengeAttemptPost(request(rows[0]),async()=>{throw new Error('offline')})
 assert.equal(down.status,503);assert.equal(down.headers.get('Retry-After'),'60')
 const oversized=new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:new Uint8Array(MAX_GAMEPLAY_BYTES+1)})
 assert.equal((await handleChallengeAttemptPost(oversized,async()=>false)).status,413)
})
