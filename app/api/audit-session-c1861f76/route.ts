import { readPlaytestReportRows } from '../../../lib/db'

export const dynamic = 'force-dynamic'

const SESSION_PREFIX = 'c1861f76'
const BENCHMARK = 'difficulty-v2-benchmark-v2'

export async function GET(): Promise<Response> {
  if (process.env.VERCEL_ENV === 'production') {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const rows = await readPlaytestReportRows(BENCHMARK)
  const matches = rows.filter((row) => row.sessionId.startsWith(SESSION_PREFIX))
  const sessionIds = [...new Set(matches.map((row) => row.sessionId))]

  if (sessionIds.length !== 1) {
    return Response.json({
      prefix: SESSION_PREFIX,
      matchingSessions: sessionIds.length,
      results: [],
    })
  }

  const results = matches
    .sort((a, b) => a.benchmarkId.localeCompare(b.benchmarkId))
    .map((row) => ({
      benchmarkId: row.benchmarkId,
      outcome: row.outcome,
      elapsedMs: row.elapsedMs,
      moves: row.moves,
      restarts: row.restarts,
      perceivedDifficulty: row.perceivedDifficulty,
      updatedAt: row.updatedAt,
    }))

  return Response.json({
    prefix: SESSION_PREFIX,
    matchingSessions: 1,
    submitted: results.length,
    solved: results.filter((row) => row.outcome === 'solved').length,
    gaveUp: results.filter((row) => row.outcome === 'gave-up').length,
    results,
  })
}
