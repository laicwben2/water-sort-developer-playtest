// Uses the exact repository queries against local PostgreSQL, with a real Swift large-attempt export.
import {readFileSync,mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const {PGlite}=await import(process.env.PGLITE_MODULE_PATH??'@electric-sql/pglite')
const require=createRequire(import.meta.url)
const {storeChallengeAttempt}=require('../.test-build/lib/three-star-attempt-db.js')
const {storeChallengeFragment}=require('../.test-build/lib/three-star-fragment-db.js')
const {validateChallengeAttempt}=require('../.test-build/lib/three-star-attempts.js')
const {validateChallengeFragment,handleChallengeFragmentPost,FRAGMENT_BYTES}=require('../.test-build/lib/three-star-fragments.js')
const raw=JSON.parse(readFileSync(process.env.WATERSORT_LARGE_ATTEMPT_OUTPUT,'utf8'))
const directory=mkdtempSync(join(tmpdir(),'water-sort-fragments-pg-'))
let pg=new PGlite(directory)
for(const file of ['three-star-attempt-db.ts','three-star-fragment-db.ts']) {
 const source=readFileSync(new URL('../lib/'+file,import.meta.url),'utf8'),schema=source.match(/const schema=`([\s\S]*?)`/)[1]
 for(const statement of schema.split(/;\n(?=CREATE)/))await pg.query(statement)
}
function sql(strings,...params) {
 const query=strings.reduce((a,s,i)=>a+(i?'$'+i:'')+s,'')
 return {query,params,then(resolve,reject){return pg.query(query,params).then(r=>r.rows).then(resolve,reject)}}
}
sql.query=(q,p=[])=>pg.query(q,p).then(r=>r.rows)
sql.transaction=queries=>pg.transaction(async tx=>{const results=[];for(const q of queries)results.push((await tx.query(q.query,q.params)).rows);return results})
const save=p=>storeChallengeFragment(p,sql,attempt=>storeChallengeAttempt(attempt,sql))
const checksum=b=>createHash('sha256').update(b).digest('hex')
function split(body) {
 const bytes=Buffer.from(JSON.stringify(body)),payloadHash=checksum(bytes),partCount=Math.ceil(bytes.length/FRAGMENT_BYTES)
 return Array.from({length:partCount},(_,partIndex)=>{const data=bytes.subarray(partIndex*FRAGMENT_BYTES,(partIndex+1)*FRAGMENT_BYTES);return validateChallengeFragment({protocolVersion:3,challengeId:body.challenge.challengeId,sessionIndex:body.sessionIndex,partIndex,partCount,byteCount:bytes.length,payloadHash,partHash:checksum(data),data:data.toString('base64')})})
}
const parts=split(raw);assert.ok(parts.length>1)
for(const part of [...parts].reverse()) {
 const request=new Request('https://example.test/api/three-star-attempt-parts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(part)})
 assert.ok(Buffer.byteLength(JSON.stringify(part))<512*1024)
 const result=await handleChallengeFragmentPost(request,save);assert.equal(result.status,200)
 const ack=await result.json();assert.equal(ack.complete,false)
}
assert.deepEqual(await save(parts.at(-1)),{attemptComplete:true,complete:false})
assert.equal((await pg.query('SELECT COUNT(*)::int AS count FROM ios_three_star_attempts')).rows[0].count,1)
assert.equal((await pg.query('SELECT COUNT(*)::int AS count FROM ios_three_star_fragments WHERE data IS NOT NULL')).rows[0].count,0)
const fixture=JSON.parse(readFileSync(new URL('../tests/swift-three-star-challenge.json',import.meta.url),'utf8'))
const winner=structuredClone(fixture.sessions.at(-1))
winner.actions=winner.actions.slice(4).map(a=>({...a,atMs:0}));winner.totalMoves=14;winner.undos=0;winner.restarts=0;winner.elapsedMs=0
winner.sessionId=raw.challenge.challengeId;winner.playerId=raw.challenge.playerId;winner.startedAt=raw.challenge.achievedAt;winner.completedAt=raw.challenge.achievedAt;winner.clientVersion=raw.challenge.clientVersion
const last={protocolVersion:2,challenge:raw.challenge,sessionIndex:1,session:winner};validateChallengeAttempt(last)
assert.deepEqual(await save(split(last)[0]),{attemptComplete:true,complete:true})
await pg.close();pg=new PGlite(directory)
assert.deepEqual(await save(parts.at(-1)),{attemptComplete:true,complete:true})
assert.equal((await pg.query('SELECT COUNT(*)::int AS count FROM ios_three_star_attempts')).rows[0].count,2)
await pg.close()
console.log(`Fragment SQL checks passed: ${parts.length} parts, 100000 legal Swift actions, out-of-order and duplicate receipts, raw-byte cleanup, full challenge completion, durable reopen. Multi-connection Neon concurrency remains unverified.`)
