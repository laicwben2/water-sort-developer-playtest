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
- no source difficulty, solver metrics, or optimal-move metadata.

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

Resubmitting the same session/puzzle updates the existing row instead of adding a duplicate sample.
