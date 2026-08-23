# Insights rating and market-state model

The canonical implementation is `lib/insights-rating-model.ts`. This document explains the current formula; code and tests remain executable truth.

## Scope and disclaimer

The model converts published KFSP read-model fields into five comparable 0–100 dimensions and one descriptive state. It is a QeoIndex heuristic, not KFSP proprietary logic, a valuation target, or an investment recommendation.

## Input normalization

All final values are rounded and clamped to `[0, 100]`:

```text
clamp(x) = round(max(0, min(100, x)))
score(x) = 50 when x is null; otherwise clamp(x)
signed(x, scale) = 50 when x is null; otherwise clamp(50 + x / scale × 50)
```

Return normalization:

```text
weekly  = signed(weeklyChangePercent, 10)
monthly = signed(monthlyChangePercent, 20)
```

Therefore +10% weekly or +20% monthly maps to 100; the equivalent negative move maps to 0. Values outside those bands are clamped.

### RRG mapping

| State | Score |
| --- | ---: |
| Dẫn dắt | 88 |
| Phục hồi | 67 |
| Suy yếu | 38 |
| Đội sổ | 18 |
| Missing/unknown | 50 |

### Price-potential mapping

| Provider label | Score |
| --- | ---: |
| `Tăng ↑↑↑` | 92 |
| `Tăng ↑↑` | 80 |
| Other `Tăng` | 68 |
| Other `Giảm` | 32 |
| `Giảm ↓↓` | 20 |
| `Giảm ↓↓↓` | 8 |
| Missing/unknown | 50 |

Matching order is important: the implementation checks three arrows before two arrows, then the generic label.

### RSI heat and beta risk

```text
rsiHeat(number) = clamp((RSI - 40) × 2.5)
betaRisk        = 50 when beta is null
                  otherwise clamp(50 + (beta - 1) × 42)
```

Text RSI maps `quá mua`/`overbought` to 90 and `quá bán`/`oversold` to 15; other text maps to 50.

## Five dimensions

`weighted()` calculates the weighted sum then clamps and rounds it.

### BULL — Xu hướng tăng

```text
BULL = 0.24 × RSs
     + 0.20 × RSm
     + 0.20 × weekly
     + 0.18 × monthly
     + 0.10 × potential
     + 0.08 × stockRRG
```

Interpretation: short/medium relative strength and price momentum dominate, with price potential and stock RRG as confirmation.

### HEAT — Độ nóng

```text
HEAT = 0.30 × weekly
     + 0.25 × monthly
     + 0.25 × rsiHeat
     + 0.10 × RSs
     + 0.10 × potential
```

Interpretation: a high value means short-term momentum is extended; high is not automatically good.

### RISK — Rủi ro

```text
downsideRisk = 0.55 × (100 - weekly) + 0.45 × (100 - monthly)

RISK = 0.25 × betaRisk
     + 0.25 × downsideRisk
     + 0.20 × (100 - rating)
     + 0.15 × (100 - stockRRG)
     + 0.15 × (100 - sectorRRG)
```

Interpretation: beta, downside momentum, weak composite quality, and unfavorable RRG increase risk.

### ACC — Tích lũy

```text
controlledHeat = 100 - abs(HEAT - 55)

ACC = 0.20 × CANSLIM
    + 0.16 × 4M
    + 0.14 × RSs
    + 0.14 × RSm
    + 0.12 × stockRRG
    + 0.10 × sectorRRG
    + 0.14 × controlledHeat
```

Interpretation: accumulation favors quality plus relative strength in a controlled heat zone centered on 55. This is not a volume-based institutional-flow detector.

### SUST — Bền vững

```text
SUST = 0.24 × CANSLIM
     + 0.20 × 4M
     + 0.20 × rating
     + 0.14 × RSm
     + 0.12 × sectorRRG
     + 0.10 × (100 - RISK)
```

Interpretation: long-lived strength should combine fundamental/4M quality, medium relative strength, supportive sector context, and controlled risk.

## State classification

Rules are evaluated in this exact precedence order:

1. `RISK >= 68` → **Rủi ro cao**.
2. `HEAT >= 74 AND BULL >= 62` → **Quá nhiệt**.
3. `BULL >= 70 AND SUST >= 63` → **Dẫn dắt**.
4. `ACC >= 68 AND HEAT <= 62` → **Tích lũy kín**.
5. `ACC >= 58 AND RISK < 58` → **Tích lũy**.
6. Otherwise → **Trung lập**.

Precedence prevents a high-risk stock from being labeled leading merely because it also has strong momentum.

## Composite rating

The stored `kfsp_composite_score` is the arithmetic mean of available provider values:

```text
rating = mean(4M, CANSLIM, stock RS-S, sector RS-S)
```

Null components are excluded. If all components are missing, the composite is null and the snapshot row fails the publish validity rule. This rating is a QeoIndex comparison score, not a provider recommendation.

## Sector aggregation

For each sector in the latest published snapshot:

- `stockCount = count(rows)`
- `top100Count = count(rows where is_top100)`
- `totalMarketCapBillion = sum(non-null market_cap_billion; null contributes 0)`
- numeric score, price, RS, weekly/monthly, and rating fields = arithmetic mean of non-null values
- `pricePotentialUpCount = count(pricePotential starts with "Tăng")`
- dominant sector RRG = mode of non-null sector RRG states; a count tie currently resolves by Vietnamese lexical order

These are equal-weight stock averages, not market-cap-weighted aggregates. Do not label them weighted indexes.

## Historical comparison

For a requested window `d` in `{1, 7, 30}`:

1. Calculate `targetDate = latestDate - d calendar days` in UTC.
2. Select the latest published snapshot whose date is `<= targetDate`.
3. Delta is `currentValue - selectedHistoricalValue`.
4. Return null and render `—` when no eligible snapshot/value exists.

No interpolation, forward fill beyond the on-or-before rule, or synthetic daily point is allowed. These are snapshot deltas, not trading-session-exact returns.

## Missing-value policy

- The model uses neutral 50 for a missing normalized input.
- The table displays missing provider values as `—`.
- The read-model may use the composite score as a visual fallback for missing 4M/CANSLIM component cards, but storage remains null.
- Never coerce SQL null to zero; zero is a real score with a materially different meaning.

## Change protocol

Any change to mapping, scale, weight, threshold, missing-value behavior, or state precedence must include:

1. an update to `lib/insights-rating-model.ts`;
2. boundary and regression tests in `tests/insights-rating-model.test.ts`;
3. updates to this document and UI explanations;
4. a model-version decision if derived values will be persisted;
5. browser verification on representative high-risk, overheated, leading, accumulation, and missing-data rows.

