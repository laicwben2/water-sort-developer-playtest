# iPhone first-play API (v1)

`POST /api/gameplay-sessions`, `Content-Type: application/json`. Optional `Idempotency-Key` must equal `sessionId`. Anonymous personal-use client; there is no login or privileged database key in the app. The legacy `/api/submissions`, its validation, database table, and report remain unchanged.

The body is one flat `GameplaySession` (see `lib/gameplay-validation.ts` and the actual Swift-generated `tests/swift-session.json`). Required fields: schemaVersion=1, source=ios, persistent sessionId/playerId UUIDs, datasetKind, packId, levelId, boardHash, rulesVersion=classic-v1, capacity, startedAt/completedAt UTC dates, elapsedMs, currentMoves, totalMoves, restarts, undos, actions, finalBoard, clientVersion. No difficulty feedback. `boardHash` is lowercase SHA-256 of UTF-8 `JSON.stringify([capacity, initialBoard])`; bottles are bottom→top.

Actions: `{type:"move",atMs,from,to,color,amount}`, `{type:"undo",atMs}`, `{type:"restart",atMs}`. Time is foreground playing/thinking time, including earlier retries. Replay maintains an undo stack; restart clears the stack and currentMoves, but totalMoves remains cumulative. Completion freezes the record. Replays are never submitted.

Three immutable packs are registered:

- `production`: 3,000 formal levels from catalog commit `fe8beaaa8af5312272b68cfcf2fa49686f154f32`, packId `mac-local-pilot-v1-catalog-000000-002999-fe8beaaa8af5`, in `data/ios/release-levels.json`. Provenance is in `data/ios/release-source.json`.
- `development`: the original 100-puzzle pilot shard pinned to commit `0d97846a991f5e1bd84795129c3c8329eb9bd639`, packId `mac-local-pilot-v1-shard-000000-000099-0d97846a991f`, in `data/ios/pilot-levels.json`.
- `development`: the previous 12 format samples in `data/ios/development-levels.json` (corrected B03 has two empty bottles).

Old registrations remain so previously queued offline records are valid. Formal and development progress/records remain separate even where IDs and boards overlap; never relabel old records. Source IDs, bottom-to-top boards, capacity and solver-reported optimal move counts are retained, with other research metadata and step-by-step solutions excluded from gameplay packs. Real Swift fixtures cover all three packs; the new formal first-level record has 14 final moves, 16 cumulative pours, one undo and one restart.

The iOS completion rating is derived from final-round `currentMoves` and the registered solver optimum: 3 stars at/below optimum, 2 at/below ceil(optimum×1.25), 1 otherwise. It is not a player difficulty report and does not add fields to the immutable API schema. Replays can improve local star display without uploading another first-play record.

Responses:

- 200 `{ok:true,sessionId}` after storage confirmation, including an identical retry.
- 400 malformed/unregistered/mismatched/replay-invalid data; 409 immutable identity conflict; 413 excessive request bytes; 415 wrong content type. Retain the client record for inspection.
- 503 storage unavailable, `Retry-After: 60`. Retain and defer retry.

Streaming input is bounded to 8 MiB even without a content-length header. Hosting providers may apply a lower request limit (including Vercel); normal gameplay records are much smaller. Records that exceed a hosting limit must remain local and show the non-retryable failure.

`ios_gameplay_sessions` is separate from `playtest_submissions`. The first valid request creates its schema idempotently using the existing DATABASE_URL. Constraints: session_id primary key and unique `(player_id,dataset_kind,pack_id,level_id,board_hash)`. Inserts use ON CONFLICT DO NOTHING, followed by an immutable payload comparison. UUID/date formatting is normalized before hashing. No duplicate request updates an existing row. Concurrent insert conflicts are read in a separate statement after the insert has finished waiting.

Run `pnpm test:gameplay` and `pnpm build`. The tests replay a real Swift export, exercise undo/restart and cumulative counts, old/new format separation, request limits, duplicate identity and storage outages. A live database migration/concurrency run remains a deployment verification step; unit tests do not substitute for that.
