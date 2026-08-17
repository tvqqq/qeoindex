# Next-agent task handoff

Copy the block below into the next agent's task. Detailed architecture and operating knowledge live in `docs/HANDOVER.md`.

---

You are continuing work on StockOS in `/Users/quyentat/_www/qeoindex`.

## Read first

1. `AGENTS.md`
2. `docs/HANDOVER.md`
3. `docs/market-board.md`
4. `docs/security.md`

Do not discard, reset, or overwrite the current working tree. It contains the complete Top 100, EOD, index fallback, responsive six-group UI, tests, and handover work that is already running in production but is not yet consolidated into a commit.

## Current production state

- Stable URL: <https://stockos-beryl.vercel.app>
- Latest runtime deployment: `dpl_3ew1tRSCdQc9FKE2SgQN81Vv71ve`
- Notion is the source of truth for Top 100 membership, rank, market cap, and canonical sector.
- Board layout has six visual groups. Energy and Utilities render inside `Các ngành còn lại` without changing canonical sector values.
- Stock prices and mini charts persist after close using Yahoo EOD/latest-session fallback.
- VNINDEX, VN30, and HNXINDEX bootstrap from `/api/market/indexes`; DNSE overwrites when live.
- Stocks at or above +3% have a reduced-motion-safe green highlight.

## Objective

Stabilize the current release and reduce the highest-risk maintenance gaps. Work in the priority order below and do not start a later priority while an earlier one has unresolved correctness issues.

### P0 — Consolidate the current release

1. Review the entire dirty diff; separate user-owned/unrelated changes only when ownership is certain.
2. Confirm all Top 100 and sector/group changes match the documented Notion-source-of-truth behavior.
3. Run the full targeted validation suite listed below.
4. Produce a concise release diff summary.
5. Commit/push/open a PR only if the user explicitly authorizes those Git operations. Do not redeploy solely to consolidate Git history unless runtime code changes.

Acceptance criteria:

- No secrets or accidental local files in the diff.
- Top 100 remains capped at 100 and six board groups cover every canonical sector.
- Current production behavior is represented by the checked-out code.
- Validation results clearly distinguish targeted success from the pre-existing full-lint debt.

### P1 — Unify scanner history policy

There is a known mismatch:

- `lib/scanner-policy.ts`: 60–199 Daily bars → `Incomplete` with forced LOW confidence.
- `lib/scanner-runner.ts`: fewer than 200 bars → reject before writing.

First determine the intended product policy with the user. Then make the runner, persistence status, health endpoint, tests, and documentation agree. Do not silently choose one behavior.

Acceptance criteria:

- One canonical policy is used by the runner.
- Boundary tests cover 59, 60, 199, and 200 bars.
- Health output and UI wording match persistence behavior.
- Provider provenance remains visible.

### P2 — Add visual regression coverage

Add deterministic board checks for viewports near 390, 768, 1280/1440, and 1920 pixels.

Verify:

- Responsive grid is 1/2/3/6 columns at the intended breakpoints.
- All six group headers have equal height.
- No ticker, price, percentage pill, or mini chart is clipped.
- `#rank` is not visible.
- +3% highlight exists and respects `prefers-reduced-motion`.
- After-close fixtures show both price and mini chart.

Do not claim visual QA if browser tooling is unavailable; record the limitation and leave a reproducible command for the next environment.

### P3 — Complete index fallback

UPCOM-INDEX still relies on DNSE. Add a production-compatible EOD snapshot only if the provider can be verified from Vercel. SSI iBoard returned HTTP 403 from the Vercel datacenter even though it worked locally; a local-only success is insufficient.

Acceptance criteria:

- `/api/market/indexes` returns positive VNINDEX, VN30, HNXINDEX, and UPCOMINDEX values after close.
- The provider call has an explicit timeout and no credentials in the browser.
- A production smoke inspects actual values and error arrays, not only HTTP 200.

### P4 — Reduce lint debt in a separate change

Do not mix broad lint cleanup into market-data correctness work. First exclude only truly generated artifacts, then fix React purity/memoization errors in owned source files. The end goal is a trustworthy full `pnpm lint`, but report the existing baseline honestly until achieved.

## Required validation

```bash
pnpm test:universe
pnpm test:intraday
pnpm test:indexes
pnpm test:scanner-core
pnpm test:signal-core
pnpm exec eslint <all-touched-files>
pnpm typecheck
pnpm build --webpack
pnpm scan:secrets
git diff --check
```

If runtime behavior changes and deployment is authorized:

```bash
pnpm exec vercel --prod --yes
curl -sS https://stockos-beryl.vercel.app/api/market/indexes
```

Confirm the deployment is `READY`, the stable alias is updated, the home page returns successfully, and changed APIs contain valid data.

## Guardrails

- Never replace Notion membership with a hard-coded universe.
- Never expose DNSE, Notion, Finhay, scheduler, or infrastructure credentials through `NEXT_PUBLIC_*`, logs, documentation, or Git.
- Keep external calls bounded: provider timeout is normally 8 seconds; avoid unbounded fan-out.
- Preserve EOD display fallback and reject zero Yahoo OHLC placeholders.
- Preserve unrelated dirty-worktree changes.
- Do not claim a scanner batch is complete from progress output; query final persisted state.
- Do not report deployment success as a smoke test without checking the live page/API values.

## Final report format

1. Outcome first.
2. Files/behavior changed.
3. Tests, lint, typecheck, build, and secret-scan evidence.
4. Production deployment and live smoke evidence, if applicable.
5. Remaining risks or deferred priorities.

---
