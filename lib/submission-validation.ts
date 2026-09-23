import { applyMove, calculatePour, isSolved, type Board } from './game'
import {
  GIVE_UP_REASONS,
  type PlaytestResult,
  type PlaytestResultsDocument,
} from './results'

export interface SubmissionRequest {
  sessionId: string
  document: PlaytestResultsDocument
}

export interface SubmissionPuzzle {
  benchmarkId: string
  capacity: number
  board: Board
}

export interface SubmissionBenchmark {
  benchmark: string
  puzzles: SubmissionPuzzle[]
}

export class SubmissionValidationError extends Error {}

function fail(message: string): never {
  throw new SubmissionValidationError(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  name: string,
): void {
  const allowedSet = new Set(allowed)
  const unexpected = Object.keys(value).find((key) => !allowedSet.has(key))
  if (unexpected) fail('Unexpected ' + name + ' field: ' + unexpected)
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail(name + ' must be a non-negative safe integer')
  }
  return value
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    fail(name + ' must be a positive safe integer')
  }
  return value
}

function rating(value: unknown, name: string): number {
  const parsed = nonNegativeInteger(value, name)
  if (parsed < 1 || parsed > 5) fail(name + ' must be an integer from 1 to 5')
  return parsed
}

function boardsEqual(a: Board, b: Board): boolean {
  return a.length === b.length && a.every(
    (tube, index) =>
      tube.length === b[index]?.length &&
      tube.every((color, cell) => color === b[index][cell]),
  )
}

function validateBoard(value: unknown, capacity: number, name: string): Board {
  if (!Array.isArray(value)) fail(name + ' must be an array')
  return value.map((rawTube, tubeIndex) => {
    if (!Array.isArray(rawTube)) fail(name + ' tube ' + tubeIndex + ' must be an array')
    if (rawTube.length > capacity) fail(name + ' tube ' + tubeIndex + ' exceeds capacity')
    return rawTube.map((color, cellIndex) =>
      nonNegativeInteger(color, name + ' color at ' + tubeIndex + ':' + cellIndex),
    )
  })
}

function validateGiveUpFeedback(
  result: Record<string, unknown>,
  outcome: 'solved' | 'gave-up',
  benchmarkId: string,
): void {
  if (outcome === 'solved') {
    if (result.giveUpReasons !== undefined || result.giveUpNote !== undefined) {
      fail('Solved result must not contain give-up feedback: ' + benchmarkId)
    }
    return
  }

  if (!Array.isArray(result.giveUpReasons) || result.giveUpReasons.length === 0) {
    fail('gave-up result requires at least one giveUpReason: ' + benchmarkId)
  }

  const allowed = new Set<string>(GIVE_UP_REASONS)
  const seen = new Set<string>()
  for (const rawReason of result.giveUpReasons) {
    if (typeof rawReason !== 'string' || !allowed.has(rawReason)) {
      fail('Invalid giveUpReason for ' + benchmarkId + ': ' + String(rawReason))
    }
    if (seen.has(rawReason)) fail('Duplicate giveUpReason for ' + benchmarkId + ': ' + rawReason)
    seen.add(rawReason)
  }

  if (
    result.giveUpNote !== undefined &&
    (typeof result.giveUpNote !== 'string' || result.giveUpNote.trim() === '')
  ) {
    fail('giveUpNote must be a non-empty string: ' + benchmarkId)
  }
  if (
    seen.has('other') &&
    (typeof result.giveUpNote !== 'string' || result.giveUpNote.trim() === '')
  ) {
    fail('giveUpNote is required when reason is other: ' + benchmarkId)
  }
}

function validateAndReplayResult(raw: unknown, puzzle: SubmissionPuzzle): PlaytestResult {
  if (!isRecord(raw)) fail('Result for ' + puzzle.benchmarkId + ' must be an object')
  exactKeys(
    raw,
    [
      'benchmarkId',
      'outcome',
      'elapsedMs',
      'moves',
      'restarts',
      'actions',
      'finalBoard',
      'perceivedDifficulty',
      'confidence',
      'frustration',
      'giveUpReasons',
      'giveUpNote',
    ],
    'result ' + puzzle.benchmarkId,
  )

  if (raw.benchmarkId !== puzzle.benchmarkId) fail('benchmarkId mismatch: ' + puzzle.benchmarkId)
  if (raw.outcome !== 'solved' && raw.outcome !== 'gave-up') {
    fail('Invalid outcome: ' + puzzle.benchmarkId)
  }

  const elapsedMs = nonNegativeInteger(raw.elapsedMs, 'elapsedMs for ' + puzzle.benchmarkId)
  const moves = nonNegativeInteger(raw.moves, 'moves for ' + puzzle.benchmarkId)
  const restarts = nonNegativeInteger(raw.restarts, 'restarts for ' + puzzle.benchmarkId)
  rating(raw.perceivedDifficulty, 'perceivedDifficulty for ' + puzzle.benchmarkId)
  if (raw.confidence !== undefined) rating(raw.confidence, 'confidence for ' + puzzle.benchmarkId)
  if (raw.frustration !== undefined) rating(raw.frustration, 'frustration for ' + puzzle.benchmarkId)

  if (!Array.isArray(raw.actions)) fail('actions must be an array: ' + puzzle.benchmarkId)

  let replay = puzzle.board.map((tube) => [...tube])
  let replayMoves = 0
  let replayRestarts = 0
  let previousAtMs = -1

  for (const [index, rawAction] of raw.actions.entries()) {
    if (!isRecord(rawAction)) fail('Action ' + index + ' must be an object')
    const atMs = nonNegativeInteger(rawAction.atMs, 'atMs for action ' + index)
    if (atMs > elapsedMs) fail('Action timestamp exceeds elapsed time at index ' + index)
    if (atMs < previousAtMs) fail('Action timestamps must be non-decreasing: ' + puzzle.benchmarkId)
    previousAtMs = atMs

    if (rawAction.type === 'restart') {
      exactKeys(rawAction, ['type', 'atMs'], 'action ' + index)
      replay = puzzle.board.map((tube) => [...tube])
      replayRestarts += 1
      continue
    }

    if (rawAction.type !== 'move') fail('Invalid action type at index ' + index)
    exactKeys(rawAction, ['type', 'atMs', 'from', 'to', 'color', 'amount'], 'action ' + index)

    const from = nonNegativeInteger(rawAction.from, 'from for action ' + index)
    const to = nonNegativeInteger(rawAction.to, 'to for action ' + index)
    const color = nonNegativeInteger(rawAction.color, 'color for action ' + index)
    const amount = positiveInteger(rawAction.amount, 'amount for action ' + index)
    const expected = calculatePour(replay, from, to, puzzle.capacity)

    if (!expected || expected.color !== color || expected.amount !== amount) {
      fail('Illegal or mismatched move at action ' + index + ': ' + puzzle.benchmarkId)
    }

    replay = applyMove(replay, expected)
    replayMoves += 1
  }

  if (replayMoves !== moves) fail('Move count disagrees with actions: ' + puzzle.benchmarkId)
  if (replayRestarts !== restarts) fail('Restart count disagrees with actions: ' + puzzle.benchmarkId)

  const finalBoard = validateBoard(raw.finalBoard, puzzle.capacity, 'finalBoard for ' + puzzle.benchmarkId)
  if (!boardsEqual(replay, finalBoard)) fail('finalBoard disagrees with action replay: ' + puzzle.benchmarkId)

  const solved = isSolved(replay, puzzle.capacity)
  if (raw.outcome === 'solved' && !solved) fail('Solved outcome is not solved: ' + puzzle.benchmarkId)
  if (raw.outcome === 'gave-up' && solved) fail('gave-up outcome is already solved: ' + puzzle.benchmarkId)

  validateGiveUpFeedback(raw, raw.outcome, puzzle.benchmarkId)
  return raw as unknown as PlaytestResult
}

export function validateSubmissionRequest(
  raw: unknown,
  benchmark: SubmissionBenchmark,
): SubmissionRequest {
  if (!isRecord(raw)) fail('Submission must be an object')
  exactKeys(raw, ['sessionId', 'document'], 'submission')

  if (
    typeof raw.sessionId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw.sessionId)
  ) {
    fail('sessionId must be a UUID')
  }

  if (!isRecord(raw.document)) fail('document must be an object')
  exactKeys(raw.document, ['version', 'benchmark', 'exportedAt', 'results'], 'document')

  if (raw.document.version !== 'difficulty-v2-playtest-results-v2') {
    fail('Unsupported results version: ' + String(raw.document.version))
  }
  if (raw.document.benchmark !== benchmark.benchmark) {
    fail('Unexpected benchmark: ' + String(raw.document.benchmark))
  }
  if (
    typeof raw.document.exportedAt !== 'string' ||
    Number.isNaN(Date.parse(raw.document.exportedAt))
  ) {
    fail('exportedAt must be a valid date-time string')
  }
  if (!Array.isArray(raw.document.results)) fail('results must be an array')

  const byId = new Map(benchmark.puzzles.map((puzzle) => [puzzle.benchmarkId, puzzle]))
  const seen = new Set<string>()
  const validatedResults = raw.document.results.map((result) => {
    if (!isRecord(result) || typeof result.benchmarkId !== 'string') {
      fail('Every result must contain a benchmarkId')
    }
    if (seen.has(result.benchmarkId)) fail('Duplicate benchmarkId: ' + result.benchmarkId)
    seen.add(result.benchmarkId)

    const puzzle = byId.get(result.benchmarkId)
    if (!puzzle) fail('Unknown benchmarkId: ' + result.benchmarkId)
    return validateAndReplayResult(result, puzzle)
  })

  return {
    sessionId: raw.sessionId,
    document: {
      version: 'difficulty-v2-playtest-results-v2',
      benchmark: benchmark.benchmark,
      exportedAt: raw.document.exportedAt,
      results: validatedResults,
    },
  }
}
