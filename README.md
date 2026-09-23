# Developer Playtest Web

Standalone Next.js App Router frontend for blind Water Sort developer playtests.

Current scope:

- anonymous browser-local session ID;
- deterministic per-session randomized puzzle order;
- blind benchmark loading;
- classic-v1 pour interaction;
- per-puzzle timer;
- cumulative legal-move count across restarts;
- restart action history;
- automatic solved detection;
- explicit give-up confirmation and structured reasons;
- 1–5 perceived-difficulty rating plus optional confidence/frustration;
- saved completed/gave-up results in browser localStorage using the v2 result shape;
- anonymous POST submission to Neon Postgres with upsert per session + puzzle;
- server-side v2 validation plus full classic-v1 action replay before persistence;
- automatic background re-submit of locally saved results after reload;
- client/server git provenance for newly persisted samples;
- read-only aggregated research report at `/report`, filterable by client version;
- no source difficulty, solver metrics, or optimal-move metadata in the blind playtest UI.

Only finished/gave-up puzzles with submitted feedback are persisted. Reloading during an active puzzle discards that in-progress attempt.

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:3000.

The benchmark snapshot is copied into `public/benchmark.json` so the app can later be deployed independently from the generator runtime.

## Submission storage

The API route `POST /api/submissions` requires:

```text
DATABASE_URL=postgresql://...
```

Provision Neon through the Vercel Marketplace when the app is deployed. The database client is initialized lazily, so `next build` succeeds before `DATABASE_URL` exists.

The API creates `playtest_submissions` and its benchmark index on first successful request. Rows are keyed by:

```text
(session_id, benchmark, benchmark_id)
```

Resubmitting the same session/puzzle updates the existing row instead of adding a duplicate sample. The first recorded `client_version` and `server_version` remain attached to that row when later background re-submissions update the result payload.

## Research report

Open `/report` for a server-rendered, read-only view over the Neon submissions table.

It includes:

- sample and anonymous-session counts;
- solve rate;
- per-puzzle median elapsed time and solved-only median elapsed time;
- median move count and average restart count;
- average perceived difficulty, confidence, and frustration;
- give-up reason aggregation;
- filtering by `client_version`, with pre-provenance rows grouped as legacy/unknown.

The report intentionally exposes aggregate research data only. It does not show session IDs, individual action histories, final boards, or free-text give-up notes. Solver metrics and human-vs-solver correlation are intentionally deferred to the next research stage.
