import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import swift from './swift-three-star-challenge.json'
import {validateChallengeFragment,assembleChallengeFragments,handleChallengeFragmentPost,FRAGMENT_BYTES,type ChallengeFragment} from '../lib/three-star-fragments'
import {validateChallengeAttempt,hash} from '../lib/three-star-attempts'
import {GameplayConflictError} from '../lib/gameplay-db'
const checksum=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
const request=(raw:unknown)=>new Request('https://example.test/api/three-star-attempt-parts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(raw)})
function fixture():ChallengeFragment[] {
 const {sessions,...challenge}=structuredClone(swift),session=sessions[0],move=session.actions[0]
 const leading=Array.from({length:10000},(_,i)=>i%2===0?{...move,atMs:0}:{type:'undo',atMs:0})
 session.actions=[...leading,...session.actions] as typeof session.actions
 session.totalMoves+=5000;session.undos+=5000;challenge.totalMoves+=5000;challenge.undos+=5000
 const body={protocolVersion:2,challenge,sessionIndex:0,session}
 validateChallengeAttempt(body)
 const bytes=Buffer.from(JSON.stringify(body)),payloadHash=checksum(bytes),partCount=Math.ceil(bytes.length/FRAGMENT_BYTES)
 assert.ok(partCount>1)
 return Array.from({length:partCount},(_,partIndex)=>{
  const part=bytes.subarray(partIndex*FRAGMENT_BYTES,(partIndex+1)*FRAGMENT_BYTES)
  return {protocolVersion:3,challengeId:challenge.challengeId.toLowerCase(),sessionIndex:0,partIndex,partCount,byteCount:bytes.length,payloadHash,partHash:checksum(part),data:part.toString('base64')}
 })
}
test('small requests reconstruct a large legal session; duplicate and out-of-order fragments do not lose actions',async()=>{
 const parts=fixture(),stored=new Map<number,ChallengeFragment>();let finalizations=0
 const save=async(p:ChallengeFragment)=>{
  const old=stored.get(p.partIndex)
  if(old && hash(old)!==hash(p))throw new GameplayConflictError('immutable fragment')
  stored.set(p.partIndex,p)
  if(stored.size<parts.length)return {attemptComplete:false,complete:false}
  const attempt=validateChallengeAttempt(assembleChallengeFragments([...stored.values()]))
  assert.equal(attempt.session.actions.length,10020);finalizations++
  return {attemptComplete:true,complete:false}
 }
 for(const p of [...parts].reverse()) {
  assert.ok(Buffer.byteLength(JSON.stringify(p))<512*1024)
  const response=await handleChallengeFragmentPost(request(p),save);assert.equal(response.status,200)
  assert.equal((await response.json()).attemptComplete,stored.size===parts.length)
 }
 const repeated=await handleChallengeFragmentPost(request(parts.at(-1)!),save)
 assert.equal(repeated.status,200);assert.equal((await repeated.json()).attemptComplete,true)
 assert.equal(stored.size,parts.length);assert.equal(finalizations,2)
 const changed=structuredClone(parts[0]),bytes=Buffer.from(changed.data,'base64');bytes[0]^=1;changed.data=bytes.toString('base64');changed.partHash=checksum(bytes)
 assert.equal((await handleChallengeFragmentPost(request(changed),save)).status,409)
})
test('checksums, omitted fragments, mixed payloads, byte bounds, and storage network failures remain explicit',async()=>{
 const parts=fixture()
 const bad=structuredClone(parts[0]);bad.partHash='0'.repeat(64);assert.throws(()=>validateChallengeFragment(bad))
 assert.throws(()=>assembleChallengeFragments(parts.slice(1)))
 const mixed=structuredClone(parts);mixed[1].payloadHash='0'.repeat(64);assert.throws(()=>assembleChallengeFragments(mixed))
 const down=await handleChallengeFragmentPost(request(parts[0]),async()=>{throw new TypeError('fetch failed')})
 assert.equal(down.status,503);assert.equal(down.headers.get('Retry-After'),'60')
 const oversized=new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:new Uint8Array(512*1024+1)})
 assert.equal((await handleChallengeFragmentPost(oversized,async()=>({attemptComplete:false,complete:false}))).status,413)
})
