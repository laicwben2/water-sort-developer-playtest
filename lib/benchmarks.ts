import currentBenchmarkData from '../public/benchmark.json'
import legacyBenchmarkData from '../data/benchmarks/difficulty-v2-benchmark-v1-blind.json'
import type { SubmissionBenchmark } from './submission-validation'

export interface BenchmarkSnapshot extends SubmissionBenchmark {
  version: string
}

export const CURRENT_BENCHMARK = currentBenchmarkData as BenchmarkSnapshot
export const LEGACY_BENCHMARK = legacyBenchmarkData as BenchmarkSnapshot

export const BENCHMARKS: readonly BenchmarkSnapshot[] = [
  CURRENT_BENCHMARK,
  LEGACY_BENCHMARK,
]

export function getBenchmarkSnapshot(name: string): BenchmarkSnapshot | null {
  return BENCHMARKS.find((benchmark) => benchmark.benchmark === name) ?? null
}
