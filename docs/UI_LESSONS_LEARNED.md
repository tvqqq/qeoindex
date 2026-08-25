# UI Lessons Learned — QeoIndex

This document records production-facing UI lessons that every agent must follow when changing QeoIndex interfaces. These are engineering constraints, not optional style preferences.

## Incident: Wyckoff chart screen jitter after `ef28dd6`

Commit `ef28dd6abf53582db2e419df74b25312b628d83f` refreshed the `/insights/wyckoff` shell without changing the Wyckoff calculation or Lightweight Charts data pipeline. The visible regression appeared after the new shell introduced several expensive presentation effects around an auto-sized canvas chart:

- a large `backdrop-blur-2xl` / `backdrop-filter` surface;
- multiple CSS `filter: drop-shadow(...)` effects in the same header;
- page-root font changes that enlarged the layout/font-recalculation scope;
- newly visible dynamic Next.js links using automatic prefetch while the chart runtime was mounting;
- a broad `transition-all` instead of transitions limited to the properties that actually change.

The fix kept the visual hierarchy but removed the compositor-heavy effects, restored scoped typography, disabled eager prefetch for the new dynamic links, and narrowed transitions.

## Mandatory UI performance rules

### 1. Treat realtime, chart, canvas, and dense-table screens as performance-sensitive by default

Pages containing Lightweight Charts, canvas, realtime quote updates, order books, large tables, or frequently updating dashboards must be designed for stable paint/compositing first. Decorative effects are secondary.

Agents **must not** add large persistent `backdrop-filter` / `backdrop-blur-*` surfaces on, above, or immediately beside those regions unless browser profiling proves they are safe. Prefer opaque/semi-opaque backgrounds, borders, gradients, and normal `box-shadow`.

### 2. Avoid CSS `filter` on large or frequently updating UI

Do not use `filter: drop-shadow(...)`, blur, brightness, or similar filter stacks on large containers, canvas neighbors, realtime rows, or elements that repaint often. These effects can force extra compositor work.

For static emphasis prefer, in order:

1. border / background contrast;
2. small bounded `box-shadow`;
3. gradients;
4. CSS `filter` only when the visual benefit is material and performance has been measured.

### 3. Scope typography; do not move decorative fonts to a page root casually

If a font treatment is needed for a ticker, title, score, or heading, apply it to that component. Do not add a font class to a large page root solely to style a few child elements. Root-level font changes can expand font loading, metric recalculation, and layout work across hundreds of nodes.

### 4. Never use `transition-all` in performance-sensitive UI

Transitions must name the properties being animated, for example `transition-colors`, `transition-opacity`, or an explicit transform transition. Do not animate dimensions, layout, filters, shadows, or backdrop effects on dense/realtime/chart screens unless the interaction explicitly requires it and has been profiled.

Animation libraries and template examples from shadcn, SmoothUI, or other sources are references, not permission to copy expensive effects unchanged.

### 5. Prefer transform/opacity for motion and keep animation areas bounded

When animation is useful:

- prefer `transform` and `opacity`;
- keep the animated region small;
- avoid continuous animations on large backgrounds;
- avoid layout-driven animation around an auto-sized chart/canvas;
- honor `prefers-reduced-motion`;
- do not update React state on every pointer move when CSS variables or direct bounded DOM effects are sufficient.

### 6. Dense dynamic-link collections must not auto-prefetch every route

QeoIndex already experienced route-prefetch storms on dynamic research pages. Any dense list/table of ticker links must use `prefetch={false}` or the project intent-prefetch helper instead of default viewport prefetch.

Even a small number of new dynamic links placed beside a heavy chart should be reviewed: background RSC/network work during chart mount can worsen responsiveness. Disable automatic prefetch unless there is a demonstrated navigation benefit.

### 7. Chart containers need stable layout

For canvas/Lightweight Charts/Recharts-heavy sections:

- keep container width/height stable during mount;
- avoid ancestor layout animation;
- avoid large backdrop/filter layers overlapping the chart;
- do not remount the chart because of cosmetic state changes;
- preserve stable keys and object references where practical;
- avoid changing surrounding font metrics after chart initialization.

A visual effect that causes the browser to repeatedly resize/recompose a chart is a bug even if React render counts look normal.

### 8. Do not optimize only React; inspect browser paint/compositor cost

A screen can jitter with no obvious React render loop. When investigating UI performance, inspect all four layers:

1. React renders/state updates;
2. layout/style recalculation;
3. paint/compositing/GPU layers;
4. background navigation/network work.

Do not conclude that a regression is "the chart library" until the surrounding CSS and route behavior have been compared against the last known-good commit.

For realtime session boundaries, clearing only visible React state is insufficient. Clear ref-backed stores and client caches too, then guard every in-flight hydration callback so an older REST/Supabase response cannot repopulate stale data after the reset.

### 9. Visual fidelity never overrides interaction stability

If a mockup uses blur, glow, filter stacks, oversized shadows, animated gradients, or other expensive decoration, reproduce the **visual hierarchy and intent**, not necessarily the exact rendering primitive.

On QeoIndex, stable scrolling, chart interaction, low CPU/GPU usage, and readable market data have higher priority than decorative fidelity.

### 10. Performance regressions require a guardrail

When fixing a UI performance regression, add a deterministic regression guard where possible. Examples:

- source-level test preventing eager prefetch in dense dynamic lists;
- test preventing reintroduction of known expensive header effects;
- component-level memoization/render contract test;
- documented profiling acceptance criteria when automated verification is not practical.

Do not rely only on a comment saying "do not change this".

## Required review checklist for every UI change

Before an agent marks UI work complete, it must explicitly review:

- Does this add `backdrop-filter`, blur, CSS `filter`, large shadows, continuous animation, or `transition-all`?
- Is any such effect near a chart, canvas, realtime board, order book, or dense table?
- Did a typography change increase the scope from a component to an entire page/root?
- Did new `next/link` elements introduce automatic prefetch for many dynamic routes or during a heavy page mount?
- Could the change resize/remount an auto-sized chart after initialization?
- Are animations limited to transform/opacity and bounded regions?
- Is `prefers-reduced-motion` respected where motion is non-essential?
- Is there a regression test or documented browser profiling result for a previously observed performance issue?

If any answer indicates material risk, the agent must simplify the implementation or profile it before merge.

## Definition of done for performance-sensitive UI

A code/build pass is necessary but not sufficient. For material changes to a realtime/chart-heavy screen, the release should also be visually checked in a real browser at the relevant viewport. If browser profiling is available, inspect main-thread activity and compositor/layer behavior during initial mount, scroll, hover, chart interaction, and route navigation.

The expected default is: **no visible jitter, no repeated layout shift, no uncontrolled prefetch burst, and no decorative effect that materially increases CPU/GPU load.**
