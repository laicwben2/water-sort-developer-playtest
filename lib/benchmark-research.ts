import metricsData from '../data/benchmarks/difficulty-v2-benchmark-metrics-v1.json'

export type SourceDifficulty = 'easy' | 'medium' | 'hard'

export interface BenchmarkResearchMetric {
  benchmarkId: string
  sourceLevelKey: string
  sourceDifficulty: SourceDifficulty
  candidateIndex: number
  sourceEmptyTubes: number
  minimumRequiredEmptyTubes: number
  benchmarkV1Valid: boolean
  benchmarkV1Issue: string | null
  solver: {
    optimalMoves: number
    exploredStates: number
    visitedStates: number
    generatedMoves: number
    averageBranching: number
  }
  solutionPath: {
    decisionSteps: number
    forcedSteps: number
    totalAlternativeMoves: number
    averageChoices: number
    maximumChoices: number
  }
  mistakeAnalysis: {
    wrongMoveDensity: number
    deadEndDensity: number
    deadEndRisk: number
    averageRecoveryPenalty: number
    maxRecoveryPenalty: number
  }
}

export interface BenchmarkResearchSource {
  artifactId: number
  pairedArtifactId: number
  artifactFile: string
  batchSeed: string
  generatorVersion: string
  rngVersion: string
  canonicalVersion: string
  encodingVersion: string
  solverStateEncodingVersion: string
  configFingerprint: string
  profile: string
}

const parsed = metricsData as {
  source: BenchmarkResearchSource
  puzzles: BenchmarkResearchMetric[]
}

export const BENCHMARK_RESEARCH_SOURCE = parsed.source
export const BENCHMARK_RESEARCH_METRICS = parsed.puzzles

const byId = new Map(
  BENCHMARK_RESEARCH_METRICS.map((metric) => [metric.benchmarkId, metric]),
)

export function getBenchmarkResearchMetric(
  benchmarkId: string,
): BenchmarkResearchMetric | null {
  return byId.get(benchmarkId) ?? null
}

export function sourceDifficultyOrdinal(value: SourceDifficulty): number {
  if (value === 'easy') return 1
  if (value === 'medium') return 2
  return 3
}

export function isResearchMetricValidForBenchmark(
  metric: BenchmarkResearchMetric,
  benchmark: string,
): boolean {
  if (benchmark === 'difficulty-v2-benchmark-v1') {
    return metric.benchmarkV1Valid
  }
  return true
}
