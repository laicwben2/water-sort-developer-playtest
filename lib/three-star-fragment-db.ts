import type {neon} from '@neondatabase/serverless'
import {database,persistChallengeAttempt} from './three-star-attempt-db'
import {validateChallengeAttempt,hash} from './three-star-attempts'
import {GameplayConflictError} from './gameplay-db'
import {GameplayValidationError} from './gameplay-validation'
import {assembleChallengeFragments,type ChallengeFragment,type FragmentReceipt} from './three-star-fragments'
let schemaReady:Promise<void>|undefined
const schema=`
CREATE TABLE IF NOT EXISTS ios_three_star_fragment_groups (
 challenge_id UUID NOT NULL,session_index INTEGER NOT NULL,info_hash TEXT NOT NULL,
 part_count INTEGER NOT NULL,byte_count INTEGER NOT NULL,payload_hash TEXT NOT NULL,
 received_count INTEGER NOT NULL DEFAULT 0,attempt_complete BOOLEAN NOT NULL DEFAULT FALSE,
 complete_receipt BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(challenge_id,session_index));
CREATE TABLE IF NOT EXISTS ios_three_star_fragments (
 challenge_id UUID NOT NULL,session_index INTEGER NOT NULL,part_index INTEGER NOT NULL,part_hash TEXT NOT NULL,data TEXT,
 PRIMARY KEY(challenge_id,session_index,part_index),FOREIGN KEY(challenge_id,session_index) REFERENCES ios_three_star_fragment_groups(challenge_id,session_index));
CREATE OR REPLACE FUNCTION ios_stage_three_star_fragment(p_id UUID,p_session INTEGER,p_index INTEGER,p_count INTEGER,p_bytes INTEGER,p_payload_hash TEXT,p_info_hash TEXT,p_hash TEXT,p_data TEXT)
RETURNS TABLE(attempt_complete BOOLEAN,complete BOOLEAN,received_count INTEGER) LANGUAGE plpgsql AS $fn$
DECLARE g ios_three_star_fragment_groups%ROWTYPE;old_hash TEXT;added INTEGER;
BEGIN
 INSERT INTO ios_three_star_fragment_groups(challenge_id,session_index,info_hash,part_count,byte_count,payload_hash)
 VALUES(p_id,p_session,p_info_hash,p_count,p_bytes,p_payload_hash) ON CONFLICT DO NOTHING;
 SELECT * INTO g FROM ios_three_star_fragment_groups WHERE challenge_id=p_id AND session_index=p_session FOR UPDATE;
 IF g.info_hash<>p_info_hash THEN RAISE EXCEPTION 'immutable fragment group' USING ERRCODE='23505'; END IF;
 INSERT INTO ios_three_star_fragments(challenge_id,session_index,part_index,part_hash,data)
 VALUES(p_id,p_session,p_index,p_hash,p_data) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT;
 SELECT part_hash INTO old_hash FROM ios_three_star_fragments WHERE challenge_id=p_id AND session_index=p_session AND part_index=p_index;
 IF old_hash<>p_hash THEN RAISE EXCEPTION 'immutable fragment' USING ERRCODE='23505'; END IF;
 IF added=1 THEN UPDATE ios_three_star_fragment_groups SET received_count=ios_three_star_fragment_groups.received_count+1
 WHERE challenge_id=p_id AND session_index=p_session RETURNING * INTO g; END IF;
 RETURN QUERY SELECT g.attempt_complete,(g.complete_receipt OR COALESCE((SELECT m.complete FROM ios_three_star_manifests m WHERE m.challenge_id=p_id),FALSE)),g.received_count;
END $fn$;`
export async function persistChallengeFragment(part:ChallengeFragment):Promise<FragmentReceipt> {
 return storeChallengeFragment(part,await database(),persistChallengeAttempt)
}
export async function storeChallengeFragment(part:ChallengeFragment,sql:ReturnType<typeof neon<false,false>>,saveAttempt:typeof persistChallengeAttempt):Promise<FragmentReceipt> {
 schemaReady??=(async()=>{for(const statement of schema.split(/;\n(?=CREATE)/))await sql.query(statement)})().catch(error=>{schemaReady=undefined;throw error})
 await schemaReady
 const {challengeId:id,sessionIndex,partCount,byteCount,payloadHash}=part
 const infoHash=hash({id,sessionIndex,partCount,byteCount,payloadHash})
 let staged:{attempt_complete:boolean;complete:boolean;received_count:number}
 try {
  const rows=await sql`SELECT * FROM ios_stage_three_star_fragment(${id}::uuid,${sessionIndex},${part.partIndex},${partCount},${byteCount},${payloadHash},${infoHash},${part.partHash},${part.data})`
  staged=rows[0] as typeof staged
 } catch(error) {if((error as {code?:string}).code==='23505')throw new GameplayConflictError('An immutable fragment already exists');throw error}
 if(staged.attempt_complete)return {attemptComplete:true,complete:staged.complete}
 if(staged.received_count<partCount)return {attemptComplete:false,complete:false}
 const chunks=await sql`SELECT part_index AS "partIndex",part_hash AS "partHash",data FROM ios_three_star_fragments WHERE challenge_id=${id}::uuid AND session_index=${sessionIndex} ORDER BY part_index`
 // Another finalizer may already have discarded bytes after storing the verified attempt.
 if(chunks.some(row=>row.data===null)) {
  const rows=await sql`SELECT g.attempt_complete,(g.complete_receipt OR COALESCE(m.complete,FALSE)) AS complete FROM ios_three_star_fragment_groups g LEFT JOIN ios_three_star_manifests m USING(challenge_id) WHERE g.challenge_id=${id}::uuid AND g.session_index=${sessionIndex}`
  return {attemptComplete:rows[0]?.attempt_complete===true,complete:rows[0]?.complete===true}
 }
 const assembled=assembleChallengeFragments(chunks.map(row=>({...part,partIndex:row.partIndex as number,partHash:row.partHash as string,data:row.data as string})))
 const attempt=validateChallengeAttempt(assembled)
 if(attempt.challenge.challengeId!==id || attempt.sessionIndex!==sessionIndex)throw new GameplayValidationError('Fragment identity differs from payload')
 const complete=await saveAttempt(attempt)
 // Keep hashes as durable receipts; discard the duplicate raw bytes only after verified storage.
 await sql.transaction([
  sql`UPDATE ios_three_star_fragment_groups SET attempt_complete=TRUE,complete_receipt=${complete} WHERE challenge_id=${id}::uuid AND session_index=${sessionIndex}`,
  sql`UPDATE ios_three_star_fragments SET data=NULL WHERE challenge_id=${id}::uuid AND session_index=${sessionIndex}`
 ])
 return {attemptComplete:true,complete}
}
