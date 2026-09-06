# QEO-122 — Free Corporate-Action Source Evidence (2026-09-06)

## Decision

**GO — use current VSDC public corporate-action pages (`https://vsdc.vn`) as the primary free source candidate for QEO-123 canonical ingestion.**

This decision is bounded to the evidence below. The legacy `www.vsd.vn` host is **not** a production dependency. Any event/date outside the verified parser/calendar regime remains fail-closed until separately proven.

## Scope and non-production boundary

QEO-122 is a source-validation spike only. The probe under `scripts/probes/qeo122-*` is intentionally non-production and must not be imported by runtime surfaces. This spike does not create the canonical `corporate_actions` schema, does not rewrite Daily OHLCV, and does not implement adjustment factors.

Final tested code head before this docs-only evidence update: `771c1b8cbedacc12366088d4984c08f20abb3fef`.

Fresh verification evidence on that exact code head:

- GitHub Actions `QEO-122 Probe` run **#27**, run id `34031368375`: **success**.
- `probe-regressions` job `101481374301`: **success**.
- `live-source-matrix` job `101481414199`: **success**.
- Generic `Verify` run **#2389**, run id `34031368222`: **success** including tracked/PR/ref secret scans, repo hygiene, contracts, touched lint, TypeScript and production build.
- GitHub CodeQL check `101481428596`: **success**, `No new alerts in code changed by this pull request`.
- Live evidence artifact: `qeo122-live-source-matrix`, artifact id `9988719130`.
- Artifact digest: `sha256:3c52eb4f1bd041cb8f99a711a88a9738e059c200986d33907f40abb05d240cd3`.
- Live matrix generated at `2026-09-06T11:50:49.263Z`.

The branch was also synchronized with current `main` before this final run; PR #345 was mergeable and the shared `.gitleaksignore` / `tests/market-data-contract.test.ts` drift was removed from the PR diff so QEO-122 remains isolated to dedicated probe/evidence files.

## Final gate table

| Required gate | Result | Evidence |
| --- | --- | --- |
| historical retained-scope coverage | **PASS** | Retained VHM listed-history events from 2018–2026 are represented and the six verified VHM record dates reproduce the retained ex-date sequence. |
| cash terms | **PASS** | VHM 2019 `1,000 VND/share`, VHM 2021 `1,500`, VHM 2022 `2,000`, VHM 2026 `6,000`, plus HNX/UPCOM samples parse exactly. |
| stock terms | **PASS** | VHM 2018 source ratio `1.000:250` is preserved semantically as `1000:250`; VHM 2021 `1000:300`; VHM 2026 `1:1`. |
| rights terms | **PASS** | YTC UPCOM event `169561`: ratio `100:210`, subscription price `20,000 VND`. |
| multi-action notice identity | **PASS** | VHM event `144349` remains one source notice with two normalized components: cash `1,500` and stock `1000:300`. |
| parser live-DOM compatibility | **PASS** | Labels whose values render on adjacent lines are parsed without weakening exact-label matching. |
| entity decoding safety | **PASS** | Numeric entities parse correctly and nested named entities are decoded exactly once; CodeQL reports no new PR alerts. |
| ex-date determinism | **PASS** | Explicit `record_date_previous_verified_trading_session` derivation against the versioned Vietnam trading calendar; unknown regime/uncovered/invalid dates return `null`. |
| amendment identity | **PASS** | SNC correction event `199110` explicitly references notice `1515/TB-CNVSDC` dated `2026-08-06`; original event `198978` is independently retrievable twice. |
| HOSE/HNX/UPCOM coverage | **PASS** | HOSE: VHM; HNX: TDN `150529`; UPCOM: THN `151827` and YTC `169561`. |
| operational accessibility | **PASS** | All required current-host cases fetched twice with HTTP 200, stable semantic fingerprints and no observed HTTP 429/rate-limit response. |
| generic repo verification | **PASS** | Verify #2389 passed secrets, hygiene, contracts, lint, TypeScript and production build. |

**All required rows PASS => QEO-122 GO.**

## Live-source matrix

Fetch policy used by the final successful run:

- attempts per source: `2`
- inter-request delay: `300 ms`
- timeout: `20,000 ms`
- redirects: disabled for the bounded source allowlist probe
- network targets: compile-time literal allowlist
- required source cases: `10`

Final summary emitted by the probe:

```json
{
  "sourceCount": 10,
  "requiredPairsPass": true,
  "amendmentOriginalPass": true,
  "allRequiredLiveGatesPass": true,
  "anyRateLimited": false,
  "rawBodyDriftCount": 10
}
```

### VHM retained history

| VSDC event | Action | Record date | Parsed terms | Source update timestamp |
| --- | --- | --- | --- | --- |
| `50366` | stock dividend | 2018-10-09 | `1000:250` | `2018-10-02T16:05:48+07:00` |
| `57987` | cash dividend | 2019-08-09 | `1,000 VND/share` | `2019-08-02T16:20:11+07:00` |
| `144349` | cash + stock dividend | 2021-09-16 | `1,500 VND/share` + `1000:300` | `2021-09-07T14:27:48+07:00` |
| `150909` | cash dividend | 2022-06-01 | `2,000 VND/share` | `2022-05-20T17:38:42+07:00` |
| `197086` | cash dividend | 2026-06-30 | `6,000 VND/share` | `2026-06-19T09:42:40+07:00` |
| `198392` | stock dividend | 2026-08-07 | `1:1` | `2026-07-21T16:29:39+07:00` |

All six VHM pages returned HTTP 200 on both final-run attempts and produced identical semantic fingerprints across the pair.

### Cross-exchange / rights coverage

| VSDC event | Ticker | Exchange | Record date | Parsed terms |
| --- | --- | --- | --- | --- |
| `150529` | TDN | HNX | 2022-06-01 | cash `1,400 VND/share` |
| `151827` | THN | UPCOM | 2022-07-15 | cash `866 VND/share` |
| `169561` | YTC | UPCOM | 2024-04-16 | rights `100:210`, price `20,000 VND` |

These pages also returned HTTP 200 twice and remained semantically stable.

## Historical `ex_date` derivation

The spike uses a deliberately bounded derivation contract:

- regime: `verified-record-minus-one-trading-session-v1`
- method: `record_date_previous_verified_trading_session`
- calendar version: `vn-securities-calendar-2018-2026-v1`
- exchanges: HOSE / HNX / UPCOM only
- date must be covered by the verified Vietnam securities trading calendar
- unsupported regime, uncovered date, invalid exchange or unproven/non-trading record-date input => `null`

Verified retained VHM sequence:

| Record date | Derived `ex_date` |
| --- | --- |
| 2018-10-09 | 2018-10-08 |
| 2019-08-09 | 2019-08-08 |
| 2021-09-16 | 2021-09-15 |
| 2022-06-01 | 2022-05-31 |
| 2026-06-30 | 2026-06-29 |
| 2026-08-07 | 2026-08-06 |

Representative HNX/UPCOM regression cases are also covered. No modern-rule guess is allowed outside the proven interval/regime.

## Identity, duplicate and amendment semantics

### Stable source identity

- Primary source identity is the **numeric VSDC event id** extracted from the event URL.
- The same numeric id is preserved across historical path/host aliases such as `/vi/ad/...`, `/vi/ad1/...`, `vsdc.vn`, and legacy `vsd.vn` forms.
- `sourceUpdatedAt` is provenance metadata, not the dedupe key.
- `rawTextHash` is evidence/audit metadata, not the business identity.

### Amendment lineage

SNC correction event `199110` parses an explicit correction relationship rather than guessing from text similarity:

- ticker: `SNC`
- amendment type: `correction`
- referenced notice: `1515/TB-CNVSDC`
- referenced notice date: `2026-08-06`
- source update timestamp: `2026-08-11T11:10:33+07:00`
- original event probe: `198978`
- original independently returned HTTP 200 twice and matched expected body evidence.

QEO-123 should therefore model amendments as explicit provenance/lineage, not overwrite events solely by ticker/date similarity.

## Parser stability and security findings fixed during the spike

The gates found real defects before GO:

1. Vietnamese thousands-separated ratio operand `1.000` was initially interpreted as decimal `1`; regression now preserves it as `1000`.
2. VSDC encodes Vietnamese characters with numeric HTML entities; hexadecimal and decimal entities are parsed so labels and `sourceUpdatedAt` remain available.
3. Parsing the entire rendered page allowed related-news content to contaminate main-action classification; action parsing is now scoped to the main notice body before related-news/footer markers.
4. The VHM 2021 notice proves a single VSDC notice can contain multiple action components; parsing preserves both rather than collapsing them.
5. A security hardening refactor initially assumed same-line `label: value` markup and broke 9/10 live notices. A RED regression captured VSDC's adjacent-line label/value rendering; exact-label parsing now accepts only the immediately adjacent value when the inline value is empty.
6. CodeQL identified a possible double-unescape path in the HTML decoder. A RED regression proves `&amp;lt;...&amp;gt;` is decoded once, and named `&amp;` is now decoded last. Final CodeQL reports no new alerts in PR changes.

Dedicated QEO-122 regressions cover these cases and passed in Probe #27.

## Raw HTML drift and semantic stability

Every final live pair had a different raw HTML hash (`rawBodyDriftCount = 10`). The page includes dynamic request/page token material, so raw-byte equality is not a valid source-stability requirement.

The GO gate separates:

- **raw body hash:** retained for evidence/audit, expected to drift;
- **semantic fingerprint:** normalized source identity + parsed material terms, required to remain stable across the pair.

All required final pairs were semantically stable.

## Rate-limit / robots / operational constraints

Observed in final Probe #27:

- no HTTP 429 response across the bounded 2x matrix;
- all required current-host action pages returned HTTP 200 twice;
- `https://vsdc.vn/robots.txt` returned HTTP 302 with location `/vi/robots.txt` while redirects were intentionally disabled for the probe;
- legacy `https://www.vsd.vn/robots.txt` failed from the GitHub Actions environment;
- therefore no claim is made that a machine-readable robots policy grants unlimited crawling, and public accessibility is not treated as a license;
- legacy `vsd.vn` is **not** selected as a production dependency.

This does not prove unlimited request capacity. QEO-123 ingestion should remain conservative: bounded concurrency, retry/backoff for transient network/5xx/429 responses, caching/idempotency by numeric event id, and no high-frequency crawling requirement.

## QEO-123 handoff requirements

The source gate is GO, but QEO-123 must preserve the proven constraints:

1. current source host: `vsdc.vn`;
2. canonical source identity: numeric VSDC event id + exact source URL;
3. preserve one source notice to many action components;
4. preserve `sourceUpdatedAt`, raw source hash and amendment lineage as provenance;
5. do not use raw HTML equality as event identity;
6. derive `ex_date` only within an explicitly versioned/verified calendar regime; otherwise fail closed;
7. ingestion must be idempotent and amendment-aware;
8. retain conservative request throttling/backoff;
9. no dependency on legacy `vsd.vn` availability.

## Final recommendation

**QEO-122 = GO.** VSDC current-host public corporate-action pages are sufficient to proceed to QEO-123 canonical `corporate_actions` schema/ingestion design for the tested retained scope. FiinGroup remains unnecessary for this gate and stays out of implementation scope unless later canonical-ingestion evidence exposes a material coverage or operational gap.