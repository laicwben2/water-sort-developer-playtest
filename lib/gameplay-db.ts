import { neon } from '@neondatabase/serverless'
import { payloadHash, type GameplaySession } from './gameplay-validation'

export class GameplayConflictError extends Error {}
let sqlClient: ReturnType<typeof neon<false, false>> | undefined
let schemaReady: Promise<void> | undefined
function getSql() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured')
  return sqlClient ??= neon<false, false>(process.env.DATABASE_URL)
}
export function confirmDuplicate(record: GameplaySession, row: { sessionId: string; payloadHash: string }): void {
  if (row.sessionId.toLowerCase() !== record.sessionId.toLowerCase() || row.payloadHash !== payloadHash(record)) {
    throw new GameplayConflictError('An immutable first-play record already exists')
  }
}
export async function persistGameplaySession(record: GameplaySession): Promise<void> {
  const sql = getSql()
  schemaReady ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS ios_gameplay_sessions (
        session_id UUID PRIMARY KEY,
        player_id UUID NOT NULL,
        dataset_kind TEXT NOT NULL CHECK (dataset_kind IN ('development', 'production')),
        pack_id TEXT NOT NULL,
        level_id TEXT NOT NULL,
        board_hash TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        record JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (player_id, dataset_kind, pack_id, level_id, board_hash)
      )
    `
  })().catch(error => { schemaReady = undefined; throw error })
  await schemaReady
  const hash = payloadHash(record)
  const inserted = await sql`
    INSERT INTO ios_gameplay_sessions (session_id, player_id, dataset_kind, pack_id, level_id, board_hash, payload_hash, record)
    VALUES (${record.sessionId}::uuid, ${record.playerId}::uuid, ${record.datasetKind}, ${record.packId}, ${record.levelId}, ${record.boardHash}, ${hash}, ${JSON.stringify(record)}::jsonb)
    ON CONFLICT DO NOTHING
    RETURNING session_id
  `
  if (inserted.length > 0) return
  // A separate statement sees a concurrent insert after ON CONFLICT has waited for it.
  const existing = await sql`
    SELECT session_id::text AS "sessionId", payload_hash AS "payloadHash"
    FROM ios_gameplay_sessions
    WHERE session_id = ${record.sessionId}::uuid
       OR (player_id = ${record.playerId}::uuid AND dataset_kind = ${record.datasetKind}
           AND pack_id = ${record.packId} AND level_id = ${record.levelId} AND board_hash = ${record.boardHash})
  `
  if (existing.length !== 1) throw new GameplayConflictError('Conflicting first-play identity')
  confirmDuplicate(record, existing[0] as { sessionId: string; payloadHash: string })
}
