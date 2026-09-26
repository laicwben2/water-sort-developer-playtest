# Research Methodology

Last updated: 2026-09-26

This document defines how the Water Sort developer playtest data should be collected and interpreted. It is deliberately stricter than the UI implementation notes so later calibration work can distinguish valid samples from exploratory ones.

## Research objective

The current playtest measures human-perceived puzzle difficulty and behavioral outcomes without exposing source labels or solver metadata to the tester.

The blind UI must not show:

- source Easy / Medium / Hard labels;
- optimal move count;
- solver search metrics;
- generator difficulty features that could bias the tester.

The next research stage will compare the human measurements described here with solver/generator metrics in a server-side analysis path.

## Unit of observation

A persisted sample represents one anonymous browser session's submitted result for one benchmark puzzle.

Database uniqueness is:

```text
(session_id, benchmark, benchmark_id)
```

Re-submitting the same session and puzzle updates that row instead of creating a second sample.

Only a puzzle that is either solved or explicitly given up and then has feedback submitted is persisted.

## Recorded measurements

Each result contains:

- `outcome`: `solved` or `gave-up`;
- `elapsedMs`: elapsed puzzle time;
- `moves`: cumulative legal moves, including moves before restarts;
- `restarts`: number of explicit puzzle restarts;
- `actions`: replayable move/restart history;
- `finalBoard`: final board when feedback was submitted;
- `perceivedDifficulty`: required 1–5 human difficulty rating;
- `confidence`: optional 1–5 confidence in the difficulty rating;
- `frustration`: optional 1–5 frustration rating;
- `giveUpReasons`: structured reasons when outcome is `gave-up`;
- `giveUpNote`: optional free-text note.

### Perceived difficulty

`perceivedDifficulty` is the tester's direct rating:

- 1 = very easy;
- 2 = easy;
- 3 = medium;
- 4 = difficult;
- 5 = very difficult.

### Confidence

`confidence` is specifically confidence in the **difficulty rating**, not general confidence in solving ability.

UI definition:

> 1 = 很不確定，5 = 很確定這個難度評分能代表你的實際感受

A low confidence score means the difficulty rating should be treated as less certain. It does not mean the tester was less confident while playing.

### Frustration

`frustration` is optional and independent from perceived difficulty. A puzzle can be difficult without being frustrating and vice versa.

## Give-up reasons

Structured values currently include:

- `no-next-move`;
- `likely-dead-end`;
- `repeated-restarts`;
- `too-many-choices`;
- `taking-too-long`;
- `no-longer-fun`;
- `other`.

The report may aggregate these codes, but free-text `giveUpNote` is intentionally not exposed in the public aggregate report.

## Timing and move-count interpretation

The research report distinguishes:

- **median elapsed time**: all submitted outcomes, including give-ups;
- **solved-only median elapsed time**: only `solved` samples.

This separation is required because time spent before giving up is not equivalent to solution time.

`moves` is cumulative across restarts. It therefore reflects the tester's total interaction cost, not merely the move count of the final successful attempt.

## Version provenance

New submissions record:

- `client_version`: the git commit loaded by the browser;
- `server_version`: the production commit receiving the submission.

Both use the Vercel git commit SHA in production and `local-dev` locally.

For an existing row, later background re-submission updates the result payload but does not overwrite the initially recorded provenance. This preserves the version under which that session/puzzle sample first entered the database.

Rows created before provenance tracking remain `NULL`. They must be labeled legacy/unknown rather than assigned a guessed version.

## First playtest round caveat

The first completed 12-puzzle developer round on 2026-09-23 occurred while the UI was still being refined. It crossed multiple production deployments, including changes to game-area presentation and confidence wording.

Consequences:

- the round is useful for functional verification;
- it is useful as an initial human sample;
- it is **not** a clean formal calibration dataset;
- its individual rows predate provenance capture and therefore cannot be reliably assigned to exact UI commits.

Do not backfill guessed `client_version` or `server_version` values for these rows.

For formal calibration, collect a new round after the UI and measurement wording are frozen and provenance tracking is active.

## Report interpretation

The current `/report` page is descriptive only. It should not be treated as a calibrated difficulty model.

Particular caution is required when sample count is small:

- percentages can be dominated by a single tester;
- average 1–5 ratings are not interval-scale ground truth;
- completion time is highly player-dependent;
- restarts and give-up behavior may carry information distinct from completion time;
- confidence should be considered when interpreting subjective difficulty.

The report intentionally does not expose anonymous session IDs, action histories, final boards, or free-text notes.

## Formal calibration conditions

Before treating human-vs-solver results as calibration evidence:

1. Freeze the benchmark snapshot and playtest wording.
2. Use a production version with working `client_version` / `server_version` provenance.
3. Avoid changing board scale, interaction affordances, or feedback definitions during the sample-collection round.
4. Collect multiple independent sessions per puzzle.
5. Keep raw human measures separate from derived composite difficulty scores.
6. Join solver/generator metrics outside the blind tester UI.
7. Record the exact solver/generator version used to compute comparison metrics.


## Benchmark v1 defect and v2 correction

During the first human-vs-solver provenance recovery, B03 was traced to the authoritative research-3 source puzzle:

```text
expanded.easy.k4.c000008
```

Source provenance:

- full-path GitHub Actions artifact: `10730213935`;
- paired cap8 artifact: `10730528355`;
- batch seed: `water-sort:difficulty-v2:research-3`;
- generator version: `0.2.1`;
- config fingerprint: `aaa8ea23`.

The source puzzle has two empty tubes and records:

```text
minimumRequiredEmptyTubes = 2
```

Its stored empty-tube analysis proves the same filled board with one empty tube is `unsolvable`.

The v1 blind manifest accidentally copied B03 with only one empty tube. Therefore:

- v1 B03 is an invalid benchmark sample;
- its human result remains stored for audit purposes;
- v1 B03 must be excluded from calibration/correlation;
- no solver metrics from the two-empty source board may be interpreted as metrics for the one-empty v1 board.

The active tester benchmark is now `difficulty-v2-benchmark-v2`. It restores B03's second empty tube and uses a new benchmark identity so new samples cannot upsert into or mix with v1 rows.

All other B01–B12 v1 boards matched their research-3 source boards exactly.

## Human-vs-solver correlation

The research report now joins human aggregates with a server-only metric manifest derived from artifact `10730213935`.

The initial analysis uses Spearman rank correlation because the main subjective difficulty measure is ordinal and sample counts are small.

The report currently compares selected pairs including:

- subjective difficulty vs source Easy/Medium/Hard;
- subjective difficulty vs optimal moves;
- subjective difficulty vs wrong-move density;
- subjective difficulty vs dead-end density/risk;
- subjective difficulty vs solver average branching;
- solved-only time vs optimal moves;
- solved-only moves vs optimal moves;
- restarts vs dead-end density.

Correlation rows state their effective puzzle count. For v1, B03 is automatically excluded.

These statistics are exploratory. Multiple independent v2 sessions are still required before using them for difficulty calibration.


## Give-up engagement / attempt-depth interpretation

A `gave-up` outcome is not automatically evidence that the puzzle itself is difficult.

Difficulty interpretation must consider how much interaction occurred before the player gave up. In particular, a short attempt with near-zero legal moves and no or very few restarts may reflect:

- uncertainty about the rules or how to begin;
- interface/onboarding friction;
- low engagement or willingness to continue;
- interruption;
- or genuine puzzle difficulty.

Those causes cannot be separated from the outcome code alone.

Therefore, raw give-up samples must always be retained, but difficulty analysis should distinguish at least three conceptual attempt-depth groups:

- **minimal attempt** — very limited interaction before give-up;
- **meaningful attempt** — enough play to provide some evidence about puzzle difficulty;
- **sustained attempt** — substantial interaction/restarts before give-up.

Exact thresholds are not fixed yet. They should be defined from observed elapsed time, legal-move count, and restart behavior before being used as an exclusion/weighting rule. Do not retroactively delete raw samples.

### 2026-09-26 early-give-up examples

After the first complete v2 session, two additional anonymous sessions submitted one result each.

Production aggregates imply:

- **B03**: the additional sample gave up after approximately 21 seconds, with **0 legal moves** and **1 restart**, rated difficulty **5**, and selected `no-next-move`;
- **B12**: the additional sample gave up after approximately 37 seconds, with **2 legal moves** and **0 restarts**, rated difficulty **4**, and selected `no-next-move`.

These are useful behavioral/onboarding observations, but they are weak evidence that B03 or B12 are intrinsically difficult. They should not be treated the same way as a sustained failed attempt such as a player spending several minutes, making many moves, and repeatedly restarting.

Until an explicit attempt-depth rule is implemented, interpret correlations containing these early give-ups cautiously and inspect the underlying time/move/restart pattern before drawing a difficulty conclusion.
