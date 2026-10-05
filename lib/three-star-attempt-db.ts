import {neon} from '@neondatabase/serverless'
import {GameplayConflictError} from './gameplay-db'
import {GameplayValidationError} from './gameplay-validation'
import {hash,validateChallengeAttempt,confirmAttemptDuplicate,type ChallengeAttempt} from './three-star-attempts'
let sqlClient:ReturnType<typeof neon<false,false>>|undefined
let schemaReady:Promise<void>|undefined
// One database function holds a challenge row lock for insertion, totals, and receipt.
const schema=`
CREATE TABLE IF NOT EXISTS ios_three_star_challenges (
 challenge_id UUID PRIMARY KEY,first_session_id UUID NOT NULL,player_id UUID NOT NULL,
 dataset_kind TEXT NOT NULL,pack_id TEXT NOT NULL,level_id TEXT NOT NULL,board_hash TEXT NOT NULL,
 payload_hash TEXT NOT NULL,record JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(player_id,dataset_kind,pack_id,level_id,board_hash));
CREATE TABLE IF NOT EXISTS ios_three_star_manifests (
 challenge_id UUID PRIMARY KEY,player_id UUID NOT NULL,dataset_kind TEXT NOT NULL,pack_id TEXT NOT NULL,
 level_id TEXT NOT NULL,board_hash TEXT NOT NULL,manifest JSONB NOT NULL,manifest_hash TEXT NOT NULL,
 received_count INTEGER NOT NULL DEFAULT 0,elapsed_total NUMERIC NOT NULL DEFAULT 0,moves_total NUMERIC NOT NULL DEFAULT 0,
 restarts_total NUMERIC NOT NULL DEFAULT 0,undos_total NUMERIC NOT NULL DEFAULT 0,earliest_start TIMESTAMPTZ,
 complete BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(player_id,dataset_kind,pack_id,level_id,board_hash));
CREATE TABLE IF NOT EXISTS ios_three_star_attempts (
 challenge_id UUID NOT NULL REFERENCES ios_three_star_manifests(challenge_id),session_index INTEGER NOT NULL,
 session_id UUID NOT NULL,payload_hash TEXT NOT NULL,record JSONB NOT NULL,
 PRIMARY KEY(challenge_id,session_index),UNIQUE(challenge_id,session_id));
CREATE OR REPLACE FUNCTION ios_receive_three_star_attempt(p_manifest JSONB,p_manifest_hash TEXT,p_index INTEGER,p_session JSONB,p_hash TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $fn$
DECLARE h ios_three_star_manifests%ROWTYPE; old_hash TEXT; added INTEGER; id UUID=(p_manifest->>'challengeId')::uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_manifest->>'playerId',p_manifest->>'datasetKind',p_manifest->>'packId',p_manifest->>'levelId',p_manifest->>'boardHash')::text,0));
 IF EXISTS(SELECT 1 FROM ios_three_star_challenges WHERE challenge_id=id OR
  (player_id=(p_manifest->>'playerId')::uuid AND dataset_kind=p_manifest->>'datasetKind' AND pack_id=p_manifest->>'packId' AND level_id=p_manifest->>'levelId' AND board_hash=p_manifest->>'boardHash'))
 THEN RAISE EXCEPTION 'immutable legacy challenge' USING ERRCODE='23505'; END IF;
 INSERT INTO ios_three_star_manifests(challenge_id,player_id,dataset_kind,pack_id,level_id,board_hash,manifest,manifest_hash)
 VALUES(id,(p_manifest->>'playerId')::uuid,p_manifest->>'datasetKind',p_manifest->>'packId',p_manifest->>'levelId',p_manifest->>'boardHash',p_manifest,p_manifest_hash)
 ON CONFLICT DO NOTHING;
 SELECT * INTO h FROM ios_three_star_manifests WHERE challenge_id=id FOR UPDATE;
 IF NOT FOUND OR h.manifest_hash<>p_manifest_hash THEN RAISE EXCEPTION 'immutable challenge' USING ERRCODE='23505'; END IF;
 INSERT INTO ios_three_star_attempts(challenge_id,session_index,session_id,payload_hash,record)
 VALUES(id,p_index,(p_session->>'sessionId')::uuid,p_hash,p_session) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT;
 SELECT payload_hash INTO old_hash FROM ios_three_star_attempts WHERE challenge_id=id AND session_index=p_index;
 IF old_hash IS NULL OR old_hash<>p_hash THEN RAISE EXCEPTION 'immutable attempt' USING ERRCODE='23505'; END IF;
 IF added=1 THEN
  UPDATE ios_three_star_manifests SET received_count=received_count+1,
   elapsed_total=LEAST(9007199254740991,elapsed_total+(p_session->>'elapsedMs')::numeric),
   moves_total=LEAST(9007199254740991,moves_total+(p_session->>'totalMoves')::numeric),
   restarts_total=LEAST(9007199254740991,restarts_total+(p_session->>'restarts')::numeric),
   undos_total=LEAST(9007199254740991,undos_total+(p_session->>'undos')::numeric),
   earliest_start=LEAST(earliest_start,(p_session->>'startedAt')::timestamptz)
  WHERE challenge_id=id RETURNING * INTO h;
 END IF;
 IF h.received_count=(p_manifest->>'completedCount')::integer THEN
  IF h.elapsed_total<>(p_manifest->>'elapsedMs')::numeric OR h.moves_total<>(p_manifest->>'totalMoves')::numeric OR
   h.restarts_total<>(p_manifest->>'restarts')::numeric OR h.undos_total<>(p_manifest->>'undos')::numeric OR
   h.earliest_start<>(p_manifest->>'startedAt')::timestamptz THEN RAISE EXCEPTION 'invalid challenge totals' USING ERRCODE='22000'; END IF;
  UPDATE ios_three_star_manifests SET complete=TRUE WHERE challenge_id=id;
  RETURN TRUE;
 END IF;
 RETURN FALSE;
END $fn$;
CREATE OR REPLACE FUNCTION ios_save_three_star_v1(p_record JSONB,p_hash TEXT) RETURNS VOID LANGUAGE plpgsql AS $fn$
DECLARE existing_hash TEXT; id UUID=(p_record->>'challengeId')::uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_record->>'playerId',p_record->>'datasetKind',p_record->>'packId',p_record->>'levelId',p_record->>'boardHash')::text,0));
 IF EXISTS(SELECT 1 FROM ios_three_star_manifests WHERE challenge_id=id OR
  (player_id=(p_record->>'playerId')::uuid AND dataset_kind=p_record->>'datasetKind' AND pack_id=p_record->>'packId' AND level_id=p_record->>'levelId' AND board_hash=p_record->>'boardHash'))
 THEN RAISE EXCEPTION 'immutable v2 challenge' USING ERRCODE='23505'; END IF;
 INSERT INTO ios_three_star_challenges(challenge_id,first_session_id,player_id,dataset_kind,pack_id,level_id,board_hash,payload_hash,record)
 VALUES(id,(p_record->>'firstSessionId')::uuid,(p_record->>'playerId')::uuid,p_record->>'datasetKind',p_record->>'packId',p_record->>'levelId',p_record->>'boardHash',p_hash,p_record) ON CONFLICT DO NOTHING;
 SELECT payload_hash INTO existing_hash FROM ios_three_star_challenges WHERE challenge_id=id;
 IF existing_hash IS NULL OR existing_hash<>p_hash THEN RAISE EXCEPTION 'immutable v1 challenge' USING ERRCODE='23505'; END IF;
END $fn$;`
export async function database() {
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is not configured')
 const sql=sqlClient??=neon<false,false>(process.env.DATABASE_URL)
 schemaReady??=(async()=>{ for(const statement of schema.split(/;\n(?=CREATE)/)) await sql.query(statement) })().catch(error=>{schemaReady=undefined;throw error})
 await schemaReady
 return sql
}
export async function persistLegacyChallenge(record:unknown,payloadHash:string):Promise<void> {
 const sql=await database()
 try { await sql`SELECT ios_save_three_star_v1(${JSON.stringify(record)}::jsonb,${payloadHash})` }
 catch(error) { if((error as {code?:string}).code==='23505')throw new GameplayConflictError('An immutable first-three-star record already exists');throw error }
}
export async function persistChallengeAttempt(part:ChallengeAttempt):Promise<boolean> {
 return storeChallengeAttempt(part,await database())
}
export async function storeChallengeAttempt(part:ChallengeAttempt,sql:ReturnType<typeof neon<false,false>>):Promise<boolean> {
 const m=part.challenge
 // Existing v1 records remain authoritative; no migration or overwrite is required.
 const legacy=await sql`SELECT record FROM ios_three_star_challenges WHERE challenge_id=${m.challengeId}::uuid OR
 (player_id=${m.playerId}::uuid AND dataset_kind=${m.datasetKind} AND pack_id=${m.packId} AND level_id=${m.levelId} AND board_hash=${m.boardHash})`
 if(legacy.length) {
  if(legacy.length!==1)throw new GameplayConflictError('Conflicting legacy identity')
  const {sessions,...challenge}=legacy[0].record as {sessions:unknown[]}&Record<string,unknown>
  if(!sessions[part.sessionIndex])throw new GameplayConflictError('Conflicting legacy attempt')
  confirmAttemptDuplicate(validateChallengeAttempt({protocolVersion:2,challenge,sessionIndex:part.sessionIndex,session:sessions[part.sessionIndex]}),part)
  return true
 }
 try {
  const result=await sql`SELECT ios_receive_three_star_attempt(${JSON.stringify(m)}::jsonb,${hash(m)},${part.sessionIndex},${JSON.stringify(part.session)}::jsonb,${hash(part.session)}) AS complete`
  return result[0]?.complete===true
 } catch(error) {
  const code=(error as {code?:string}).code
  if(code==='23505')throw new GameplayConflictError('An immutable first-three-star record already exists')
  if(code==='22000')throw new GameplayValidationError('Challenge totals disagree with attempts')
  throw error
 }
}
