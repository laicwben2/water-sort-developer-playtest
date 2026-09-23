import { neon } from '@neondatabase/serverless'
import type { PlaytestResult } from './results'

type SqlClient = ReturnType<typeof neon>

let sqlClient: SqlClient | null = null
let schemaReady: Promise<void> | null = null

function getSql(): SqlClient {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is not configured')
  if (!sqlClient) sqlClient = neon(databaseUrl)
  return sqlClient
}

async function ensureSchema(sql: SqlClient): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS playtest_submissions (
          session_id UUID NOT NULL,
          benchmark TEXT NOT NULL,
          benchmark_id TEXT NOT NULL,
          result JSONB NOT NULL,
          client_version TEXT,
          server_version TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (session_id, benchmark, benchmark_id)
        )
      `
      await sql`
        ALTER TABLE playtest_submissions
        ADD COLUMN IF NOT EXISTS client_version TEXT
      `
      await sql`
        ALTER TABLE playtest_submissions
        ADD COLUMN IF NOT EXISTS server_version TEXT
      `
      await sql`
        CREATE INDEX IF NOT EXISTS playtest_submissions_benchmark_idx
        ON playtest_submissions (benchmark, benchmark_id)
      `
    })()
  }
  await schemaReady
}

export async function persistPlaytestResults(
  sessionId: string,
  benchmark: string,
  results: readonly PlaytestResult[],
  clientVersion: string,
  serverVersion: string,
): Promise<number> {
  const sql = getSql()
  await ensureSchema(sql)

  await Promise.all(
    results.map(async (result) => {
      const payload = JSON.stringify(result)
      await sql`
        INSERT INTO playtest_submissions (
          session_id,
          benchmark,
          benchmark_id,
          result,
          client_version,
          server_version,
          created_at,
          updated_at
        )
        VALUES (
          ${sessionId}::uuid,
          ${benchmark},
          ${result.benchmarkId},
          ${payload}::jsonb,
          ${clientVersion},
          ${serverVersion},
          NOW(),
          NOW()
        )
        ON CONFLICT (session_id, benchmark, benchmark_id)
        DO UPDATE SET
          result = EXCLUDED.result,
          updated_at = NOW()
      `
    }),
  )

  return results.length
}

export interface PlaytestReportRow {
  sessionId: string
  benchmarkId: string
  outcome: 'solved' | 'gave-up'
  elapsedMs: number
  moves: number
  restarts: number
  perceivedDifficulty: number
  confidence: number | null
  frustration: number | null
  giveUpReasons: string[]
  clientVersion: string | null
  serverVersion: string | null
  updatedAt: string
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value)
}

export async function readPlaytestReportRows(
  benchmark: string,
): Promise<PlaytestReportRow[]> {
  const sql = getSql()

  const rows = await sql`
    SELECT
      session_id::text AS "sessionId",
      benchmark_id AS "benchmarkId",
      result->>'outcome' AS "outcome",
      (result->>'elapsedMs')::bigint AS "elapsedMs",
      (result->>'moves')::integer AS "moves",
      (result->>'restarts')::integer AS "restarts",
      (result->>'perceivedDifficulty')::integer AS "perceivedDifficulty",
      (result->>'confidence')::integer AS "confidence",
      (result->>'frustration')::integer AS "frustration",
      CASE
        WHEN jsonb_typeof(result->'giveUpReasons') = 'array'
          THEN result->'giveUpReasons'
        ELSE '[]'::jsonb
      END AS "giveUpReasons",
      client_version AS "clientVersion",
      server_version AS "serverVersion",
      updated_at AS "updatedAt"
    FROM playtest_submissions
    WHERE benchmark = ${benchmark}
    ORDER BY benchmark_id, updated_at
  `

  return (rows as unknown as Record<string, unknown>[]).map((row) => {
    const outcome = row.outcome
    if (outcome !== 'solved' && outcome !== 'gave-up') {
      throw new Error('Unexpected playtest outcome in database')
    }

    const reasons = Array.isArray(row.giveUpReasons)
      ? row.giveUpReasons.filter((reason): reason is string => typeof reason === 'string')
      : []

    const updatedAt =
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : String(row.updatedAt)

    return {
      sessionId: String(row.sessionId),
      benchmarkId: String(row.benchmarkId),
      outcome,
      elapsedMs: Number(row.elapsedMs),
      moves: Number(row.moves),
      restarts: Number(row.restarts),
      perceivedDifficulty: Number(row.perceivedDifficulty),
      confidence: nullableNumber(row.confidence),
      frustration: nullableNumber(row.frustration),
      giveUpReasons: reasons,
      clientVersion: row.clientVersion === null ? null : String(row.clientVersion),
      serverVersion: row.serverVersion === null ? null : String(row.serverVersion),
      updatedAt,
    }
  })
}
