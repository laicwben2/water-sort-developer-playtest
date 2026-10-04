import {neon} from '@neondatabase/serverless'
import {GameplayConflictError} from './gameplay-db'
import {challengePayloadHash, type ThreeStarChallengeRecord} from './three-star-validation'
let sqlClient: ReturnType<typeof neon<false,false>> | undefined
let schemaReady: Promise<void> | undefined
export function confirmChallengeDuplicate(record: ThreeStarChallengeRecord, row: {challengeId: string; payloadHash: string}): void {
  if(row.challengeId.toLowerCase()!==record.challengeId || row.payloadHash!==challengePayloadHash(record)) throw new GameplayConflictError('An immutable first-three-star record already exists')
}
export async function persistThreeStarChallenge(record: ThreeStarChallengeRecord): Promise<void> {
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is not configured')
  const sql=sqlClient??=neon<false,false>(process.env.DATABASE_URL)
  schemaReady??=(async()=>{await sql`
    CREATE TABLE IF NOT EXISTS ios_three_star_challenges (
      challenge_id UUID PRIMARY KEY, first_session_id UUID NOT NULL, player_id UUID NOT NULL,
      dataset_kind TEXT NOT NULL CHECK (dataset_kind IN ('development','production')),
      pack_id TEXT NOT NULL, level_id TEXT NOT NULL, board_hash TEXT NOT NULL,
      payload_hash TEXT NOT NULL, record JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (player_id,dataset_kind,pack_id,level_id,board_hash)
    )`})().catch(error=>{schemaReady=undefined;throw error})
  await schemaReady
  const hash=challengePayloadHash(record)
  const inserted=await sql`
    INSERT INTO ios_three_star_challenges (challenge_id,first_session_id,player_id,dataset_kind,pack_id,level_id,board_hash,payload_hash,record)
    VALUES (${record.challengeId}::uuid,${record.firstSessionId}::uuid,${record.playerId}::uuid,${record.datasetKind},${record.packId},${record.levelId},${record.boardHash},${hash},${JSON.stringify(record)}::jsonb)
    ON CONFLICT DO NOTHING RETURNING challenge_id`
  if(inserted.length)return
  const rows=await sql`
    SELECT challenge_id::text AS "challengeId",payload_hash AS "payloadHash" FROM ios_three_star_challenges
    WHERE challenge_id=${record.challengeId}::uuid OR (player_id=${record.playerId}::uuid AND dataset_kind=${record.datasetKind} AND pack_id=${record.packId} AND level_id=${record.levelId} AND board_hash=${record.boardHash})`
  if(rows.length!==1)throw new GameplayConflictError('Conflicting first-three-star identity')
  confirmChallengeDuplicate(record,rows[0] as {challengeId:string;payloadHash:string})
}
