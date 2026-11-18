# Claude Cowork / Claude Code — QeoIndex

@AGENTS.md

Read [AGENTS.md](./AGENTS.md) explicitly if your client does not expand the import above.

Start with [docs/HANDOVER.md](./docs/HANDOVER.md), especially **Claude Cowork: start here**. It contains the first-session sequence, product scope, engineering roles, code map, data flows, configuration/access, verification, release and troubleshooting. [docs/README.md](./docs/README.md) is the domain documentation map.

The existing owner checkout is `/Users/quyentat/_www/qeoindex`; remote [tvqqq/qeoindex](https://github.com/tvqqq/qeoindex). Verify the actual folder, branch and remote revision before editing. Preserve unrelated work.

Current tasks, priorities, blockers and acceptance belong in [Linear](https://linear.app/qeoindex/project/qeoindex-a1a694f2af52), not a new next-agent status file. Inspect the requested issue and comments; QEO identifiers may belong to other products.

The owner's engineering workflow is Astra Light (product/architecture) → Sol Light (technical spec) → Luna Max (implementation) → Sol Light (review/pairing) → Astra Light (acceptance). Keep handoffs compact; do not have every role redesign the same task. Report unavailable model/tool capabilities honestly.

Before UI work read [UI_LESSONS_LEARNED.md](./docs/UI_LESSONS_LEARNED.md). Before Next.js implementation read the installed version's `node_modules/next/dist/docs/` guides.

**Hosting discrepancy:** AGENTS and older runbook text names Vercel; QEO-45 records a Firebase production cutover on 2026-11-05. Read canonical HANDOVER and [hosting-firebase.md](./docs/hosting-firebase.md), verify current provider state before operational changes, preserve PR protection/CI-only/no-duplicate-deployment rules, and never re-enable a legacy scheduler just to match old text.

Use GitHub Actions for executable verification under the inline-only policy. Do not run shell, builds, tests, lint, typecheck or deploy commands by default. Do not read/copy real secret files into a report. Missing data must remain explicitly unavailable.

This file is an entry point; the sole repo-wide architecture handover remains `docs/HANDOVER.md`.
