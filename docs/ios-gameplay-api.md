# iPhone first-play API (v1)

`POST /api/gameplay-sessions`, `Content-Type: application/json`. Optional `Idempotency-Key` must equal `sessionId`. Anonymous personal-use client; there is no login or privileged database key in the app. The legacy `/api/submissions`, its validation, database table, and report remain unchanged.

The body is one flat `GameplaySession` (see `lib/gameplay-validation.ts` and the actual Swift-generated `tests/swift-session.json`). Required fields: schemaVersion=1, source=ios, persistent sessionId/playerId UUIDs, datasetKind, packId, levelId, boardHash, rulesVersion=classic-v1, capacity, startedAt/completedAt UTC dates, elapsedMs, currentMoves, totalMoves, restarts, undos, actions, finalBoard, clientVersion. No difficulty feedback. `boardHash` is lowercase SHA-256 of UTF-8 `JSON.stringify([capacity, initialBoard])`; bottles are bottom→top.

Actions: `{type:"move",atMs,from,to,color,amount}`, `{type:"undo",atMs}`, `{type:"restart",atMs}`. Time is foreground playing/thinking time, including earlier retries. Replay maintains an undo stack; restart clears the stack and currentMoves, but totalMoves remains cumulative. Completion freezes the record. Replays are never submitted.

Only the fixed 12 **development format samples** in `data/ios/development-levels.json` are registered. Corrected B03 has two empty bottles. Production registration is empty; these are not formal levels. Add formal packs explicitly with a production registry entry after they are supplied by the generator; never relabel sample records.

Responses:

- 200 `{ok:true,sessionId}` after storage confirmation, including an identical retry.
- 400 malformed/unregistered/mismatched/replay-invalid data; 409 immutable identity conflict; 413 excessive request bytes; 415 wrong content type. Retain the client record for inspection.
- 503 storage unavailable, `Retry-After: 60`. Retain and defer retry.

Streaming input is bounded to 8 MiB even without a content-length header. Hosting providers may apply a lower request limit (including Vercel); normal gameplay records are much smaller. Records that exceed a hosting limit must remain local and show the non-retryable failure.

`ios_gameplay_sessions` is separate from `playtest_submissions`. The first valid request creates its schema idempotently using the existing DATABASE_URL. Constraints: session_id primary key and unique `(player_id,dataset_kind,pack_id,level_id,board_hash)`. Inserts use ON CONFLICT DO NOTHING, followed by an immutable payload comparison. UUID/date formatting is normalized before hashing. No duplicate request updates an existing row. Concurrent insert conflicts are read in a separate statement after the insert has finished waiting.

Run `pnpm test:gameplay` and `pnpm build`. The tests replay a real Swift export, exercise undo/restart and cumulative counts, old/new format separation, request limits, duplicate identity and storage outages. A live database migration/concurrency run remains a deployment verification step; unit tests do not substitute for that.
