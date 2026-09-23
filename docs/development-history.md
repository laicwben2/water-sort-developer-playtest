# Development History

Last updated: 2026-09-23

This is a concise record of research-relevant changes. Git remains the authoritative source for exact code diffs; this file records why important changes matter to the playtest and its data.

## 2026-09-23 — Standalone developer playtest

### `7a9eb9b` — Initial standalone deployment

Created the standalone `water-sort-developer-playtest` project and connected it to its own Vercel production project.

The playtest is intentionally separate from the level-generator runtime so the benchmark snapshot and tester-facing UI can be deployed independently.

## 2026-09-23 — Game-area UI refinement

### `8619f72` — Refine playtest game area from benchmark UI

Adjusted the tester-facing game area after comparing it with the previously refined Water Sort web UI.

Notable changes:

- increased main content width from 900 px to 980 px;
- increased desktop tube size from 52×178 px to 58×198 px;
- increased liquid-cell height from 33 px to 38 px;
- increased selected-tube lift from 10 px to 12 px;
- introduced a centered `.board-wrap` with stable minimum height;
- changed stats from a fixed four-column grid to a wrapping compact strip;
- hid the puzzle-order strip while actively playing/entering feedback, leaving it visible in the ready phase;
- retained a smaller responsive tube/cell layout on narrow screens.

Research relevance: visual scale and interaction affordances can affect solve time and subjective difficulty. Samples collected across materially different UI versions should not automatically be pooled as if interface conditions were identical.

## 2026-09-23 — Confidence definition

### `262773c` — Clarify playtest confidence rating

Changed the feedback label from generic “信心 1–5” to:

```text
對難度評分的信心 1–5（可選）
1 = 很不確定，5 = 很確定這個難度評分能代表你的實際感受
```

The stored field remains `confidence`; no result-schema field was renamed.

Research relevance: confidence now has an explicit construct definition and should be interpreted only as confidence in the subjective difficulty rating.

## 2026-09-23 — Version provenance

### `e670aa6` — Track playtest client and server versions

Added:

- `client_version` to the submission table;
- `server_version` to the submission table;
- browser submission of the loaded frontend commit;
- server capture of the receiving production commit;
- validation requiring a 40-character git SHA or `local-dev`.

The database uses `ADD COLUMN IF NOT EXISTS` for backward-compatible schema readiness.

On conflict, result data is updated but provenance columns are intentionally not overwritten, preserving the version associated with the first persisted sample for that session/puzzle.

Older rows remain null rather than receiving guessed version values.

## 2026-09-23 — Read-only research report

### `3aa091f` — Add read-only playtest research report

Added `/report` with server-rendered Neon aggregation.

Current metrics include:

- total puzzle-result samples;
- anonymous session count;
- solve rate;
- per-puzzle median elapsed time;
- solved-only median elapsed time;
- median moves;
- average restarts;
- average perceived difficulty;
- average confidence;
- average frustration;
- give-up-reason aggregation;
- filtering by `client_version`.

The report does not expose session IDs, raw action histories, final boards, or free-text notes and is marked `noindex, nofollow`.

## 2026-09-23 — Report/schema initialization fix

### `89f9747` — Ensure report schema before read

The first report deployment revealed an initialization-order issue:

- provenance columns were added by the write-side schema readiness code;
- no post-provenance submission had yet occurred;
- therefore the existing Neon table still lacked `client_version` / `server_version`;
- the report tried to select those fields before a new write triggered migration.

The report read path now calls the same idempotent schema-readiness function before querying.

This can create or alter missing schema objects but does **not** modify existing submission result rows. After this fix, the production report successfully read the existing 12-row first-round dataset.

## First-round data-quality note

The first completed round contains 12 puzzle results from one anonymous session. It was completed while the UI was being modified across multiple deployments, before provenance tracking was available.

Treat it as:

- functional verification;
- an initial exploratory human sample;

but not as a clean formal calibration dataset.

See [research-methodology.md](research-methodology.md) for the formal interpretation rules.


## 2026-09-23 — Recover authoritative benchmark provenance

Recovered the original Difficulty v2 research artifacts from GitHub Actions rather than recomputing metrics under a newer algorithm.

Authoritative full-path artifact:

```text
artifact 10730213935
audit/difficulty-v2-fullpath-2.json
seed water-sort:difficulty-v2:research-3
generator 0.2.1
config aaa8ea23
```

Paired cap8 artifact: `10730528355`.

Board matching recovered the source candidates for B01–B12. The server-only mapping is stored in:

```text
data/benchmarks/difficulty-v2-benchmark-metrics-v1.json
```

## 2026-09-23 — Discover invalid B03 in benchmark v1

B03 corresponded to source candidate `expanded.easy.k4.c000008`.

The source contains two empty tubes and records a minimum requirement of two. The v1 blind manifest contained only one empty tube. The source solver's stored empty-tube analysis explicitly classifies the one-empty variant as unsolvable.

This explains why the first-round B03 result cannot be used as a normal human difficulty sample.

The raw result was not deleted or rewritten.

## 2026-09-23 — Benchmark v2 and human-vs-solver report

### `3f83302` — Add human-solver research mapping and benchmark v2

Changes:

- archived the original blind v1 snapshot server-side;
- changed the active public benchmark identity to `difficulty-v2-benchmark-v2`;
- restored the second B03 empty tube;
- kept B01–B12 IDs stable inside the new benchmark identity;
- allowed the submission API to validate both current v2 and legacy v1 clients;
- added server-only solver/source metrics;
- added benchmark switching to `/report`;
- added per-puzzle human + solver comparison;
- added Spearman correlation rows;
- automatically excludes invalid v1 B03 from correlations.

The benchmark version bump is intentional: v1 and v2 must never share the same database uniqueness namespace because B03 represents a different board.
