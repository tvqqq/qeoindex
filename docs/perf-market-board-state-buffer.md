# Market board state buffering

Date: 2026-08-21

This focused performance change reduces React and sorting work on the realtime Top 100 board without changing the visible board structure, screenshot DOM, or data-source contract.

## Runtime model

- DNSE frames are still queued through `requestAnimationFrame`.
- Live quote objects are written into a ref-backed quote store without cloning the full quote map for every tick.
- React receives a shallow quote-map snapshot at most every 250 ms (~4 Hz).
- Sector and Top Movers ordering use a separate quote snapshot refreshed at most once per second.
- Five-minute history updates mutate the ref-backed history map per ticker and only clone the outer map at the next UI commit.
- Browser `/api/market/intraday` bootstrap is skipped on first mount when SSR already supplied at least 95% of the universe with usable multi-point history. Session rollover still forces a refresh.

## Why

The previous 100 ms commit loop could cause up to ~10 parent board renders per second. Sector and mover sorting also followed the live quote map, so ordering work was repeated at that rate even though users do not need ranking to reshuffle on every trade tick.

The new contract prioritizes:

1. live prices remain visually responsive (~4 Hz);
2. sector/mover ordering remains fresh (~1 Hz);
3. per-tick processing avoids full quote-map clones;
4. SSR history is reused instead of issuing a redundant browser bootstrap request.

## Validation

Required before merge:

- `pnpm test:board-contract`
- `pnpm test:core`
- `pnpm lint:touched`
- `pnpm typecheck`
- production `pnpm build`
- production browser smoke after the normal `main` Git deployment.
