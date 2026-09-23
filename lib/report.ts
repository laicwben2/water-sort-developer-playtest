import type { PlaytestReportRow } from './db'
import { GIVE_UP_REASONS, type GiveUpReason } from './results'

export const LEGACY_CLIENT_VERSION = '__legacy__'

export const GIVE_UP_REASON_LABELS: Record<GiveUpReason, string> = {
  'no-next-move': '不知道下一步怎麼走',
  'likely-dead-end': '感覺已經走進死路',
  'repeated-restarts': '重開多次仍無法完成',
  'too-many-choices': '選擇太多，不知道哪個較好',
  'taking-too-long': '題目太耗時間',
  'no-longer-fun': '覺得這題不想繼續玩',
  other: '其他',
}

export interface GiveUpReasonCount {
  reason: string
  label: string
  count: number
}

export interface AttemptSummary {
  sampleCount: number
  sessionCount: number
  solvedCount: number
  gaveUpCount: number
  solveRate: number | null
  medianElapsedMs: number | null
  medianSolvedElapsedMs: number | null
  medianMoves: number | null
  averageRestarts: number | null
  averageDifficulty: number | null
  averageConfidence: number | null
  averageFrustration: number | null
  topGiveUpReason: GiveUpReasonCount | null
}

export interface PuzzleReport extends AttemptSummary {
  benchmarkId: string
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]
  return (sorted[middle - 1] + sorted[middle]) / 2
}

function presentNumbers(values: readonly (number | null)[]): number[] {
  return values.filter((value): value is number => value !== null)
}

export function aggregateGiveUpReasons(
  rows: readonly PlaytestReportRow[],
): GiveUpReasonCount[] {
  const counts = new Map<string, number>()

  for (const row of rows) {
    if (row.outcome !== 'gave-up') continue
    for (const reason of row.giveUpReasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1)
    }
  }

  const knownReasonOrder = new Map<string, number>(
    GIVE_UP_REASONS.map((reason, index) => [reason, index]),
  )

  return Array.from(counts.entries())
    .map(([reason, count]) => ({
      reason,
      label:
        GIVE_UP_REASON_LABELS[reason as GiveUpReason] ??
        reason,
      count,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return (knownReasonOrder.get(a.reason) ?? 999) -
        (knownReasonOrder.get(b.reason) ?? 999)
    })
}

export function summarizeRows(
  rows: readonly PlaytestReportRow[],
): AttemptSummary {
  const solvedRows = rows.filter((row) => row.outcome === 'solved')
  const gaveUpRows = rows.filter((row) => row.outcome === 'gave-up')
  const reasonCounts = aggregateGiveUpReasons(rows)

  return {
    sampleCount: rows.length,
    sessionCount: new Set(rows.map((row) => row.sessionId)).size,
    solvedCount: solvedRows.length,
    gaveUpCount: gaveUpRows.length,
    solveRate: rows.length === 0 ? null : solvedRows.length / rows.length,
    medianElapsedMs: median(rows.map((row) => row.elapsedMs)),
    medianSolvedElapsedMs: median(solvedRows.map((row) => row.elapsedMs)),
    medianMoves: median(rows.map((row) => row.moves)),
    averageRestarts: average(rows.map((row) => row.restarts)),
    averageDifficulty: average(rows.map((row) => row.perceivedDifficulty)),
    averageConfidence: average(presentNumbers(rows.map((row) => row.confidence))),
    averageFrustration: average(presentNumbers(rows.map((row) => row.frustration))),
    topGiveUpReason: reasonCounts[0] ?? null,
  }
}

export function buildPuzzleReports(
  rows: readonly PlaytestReportRow[],
  benchmarkIds: readonly string[],
): PuzzleReport[] {
  return benchmarkIds.map((benchmarkId) => ({
    benchmarkId,
    ...summarizeRows(rows.filter((row) => row.benchmarkId === benchmarkId)),
  }))
}

export function filterRowsByClientVersion(
  rows: readonly PlaytestReportRow[],
  selectedVersion: string,
): PlaytestReportRow[] {
  if (selectedVersion === 'all') return [...rows]
  if (selectedVersion === LEGACY_CLIENT_VERSION) {
    return rows.filter((row) => row.clientVersion === null)
  }
  return rows.filter((row) => row.clientVersion === selectedVersion)
}
