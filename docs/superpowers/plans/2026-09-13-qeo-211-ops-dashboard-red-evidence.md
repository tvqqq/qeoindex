# QEO-211 RED Evidence

This branch intentionally records the TDD RED checkpoint before production source exists.

Expected failing assertions on this head:

- `services/ops-dashboard/... must exist`
- `services/ops-dashboard/*` must be excluded from the public Vercel build-impact classifier
- health/Gatus semantics cannot be loaded until their source files exist

The failure is expected to come from `tests/build-impact.test.ts`, which is already registered in the canonical fast suite. No production QEO-211 source exists on this checkpoint.
