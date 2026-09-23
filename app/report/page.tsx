import type { Metadata } from 'next'
import {
  BENCHMARKS,
  CURRENT_BENCHMARK,
  LEGACY_BENCHMARK,
  getBenchmarkSnapshot,
} from '../../lib/benchmarks'
import {
  BENCHMARK_RESEARCH_SOURCE,
  getBenchmarkResearchMetric,
  isResearchMetricValidForBenchmark,
} from '../../lib/benchmark-research'
import { readPlaytestReportRows, type PlaytestReportRow } from '../../lib/db'
import {
  LEGACY_CLIENT_VERSION,
  aggregateGiveUpReasons,
  buildHumanSolverCorrelations,
  buildPuzzleReports,
  filterRowsByClientVersion,
  summarizeRows,
} from '../../lib/report'
import styles from './report.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Playtest Research Report',
  robots: {
    index: false,
    follow: false,
  },
}

interface ReportPageProps {
  searchParams: Promise<{
    benchmark?: string | string[]
    clientVersion?: string | string[]
  }>
}

function formatPercent(value: number | null): string {
  return value === null ? '—' : Math.round(value * 100) + '%'
}

function formatDecimal(value: number | null, digits = 1): string {
  return value === null ? '—' : value.toFixed(digits)
}

function formatMoves(value: number | null): string {
  if (value === null) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return '—'
  const totalSeconds = milliseconds / 1000
  if (totalSeconds < 60) return totalSeconds.toFixed(1) + ' 秒'
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = (totalSeconds - minutes * 60).toFixed(1).padStart(4, '0')
  return minutes + ':' + seconds
}

function formatVersion(version: string): string {
  return version.length === 40 ? version.slice(0, 8) : version
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-TW', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Taipei',
  }).format(date)
}

function latestUpdatedAt(rows: readonly PlaytestReportRow[]): string | null {
  let latest: string | null = null
  let latestTime = Number.NEGATIVE_INFINITY
  for (const row of rows) {
    const time = Date.parse(row.updatedAt)
    if (Number.isFinite(time) && time > latestTime) {
      latest = row.updatedAt
      latestTime = time
    }
  }
  return latest
}

function clientVersionOptions(rows: readonly PlaytestReportRow[]): string[] {
  const latestByVersion = new Map<string, number>()
  for (const row of rows) {
    if (!row.clientVersion) continue
    const time = Date.parse(row.updatedAt)
    latestByVersion.set(
      row.clientVersion,
      Math.max(latestByVersion.get(row.clientVersion) ?? Number.NEGATIVE_INFINITY, time),
    )
  }
  return Array.from(latestByVersion.keys()).sort(
    (a, b) => (latestByVersion.get(b) ?? 0) - (latestByVersion.get(a) ?? 0),
  )
}

function benchmarkLabel(name: string): string {
  if (name === CURRENT_BENCHMARK.benchmark) return 'v2 — 目前收樣（B03 已修正）'
  if (name === LEGACY_BENCHMARK.benchmark) return 'v1 — 第一輪 exploratory'
  return name
}

export default async function ReportPage({ searchParams }: ReportPageProps) {
  const params = await searchParams
  const requestedBenchmark = Array.isArray(params.benchmark)
    ? params.benchmark[0]
    : params.benchmark
  const selectedBenchmark =
    (requestedBenchmark && getBenchmarkSnapshot(requestedBenchmark)) ??
    LEGACY_BENCHMARK

  let rows: PlaytestReportRow[] = []
  let loadError: string | null = null
  try {
    rows = await readPlaytestReportRows(selectedBenchmark.benchmark)
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Unknown report error'
  }

  const knownVersions = clientVersionOptions(rows)
  const hasLegacyRows = rows.some((row) => row.clientVersion === null)
  const requestedVersion = Array.isArray(params.clientVersion)
    ? params.clientVersion[0]
    : params.clientVersion
  const validVersions = new Set(['all', LEGACY_CLIENT_VERSION, ...knownVersions])
  const selectedVersion =
    requestedVersion && validVersions.has(requestedVersion)
      ? requestedVersion
      : 'all'

  const filteredRows = filterRowsByClientVersion(rows, selectedVersion)
  const summary = summarizeRows(filteredRows)
  const puzzleReports = buildPuzzleReports(
    filteredRows,
    selectedBenchmark.puzzles.map((puzzle) => puzzle.benchmarkId),
  )
  const giveUpReasons = aggregateGiveUpReasons(filteredRows)
  const correlations = buildHumanSolverCorrelations(
    puzzleReports,
    selectedBenchmark.benchmark,
  )
  const validCorrelationPuzzles = puzzleReports.filter((puzzle) => {
    const metric = getBenchmarkResearchMetric(puzzle.benchmarkId)
    return Boolean(
      metric &&
      isResearchMetricValidForBenchmark(metric, selectedBenchmark.benchmark) &&
      puzzle.sampleCount > 0,
    )
  }).length

  return (
    <main className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <a className={styles.backLink} href="/">← 返回盲測</a>
          <h1>Playtest Research Report</h1>
          <p className={styles.subtitle}>
            Neon 匿名聚合 + server-only solver research metrics。盲測頁面本身不會收到 solver 指標。
          </p>
        </div>
        <div className={styles.benchmarkBadge}>{selectedBenchmark.benchmark}</div>
      </div>

      {selectedBenchmark.benchmark === LEGACY_BENCHMARK.benchmark && (
        <section className={styles.warningCard}>
          <strong>v1 資料品質警示：B03 不可用於 correlation</strong>
          <p>
            B03 在 blind manifest 複製時少了一支必要空管。來源 puzzle 明確要求 2 支空管，
            且 1 支空管已被 solver 證明 unsolvable。原始 B03 人類結果保留，但所有 correlation 自動排除它。
          </p>
        </section>
      )}

      {selectedBenchmark.benchmark === CURRENT_BENCHMARK.benchmark && (
        <section className={styles.noteCard}>
          <strong>目前正式收樣 benchmark v2</strong>
          <p>
            v2 保留 B01–B12 身分，但 B03 已恢復來源盤面的第二支空管，因此使用新的 benchmark identity，
            不會與 v1 舊資料混在同一資料列。
          </p>
        </section>
      )}

      {loadError ? (
        <section className={styles.errorCard}>
          <strong>目前無法載入報表</strong>
          <p>{loadError}</p>
        </section>
      ) : (
        <>
          <section className={styles.filterCard}>
            <form className={styles.filterForm} method="get">
              <label>
                Benchmark
                <select name="benchmark" defaultValue={selectedBenchmark.benchmark}>
                  {BENCHMARKS.map((benchmark) => (
                    <option key={benchmark.benchmark} value={benchmark.benchmark}>
                      {benchmarkLabel(benchmark.benchmark)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Client version
                <select name="clientVersion" defaultValue={selectedVersion}>
                  <option value="all">全部版本</option>
                  {knownVersions.map((version) => (
                    <option key={version} value={version}>
                      {formatVersion(version)}
                    </option>
                  ))}
                  {hasLegacyRows && (
                    <option value={LEGACY_CLIENT_VERSION}>舊資料（未記錄版本）</option>
                  )}
                </select>
              </label>
              <button type="submit">套用</button>
            </form>
            <p className={styles.filterNote}>
              v1 與 v2 使用不同 benchmark identity；切換 benchmark 不會把兩輪資料混合。
            </p>
          </section>

          <section className={styles.summaryGrid}>
            <article className={styles.metricCard}><span>題目結果樣本</span><strong>{summary.sampleCount}</strong></article>
            <article className={styles.metricCard}><span>匿名 sessions</span><strong>{summary.sessionCount}</strong></article>
            <article className={styles.metricCard}><span>完成率</span><strong>{formatPercent(summary.solveRate)}</strong></article>
            <article className={styles.metricCard}><span>平均主觀難度</span><strong>{formatDecimal(summary.averageDifficulty)}</strong></article>
            <article className={styles.metricCard}>
              <span>最後更新（台北）</span>
              <strong className={styles.smallMetric}>{formatUpdatedAt(latestUpdatedAt(filteredRows))}</strong>
            </article>
          </section>

          <section className={styles.section}>
            <h2>Human vs solver — Spearman ρ</h2>
            <p className={styles.sectionNote}>
              以題目為單位聚合；目前可用題目 {validCorrelationPuzzles} 題。v1 的 B03 自動排除。
              這是 exploratory correlation，不是 calibration 結論。
            </p>
            <div className={styles.tableWrap}>
              <table className={styles.compactTable}>
                <thead>
                  <tr><th>Human metric</th><th>Solver metric</th><th>ρ</th><th>n</th></tr>
                </thead>
                <tbody>
                  {correlations.map((correlation) => (
                    <tr key={correlation.humanMetric + correlation.solverMetric}>
                      <td>{correlation.humanMetric}</td>
                      <td>{correlation.solverMetric}</td>
                      <td>{correlation.rho === null ? '—' : correlation.rho.toFixed(3)}</td>
                      <td>{correlation.sampleSize}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.sourceNote}>
              Solver source: GitHub Actions artifact {BENCHMARK_RESEARCH_SOURCE.artifactId},
              generator {BENCHMARK_RESEARCH_SOURCE.generatorVersion},
              seed {BENCHMARK_RESEARCH_SOURCE.batchSeed},
              config {BENCHMARK_RESEARCH_SOURCE.configFingerprint}.
            </p>
          </section>

          <section className={styles.section}>
            <h2>題目對照：human + solver</h2>
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>題目</th>
                    <th>研究有效</th>
                    <th>來源難度</th>
                    <th>Optimal</th>
                    <th>Alternatives</th>
                    <th>Wrong density</th>
                    <th>Dead-end density</th>
                    <th>Max recovery</th>
                    <th>完成率</th>
                    <th>主觀難度</th>
                    <th>完成者時間</th>
                    <th>完成者步數</th>
                    <th>平均重開</th>
                  </tr>
                </thead>
                <tbody>
                  {puzzleReports.map((puzzle) => {
                    const metric = getBenchmarkResearchMetric(puzzle.benchmarkId)
                    const valid = metric
                      ? isResearchMetricValidForBenchmark(metric, selectedBenchmark.benchmark)
                      : false
                    return (
                      <tr key={puzzle.benchmarkId} className={valid ? undefined : styles.invalidRow}>
                        <th scope="row">{puzzle.benchmarkId}</th>
                        <td>{valid ? '是' : '排除'}</td>
                        <td>{metric?.sourceDifficulty ?? '—'}</td>
                        <td>{metric?.solver.optimalMoves ?? '—'}</td>
                        <td>{metric?.solutionPath.totalAlternativeMoves ?? '—'}</td>
                        <td>{metric ? formatDecimal(metric.mistakeAnalysis.wrongMoveDensity, 3) : '—'}</td>
                        <td>{metric ? formatDecimal(metric.mistakeAnalysis.deadEndDensity, 3) : '—'}</td>
                        <td>{metric?.mistakeAnalysis.maxRecoveryPenalty ?? '—'}</td>
                        <td>{formatPercent(puzzle.solveRate)}</td>
                        <td>{formatDecimal(puzzle.averageDifficulty)}</td>
                        <td>{formatDuration(puzzle.medianSolvedElapsedMs)}</td>
                        <td>{formatMoves(puzzle.medianSolvedMoves)}</td>
                        <td>{formatDecimal(puzzle.averageRestarts)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <div>
                <h2>每題描述統計</h2>
                <p>「中位用時」包含完成與放棄；完成者欄位只計 solved 樣本。</p>
              </div>
            </div>
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>題目</th><th>樣本</th><th>完成率</th><th>中位用時</th>
                    <th>完成者中位用時</th><th>中位步數</th><th>完成者中位步數</th>
                    <th>平均重開</th><th>主觀難度</th><th>信心</th><th>挫折感</th><th>主要放棄原因</th>
                  </tr>
                </thead>
                <tbody>
                  {puzzleReports.map((puzzle) => (
                    <tr key={puzzle.benchmarkId}>
                      <th scope="row">{puzzle.benchmarkId}</th>
                      <td>{puzzle.sampleCount}</td>
                      <td>
                        {formatPercent(puzzle.solveRate)}
                        {puzzle.sampleCount > 0 && (
                          <span className={styles.cellNote}>{puzzle.solvedCount}/{puzzle.sampleCount}</span>
                        )}
                      </td>
                      <td>{formatDuration(puzzle.medianElapsedMs)}</td>
                      <td>{formatDuration(puzzle.medianSolvedElapsedMs)}</td>
                      <td>{formatMoves(puzzle.medianMoves)}</td>
                      <td>{formatMoves(puzzle.medianSolvedMoves)}</td>
                      <td>{formatDecimal(puzzle.averageRestarts)}</td>
                      <td>{formatDecimal(puzzle.averageDifficulty)}</td>
                      <td>{formatDecimal(puzzle.averageConfidence)}</td>
                      <td>{formatDecimal(puzzle.averageFrustration)}</td>
                      <td>{puzzle.topGiveUpReason ? puzzle.topGiveUpReason.label + ' (' + puzzle.topGiveUpReason.count + ')' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.section}>
            <h2>放棄原因彙總</h2>
            {giveUpReasons.length === 0 ? (
              <p className={styles.emptyState}>目前篩選範圍內沒有放棄樣本。</p>
            ) : (
              <div className={styles.reasonGrid}>
                {giveUpReasons.map((reason) => (
                  <article className={styles.reasonCard} key={reason.reason}>
                    <strong>{reason.count}</strong><span>{reason.label}</span><code>{reason.reason}</code>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}
