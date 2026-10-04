import {createHash} from 'node:crypto'
import {object, keys, integer, text, uuid, date, registeredPuzzle, validateGameplaySession, GameplayValidationError, type GameplaySession} from './gameplay-validation'

export interface ThreeStarChallengeRecord {
  schemaVersion: 1; source: 'ios'; challengeId: string; firstSessionId: string; playerId: string
  datasetKind: 'development' | 'production'; packId: string; levelId: string; boardHash: string; rulesVersion: 'classic-v1'; capacity: number
  startedAt: string; achievedAt: string; optimalMoves: number; elapsedMs: number; totalMoves: number; restarts: number; undos: number
  attemptCount: number; completedCount: number; sessions: GameplaySession[]; clientVersion: string
}
function fail(message: string): never { throw new GameplayValidationError(message) }
export function validateThreeStarChallenge(raw: unknown): ThreeStarChallengeRecord {
  const value = object(raw)
  keys(value, ['schemaVersion','source','challengeId','firstSessionId','playerId','datasetKind','packId','levelId','boardHash','rulesVersion','capacity','startedAt','achievedAt','optimalMoves','elapsedMs','totalMoves','restarts','undos','attemptCount','completedCount','sessions','clientVersion'])
  const puzzle = registeredPuzzle(value)
  if (!puzzle?.optimalMoves || value.schemaVersion !== 1 || value.source !== 'ios' || value.rulesVersion !== 'classic-v1' || value.optimalMoves !== puzzle.optimalMoves) fail('Missing or mismatched solver optimum')
  const challengeId = uuid(value.challengeId,'challengeId'), firstSessionId = uuid(value.firstSessionId,'firstSessionId'), playerId = uuid(value.playerId,'playerId')
  const startedAt = date(value.startedAt,'startedAt'), achievedAt = date(value.achievedAt,'achievedAt')
  const clientVersion = text(value.clientVersion,'clientVersion',100)
  if (!Array.isArray(value.sessions) || !value.sessions.length || value.sessions.length > 10000) fail('Invalid challenge sessions')
  let actions = 0
  const sessions = value.sessions.map(rawSession => {
    const row = object(rawSession)
    if (!Array.isArray(row.actions) || (actions += row.actions.length) > 100000) fail('Too many challenge actions')
    return validateGameplaySession(rawSession, puzzle)
  })
  const first = sessions[0], last = sessions[sessions.length - 1]
  if (first.sessionId !== firstSessionId || last.sessionId !== challengeId || last.completedAt !== achievedAt ||
      startedAt !== sessions.reduce((a,s) => a < s.startedAt ? a : s.startedAt, first.startedAt) ||
      new Set(sessions.map(s => s.sessionId)).size !== sessions.length) fail('Invalid challenge identities or dates')
  for (let i=0;i<sessions.length;i++) {
    const row=sessions[i]
    if(row.playerId!==playerId || row.datasetKind!==value.datasetKind || row.packId!==value.packId || row.levelId!==value.levelId || row.boardHash!==value.boardHash || row.capacity!==value.capacity) fail('Mixed challenge identities')
    // The array records durable client completion order; wall clocks may move backwards.
    if(i===sessions.length-1 ? row.currentMoves>puzzle.optimalMoves : row.currentMoves<=puzzle.optimalMoves) fail('Challenge does not end at first three stars')
  }
  function sum(key: 'elapsedMs'|'totalMoves'|'restarts'|'undos') { return sessions.reduce((a,s)=>Math.min(Number.MAX_SAFE_INTEGER-a,s[key])+a,0) }
  const elapsedMs=integer(value.elapsedMs,'elapsedMs'),totalMoves=integer(value.totalMoves,'totalMoves'),restarts=integer(value.restarts,'restarts'),undos=integer(value.undos,'undos')
  const attemptCount=integer(value.attemptCount,'attemptCount'),completedCount=integer(value.completedCount,'completedCount')
  if(elapsedMs!==sum('elapsedMs') || totalMoves!==sum('totalMoves') || restarts!==sum('restarts') || undos!==sum('undos') || completedCount!==sessions.length || attemptCount!==sessions.length+restarts) fail('Challenge aggregates disagree with attempts')
  return {schemaVersion:1,source:'ios',challengeId,firstSessionId,playerId,datasetKind:first.datasetKind,packId:first.packId,levelId:first.levelId,boardHash:first.boardHash,rulesVersion:'classic-v1',capacity:first.capacity,startedAt,achievedAt,optimalMoves:puzzle.optimalMoves,elapsedMs,totalMoves,restarts,undos,attemptCount,completedCount,sessions,clientVersion}
}
export function challengePayloadHash(record: ThreeStarChallengeRecord): string { return createHash('sha256').update(JSON.stringify(record)).digest('hex') }
