import type { Board, Move } from './game'

export const GIVE_UP_REASONS = [
  'no-next-move',
  'likely-dead-end',
  'repeated-restarts',
  'too-many-choices',
  'taking-too-long',
  'no-longer-fun',
  'other',
] as const

export type GiveUpReason = (typeof GIVE_UP_REASONS)[number]

export type PlaytestAction =
  | ({ type: 'move'; atMs: number } & Move)
  | { type: 'restart'; atMs: number }

export interface PlaytestResult {
  benchmarkId: string
  outcome: 'solved' | 'gave-up'
  elapsedMs: number
  moves: number
  restarts: number
  actions: PlaytestAction[]
  finalBoard: Board
  perceivedDifficulty: number
  confidence?: number
  frustration?: number
  giveUpReasons?: GiveUpReason[]
  giveUpNote?: string
}

export interface PlaytestResultsDocument {
  version: 'difficulty-v2-playtest-results-v2'
  benchmark: string
  exportedAt: string
  results: PlaytestResult[]
}
