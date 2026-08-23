# Next-agent task handoff

Copy the block below into the next agent's task. Detailed architecture and operating knowledge live in `docs/HANDOVER.md`.

---

You are continuing work on QeoIndex in `/Users/quyentat/_www/qeoindex`.

## Read first

1. `AGENTS.md`
2. `docs/HANDOVER.md`
3. `docs/market-board.md`
4. `docs/security.md`
5. For Insights work: `docs/insights-homepage.md`, then `docs/insights-handover.md`

Do not discard, reset, or overwrite unrelated work. The Top 100/EOD/index-fallback/six-group market-board release is already consolidated on `main`; the scanner-policy and board-regression improvements live on `codex/next-agent-improvements` until merged.

## Current production state

- Product: QeoIndex — `Đọc thị trường. Giữ kỷ luật.`
- Official domain: <https://qeoindex.qeoqeo.com>
- Legacy Vercel fallback alias: <https://stockos-beryl.vercel.app>
- The existing Vercel project slug `tvqqq/stockos` is an infrastructure identifier, not the public product brand.
- Main release includes the consolidated Top 100 HOSE board and handoff documentation.
- Notion is the source of truth for Top 100 membership, rank, market cap, and canonical sector.
- Board layout has six visual groups. Energy and Utilities render inside `Các ngành còn lại` without changing canonical sector values.
- Stock prices and mini charts persist after close using Yahoo EOD/latest-session fallback.
- VNINDEX, VN30, and HNXINDEX bootstrap from `/api/market/indexes`; DNSE overwrites when live.
- Stocks at or above +3% have a reduced-motion-safe green highlight.
- Scanner history policy is unified on the improvement branch: fewer than 60 completed Daily bars are rejected; 60–199 bars persist as `Incomplete` with forced `LOW` confidence; 200 or more bars persist as `Complete`.
- Same-date scanner persistence is monotonic: `Incomplete` may upgrade to `Complete`, but an existing `Complete` result is never automatically downgraded because a provider later returns less history.
- `pnpm build` runs `test:core`, targeted lint for the touched scanner/UI files, explicit TypeScript, and the tracked-source secret scan before Next.js compilation.
- Production deployment is Git-driven: only `main` is deployment-enabled and Vercel Git Integration is the normal production deployment mechanism.
- `/insights` is authenticated for all signed-in users. Its daily KFSP-derived snapshots, five-axis heuristic, design contract, current limitations, and operations runbook are indexed from `docs/insights-homepage.md`.

## Priority status

### P0 — Consolidate the current release — COMPLETE on `main`

The Top 100, EOD fallback, index snapshot, responsive six-group UI, tests, and docs are represented in Git history. Continue to preserve Notion as the universe source of truth and do not reintroduce a hard-coded production membership list.

### P1 — Unified scanner history policy — IMPLEMENTED on improvement branch

Canonical policy:

- fewer than 60 completed Daily bars → reject before persistence;
- 60–199 completed Daily bars → persist as `Incomplete` and force `LOW` confidence;
- 200 or more completed Daily bars → persist as `Complete` and use normal engine confidence.

The runner, persistence status type, health endpoint, scanner UI wording, and docs use the same policy. Provider provenance remains visible. Same-date persistence allows `Incomplete → Complete` upgrades and prevents `Complete → Incomplete` downgrades caused by transient provider-history regression.

Tests cover 59, 60, 199, 200 and same-date monotonic status behavior.

### P2 — Board regression coverage — SOURCE CONTRACT IMPLEMENTED; BROWSER VISUAL QA STILL PENDING

`tests/market-board-visual-contract.test.ts` deterministically protects:

- 1/2/3/6 column responsive contract at the intended breakpoints;
- exactly six board groups;
- fixed 72px group-header height;
- stock-row clipping guards and hidden rank;
- +3% highlight and `prefers-reduced-motion` fallback;
- after-close price + mini-chart fallback wiring.

The test runs inside `test:core` and therefore before every `pnpm build`.

This is source-contract regression coverage, not pixel/screenshot QA. When browser tooling is available, add real viewport screenshots near 390, 768, 1280/1440, and 1920 pixels and verify visible clipping/layout. Do not claim visual QA until that is run.

### P3 — Complete UPCOM index fallback — DEFERRED

UPCOM-INDEX still relies on DNSE. Add a production-compatible EOD snapshot only if the provider can be verified from Vercel. SSI iBoard returned HTTP 403 from the Vercel datacenter even though it worked locally; a local-only success is insufficient.

A temporary TradingView candidate-symbol probe was created and then removed; preview deployment protection prevented a reliable Vercel response, so no unverified UPCOM provider was added to runtime code.

Acceptance criteria remain:

- `/api/market/indexes` returns positive VNINDEX, VN30, HNXINDEX, and UPCOMINDEX values after close.
- The provider call has an explicit timeout and no credentials in the browser.
- A production smoke inspects actual values and error arrays, not only HTTP 200.

### P4 — Reduce full lint debt — DEFERRED / SEPARATE CHANGE

Do not mix broad lint cleanup into market-data correctness work. Targeted lint for the files touched by this improvement is enforced before build; repository-wide lint debt remains a separate task.

## Required validation

```bash
pnpm test:core
pnpm lint:touched
pnpm typecheck
pnpm scan:secrets
pnpm build --webpack
git diff --check
```

`test:core` expands to:

```bash
pnpm test:universe
pnpm test:intraday
pnpm test:indexes
pnpm test:scanner-core
pnpm test:signal-core
pnpm test:board-contract
```

## Git and production release

Normal release flow:

```text
feature/work branch
  -> validate locally
  -> commit + push branch
  -> PR / squash or merge once into main
  -> Vercel Git Integration auto-deploys main
  -> verify deployment READY
  -> smoke qeoindex.qeoqeo.com and changed APIs
```

Important rules:

- Do not run `vercel --prod`, `vercel deploy --prod`, a Deploy Hook, or another manual production deployment after pushing/merging the same release to `main`.
- Use Vercel tooling to inspect deployment status/logs; inspection must not create another deployment.
- Do not redeploy just to smoke-test or verify an existing release.
- A manual production deployment is exceptional recovery only and requires explicit user authorization plus confirmation that Git auto-deploy will not also run for that release.
- If Vercel returns a deployment quota/rate-limit error, stop retrying and report the blocked release.
- Target invariant: one approved release merged to `main` → one Vercel production deployment.

After the Git-triggered deployment reaches `READY`:

```bash
curl -sS https://qeoindex.qeoqeo.com/api/market/indexes
```

Confirm the official domain serves the release, the legacy fallback alias still works if retained, the home page returns successfully, and changed APIs contain valid data.

## Guardrails

- Never replace Notion membership with a hard-coded universe.
- Never expose DNSE, Notion, Finhay, scheduler, or infrastructure credentials through `NEXT_PUBLIC_*`, logs, documentation, or Git.
- Keep external calls bounded: provider timeout is normally 8 seconds; avoid unbounded fan-out.
- Preserve EOD display fallback and reject zero Yahoo OHLC placeholders.
- Preserve unrelated dirty-worktree changes.
- Do not claim a scanner batch is complete from progress output; query final persisted state.
- Do not report deployment success as a smoke test without checking the live page/API values.
- Do not claim screenshot/pixel visual QA from source-contract tests alone.
- Preserve legacy technical identifiers when changing them would invalidate sessions or integrations; public branding remains QeoIndex.
- Never create both a Git-triggered and manual Vercel production deployment for the same release.
- Never retry production deployment in a loop after a Vercel quota/rate-limit error.

## Final report format

1. Outcome first.
2. Files/behavior changed.
3. Tests, lint, typecheck, build, and secret-scan evidence.
4. Production deployment and live smoke evidence, if applicable.
5. Remaining risks or deferred priorities.

---
