import type { Metadata } from 'next'
import benchmarkData from '../../public/benchmark.json'
import { readPlaytestReportRows, type PlaytestReportRow } from '../../lib/db'
import {
  LEGACY_CLIENT_VERSION,
  aggregateGiveUpReasons,
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

interface BenchmarkSnapshot {
  benchmark: string
  puzzles: Array<{ benchmarkId: string }>
}

interface ReportPageProps {
  searchParams: Promise<{
    clientVersion?: string | string[]
  }>
}

const benchmark = benchmarkData as BenchmarkSnapshot

function formatPercent(value: number | null): string {
  return value === null ? '—' : Math.round(value * 100) + '%'
}

function formatDecimal(value: number | null): string {
  return value === null ? '—' : value.toFixed(1)
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

export default async function ReportPage({ searchParams }: ReportPageProps) {
  const params = await searchParams
  let rows: PlaytestReportRow[] = []
  let loadError: string | null = null

  try {
    rows = await readPlaytestReportRows(benchmark.benchmark)
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Unknown report error'
  }

  const knownVersions = clientVersionOptions(rows)
  const hasLegacyRows = rows.some((row) => row.clientVersion === null)
  const requestedVersion = Array.isArray(params.clientVersion)
    ? params.clientVersion[0]
    : params.clientVersion

  const validVersions = new Set([
    'all',
    LEGACY_CLIENT_VERSION,
    ...knownVersions,
  ])

  const selectedVersion =
    requestedVersion && validVersions.has(requestedVersion)
      ? requestedVersion
      : 'all'

  const filteredRows = filterRowsByClientVersion(rows, selectedVersion)
  const summary = summarizeRows(filteredRows)
  const puzzleReports = buildPuzzleReports(
    filteredRows,
    benchmark.puzzles.map((puzzle) => puzzle.benchmarkId),
  )
  const giveUpReasons = aggregateGiveUpReasons(filteredRows)

  return (
    <main className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <a className={styles.backLink} href="/">← 返回盲測</a>
          <h1>Playtest Research Report</h1>
          <p className={styles.subtitle}>
            Neon 只讀彙總。這裡只顯示匿名聚合結果，不列出 session ID 或單筆 action history。
          </p>
        </div>
        <div className={styles.benchmarkBadge}>{benchmark.benchmark}</div>
      </div>

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
              新資料可依實際載入的前端 commit 篩選；provenance 上線前的資料保留為「未記錄版本」。
            </p>
          </section>

          <section className={styles.summaryGrid}>
            <article className={styles.metricCard}>
              <span>題目結果樣本</span>
              <strong>{summary.sampleCount}</strong>
            </article>
            <article className={styles.metricCard}>
              <span>匿名 sessions</span>
              <strong>{summary.sessionCount}</strong>
            </article>
            <article className={styles.metricCard}>
              <span>完成率</span>
              <strong>{formatPercent(summary.solveRate)}</strong>
            </article>
            <article className={styles.metricCard}>
              <span>平均主觀難度</span>
              <strong>{formatDecimal(summary.averageDifficulty)}</strong>
            </article>
            <article className={styles.metricCard}>
              <span>最後更新（台北）</span>
              <strong className={styles.smallMetric}>
                {formatUpdatedAt(latestUpdatedAt(filteredRows))}
              </strong>
            </article>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <div>
                <h2>每題描述統計</h2>
                <p>
                  「中位用時」包含完成與放棄；「完成者中位用時」只計算 solved 樣本。
                </p>
              </div>
            </div>

            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>題目</th>
                    <th>樣本</th>
                    <th>完成率</th>
                    <th>中位用時</th>
                    <th>完成者中位用時</th>
                    <th>中位步數</th>
                    <th>平均重開</th>
                    <th>主觀難度</th>
                    <th>信心</th>
                    <th>挫折感</th>
                    <th>主要放棄原因</th>
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
                          <span className={styles.cellNote}>
                            {puzzle.solvedCount}/{puzzle.sampleCount}
                          </span>
                        )}
                      </td>
                      <td>{formatDuration(puzzle.medianElapsedMs)}</td>
                      <td>{formatDuration(puzzle.medianSolvedElapsedMs)}</td>
                      <td>{formatMoves(puzzle.medianMoves)}</td>
                      <td>{formatDecimal(puzzle.averageRestarts)}</td>
                      <td>{formatDecimal(puzzle.averageDifficulty)}</td>
                      <td>{formatDecimal(puzzle.averageConfidence)}</td>
                      <td>{formatDecimal(puzzle.averageFrustration)}</td>
                      <td>
                        {puzzle.topGiveUpReason
                          ? puzzle.topGiveUpReason.label +
                            ' (' +
                            puzzle.topGiveUpReason.count +
                            ')'
                          : '—'}
                      </td>
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
                    <strong>{reason.count}</strong>
                    <span>{reason.label}</span>
                    <code>{reason.reason}</code>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className={styles.noteCard}>
            <strong>解讀注意</strong>
            <p>
              目前是描述統計，不做難度 calibration 結論。樣本量小時，完成率、時間與平均評分都容易被單一測試者影響；
              human-vs-solver correlation 會在下一階段另外加入 solver 指標後再計算。
            </p>
          </section>
        </>
      )}
    </main>
  )
}
