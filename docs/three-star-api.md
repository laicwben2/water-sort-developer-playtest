# First-three-star challenge API (v1)

`POST /api/three-star-challenges`, `Content-Type: application/json`, optional `Idempotency-Key` equal to `challengeId`. This is additional information. `/api/gameplay-sessions`, `/api/submissions`, and their stored records retain their contracts.

The iPhone derives the challenge URL beside the configured first-play URL: `https://HOST/api/gameplay-sessions` → `https://HOST/api/three-star-challenges`. The two jobs may arrive in either order. No database foreign key requires the first-play transfer to finish first.

At the first three-star completion, save one immutable record with:

- `schemaVersion=1`, `source=ios`, `challengeId` (winning session UUID), `firstSessionId`, `playerId`.
- `datasetKind`, `packId`, `levelId`, `boardHash`, `rulesVersion=classic-v1`, `capacity`, registered `optimalMoves`.
- `startedAt`, `achievedAt`, cumulative `elapsedMs`, `totalMoves`, `restarts`, `undos`, `attemptCount`, `completedCount`, `clientVersion`.
- `sessions`: every completed attempt from the first play through the first three-star win, inclusive, in completion order. Each uses the existing flat gameplay-session action and statistics format, including replays. Its clientVersion identifies this challenge export; the original first-play payload is not rewritten.

Attempt count = included session count + restart count. Undo and resuming a session do not create a new attempt. All legal pours count, including undone pours and rounds discarded by restart. Elapsed time sums foreground playing/thinking time; time spent away from the puzzle does not count. The final round's net move count still determines each star rating. A challenge in progress remains local; completion freezes the upload, and later replays do not add time or steps.

The server replays every attempt against the registered puzzle, checks same player/puzzle identity, chronology, first/winning IDs, solver optimum and aggregate sums. Earlier completions must be below three stars, and the final completion must meet the three-star limit. No difficulty feedback is collected. Input is streamed with an 8 MiB bound, 10,000 sessions and 100,000 total actions; oversized records remain local for inspection rather than being truncated. Hosting may impose a lower body limit.

Responses: `200 {ok:true,challengeId}` after storage confirmation, including identical retries; `400` invalid data; `409` an immutable identity conflict; `413` oversized input; `415` wrong media type; `503` temporary storage failure with `Retry-After: 60`.

`ios_three_star_challenges` is separate from first-play and friend-testing tables. Unique keys are `challenge_id` and `(player_id,dataset_kind,pack_id,level_id,board_hash)`; retries compare a normalized payload hash and never overwrite an earlier accepted record.

The phone shares the existing file-based background URLSession engine and 1/5/15/60-minute retry policy. Task descriptions and upload filenames distinguish first-play from challenge even when both share the winning UUID. Each has its own acknowledgement key, retry state and backup state. Older archives without `threeStarUploads` decode as an empty queue; existing history backfills already-achieved milestones once. Restores retain local immutable milestones and acknowledged upload states.

Run the Swift command below in the water-sort-ios checkout. Backend verification uses `pnpm test:gameplay` and `pnpm build`.

Validation uses a real Swift-generated formal-level fixture with one-, two- and three-star sessions: final net moves `[20,16,14]`, total pours `52`, elapsed `6000 ms`, one undo, one restart, four attempts across three completed sessions.

```sh
WATERSORT_CHALLENGE_CONTRACT_OUTPUT=/tmp/swift-three-star-challenge.json swift test \
  --filter testOneTwoThreeStarsAccumulateAllAttemptsAndFreezeSeparateUpload
```

Backend changes are in the existing draft PR. Deployment/database verification remains separate from local contract and HTTPS transfer tests.
