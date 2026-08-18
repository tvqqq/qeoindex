# QeoIndex build performance

Baseline audited from the successful Vercel production build for commit `2f9def1` on 2026-08-18.

## Baseline

- Dependency install after cache restore: about 0.8s.
- Prebuild verification: about 16s.
- Turbopack compile: about 1.6s.
- Next.js TypeScript phase: about 2.7s.
- Build cache artifact: about 413.8 MB.
- Build-cache creation + upload: about 24.6s.

The dependency restore and Turbopack compile are already fast. The highest-ROI work is avoiding unnecessary deployments, avoiding duplicated verification, and persisting small tooling caches. Do not enable experimental Turbopack filesystem caching for production builds without measuring both compile time and cache artifact size; a larger cache upload can erase the compile-time gain.

## Build policy

1. `main` remains the only Vercel deployment branch.
2. Vercel may skip a deployment only when every changed file is non-runtime-only (documentation, tests, GitHub workflow configuration, or Supabase migrations). Unknown or mixed changes build conservatively.
3. Vercel `prebuild` runs the core regression suite, cached targeted ESLint, and the secret scan. It does not run a standalone `tsc --noEmit` because `next build` performs production TypeScript checking.
4. GitHub Verify remains the broader quality gate: full core regression suite, targeted ESLint, and standalone TypeScript checking.
5. GitHub uses pnpm with the repository-pinned version and caches both the pnpm store and small ESLint/TypeScript incremental artifacts.
6. CI cancels stale Verify runs when a newer commit supersedes the same PR or branch.
7. `.next/cache/eslint` and `.next/cache/typescript` are tooling caches. They must never become runtime source-of-truth data.

## Measuring changes

For a build optimization release, compare at least:

- dependency install duration;
- prebuild duration;
- Turbopack compile duration;
- Next TypeScript duration;
- total build duration;
- build cache artifact size and upload duration.

A change is not an optimization if it shortens compilation but materially increases total build + cache upload time.
