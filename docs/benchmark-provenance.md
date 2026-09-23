# Benchmark Provenance

Last updated: 2026-09-23

## Authoritative source

The B01–B12 Difficulty v2 benchmark was selected from the research batch identified by:

```text
batch seed: water-sort:difficulty-v2:research-3
profile: expanded
generator: 0.2.1
config fingerprint: aaa8ea23
```

Authoritative full-path GitHub Actions artifact:

```text
artifact ID: 10730213935
file: audit/difficulty-v2-fullpath-2.json
```

Paired cap8 research artifact:

```text
artifact ID: 10730528355
file: audit/difficulty-v2-research-3.json
```

The checked-in server-only metric manifest is:

```text
data/benchmarks/difficulty-v2-benchmark-metrics-v1.json
```

It is not placed under `public/` and is not sent to the blind tester UI.

## B01–B12 source mapping

| Benchmark | Source difficulty | Source candidate | Source empty tubes | Minimum required | v1 research-valid |
| --- | --- | ---: | ---: | ---: | --- |
| B01 | hard | c000002 | 2 | 2 | yes |
| B02 | easy | c000006 | 1 | 1 | yes |
| B03 | easy | c000008 | 2 | 2 | **no** |
| B04 | medium | c000004 | 2 | 2 | yes |
| B05 | hard | c000005 | 1 | 1 | yes |
| B06 | easy | c000002 | 1 | 1 | yes |
| B07 | medium | c000002 | 2 | 2 | yes |
| B08 | medium | c000007 | 1 | 1 | yes |
| B09 | hard | c000009 | 2 | 2 | yes |
| B10 | hard | c000001 | 2 | 2 | yes |
| B11 | medium | c000003 | 1 | 1 | yes |
| B12 | easy | c000005 | 2 | 2 | yes |

B01, B02 and B04–B12 match the source boards exactly.

B03's filled tubes match source candidate `expanded.easy.k4.c000008`, but the v1 blind snapshot omitted one of the two empty tubes. The source artifact proves the one-empty variant unsolvable.

## Benchmark identities

### v1 — legacy exploratory

```text
difficulty-v2-benchmark-v1
```

The original first developer round used this identity. It remains queryable in the research report. B03 is retained as raw evidence but excluded from human-vs-solver correlation.

### v2 — active corrected benchmark

```text
difficulty-v2-benchmark-v2
```

The only puzzle geometry change from v1 is B03: the second required empty tube is restored.

Using a new benchmark identity prevents v2 results from overwriting or aggregating with v1 rows whose B03 board differs.

## Metric interpretation

The metric manifest preserves source-side measurements such as:

- optimal moves;
- solver explored/visited/generated states;
- solver average branching;
- decision/forced steps;
- total alternatives and path choices;
- wrong-move density;
- dead-end density/risk;
- recovery penalties.

For v1 B03, source metrics describe the correct two-empty source board, not the invalid one-empty blind board, so they are not joined into correlation.
