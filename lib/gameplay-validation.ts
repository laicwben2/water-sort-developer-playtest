import { createHash } from 'node:crypto'
import samplePack from '../data/ios/development-levels.json'
import pilotPack from '../data/ios/pilot-levels.json'
import releasePack from '../data/ios/release-levels.json'
import { applyMove, calculatePour, isSolved, type Board, type Move } from './game'

export type GameplayAction = ({ type: 'move'; atMs: number } & Move) | { type: 'undo' | 'restart'; atMs: number }
export interface GameplaySession {
  schemaVersion: 1; source: 'ios'; sessionId: string; playerId: string
  datasetKind: 'development' | 'production'; packId: string; levelId: string; boardHash: string
  rulesVersion: 'classic-v1'; capacity: number; startedAt: string; completedAt: string
  elapsedMs: number; currentMoves: number; totalMoves: number; restarts: number; undos: number
  actions: GameplayAction[]; finalBoard: Board; clientVersion: string
}
export interface GameplayPuzzle { datasetKind: 'development' | 'production'; packId: string; levelId: string; capacity: number; board: Board }
export class GameplayValidationError extends Error {}
function fail(message: string): never { throw new GameplayValidationError(message) }
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('Expected an object')
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, expected: string[]) {
  if (Object.keys(value).some(k => !expected.includes(k)) || expected.some(k => !(k in value))) fail('Unexpected or missing field')
}
function integer(value: unknown, name: string, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) fail('Invalid ' + name)
  return value as number
}
function text(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) fail('Invalid ' + name)
  return value as string
}
function uuid(value: unknown, name: string) {
  const parsed = text(value, name, 36)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed)) fail('Invalid ' + name)
  return parsed.toLowerCase()
}
function date(value: unknown, name: string): string {
  const parsed = text(value, name, 40)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(parsed) || !Number.isFinite(Date.parse(parsed))) fail('Invalid ' + name)
  return new Date(parsed).toISOString()
}
export function boardHash(capacity: number, board: Board): string {
  return createHash('sha256').update(JSON.stringify([capacity, board])).digest('hex')
}
// Data kind and immutable pack ID keep formal records separate from pilot tests.
export function registeredPuzzle(raw: unknown): GameplayPuzzle | undefined {
  const value = object(raw)
  const entry = [
    {kind: 'development' as const, pack: samplePack},
    {kind: 'development' as const, pack: pilotPack},
    {kind: 'production' as const, pack: releasePack},
  ].find(entry => entry.kind === value.datasetKind && entry.pack.packId === value.packId)
  const level = entry?.pack.levels.find(level => level.id === value.levelId)
  return entry && level && {datasetKind: entry.kind, packId: entry.pack.packId, levelId: level.id, capacity: level.capacity, board: level.board}
}
export function validateGameplaySession(raw: unknown, puzzle = registeredPuzzle(raw)): GameplaySession {
  const value = object(raw)
  keys(value, ['schemaVersion','source','sessionId','playerId','datasetKind','packId','levelId','boardHash','rulesVersion','capacity','startedAt','completedAt','elapsedMs','currentMoves','totalMoves','restarts','undos','actions','finalBoard','clientVersion'])
  if (!puzzle || value.schemaVersion !== 1 || value.source !== 'ios' || value.rulesVersion !== 'classic-v1' || value.datasetKind !== puzzle.datasetKind || value.packId !== puzzle.packId || value.levelId !== puzzle.levelId || value.capacity !== puzzle.capacity || value.boardHash !== boardHash(puzzle.capacity, puzzle.board)) fail('Unregistered or mismatched puzzle')
  const sessionId = uuid(value.sessionId, 'sessionId'), playerId = uuid(value.playerId, 'playerId')
  const startedAt = date(value.startedAt, 'startedAt'), completedAt = date(value.completedAt, 'completedAt')
  if (Date.parse(completedAt) < Date.parse(startedAt)) fail('Completion precedes start')
  const elapsedMs = integer(value.elapsedMs, 'elapsedMs')
  const currentMoves = integer(value.currentMoves, 'currentMoves', 100000), totalMoves = integer(value.totalMoves, 'totalMoves', 100000)
  const restarts = integer(value.restarts, 'restarts', 100000), undos = integer(value.undos, 'undos', 100000)
  const clientVersion = text(value.clientVersion, 'clientVersion', 100)
  if (!Array.isArray(value.actions) || value.actions.length === 0 || value.actions.length > 100000) fail('Invalid actions')
  let board = puzzle.board.map(tube => [...tube]), moves = 0, resets = 0, undoCount = 0, previousMs = 0
  const stack: Board[] = [], actions: GameplayAction[] = []
  for (const rawAction of value.actions as unknown[]) {
    const action = object(rawAction)
    const atMs = integer(action.atMs, 'atMs')
    if (atMs < previousMs || atMs > elapsedMs || isSolved(board, puzzle.capacity)) fail('Invalid action time or action after completion')
    previousMs = atMs
    if (action.type === 'move') {
      keys(action, ['type','atMs','from','to','color','amount'])
      const from = integer(action.from, 'from', 31), to = integer(action.to, 'to', 31)
      const expected = calculatePour(board, from, to, puzzle.capacity)
      if (!expected || expected.color !== action.color || expected.amount !== action.amount) fail('Illegal or mismatched pour')
      stack.push(board); board = applyMove(board, expected); moves++
      actions.push({ type: 'move', atMs, ...expected })
    } else if (action.type === 'undo') {
      keys(action, ['type','atMs'])
      const previous = stack.pop()
      if (!previous) fail('Undo without a prior move')
      board = previous as Board; undoCount++; actions.push({ type: 'undo', atMs })
    } else if (action.type === 'restart') {
      keys(action, ['type','atMs'])
      board = puzzle.board.map(tube => [...tube]); stack.length = 0; resets++; actions.push({ type: 'restart', atMs })
    } else fail('Unsupported action')
  }
  if (moves !== totalMoves || stack.length !== currentMoves || resets !== restarts || undoCount !== undos || !isSolved(board, puzzle.capacity) || JSON.stringify(value.finalBoard) !== JSON.stringify(board)) fail('Statistics or final board disagree with replay')
  return { schemaVersion: 1, source: 'ios', sessionId, playerId, datasetKind: puzzle.datasetKind, packId: puzzle.packId, levelId: puzzle.levelId, boardHash: boardHash(puzzle.capacity,puzzle.board), rulesVersion: 'classic-v1', capacity: puzzle.capacity, startedAt, completedAt, elapsedMs, currentMoves, totalMoves, restarts, undos, actions, finalBoard: board, clientVersion }
}
export function payloadHash(record: GameplaySession): string {
  // Validation constructs a stable field order and normalizes UUIDs and date strings.
  return createHash('sha256').update(JSON.stringify(record)).digest('hex')
}
