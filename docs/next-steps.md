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

Active benchmark:

```text
difficulty-v2-benchmark-v2
```

Completed:

- blind playtest workflow and Neon persistence;
- client/server provenance for new samples;
- authoritative B01–B12 solver provenance recovered from GitHub Actions artifact `10730213935`;
- server-only solver metric mapping;
- B03 v1 defect identified and documented;
- v2 benchmark created with corrected B03;
- legacy v1 retained separately;
- report benchmark/client-version filtering;
- per-puzzle human + solver comparison;
- Spearman correlation view;
- v1 B03 automatic exclusion from correlation.

## First-round interpretation

The first v1 round has 12 raw puzzle results from one anonymous session.

It is exploratory only because:

1. the UI changed across several deployments;
2. rows predate client-version provenance;
3. B03 was an invalid one-empty unsolvable variant.

Do not use the 12-row v1 set as formal calibration evidence.

The remaining 11 valid v1 puzzles can still be used for exploratory human-vs-solver pattern inspection.

## Immediate next step: collect clean v2 human samples

The main engineering prerequisite for correlation is now implemented.

Next research work is to collect a clean cohort on v2:

- keep the tester UI and wording frozen during the round;
- verify each new row has `client_version` and `server_version`;
- collect multiple independent sessions per puzzle;
- avoid changing benchmark geometry during collection;
- periodically inspect correlation stability by client-version cohort.

Do not interpret one tester's correlation coefficients as model validation.

## After enough v2 samples

Evaluate which solver metrics remain stable predictors across people.

Candidates currently surfaced in the report include:

- optimal moves;
- wrong-move density;
- dead-end density/risk;
- solver branching;
- source difficulty class.

Only after multi-session evidence should the generator difficulty model or Easy/Medium/Hard thresholds be adjusted.

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
- report aggregation/correlation formulas;
- data-quality assumptions.

Small cosmetic/code-maintenance changes that cannot affect measurement interpretation can remain in commit history only.
