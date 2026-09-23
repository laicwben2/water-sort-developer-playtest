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
