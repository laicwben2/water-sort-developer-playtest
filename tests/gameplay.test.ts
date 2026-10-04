import { test } from 'node:test'
import assert from 'node:assert/strict'
import swiftSession from './swift-session.json'
import samplePack from '../data/ios/development-levels.json'
import { validateGameplaySession, payloadHash, GameplayValidationError } from '../lib/gameplay-validation'
import { confirmDuplicate, GameplayConflictError } from '../lib/gameplay-db'
import { handleGameplayPost, MAX_GAMEPLAY_BYTES } from '../lib/gameplay-http'
import { validateSubmissionRequest } from '../lib/submission-validation'
import { applyMove, calculatePour, type Board } from '../lib/game'
const clone = () => structuredClone(swiftSession)
const request = (body: unknown, headers = {}) => new Request('https://example.test/api/gameplay-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
test('real Swift record replays move, undo, restart and 21-move development solution', () => {
  const row = validateGameplaySession(clone())
  assert.equal(row.currentMoves, 21); assert.equal(row.totalMoves, 23)
  assert.equal(row.undos, 1); assert.equal(row.restarts, 1)
  assert.equal(samplePack.levels.length, 12)
  assert.equal(samplePack.levels[2].board.filter(tube => !tube.length).length, 2)
})
test('UUID case, date precision and property order normalize for retry identity', () => {
  const a = validateGameplaySession(clone()), raw = clone()
  raw.sessionId = raw.sessionId.toLowerCase(); raw.playerId = raw.playerId.toLowerCase()
  raw.startedAt = new Date(raw.startedAt).toISOString()
  const b = validateGameplaySession(Object.fromEntries(Object.entries(raw).reverse()))
  assert.equal(payloadHash(a), payloadHash(b))
  confirmDuplicate(a, { sessionId: a.sessionId, payloadHash: payloadHash(b) })
  assert.throws(() => confirmDuplicate(a, { sessionId: 'a'.repeat(36), payloadHash: payloadHash(a) }), GameplayConflictError)
  assert.throws(() => confirmDuplicate(a, { sessionId: a.sessionId, payloadHash: 'changed' }), GameplayConflictError)
})
test('rejects tampered statistics, hash, illegal undo, moves after completion and ratings', () => {
  const bad = clone(); bad.totalMoves++; assert.throws(() => validateGameplaySession(bad), GameplayValidationError)
  const hash = clone(); hash.boardHash = '0'.repeat(64); assert.throws(() => validateGameplaySession(hash))
  const undo = clone(); undo.actions.unshift({ type: 'undo', atMs: 0 } as typeof undo.actions[number]); assert.throws(() => validateGameplaySession(undo))
  const after = clone(); after.actions.push({ type: 'restart', atMs: after.elapsedMs } as typeof after.actions[number]); assert.throws(() => validateGameplaySession(after))
  assert.throws(() => validateGameplaySession({ ...clone(), perceivedDifficulty: 3 }))
})
test('production and unknown packs never alias the development samples', () => {
  assert.throws(() => validateGameplaySession({ ...clone(), datasetKind: 'production' }))
  assert.throws(() => validateGameplaySession({ ...clone(), packId: 'future-pack' }))
  assert.throws(() => validateGameplaySession({ ...clone(), levelId: 'unknown' }))
})
test('old rating-based validation retains its original contract', () => {
  const puzzle = { benchmarkId: 'tiny', capacity: 2, board: [[0,1],[1,0],[]] }
  let board: Board = puzzle.board; const actions = []
  for (const [from,to] of [[0,2],[1,0],[2,1]]) { const move = calculatePour(board,from,to,2)!; board=applyMove(board,move); actions.push({ type:'move',atMs:0,...move }) }
  const raw = { sessionId: 'b3483fbc-2321-42fc-823b-5dd95b00f26f', clientVersion:'local-dev',document:{version:'difficulty-v2-playtest-results-v2',benchmark:'tiny-benchmark',exportedAt:'2026-10-04T00:00:00Z',results:[{benchmarkId:'tiny',outcome:'solved',elapsedMs:0,moves:3,restarts:0,actions,finalBoard:board,perceivedDifficulty:3}]}}
  const benchmark={benchmark:'tiny-benchmark',puzzles:[puzzle]}
  assert.equal(validateSubmissionRequest(raw,benchmark).document.results.length,1)
  assert.throws(() => validateSubmissionRequest(clone(),benchmark))
  assert.throws(() => validateGameplaySession(raw))
})
test('HTTP ack matches session and lost responses can be safely retried', async () => {
  const rows = new Map<string,ReturnType<typeof validateGameplaySession>>()
  const save = async (row: ReturnType<typeof validateGameplaySession>) => { const old=rows.get(row.sessionId); if(old)confirmDuplicate(row,{sessionId:old.sessionId,payloadHash:payloadHash(old)});else rows.set(row.sessionId,row) }
  for (let i=0;i<2;i++) {
    const response=await handleGameplayPost(request(clone(),{'Idempotency-Key':swiftSession.sessionId}),save)
    assert.equal(response.status,200); assert.deepEqual(await response.json(),{ok:true,sessionId:swiftSession.sessionId.toLowerCase()})
  }
  assert.equal(rows.size,1)
  const bad=await handleGameplayPost(request(clone(),{'Idempotency-Key':'different'}),save); assert.equal(bad.status,400)
})
test('HTTP storage outage requests a deferred retry and conflicts do not overwrite', async () => {
  const down=await handleGameplayPost(request(clone()),async()=>{throw new Error('offline')})
  assert.equal(down.status,503); assert.equal(down.headers.get('Retry-After'),'60')
  const conflict=await handleGameplayPost(request(clone()),async()=>{throw new GameplayConflictError('immutable')})
  assert.equal(conflict.status,409)
})
test('streaming request size enforced even with absent content-length', async () => {
  let called=false
  const oversized=new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:new Uint8Array(MAX_GAMEPLAY_BYTES+1)})
  const result=await handleGameplayPost(oversized,async()=>{called=true})
  assert.equal(result.status,413); assert.equal(called,false)
  const malformed=new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})
  assert.equal((await handleGameplayPost(malformed,async()=>{})).status,400)
})
