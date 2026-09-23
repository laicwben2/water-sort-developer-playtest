# Next Steps / Handoff

Last updated: 2026-09-23

## Current state

Production application:

```text
https://water-sort-developer-playtest.vercel.app
```

Research report:

```text
https://water-sort-developer-playtest.vercel.app/report
```

Repository:

```text
laicwben2/water-sort-developer-playtest
```

Current completed capabilities:

- blind developer playtest for benchmark B01–B12;
- anonymous browser-local sessions;
- deterministic randomized order per session;
- solve/give-up workflow with structured feedback;
- server-side validation and action replay;
- Neon upsert storage;
- client/server git provenance for new samples;
- read-only aggregate report with version filtering.

The existing first round contains 12 results from one session and predates provenance capture. It is exploratory rather than a clean calibration set.

## Immediate next stage: human-vs-solver correlation

Do **not** add solver metrics to the blind tester UI.

The next implementation should create a server-side analysis join between:

1. human results in `water-sort-developer-playtest`; and
2. solver/generator metrics for B01–B12 from `laicwben2/water-sort-level-generator`.

### Step 1 — Locate authoritative solver metrics

Identify the exact source artifact/version that generated or evaluated the current benchmark snapshot.

For each `benchmarkId`, capture available authoritative fields such as:

- optimal/minimum move count, if computed;
- search node count / expansions;
- search depth;
- branching-related features;
- restart/dead-end-related solver features, if available;
- existing generator difficulty score/components;
- solver/generator git commit or artifact version.

Do not infer or recompute fields under a different algorithm without recording that distinction.

### Step 2 — Create a server-only metric mapping

Join by `benchmarkId`.

The solver mapping must not be included in `public/benchmark.json` or otherwise shipped to the tester-facing client.

Prefer a server-side data module or protected research artifact that makes the solver version explicit.

### Step 3 — Extend the report without collapsing measures too early

Start with side-by-side descriptive columns rather than a single composite score.

Useful comparisons include:

- perceived difficulty vs optimal moves;
- perceived difficulty vs solver search effort;
- completion rate vs solver metrics;
- solved-only time vs solver metrics;
- restarts vs solver metrics;
- frustration vs solver metrics;
- give-up incidence vs solver metrics.

Confidence should be available as context/weighting information, but raw and weighted analyses should both remain inspectable.

### Step 4 — Correlation analysis

Because the current human rating is ordinal 1–5 and early sample sizes will be small, prefer rank-based correlation such as Spearman as the initial descriptive statistic.

Do not treat one tester's 12 ratings as model validation.

Report at minimum:

- sample size used for each correlation;
- missing-value handling;
- whether rows are per-attempt or aggregated per puzzle;
- correlation statistic;
- solver metric version;
- human client-version filter.

### Step 5 — Collect a clean calibration round

Before making calibration decisions:

- freeze the tester UI and wording;
- confirm new samples record `client_version`;
- collect multiple independent sessions;
- avoid production UI changes during that collection period.

The current first round can remain visible in the report as legacy/unknown but should be separable from the clean calibration cohort.

## Documentation rule going forward

For changes that can affect research interpretation, update documentation in the same development step.

At minimum document changes to:

- tester-visible UI geometry or interaction behavior;
- timer, move, or restart semantics;
- feedback wording or scale definitions;
- persistence/upsert rules;
- schema/provenance behavior;
- benchmark contents;
- solver metrics or solver version;
- report aggregation formulas;
- data-quality assumptions.

Small cosmetic/code-maintenance changes that cannot affect measurement interpretation can remain in commit history only.
