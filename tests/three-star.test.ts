import {test} from 'node:test'
import assert from 'node:assert/strict'
import swiftChallenge from './swift-three-star-challenge.json'
import {validateThreeStarChallenge,challengePayloadHash} from '../lib/three-star-validation'
import {confirmChallengeDuplicate} from '../lib/three-star-db'
import {handleThreeStarPost} from '../lib/three-star-http'
import {validateGameplaySession} from '../lib/gameplay-validation'
import {GameplayConflictError} from '../lib/gameplay-db'
import {MAX_GAMEPLAY_BYTES} from '../lib/gameplay-http'
const clone=()=>structuredClone(swiftChallenge)
const request=(body:unknown,headers={})=>new Request('https://example.test/api/three-star-challenges',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)})
test('real Swift challenge replays one/two/three stars, all retries, and sums 52 pours',()=>{
  const row=validateThreeStarChallenge(clone())
  assert.deepEqual(row.sessions.map(s=>s.currentMoves),[20,16,14])
  assert.equal(row.optimalMoves,14);assert.equal(row.totalMoves,52);assert.equal(row.elapsedMs,6000)
  assert.equal(row.attemptCount,4);assert.equal(row.completedCount,3);assert.equal(row.restarts,1);assert.equal(row.undos,1)
  assert.equal(row.challengeId,row.sessions[2].sessionId);assert.equal(row.firstSessionId,row.sessions[0].sessionId)
  assert.equal(validateGameplaySession(row.sessions[0]).totalMoves,20)
  assert.throws(()=>validateGameplaySession(row))
})
test('challenge rejects mismatched sums, optimum, player, omitted first or extra sessions after three stars',()=>{
  for(const key of ['totalMoves','elapsedMs','attemptCount','optimalMoves','completedCount'] as const){const bad=clone();bad[key]++;assert.throws(()=>validateThreeStarChallenge(bad))}
  const mixed=clone();mixed.sessions[1].playerId='61a69c5e-6ed5-47d7-b054-529544156d70';assert.throws(()=>validateThreeStarChallenge(mixed))
  const missing=clone();missing.sessions.shift();assert.throws(()=>validateThreeStarChallenge(missing))
  const extra=clone();extra.sessions.push({...extra.sessions[2],sessionId:'61a69c5e-6ed5-47d7-b054-529544156d70'});assert.throws(()=>validateThreeStarChallenge(extra))
  const repeat=clone();repeat.sessions[1].sessionId=repeat.sessions[0].sessionId;assert.throws(()=>validateThreeStarChallenge(repeat))
  const wrongKind=clone();wrongKind.datasetKind='development';assert.throws(()=>validateThreeStarChallenge(wrongKind))
})
test('challenge rejects illegal actions, a non-three-star finish, and chronological reversal',()=>{
  const bad=clone();bad.sessions[1].actions[0].amount=(bad.sessions[1].actions[0].amount??0)+1;assert.throws(()=>validateThreeStarChallenge(bad))
  const noWin=clone();noWin.sessions.pop();noWin.challengeId=noWin.sessions.at(-1)!.sessionId;noWin.achievedAt=noWin.sessions.at(-1)!.completedAt;assert.throws(()=>validateThreeStarChallenge(noWin))
  const reversed=clone();[reversed.sessions[0],reversed.sessions[1]]=[reversed.sessions[1],reversed.sessions[0]];reversed.firstSessionId=reversed.sessions[0].sessionId;assert.throws(()=>validateThreeStarChallenge(reversed))
})
test('challenge UUIDs and dates normalize; immutable conflicting payloads cannot overwrite',()=>{
  const a=validateThreeStarChallenge(clone()), raw=clone()
  raw.challengeId=raw.challengeId.toLowerCase();raw.firstSessionId=raw.firstSessionId.toLowerCase();raw.playerId=raw.playerId.toLowerCase()
  const b=validateThreeStarChallenge(Object.fromEntries(Object.entries(raw).reverse()))
  assert.equal(challengePayloadHash(a),challengePayloadHash(b))
  confirmChallengeDuplicate(a,{challengeId:a.challengeId,payloadHash:challengePayloadHash(b)})
  assert.throws(()=>confirmChallengeDuplicate(a,{challengeId:a.challengeId,payloadHash:'changed'}),GameplayConflictError)
})
test('HTTP challenge receipt acknowledges its own ID and lost responses safely retry',async()=>{
  const saved=new Map<string,ReturnType<typeof validateThreeStarChallenge>>()
  const save=async(row:ReturnType<typeof validateThreeStarChallenge>)=>{const old=saved.get(row.challengeId);if(old)confirmChallengeDuplicate(row,{challengeId:old.challengeId,payloadHash:challengePayloadHash(old)});else saved.set(row.challengeId,row)}
  for(let i=0;i<2;i++){const result=await handleThreeStarPost(request(clone(),{'Idempotency-Key':swiftChallenge.challengeId}),save);assert.equal(result.status,200);assert.deepEqual(await result.json(),{ok:true,challengeId:swiftChallenge.challengeId.toLowerCase()})}
  assert.equal(saved.size,1)
  assert.equal((await handleThreeStarPost(request(clone(),{'Idempotency-Key':'different'}),save)).status,400)
})
test('challenge storage outage defers retry, conflict preserves data, and bounded input rejects oversize',async()=>{
  const down=await handleThreeStarPost(request(clone()),async()=>{throw new Error('offline')});assert.equal(down.status,503);assert.equal(down.headers.get('Retry-After'),'60')
  assert.equal((await handleThreeStarPost(request(clone()),async()=>{throw new GameplayConflictError('immutable')})).status,409)
  const oversized=new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:new Uint8Array(MAX_GAMEPLAY_BYTES+1)})
  assert.equal((await handleThreeStarPost(oversized,async()=>{throw new Error('must not save')})).status,413)
  assert.equal((await handleThreeStarPost(new Request('https://example.test',{method:'POST',body:'{}'}),async()=>{})).status,415)
})
