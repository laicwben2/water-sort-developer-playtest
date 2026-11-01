// Run after test:gameplay. PGLITE_MODULE_PATH may point to a temporary installation.
import {readFileSync,mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createRequire} from 'node:module'
import assert from 'node:assert/strict'
const {PGlite}=await import(process.env.PGLITE_MODULE_PATH??'@electric-sql/pglite')
const require=createRequire(import.meta.url)
const {validateChallengeAttempt,hash}=require('../.test-build/lib/three-star-attempts.js')
const raw=JSON.parse(readFileSync(new URL('../tests/swift-three-star-challenge.json',import.meta.url),'utf8'))
const source=readFileSync(new URL('../lib/three-star-attempt-db.ts',import.meta.url),'utf8')
const schema=source.match(/const schema=`([\s\S]*?)`/)[1]
const directory=mkdtempSync(join(tmpdir(),'water-sort-pg-'))
let pg=new PGlite(directory)
for(const statement of schema.split(/;\n(?=CREATE)/))await pg.query(statement)
const {sessions,...challenge}=raw
const parts=sessions.map((session,sessionIndex)=>validateChallengeAttempt({protocolVersion:2,challenge,sessionIndex,session}))
const save=(part)=>pg.query('SELECT ios_receive_three_star_attempt($1::jsonb,$2,$3,$4::jsonb,$5) AS complete',[JSON.stringify(part.challenge),hash(part.challenge),part.sessionIndex,JSON.stringify(part.session),hash(part.session)])
for(const i of [2,0,0])assert.equal((await save(parts[i])).rows[0].complete,false)
assert.equal((await save(parts[1])).rows[0].complete,true)
assert.equal((await save(parts[2])).rows[0].complete,true)
assert.equal((await pg.query('SELECT COUNT(*)::int AS count FROM ios_three_star_attempts')).rows[0].count,3)
const changed=structuredClone(parts[0]);changed.session.clientVersion='changed'
await assert.rejects(save(changed),e=>e.code==='23505')
await assert.rejects(pg.query('SELECT ios_save_three_star_v1($1::jsonb,$2)',[JSON.stringify(raw),hash(raw)]),e=>e.code==='23505')
await pg.close();pg=new PGlite(directory)
assert.equal((await pg.query('SELECT complete FROM ios_three_star_manifests')).rows[0].complete,true)
assert.equal((await save(parts[2])).rows[0].complete,true)
// A bad final sum rolls back the last row and leaves the earlier received rows intact.
const badParts=structuredClone(parts)
for(const part of badParts){part.challenge.challengeId='61a69c5e-6ed5-47d7-b054-529544156d70';part.challenge.playerId='e1ba0ca7-3d50-46b3-bfbd-d7dc0d063ac7';part.challenge.totalMoves++}
badParts[2].session.sessionId=badParts[2].challenge.challengeId
await save(badParts[0]);await save(badParts[1])
await assert.rejects(save(badParts[2]),e=>e.code==='22000')
assert.equal((await pg.query('SELECT received_count FROM ios_three_star_manifests WHERE challenge_id=$1::uuid',[badParts[0].challenge.challengeId])).rows[0].received_count,2)
await pg.close()
console.log('PostgreSQL function checks passed: receipt, duplicate, conflicts, rollback, durable reopen. Separate-connection concurrency and Neon deployment remain unverified.')
