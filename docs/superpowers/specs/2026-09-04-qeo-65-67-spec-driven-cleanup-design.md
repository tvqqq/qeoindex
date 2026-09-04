# QEO-65 / QEO-66 / QEO-67 Spec-Driven Cleanup Design

## Status

Approved architecture direction: **Deletion-first, Spec-governed, Modularize-last**.

This document is the canonical design contract for the QEO-65 cleanup program and its QEO-66 / QEO-67 workstreams. It defines what may be deleted, what must be protected, how tests and build gates are reshaped, and how surviving code is reorganized into domain modules.

Implementation must not infer cleanup decisions from filenames, historical issue numbers, age, or size alone. Deletion requires evidence against this current-state contract.

## Goal

Reduce QeoIndex to the smallest maintainable production code/data surface that preserves current product behavior and operational safety.

The program optimizes four outcomes together:

1. **Source size** — remove superseded runtime code, compatibility wrappers, stale architecture docs/config and duplicate implementations.
2. **Database size** — drop zero-consumer legacy objects and aggressively bound transient/staging/build-artifact data while preserving canonical evidence.
3. **Build/verification time** — remove superseded tests, consolidate duplicate regressions, and decouple release verification from artifact compilation.
4. **Architecture clarity** — regroup only surviving code into explicit domain modules with narrow public APIs and documented data ownership.

Git history is the historical archive. Dead runtime code does not remain on `main` merely to preserve historical context.

## Program decision

The execution order is fixed:

```text
CURRENT-ARCHITECTURE SPEC + BASELINES + DELETION MANIFEST
                         │
                         ▼
QEO-66 — canonical tests / CI-build contract
                         │
                         ▼
QEO-65 — legacy source/docs/config deletion
                         │
                         ▼
QEO-65 — zero-consumer schema/data deletion + retention tightening
                         │
                         ▼
QEO-67 — regroup surviving code into domain modules
                         │
                         ▼
FULL VERIFY + PRODUCTION SMOKE + BEFORE/AFTER METRICS
```

### Why this order

- Moving files before deletion makes obsolete code look canonical and obscures whether regressions come from behavior changes or path movement.
- Destructive cleanup must not outrun the current safety net; QEO-66 establishes the current production contracts first.
- Database cleanup is based on ownership and consumer proof, not table size.
- Module migration is cheaper and safer after the survivor set is minimized.
- Build optimization is treated as an explicit release contract rather than an accidental side effect of fewer files.

## Verified starting state — 2026-09-04

### Repository and test surface

At the start of this design:

- `tests/` contains 97 TypeScript test files.
- `supabase/migrations/` contains 84 SQL migrations.
- `package.json` exposes both `test:eod-v2` and `test:eod-v3`.
- `test:core` still invokes `test:eod-v3` although the active production workflow is EOD v4.
- `lint:touched` is a long hardcoded list of individual root-level files across unrelated domains.
- `lib/` contains large flat naming families such as `ai-council-*`, `qeoindex-eod-*`, `wyckoff-v2-*`, market/history/provider helpers, signals/scanner, portfolio, research and adapters.
- Some current source files still re-export functions from `*-legacy` compatibility files.

### Build path

Current package behavior:

```text
pnpm build
  → prebuild
    → verify:build
      → test:core
      → db:drift:verify
      → lint:touched
      → scan:secrets
  → next build
```

GitHub Verify already runs secrets, tests, targeted regressions, lint, TypeScript and a production `next build` on pull requests.

Therefore the artifact build currently repeats significant verification work that belongs in repository gates.

### Canonical documentation drift

`AGENTS.md` directs engineers/agents to `docs/HANDOVER.md` as canonical architecture, but the handover still describes EOD v3 and active Drive/Notion archive assumptions that no longer match the accepted EOD v4 design.

This drift is a cleanup defect because stale canonical documentation can regenerate removed architecture in future changes.

The program must make the current spec authoritative and update fast-start documentation to match it before cleanup is considered complete.

### Current EOD architecture facts relevant to cleanup

The active EOD workflow is Supabase-first EOD v4 and includes:

- trading-day gate;
- same-session KFSP Rating refresh;
- parallel bounded TTAI refresh and market-close collection;
- canonical READY gate;
- bounded Daily-history refresh;
- per-ticker fault isolation and PARTIAL completion;
- Wyckoff build / validate / publish;
- deterministic AI Council;
- Market Synthesis before LLM Council;
- analytical Notion summary rather than per-ticker operational archive;
- retention cleanup;
- no Google Drive dependency in the active daily graph.

Persistent Wyckoff raw history is Daily-only; Weekly is derived deterministically from Daily.

### High-confidence legacy source candidates

The current tree contains, among others:

- `modules/eod/archive-legacy.ts` — old per-ticker Notion archive and Google Drive service-account / signing / gzip / upload behavior.
- `modules/eod/workflow-steps-legacy.ts` — old EOD flow/shared compatibility implementation, including superseded phase/version semantics.
- `modules/eod/archive.ts` — current wrapper that still imports/re-exports legacy archive APIs and carries deprecated compatibility inputs.
- `modules/eod/workflow-steps.ts` — current implementation that still re-exports selected functions from the legacy workflow file.

These are candidates, not automatic deletions. Surviving current behavior must first be lifted into current modules, then unused legacy implementation is removed.

### Production database baseline

Read-only production baseline at design time:

- total database size: approximately 203.4 MB;
- public table/index/TOAST footprint: approximately 187.5 MB;
- public tables: 49;
- `market_ohlcv_history`: approximately 144.6 MB / 357.8k rows.

The largest table is canonical Daily history and is explicitly protected from size-driven cleanup.

Potential cleanup/retention review candidates include:

| Object | Approximate footprint / rows at baseline | Initial classification |
| --- | ---: | --- |
| `wyckoff_build_artifacts` | ~9.2 MB / 1,600 | transient build artifact; retention candidate |
| `kfsp_rating_raw_evidence` | ~3.6 MB / 1,200 | evidence; retention candidate |
| `wyckoff_chart_series` | ~3.2 MB / 200 | active read model; consumer proof required |
| `ai_council_llm_evidence` | ~2.9 MB / ~400 | analytical evidence; retention spec required |
| `kfsp_universe_candidate_snapshots` | ~1.7 MB / 3,504 | provider selection evidence; retention candidate |
| `market_insight_snapshot_staging` | ~1.6 MB / ~826 | staging; aggressive retention candidate |
| `eod_archive_checkpoints` | 0 rows | strong DROP candidate after dependency proof |
| `market_ohlcv_archive_ranges` | 0 rows | old cold-archive concept; revalidate against current storage contract |

These figures are baselines only. They do not authorize destructive changes.

## Source-of-truth hierarchy for engineering

After this program lands, architecture guidance must resolve in this order:

1. current approved design/specs in `docs/superpowers/specs/`;
2. current `AGENTS.md` and `docs/HANDOVER.md` fast-start summaries;
3. current module contracts/readmes;
4. implementation and generated schema types;
5. historical plans, migrations and Git history.

Historical handovers/plans may remain only when clearly labeled historical and excluded from current-agent orientation.

No canonical document may describe an inactive scheduler, storage backend or orchestration path as current.

## Definition of legacy

An asset is **legacy** only when all relevant conditions are true:

1. the current approved spec does not assign it an active responsibility;
2. no active runtime/build/test/deploy path requires it;
3. no current DB dependency or scheduled job requires it;
4. any still-valid behavior it previously provided has a canonical replacement;
5. production evidence/history required for current operation or audit does not depend on retaining the asset.

Names such as `legacy`, `v2`, `v3`, old issue IDs, old dates or low row counts are evidence hints, not deletion proof.

## Cleanup classification

Every source/test/schema/data candidate must receive one decision:

### KEEP

Current canonical responsibility remains necessary.

### REWRITE / CONSOLIDATE

The responsibility remains valid but the implementation, test shape, naming or ownership boundary is obsolete.

### MOVE

Current implementation is valid but belongs under a different module. Movement occurs primarily in QEO-67 after cleanup.

### DELETE SOURCE

The runtime/test/doc/config asset has no active responsibility after replacement proof.

### DROP SCHEMA

A table/view/RPC/column/index/trigger/scheduled job has no active consumer and is not required for current evidence or recovery.

### PRUNE / RETENTION

The object remains current but historical/transient rows can be bounded by a documented retention window.

### PROTECTED

The asset cannot be removed/pruned under this program without a separately approved storage/recovery design.

## Deletion manifest

QEO-65 implementation must maintain one reviewed deletion manifest. Every destructive item includes:

| Field | Required content |
| --- | --- |
| Asset | file, route, env, table, column, view, RPC, trigger, cron, test, doc or dependency |
| Owning module | current canonical domain |
| Current responsibility | what it does today, if anything |
| Active consumers | source search + runtime/schedule + DB dependency evidence |
| Replacement | canonical implementation or `none` |
| Production data | rows, bytes, oldest/newest where relevant |
| Decision | keep / rewrite / move / delete / drop / prune / protected |
| Risk | low / medium / destructive |
| Rollback | Git revert, migration recovery, backup or replay strategy |
| Verification | exact tests/queries/smoke gates that prove the decision |

### Destructive DB gate

A destructive DB action requires all of the following:

- zero active application consumer proof;
- database dependency inspection for views, functions, triggers, foreign keys and scheduled jobs;
- explicit data value/retention determination;
- backup/recovery evidence appropriate to the object;
- migration written without `CASCADE` unless a separately reviewed dependency set explicitly requires it;
- generated Supabase types regenerated;
- migration replay/drift checks green;
- production smoke after apply.

## Protected state

The cleanup program must not delete or prune merely for size:

- canonical Daily `market_ohlcv_history` needed by the active model;
- data required to derive completed Weekly bars from Daily;
- current auth, profile, preference, watchlist and portfolio state;
- current canonical universe and same-session market evidence;
- current operational telemetry needed for run health / PARTIAL / retry behavior within approved retention;
- current Wyckoff / AI Council evidence required by the analytical or audit contract;
- migration ledger/equivalence information required for production drift reconciliation;
- secrets/credential infrastructure currently required by active providers.

Raw Daily history pruning requires a separate cold-backup/hydration/restore design with restore proof; it is outside this program.

## QEO-66 — canonical test and release-verification design

### Purpose

QEO-66 creates the smallest trusted safety net that protects current production behavior before destructive cleanup begins.

The target is not “fewest tests”. The target is “no obsolete or duplicate tests while every current invariant remains protected”.

### Test classification

Every existing test is mapped to one bucket:

#### A. Canonical contract — KEEP

Protects a current product/runtime/data/security invariant.

Examples include:

- auth/RLS/security boundaries;
- canonical Top Stocks 200 selection/membership;
- same-session EOD v4 lineage;
- bounded concurrency and PARTIAL/retry semantics;
- Daily-only OHLCV + deterministic Weekly contract;
- Wyckoff build/validate/publish membership and count;
- deterministic → Market Synthesis → LLM Council ordering;
- AI Council evidence and persistence;
- Admin capability/auth/telemetry;
- Signals coverage;
- portfolio/accounting correctness.

#### B. Current invariant, historical shape — REWRITE / CONSOLIDATE

The bug invariant still matters but the test is tied to an old helper, old filename, issue number, exact source string, or superseded implementation boundary.

The invariant is moved into the owning current module contract before the historical test is deleted.

#### C. Superseded architecture — DELETE

Only protects behavior removed by current spec, such as:

- EOD v2/v3 orchestration as a production contract;
- active Google Drive archive;
- per-ticker operational Notion archive;
- old five-timeframe Wyckoff expectations;
- compatibility wrappers removed by QEO-65.

#### D. Duplicate invariant — MERGE / DELETE

No distinct failure mode beyond another current contract.

#### E. Recovery/migration safety — KEEP OUT OF FAST PATH

DB replay, destructive recovery and deep drift verification may remain required but do not belong in every artifact build.

### Test manifest

Before deleting tests, QEO-66 records:

| Test | Owning module | Invariant | Bucket | Replacement | Runtime cost | Decision |
| --- | --- | --- | --- | --- | ---: | --- |

All 97 starting test files must be classified.

### Target test topology

Script names must describe current domains rather than historical architecture versions.

Conceptual target:

```text
test:fast
  current fast contracts for auth, market, signals, admin, portfolio and shared critical logic

test:eod
  current EOD v4 contracts only

test:ai
  AI Council + Market Synthesis current contracts

test:db
  schema/RLS/RPC/generated-types current contracts

test:ui-contracts
  deterministic UI/performance contracts

test:db:replay
  zero-to-latest migration replay and drift

test:recovery
  destructive recovery rehearsal

verify:pr
  secrets + fast/current suites + lint + typecheck + targeted DB contract

verify:full
  verify:pr + migration replay/drift + full current integration contracts

build
  next build only
```

Exact script names may vary, but active `test:eod-v2` and `test:eod-v3` production contracts must disappear.

### Build contract

The desired release model is:

```text
PULL REQUEST
  secrets
  current tests
  lint
  typecheck
  DB safety checks
  production next build
        │
        ▼
REQUIRED CHECKS GREEN
        │
        ▼
MERGE TO MAIN
        │
        ▼
VERCEL ARTIFACT BUILD
  next build
```

`pnpm build` / Vercel must not rerun the full test + DB drift + lint + secret suite through `prebuild` once those checks are protected by required repository gates.

This is a relocation of verification responsibility, not a reduction in release safety.

### Build optimization restrictions

- Do not remove a verification step unless its replacement gate is active first.
- Do not rely on developers remembering to run a local command before merge.
- Required CI must fail closed for current contracts.
- Production deployment remains Git-triggered from `main` only.
- Do not claim build-speed improvement without before/after timing evidence.

## QEO-65 — source/docs/config cleanup design

### Wave S0 — architecture truth

Before broad deletion:

- update `docs/HANDOVER.md` to current EOD v4/storage/test/module facts;
- ensure `AGENTS.md` points only at current architecture guidance;
- clearly mark or remove historical docs that conflict with current-agent orientation;
- remove stale env/config descriptions for capabilities that no longer exist.

Historical migration comments may remain when required to understand replay history, but must not be presented as current operational guidance.

### Wave S1 — EOD archive compatibility removal

Target direction:

1. identify still-current functions imported/re-exported from `qeoindex-eod-archive-legacy.ts` and `qeoindex-eod-workflow-steps-legacy.ts`;
2. lift current behavior into current EOD / post-analysis / retention modules;
3. remove deprecated Notion/Drive parameters and exports;
4. prove no active Drive archive dispatch/import/env contract remains;
5. prove no active per-ticker Notion operational archive remains;
6. delete legacy files after zero current consumers.

No permanent `legacy/` folder is created.

### Wave S2 — versioned implementation cleanup

Versioned filenames such as `*-v2-*` or `*-v3-*` are reviewed individually.

If the version is merely historical and only one implementation remains, rename/move under the canonical module in QEO-67.

If the version denotes a real protocol/data-format contract still meaningful externally, preserve the version identifier.

### Wave S3 — dead routes/config/env/dependencies

For each deleted capability:

- remove inactive route adapters;
- remove unused environment variables;
- remove stale package/config/scripts;
- remove no-longer-used dependencies only after import/build proof;
- remove docs/tests that exist solely for the deleted capability.

## QEO-65 — database/schema/data cleanup design

### DB ownership rule

Every surviving public table/view/RPC/trigger/cron receives one primary owning module. Cross-module readers are allowed only through documented contracts.

An object with no owning current module is a deletion candidate.

### First destructive candidates

#### `eod_archive_checkpoints`

Baseline: zero rows.

Expected path:

- prove current EOD v4 and Admin no longer read/write it;
- prove remaining references are legacy/historical/generated only;
- inspect DB dependencies;
- remove legacy code reference;
- drop object with an explicit migration;
- regenerate DB types;
- verify replay/drift and production EOD/Admin health.

#### `market_ohlcv_archive_ranges`

Baseline: zero rows.

This object originated from the old Drive/Plan-C cold archive concept. It is not dropped solely because it is empty.

Drop is allowed only if the current approved storage contract has no cold-archive coverage-ledger responsibility and no current/future recovery path in the approved design depends on it.

### Retention candidates

Objects that remain current may receive tighter retention rather than DROP.

Priority review categories:

- build artifacts;
- staging rows;
- provider raw evidence with expiry semantics;
- candidate-selection snapshots;
- LLM evidence where analytical/audit requirements allow bounded history;
- job telemetry beyond operational troubleshooting/retry windows.

For each table the retention spec must define:

- purpose;
- minimum useful history;
- current consumers;
- legal/audit/recovery need if any;
- cleanup key/timestamp;
- deletion frequency;
- expected steady-state row/byte bound.

### Space reclamation measurement

Post-delete table size does not always fall immediately because PostgreSQL may retain allocated pages.

Acceptance metrics distinguish:

- logical rows deleted;
- table live/dead tuple state;
- actual relation bytes after appropriate maintenance;
- total database bytes before/after.

Do not report a database-size improvement until actual bytes are measured.

### Migration history

The current 84 migration files are not a first-wave cleanup target.

Reasons:

- they contribute negligible production DB size;
- production ledger/equivalence reconciliation depends on known history;
- destructive squashing can make clean replay and drift diagnosis less trustworthy.

A future baseline/squash is allowed only after cleanup if:

- zero-to-baseline-to-latest replay is deterministic;
- production migration ledger remains unambiguous;
- recovery rehearsal passes;
- measurable CI/build benefit justifies the risk.

That decision requires a separate approved design.

## QEO-67 — target module architecture

QEO-67 reorganizes only the surviving current implementation after QEO-66 and the first QEO-65 deletion waves.

### Principles

1. Group by domain responsibility, not generic technical layer.
2. Each module exposes a small deliberate public API.
3. Server/client boundaries are explicit.
4. `app/**` pages/routes remain thin Next.js adapters.
5. Workflows orchestrate modules; they do not duplicate domain logic.
6. Every DB object has a primary module owner.
7. No legacy namespace is created.
8. No generic `utils/` dumping ground is created.
9. Historical version names are removed when they no longer carry real semantic meaning.
10. Lower-level domains must not import EOD orchestration internals.

### Target shape

Conceptual target:

```text
modules/
  auth/
  market/
    universe/
    realtime/
    history/
    providers/
  kfsp/
  wyckoff/
  ai-council/
  signals/
  eod/
  admin/
  portfolio/
  research/
  notion/          # only if current analytical integration remains justified
  shared/          # only truly cross-domain primitives

workflows/
  eod/
  signals/
  ai/

app/
  ... Next.js pages/routes as adapters

supabase/
  migrations/
  functions/
```

### Public API rule

Each domain exposes deliberate entry points, for example:

```text
modules/market/index.ts
modules/wyckoff/index.ts
modules/ai-council/index.ts
```

These entry points do not blindly barrel-export all internals. They define the supported cross-module API.

Internal files may import sibling internals. Cross-module consumers should import public contracts where practical.

### Module contract

Each module records:

- purpose;
- public API;
- server/client runtime boundary;
- owned DB objects;
- owned jobs/workflows;
- upstream/downstream dependencies;
- canonical tests;
- forbidden dependencies;
- retention/data ownership.

### Dependency direction

Target mostly acyclic dependency graph:

```text
auth ────────────────────────────────┐
market ──┬─→ kfsp ───────────────────┤
         ├─→ wyckoff ────────────────┤
         └─→ signals ────────────────┤
                                      ├─→ eod → admin telemetry
kfsp + wyckoff ─→ ai-council ────────┘

portfolio → market read APIs
research  → canonical read APIs
```

EOD is an orchestrator and must not become a foundational dependency.

### Module migration waves

#### M0 — freeze survivor set

- QEO-66 current contracts are active.
- first QEO-65 legacy deletion wave is complete.
- canonical docs describe current architecture only.

#### M1 — low-coupling domains

Move clearer boundaries first, such as auth/portfolio/admin primitives, while preserving behavior.

#### M2 — market/KFSP/signals

Consolidate provider/history/universe ownership and scanner/signal contracts.

#### M3 — Wyckoff + AI Council

- move current functionality under canonical module ownership;
- rename obsolete historical version identifiers;
- split oversized mixed-responsibility files behind stable public APIs.

#### M4 — EOD

Move EOD v4 orchestration only after dependency modules have stable APIs.

Do not recreate compatibility re-export chains.

#### M5 — adapters/tests/tooling

- update `app/**` and workflows to module APIs;
- physically regroup canonical tests by domain ownership;
- remove hardcoded giant `lint:touched` enumeration in favor of module-aware or normal repository linting;
- update architecture maps.

### Move discipline

For each move:

1. prove owning module;
2. remove dead exports first;
3. move with minimal semantic change;
4. update imports;
5. run owning-module contracts;
6. run affected integration contracts;
7. measure lint/typecheck/build effect where relevant.

If legacy behavior is discovered during a move, it returns to the QEO-65 deletion manifest instead of being preserved inside the new module.

## Implementation work breakdown

After this design is reviewed, the implementation plan should decompose into independently reviewable releases rather than one big-bang PR.

Recommended release units:

1. **QEO-66A — test inventory + current EOD v4 contract consolidation**
2. **QEO-66B — CI/build gate split + fast/full suite topology**
3. **QEO-65A — canonical docs + high-confidence legacy source removal**
4. **QEO-65B — zero-consumer DB object drop wave**
5. **QEO-65C — retention tightening + DB byte measurement**
6. **QEO-67A — low-coupling module migration**
7. **QEO-67B — market/KFSP/signals migration**
8. **QEO-67C — Wyckoff/AI migration**
9. **QEO-67D — EOD migration + adapter/tooling cleanup**
10. **Final acceptance — full CI, DB replay/drift, production smoke, before/after metrics**

The exact PR count may differ, but destructive DB work and broad path movement must not be combined into the same release unless the implementation plan proves that separation is impossible.

## Verification gates

### Per source/test cleanup release

- current owning-module contracts green;
- affected integration contracts green;
- lint/typecheck green;
- source search proves removed runtime symbols have no active consumers;
- `next build` green.

### Per DB cleanup release

- source zero-consumer proof;
- DB dependency query proof;
- row/byte baseline captured;
- migration applies locally from current state;
- zero-to-latest replay green;
- migration drift/equivalence green;
- generated types match;
- production apply succeeds;
- production smoke verifies affected modules;
- post-apply row/byte state recorded.

### Per module migration release

- public behavior unchanged unless separately specified;
- no new cross-module cycles introduced;
- external consumers use supported module API;
- owning-module tests + affected integration tests green;
- TypeScript and production build green.

## Production smoke contract

Final program acceptance must cover at least:

- auth/session and protected API access;
- canonical Top Stocks 200 universe;
- market board / market insight critical reads;
- Signals daily coverage;
- EOD v4 scheduler/dispatch ownership and current phase behavior;
- same-session KFSP/TTAI/market evidence;
- bounded history refresh;
- Wyckoff 1D/1W publish contract;
- PARTIAL/ticker retry telemetry path;
- deterministic AI Council;
- Market Synthesis before LLM Council;
- analytical Notion summary where configured;
- Admin jobs/telemetry/retry UI contract;
- portfolio critical flows.

A cleanup release must not create an extra scheduler owner, duplicate data writer, hidden compatibility write-through, or stale archive phase.

## Metrics and success criteria

Capture before/after for the entire program and, where useful, each release wave.

### Source metrics

- tracked source file count;
- source LOC;
- number of active `*-legacy` files;
- number of historical-version production filenames (`v2`/`v3`) remaining with justification;
- number of root-level `lib/*.ts` files;
- number of cross-module imports after QEO-67.

### Test/CI metrics

- test file count;
- test LOC;
- `test:fast` duration;
- `test:eod` duration;
- full verification duration;
- TypeScript duration;
- lint duration;
- count of superseded/duplicate tests removed.

### Build metrics

- local `next build` duration;
- `pnpm build` duration before/after prebuild split;
- Vercel build duration;
- cache behavior where observable.

### Database metrics

- database total bytes;
- public table bytes;
- per-cleaned-object bytes;
- rows deleted/dropped;
- steady-state row/byte bound for retained transient tables.

### Required program outcomes

- current architecture source of truth contains no active EOD v3/Drive archive claim;
- no active production code remains in `*-legacy` compatibility files unless explicitly justified by this spec amendment;
- no active EOD v2/v3 test script remains;
- every starting test has a documented keep/rewrite/delete/merge decision;
- every destructive DB action is in the reviewed deletion manifest;
- protected canonical Daily history remains intact;
- `pnpm build` no longer performs the full verification suite through prebuild once CI gates are active;
- module boundaries are explicit and current docs match them;
- DB replay/drift/generated types remain trustworthy;
- final production smoke passes;
- before/after source, DB and build metrics are recorded.

## Rollback and recovery policy

### Source/test/module changes

Rollback through Git revert of the specific release commit/PR.

Compatibility code is not retained indefinitely as a rollback mechanism. If a release is unsafe, revert the release rather than keeping two active architectures.

### DB schema changes

Before destructive migrations:

- capture object definition and dependency evidence;
- preserve required data according to the deletion manifest;
- use explicit inverse/recovery procedure where feasible;
- rehearse destructive recovery when the object carries material state.

Do not use `CASCADE` as a convenience rollback or cleanup mechanism.

### Data retention changes

Retention changes begin with bounded conservative windows and observable cleanup. If consumers prove they require more history, adjust the retention contract before further pruning.

## Non-goals

This program does not:

- redesign investment/analysis algorithms merely to reduce code size;
- prune canonical Daily OHLCV history;
- introduce a new cold-storage architecture;
- change portfolio/accounting semantics;
- change the canonical maximum universe from 200;
- change current Wyckoff 1D/1W analytical semantics except where required to remove dead compatibility code;
- weaken auth/RLS/security gates;
- squash production migration history in the first cleanup program;
- preserve dead code in a new `legacy/` module;
- claim performance gains without measurements.

## Issue ownership

### QEO-65 — parent cleanup program

Owns:

- deletion manifest;
- canonical-doc cleanup;
- legacy source/config/env/dependency removal;
- schema/object drop decisions;
- transient retention tightening;
- final source/DB/build measurements and program acceptance.

### QEO-66 — test/build safety contract

Owns:

- classification of all starting tests;
- current contract consolidation;
- removal of superseded/duplicate tests;
- current test script topology;
- CI verification ownership;
- removal of heavy verification from artifact prebuild after required gates exist.

### QEO-67 — module architecture

Owns:

- final domain-module paths;
- public APIs;
- dependency direction;
- physical movement/rename of surviving code/tests;
- removal of root-level file sprawl and hardcoded lint topology;
- current module architecture documentation.

## Design acceptance checklist

This design is ready for implementation planning when the reviewer confirms:

- [x] cleanup order is deletion-first and module movement is last;
- [x] current architecture, not historical naming, determines legacy status;
- [x] canonical Daily OHLCV is protected;
- [x] destructive DB work requires zero-consumer/dependency/recovery proof;
- [x] tests are classified by current invariant before deletion;
- [x] build verification moves to required CI before being removed from prebuild;
- [x] current docs must stop describing EOD v3/Drive as active;
- [x] migration squashing is excluded from the first cleanup wave;
- [x] final modules expose deliberate APIs and avoid a legacy namespace;
- [x] before/after source, build, test and DB metrics are mandatory.

Once this written spec is reviewed, the next step is a detailed implementation plan. No production cleanup should start before that plan is approved.