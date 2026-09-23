import type { PlaytestReportRow } from './db'
import {
  BENCHMARK_RESEARCH_METRICS,
  isResearchMetricValidForBenchmark,
  sourceDifficultyOrdinal,
  type BenchmarkResearchMetric,
} from './benchmark-research'
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
  medianSolvedMoves: number | null
  averageRestarts: number | null
  averageDifficulty: number | null
  averageConfidence: number | null
  averageFrustration: number | null
  topGiveUpReason: GiveUpReasonCount | null
}

export interface PuzzleReport extends AttemptSummary {
  benchmarkId: string
}

export interface CorrelationRow {
  humanMetric: string
  solverMetric: string
  rho: number | null
  sampleSize: number
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
      label: GIVE_UP_REASON_LABELS[reason as GiveUpReason] ?? reason,
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
    medianSolvedMoves: median(solvedRows.map((row) => row.moves)),
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

function ranks(values: readonly number[]): number[] {
  const indexed = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value)
  const result = new Array<number>(values.length)

  let start = 0
  while (start < indexed.length) {
    let end = start
    while (end + 1 < indexed.length && indexed[end + 1].value === indexed[start].value) {
      end += 1
    }
    const averageRank = (start + end + 2) / 2
    for (let index = start; index <= end; index += 1) {
      result[indexed[index].index] = averageRank
    }
    start = end + 1
  }

  return result
}

function pearson(first: readonly number[], second: readonly number[]): number | null {
  if (first.length !== second.length || first.length < 3) return null
  const firstMean = average(first)
  const secondMean = average(second)
  if (firstMean === null || secondMean === null) return null

  let covariance = 0
  let firstVariance = 0
  let secondVariance = 0
  for (let index = 0; index < first.length; index += 1) {
    const firstDelta = first[index] - firstMean
    const secondDelta = second[index] - secondMean
    covariance += firstDelta * secondDelta
    firstVariance += firstDelta * firstDelta
    secondVariance += secondDelta * secondDelta
  }

  const denominator = Math.sqrt(firstVariance * secondVariance)
  return denominator === 0 ? null : covariance / denominator
}

function spearman(points: readonly [number, number][]): number | null {
  if (points.length < 3) return null
  return pearson(
    ranks(points.map(([human]) => human)),
    ranks(points.map(([, solver]) => solver)),
  )
}

function metricPairs(
  puzzleReports: readonly PuzzleReport[],
  benchmark: string,
  humanValue: (report: PuzzleReport) => number | null,
  solverValue: (metric: BenchmarkResearchMetric) => number,
): Array<[number, number]> {
  const byId = new Map(puzzleReports.map((report) => [report.benchmarkId, report]))
  const points: Array<[number, number]> = []

  for (const metric of BENCHMARK_RESEARCH_METRICS) {
    if (!isResearchMetricValidForBenchmark(metric, benchmark)) continue
    const report = byId.get(metric.benchmarkId)
    if (!report || report.sampleCount === 0) continue
    const human = humanValue(report)
    if (human === null) continue
    points.push([human, solverValue(metric)])
  }

  return points
}

export function buildHumanSolverCorrelations(
  puzzleReports: readonly PuzzleReport[],
  benchmark: string,
): CorrelationRow[] {
  const definitions = [
    {
      humanMetric: '平均主觀難度',
      solverMetric: '來源 Easy/Medium/Hard',
      human: (report: PuzzleReport) => report.averageDifficulty,
      solver: (metric: BenchmarkResearchMetric) => sourceDifficultyOrdinal(metric.sourceDifficulty),
    },
    {
      humanMetric: '平均主觀難度',
      solverMetric: 'Optimal moves',
      human: (report: PuzzleReport) => report.averageDifficulty,
      solver: (metric: BenchmarkResearchMetric) => metric.solver.optimalMoves,
    },
    {
      humanMetric: '平均主觀難度',
      solverMetric: 'Wrong-move density',
      human: (report: PuzzleReport) => report.averageDifficulty,
      solver: (metric: BenchmarkResearchMetric) => metric.mistakeAnalysis.wrongMoveDensity,
    },
    {
      humanMetric: '平均主觀難度',
      solverMetric: 'Dead-end density',
      human: (report: PuzzleReport) => report.averageDifficulty,
      solver: (metric: BenchmarkResearchMetric) => metric.mistakeAnalysis.deadEndDensity,
    },
    {
      humanMetric: '平均主觀難度',
      solverMetric: 'Dead-end risk',
      human: (report: PuzzleReport) => report.averageDifficulty,
      solver: (metric: BenchmarkResearchMetric) => metric.mistakeAnalysis.deadEndRisk,
    },
    {
      humanMetric: '平均主觀難度',
      solverMetric: 'Solver average branching',
      human: (report: PuzzleReport) => report.averageDifficulty,
      solver: (metric: BenchmarkResearchMetric) => metric.solver.averageBranching,
    },
    {
      humanMetric: '完成者中位用時',
      solverMetric: 'Optimal moves',
      human: (report: PuzzleReport) => report.medianSolvedElapsedMs,
      solver: (metric: BenchmarkResearchMetric) => metric.solver.optimalMoves,
    },
    {
      humanMetric: '完成者中位步數',
      solverMetric: 'Optimal moves',
      human: (report: PuzzleReport) => report.medianSolvedMoves,
      solver: (metric: BenchmarkResearchMetric) => metric.solver.optimalMoves,
    },
    {
      humanMetric: '平均重開',
      solverMetric: 'Dead-end density',
      human: (report: PuzzleReport) => report.averageRestarts,
      solver: (metric: BenchmarkResearchMetric) => metric.mistakeAnalysis.deadEndDensity,
    },
  ]

  return definitions.map((definition) => {
    const points = metricPairs(
      puzzleReports,
      benchmark,
      definition.human,
      definition.solver,
    )
    return {
      humanMetric: definition.humanMetric,
      solverMetric: definition.solverMetric,
      rho: spearman(points),
      sampleSize: points.length,
    }
  })
}
