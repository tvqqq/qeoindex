# Handoff — Insights metric guide và AI Council grounded indicators

Status: Shipped and implemented (Phases P0–P3 verified).
Audience: Antigravity, developers, and maintainers on QeoIndex.
Prepared: 2026-08-24.

## Copy-ready assignment

Triển khai hệ thống giải thích chỉ số cho `/insights` theo progressive disclosure và nâng prompt AI Council lên semantic-grounded V2. Người mới phải hiểu thứ tự đọc **thị trường → ngành → cổ phiếu → xác nhận/rủi ro** mà không làm bảng rating dày thêm. UI và AI phải dùng cùng một semantic registry có version, nhưng AI chỉ nhận các field point-in-time thực sự có trong evidence packet. Không reverse-engineer công thức độc quyền KFSP; không biến score, RRG hay price potential thành khuyến nghị mua/bán; không thay quyền quyết định deterministic của Council.

Đọc theo thứ tự trước khi sửa code:

1. `AGENTS.md`
2. `docs/HANDOVER.md`
3. `docs/UI_LESSONS_LEARNED.md`
4. `docs/insights-homepage.md`
5. `docs/insights-rating-model.md`
6. `docs/insights-design.md`
7. `docs/insights-handover.md`
8. Tài liệu này

Tại thời điểm lập plan, checkout local đang `behind origin/main 10`. Trước khi code, xác nhận base/branch hiện tại và không reset các thay đổi của user.

## Outcome cần đạt

- Trên `/insights`, luôn chỉ có một affordance nhẹ `Hiểu các chỉ số`; không tự bật onboarding modal.
- Tooltip hiện có vẫn phục vụ tra nhanh, nhưng mọi nội dung quan trọng đều truy cập được bằng click/tap, keyboard và screen reader trong một guide panel.
- Guide dạy người mới một workflow đọc dữ liệu, không chỉ đưa danh sách định nghĩa.
- Core metric copy nói rõ: chỉ số là gì, đọc cao/thấp thế nào, nên kết hợp với gì, và **không có nghĩa là gì**.
- AI Council V2 nhận giá trị gốc, đơn vị, kỳ đo, provenance, missing-value policy và caveat của đúng các chỉ số nó đang lập luận.
- Mọi evidence claim của LLM phải tham chiếu field/value có thật trong packet; server từ chối ref không tồn tại hoặc sai giá trị.
- Deterministic Council vẫn là final authority; LLM vẫn advisory-only; historical V1 records không bị rewrite.

## Những gì đọc được từ KFSP và cách áp dụng

Tài liệu KFSP đặt “toàn cảnh thị trường” trước việc chọn mã: chỉ số, độ rộng tăng/tham chiếu/giảm, khối lượng/giá trị giao dịch, phân bổ dòng tiền, nhóm ảnh hưởng và cổ phiếu nổi bật. IBD bổ sung sức khỏe/độ rộng, ngày phân phối, Nỗ lực–Kết quả và tâm lý/rủi ro. QeoIndex nên giữ cùng mental model: user phải biết môi trường chung trước khi đọc stock score.

KFSP mô tả:

- 4M là nhóm tiêu chí tìm doanh nghiệp bền vững; tài liệu công khai nêu các thành phần như tăng trưởng doanh thu/EPS/BVPS, dòng tiền kinh doanh, nợ dài hạn, hiệu quả tài sản, biên lợi nhuận, ROE/ROA/ROIC. Công thức chấm điểm chi tiết không công khai.
- CANSLIM là bộ tiêu chí tăng trưởng. QeoIndex chỉ có provider score tổng hợp; không được giả lập hoặc tuyên bố chi tiết trọng số.
- RS đo hiệu suất tương đối so với benchmark; RM đo tốc độ thay đổi của RS.
- RRG dùng RS/RM chuẩn hóa quanh 100 để tạo bốn trạng thái Dẫn dắt, Suy yếu, Đội sổ, Phục hồi. Trạng thái không đủ để biết hướng quay; một điểm Dẫn dắt vẫn có thể mất đà, một điểm Phục hồi vẫn còn yếu tương đối.
- `RS-S score` 0–100 trên bảng QeoIndex và trục `RS/RM` quanh 100 của RRG là hai representation khác nhau. UI/prompt không được trộn hai ngưỡng.
- Price potential/fair value là output ước tính của provider để tham khảo, không phải price target hay QeoIndex intrinsic valuation.

Nguồn tham khảo công khai:

- <https://hdsd.kfsp.vn/hdsd-kfsp/huong-dan-su-dung/phien-ban-app/thi-truong/thi-truong>
- <https://hdsd.kfsp.vn/hdsd-kfsp/gioi-thieu-chuc-nang/phien-ban-web/ibd-kfsp>
- <https://hdsd.kfsp.vn/hdsd-kfsp/gioi-thieu-chuc-nang/phien-ban-web/tai-chinh-doanh-nghiep/4m-and-canslim>
- <https://hdsd.kfsp.vn/hdsd-kfsp/gioi-thieu-chuc-nang/phien-ban-web/suc-manh-dong-tien>
- <https://hdsd.kfsp.vn/hdsd-kfsp/gioi-thieu-chuc-nang/phien-ban-web/tong-quan-nganh>

## Hiện trạng và gap

### UI

- `components/insights/insights-dashboard.tsx` đã có `MetricLabel`, `ScorePill` và tooltip trên nhiều header/cell.
- Các mô tả trong `supabase/functions/_shared/kfsp-catalog.ts` chủ yếu là một câu định nghĩa. Chúng chưa hướng dẫn đọc kết hợp và chưa nói rõ anti-meaning.
- Hover tooltip không phải learning surface tốt cho touch/mobile; user mới phải dò từng cột trong một bảng 11 cột.
- `Risk score` trên homepage là heuristic QeoIndex cụ thể trong `lib/insights-data.ts`, nhưng UI chưa nói công thức/giới hạn.
- `Rating tổng hợp` là mean của các provider score có dữ liệu; user có thể hiểu nhầm thành signal hoặc xác suất tăng.

### AI Council

- `lib/ai-council-data.ts` normalize nhiều field gốc vào `CouncilRatingEvidence` rồi `buildCouncilStock()` làm mất raw rating evidence khỏi `AiCouncilStock` trả về.
- `lib/ai-council-llm.ts::evidencePacket()` hiện gửi deterministic decision, agent summaries, benchmark và weight profile, nhưng không gửi raw indicator packet kèm semantics.
- Prompt hiện có guardrail tốt về no-browse/no-invention/advisory-only, nhưng model vẫn phải đoán ý nghĩa chính xác, unit, horizon và quan hệ giữa field.
- `evidenceHash` đã hash rating + Wyckoff evidence. Giữ nguyên tính point-in-time này; semantic guide version phải được audit riêng.

## UX architecture — ít nhiễu, ưu tiên newbie

### 1. Entry point

Trong header của section `Top cổ phiếu rating score`, thêm một button secondary/ghost:

```text
[BookOpen icon] Hiểu các chỉ số
```

Đặt cạnh badge nguồn dữ liệu hoặc dưới mô tả section trên màn hình hẹp. Không thêm cột, không chen card lớn trước bảng, không tự mở lần đầu.

Thêm một câu hướng dẫn luôn thấy, tối đa một dòng desktop/hai dòng mobile:

```text
Đọc theo thứ tự: thị trường → ngành → cổ phiếu. Điểm cao giúp so sánh, không phải lệnh mua.
```

### 2. Metric guide panel

Desktop: dialog dạng side panel rộng khoảng 440–480px, fixed overlay, không làm table reflow.
Mobile: full-screen dialog.
Không thêm backdrop blur lớn; dùng nền opaque, border và shadow nhỏ theo UI performance rules.

Panel có bốn khu vực:

1. `Bắt đầu trong 60 giây`
2. `Chất lượng doanh nghiệp`
3. `Sức mạnh & luân chuyển`
4. `Rủi ro, định giá & thanh khoản`

Có search theo label/alias. Mỗi metric card chỉ có:

- `Là gì?`
- `Cách đọc nhanh`
- `Kết hợp với`
- `Không có nghĩa là`
- source badge: `KFSP`, `QeoIndex derived` hoặc `Market feed`
- freshness/as-of rule nếu có

Không render toàn bộ 70+ provider fields trong MVP. Guide MVP chỉ bao phủ những metric nhìn thấy ở homepage/table và những metric trực tiếp ảnh hưởng AI Council.

### 3. Context help

- Tooltip header/cell giữ dạng tra nhanh, tối đa hai câu.
- Tooltip có action `Mở hướng dẫn` để mở panel tại đúng metric.
- Trigger phải là `button` hoặc element focusable có accessible name; không chỉ là `span cursor-help`.
- Touch: tap mở tooltip hoặc guide, không phụ thuộc hover.
- `Esc` đóng, focus trả về trigger, focus trap hoạt động, heading/description được nối bằng ARIA.
- Không gắn tooltip vào mọi numeric cell. Một header tooltip + score pill tooltip là đủ.

### 4. Learning sequence chính xác

`Bắt đầu trong 60 giây` dùng bốn bước ngắn:

1. **Thị trường có thuận không?** Xem VNIndex, độ rộng, thanh khoản và Risk score.
2. **Dòng tiền nghiêng về ngành nào?** Xem RS ngành và RRG ngành.
3. **Mã có chất lượng và sức mạnh không?** Đối chiếu 4M/CANSLIM với RSs/RSm và RRG cổ phiếu.
4. **Điều gì có thể phủ định?** Mở chi tiết để xem Beta, SMA/RSI/MACD, thanh khoản, dòng tiền, Wyckoff confirmation/invalidation.

### 5. Exact beginner semantics cho core metrics

| Metric | Copy cốt lõi | Anti-meaning bắt buộc |
| --- | --- | --- |
| Độ rộng | Số mã tăng so với số mã giảm; cho biết mức lan tỏa của phiên | Index tăng không đồng nghĩa đa số cổ phiếu tăng |
| Thanh khoản | Tổng giá trị giao dịch và thay đổi so với phiên trước | Thanh khoản cao có thể do mua chủ động hoặc bán mạnh; phải đọc cùng giá/độ rộng |
| Risk score | QeoIndex heuristic từ tỷ lệ mã giảm và biến động VNIndex, 5–95 | Không phải xác suất thị trường giảm và không phải model KFSP |
| CANSLIM | Provider score 0–100 cho bộ tiêu chí tăng trưởng | Không biết trọng số độc quyền; score cao không tự tạo điểm mua |
| 4M | Provider score 0–100 cho bộ tiêu chí chất lượng/bền vững | Không phải định giá và không thay due diligence |
| Tiềm năng giá | Nhãn provider từ giá và giá trị ước tính | Không phải target, timing hay cam kết lợi nhuận |
| RSs/RSm | Sức mạnh giá tương đối ngắn/trung hạn, thang 0–100 trong read-model | Không phải RSI; không dùng ngưỡng 100 của RRG |
| RRG | Trạng thái luân chuyển theo RS và RM so với benchmark | State không cho biết đầy đủ hướng/độ dài vector; không dùng độc lập |
| 1W/1M | Biến động giá trong cửa sổ provider | Không phải snapshot delta 7D/30D của QeoIndex history dialog |
| Rating tổng hợp | Mean các giá trị có sẵn: 4M, CANSLIM, stock RS-S, sector RS-S | Không phải provider recommendation, xác suất tăng hay backtested alpha |
| QeoIndex state | Heuristic năm chiều có formula công khai trong repo | Không phải logic độc quyền KFSP hoặc predictive label đã calibration |
| Beta | Độ nhạy tương đối so với thị trường | Không đo mọi loại rủi ro và không dự báo hướng giá |

## Shared semantic registry

Tạo một module pure TypeScript, không React, không `server-only`:

```text
lib/insights-metric-semantics.ts
```

Không copy nguyên `KFSP_FIELD_CATALOG`. Registry mới bổ sung lớp product semantics cho một tập core key và tham chiếu stable read-model key hiện có.

Suggested contract:

```ts
export type MetricSource = "kfsp" | "qeoindex" | "market_feed"
export type MetricDirection = "higher_is_supportive" | "higher_is_risk" | "context_only" | "categorical"

export interface InsightMetricSemantic {
  key: string
  label: string
  aliases: string[]
  category: "market" | "quality" | "relative_strength" | "momentum" | "rotation" | "risk" | "valuation" | "liquidity"
  source: MetricSource
  unit: "score_0_100" | "percent" | "price_thousand_vnd" | "billion_vnd" | "ratio" | "state" | "text"
  horizon: string | null
  direction: MetricDirection
  beginner: {
    what: string
    read: string
    combineWith: string[]
    notMeaning: string
  }
  ai: {
    meaning: string
    interpretationRules: string[]
    forbiddenInferences: string[]
  }
  provenanceNote: string
}

export const INSIGHTS_METRIC_GUIDE_VERSION = "metric-guide-v1"
export const INSIGHTS_METRIC_SEMANTICS: readonly InsightMetricSemantic[] = [...]
export function getMetricSemantic(key: string): InsightMetricSemantic | null
export function buildAiMetricDictionary(keys: string[]): CompactAiMetricSemantic[]
```

Rules:

- Stable key là key của QeoIndex read-model, không dùng Vietnamese provider key trong UI/prompt.
- Registry là semantic truth; numeric formula truth vẫn nằm ở module hiện tại (`insights-rating-model.ts`, `insights-data.ts`, `ai-council-model.ts`).
- Với derived metric, registry phải trỏ tới formula owner bằng `provenanceNote`.
- Unknown/missing luôn có nghĩa `không đủ dữ liệu`, không phải 0, trung tính, xấu hay tốt.
- Guide version thay khi meaning/caveat thay; typo không cần đổi version.

Core keys tối thiểu:

```text
market_breadth, market_liquidity, market_risk_score,
kfsp_canslim_score, kfsp_score_4m, kfsp_price_potential,
kfsp_stock_rs_score, kfsp_sector_rs_score, rs_short, rs_medium,
kfsp_stock_rrg_state, kfsp_sector_rrg_state,
weekly_change_pct, monthly_change_pct, kfsp_composite_score,
beta, pe_ttm, pb_ttm,
net_revenue_growth_pct, net_income_growth_pct, roe_ttm_pct, net_margin_ttm_pct,
price_vs_sma10_pct, price_vs_sma20_pct, price_vs_sma50_pct,
price_vs_sma100_pct, price_vs_sma200_pct, macd_vs_signal,
volume_1d, average_volume_20d, volume_vs_previous_session_pct,
traded_value_vs_previous_session_pct,
net_foreign_trading_billion, net_proprietary_trading_billion,
vnindex_close, vnindex_sma20, vnindex_return_20d_pct, vnindex_regime
```

## AI Council Semantic Grounding V2

### 1. Không gửi raw evidence ra client chỉ để phục vụ LLM

Mở rộng options của `getAiCouncilData()` / `getAiCouncilRuntimeData()`:

```ts
{ includeHistory?: boolean; includePromptEvidence?: boolean }
```

`app/api/ai-council/debate-daily/route.ts` truyền `includePromptEvidence: true`. Các page/browser call mặc định `false` để không tăng RSC/client payload.

Khi true, mỗi selected stock giữ một sanitized `promptEvidence` gồm:

- normalized `CouncilRatingEvidence` cần thiết;
- Wyckoff snapshots đã normalize;
- rating date/as-of và evidence hash;
- không có raw provider payload, token, diagnostic secret hoặc unmapped fields.

Nếu typing trở nên mơ hồ, tạo type riêng `AiCouncilPromptStockSnapshot`; không rải optional chaining khắp prompt code.

### 2. Packet V2

`evidencePacket()` phải có bốn lớp rõ ràng:

```ts
{
  packetVersion: "ai-council-evidence-v2",
  semanticGuideVersion: INSIGHTS_METRIC_GUIDE_VERSION,
  provenance: {...},
  observedIndicators: Record<string, { value: string | number | null; unit: string; asOf: string | null }>,
  indicatorDictionary: CompactAiMetricSemantic[],
  missingIndicators: string[],
  deterministicDecision: {...},
  deterministicAgents: [...],
  marketBenchmark: {...},
  weightProfile: {...}
}
```

Chỉ đưa dictionary entry cho field xuất hiện trong packet. Không dump toàn catalog. Null nằm trong `missingIndicators`; LLM không được dùng null làm bằng chứng thuận/nghịch.

Benchmark semantics:

- `close > sma20` chỉ là vị trí so với trend trung hạn, không tự chứng minh risk-on.
- `return20dPct` là biến động 20 phiên của VNIndex.
- `regime` hiện được derive từ close/SMA20 và ngưỡng ±2% return20d; ghi đúng formula owner `lib/ai-council-market.ts`.
- Không đưa breadth/liquidity homepage vào Council cho tới khi có persisted point-in-time evidence cùng ngày. Semantic definition không thay thế observation.

### 3. Prompt rules bắt buộc

Nâng:

```ts
AI_COUNCIL_LLM_PROMPT_VERSION = "llm-debate-v2-semantic-grounding"
```

Bull, Bear, Risk và Chair đều phải nhận các rule:

1. Interpret mỗi metric theo `indicatorDictionary`, không theo kiến thức mặc định nếu xung đột.
2. Không tự suy ra công thức/trọng số của KFSP 4M, CANSLIM, price potential, RS score.
3. Không nhầm RSs/RSm 0–100 với RRG RS/RM quanh 100; không nhầm RS với RSI.
4. RRG state là quadrant snapshot; không khẳng định hướng quay khi packet không có vector/history.
5. High liquidity/net flow không chứng minh accumulation hoặc ý định tổ chức nếu price-volume structure không xác nhận.
6. Missing/null là unknown; không được thay bằng 0 hoặc 50.
7. Mọi claim định lượng phải tham chiếu observation exact trong packet và cùng as-of.
8. Tách `observation` khỏi `inference`; không viết causal claim.
9. Không đưa tin tức, vĩ mô, doanh nghiệp hoặc sector fact ngoài packet.
10. Kết luận advisory; không override deterministic signal/risk gate.

### 4. Evidence references và server validation

Không chỉ yêu cầu model “hãy cite”. Thêm structured refs vào output schema:

```ts
interface LlmEvidenceRef {
  metricKey: string
  observedValue: string
  asOf: string | null
  interpretation: string
}
```

- Bull/Bear: 1–4 refs.
- Risk: 1–4 refs hoặc explicit missing keys.
- Chair: refs phải lấy từ packet hoặc participant refs, không tạo metric mới.
- JSON Schema dùng enum metric keys được build từ packet nếu API hỗ trợ; luôn có server validation sau response.
- Validator đối chiếu `metricKey`, normalized observed value và as-of. Sai ref làm role call fail/partial; không persist claim như completed.
- Không log toàn packet trong error/ops alert. Chỉ log ticker, evidence hash, prompt version, role và validation code.

Historical V1 debate rows là immutable. V2 chỉ áp dụng cho run mới; không update payload lịch sử để “sửa” semantics.

### 5. Token/cost boundary

- Giữ `DEFAULT_MAX_TICKERS = 3`, `HARD_MAX_TICKERS = 6`.
- Compact dictionary; mỗi entry tối đa một meaning, tối đa ba rules và hai forbidden inferences.
- Chỉ gửi non-null observations liên quan các Council agents; missing list chỉ giữ key quan trọng.
- Không gửi UI beginner copy dài vào prompt.
- Giữ `tools: []`, `store: false`, Structured Outputs, timeout và event-selection hiện tại.
- Audit token count theo prompt version để phát hiện regression chi phí.

## File-level implementation plan

### P0 — Semantic truth và tests

1. Add `lib/insights-metric-semantics.ts`.
2. Add `tests/insights-metric-semantics.test.ts`.
3. Test unique keys, required copy, valid units/source, core key coverage và registry lookup.
4. Test anti-confusion strings cho RS/RSI/RRG, null policy, proprietary-score caveat và rating formula ownership.

### P1 — UI progressive disclosure

1. Add `components/insights/metric-guide-dialog.tsx`.
2. Refactor `MetricLabel`/`ScorePill` trong `components/insights/insights-dashboard.tsx` để đọc semantic registry và mở đúng guide entry.
3. Thêm entry button + one-line reading order; không thay 11-column layout.
4. Bổ sung exact explanation cho `market_risk_score` và `kfsp_composite_score`.
5. Cập nhật `docs/insights-design.md` và `docs/insights-homepage.md` khi behavior shipped.

### P2 — AI prompt V2

1. `lib/ai-council-data.ts`: giữ sanitized prompt evidence chỉ khi option bật.
2. `lib/ai-council-runtime.ts`: propagate option mà không làm đổi page payload.
3. `app/api/ai-council/debate-daily/route.ts`: bật prompt evidence.
4. `lib/ai-council-llm.ts`: packet V2, dictionary, instructions, structured evidence refs, validator và prompt version.
5. Nếu cần type sạch, add `lib/ai-council-prompt-evidence.ts`; tránh làm `ai-council-llm.ts` phình thêm một registry thứ hai.
6. `tests/ai-council-persistence.test.ts`: giữ guardrail cũ và thêm V2 assertions.
7. Add focused pure tests cho packet/validator; export pure helpers từ module không `server-only` nếu Node test runner cần.

### P3 — Documentation, browser QA, release

1. Update `docs/insights-rating-model.md` chỉ khi formula đổi. Feature này không cần đổi formula.
2. Update `docs/insights-handover.md` với prompt/guide version, failure behavior và validation commands.
3. Browser QA authenticated `/insights` ở khoảng 390, 768, 1440 và 1920px.
4. Browser QA keyboard-only và reduced motion.
5. Verify AI cron on an explicitly selected test ticker only after local tests; inspect persisted prompt version, refs and advisory flag. Không trigger production cron hoặc merge `main` khi chưa có user approval cho release.

## Tests và acceptance criteria

### UI functional

- `Hiểu các chỉ số` mở đúng panel; không auto-open.
- Deep-open từ CANSLIM, 4M, RSs, RSm, RRG, Price potential, Rating và Risk score tới đúng entry.
- Search tìm được label và alias như `RS`, `RRG`, `4M`, `CANSLIM`, `Beta`.
- Tooltip dùng được bằng mouse, focus, tap; guide dùng được keyboard-only.
- Mobile panel không che close button, không có horizontal overflow, focus không thoát overlay.
- Table vẫn đủ 11 cột theo current contract; không thêm min-width/horizontal scroll regression trên wide desktop.
- Không có blur/filter/transition-all mới quanh chart/table.

### Semantic correctness

- UI phân biệt RS, RSI và RRG.
- UI phân biệt provider 1W/1M với QeoIndex history target 7D/30D.
- `Risk score` ghi rõ QeoIndex heuristic và formula owner.
- `Rating tổng hợp` ghi đúng mean available components, null excluded.
- Mọi score/provider estimate đều có disclaimer không phải khuyến nghị.
- Missing value hiển thị `—`/unknown; không thành 0.

### AI grounding

- Packet chứa guide version, packet version, evidence hash, as-of, unit và provenance.
- Prompt không có secrets/raw unmapped provider payload.
- Unknown metric ref, wrong value hoặc wrong as-of bị validator reject.
- Null metric không xuất hiện trong supporting evidence.
- RRG claim không suy ra hướng quay nếu không có history/vector.
- LLM output không đổi deterministic signal; `llm_advisory_only = true` vẫn giữ.
- V1 persisted rows không bị update; V2 rows có prompt version mới.
- Khi một role fail semantic validation, record là partial/failed đúng policy và deterministic run vẫn nguyên vẹn.

### Regression/performance

- Metric registry không làm tăng provider calls hoặc Supabase queries.
- Guide content bundle nhỏ; không thêm dependency.
- LLM dictionary chỉ gồm relevant keys và token audit không tăng không giới hạn.
- Không đưa prompt evidence vào authenticated page payload khi `includePromptEvidence` false.

## Minimum validation commands

```bash
pnpm test:council
node --test tests/insights-metric-semantics.test.ts
pnpm test:core
pnpm lint:touched
pnpm typecheck
pnpm exec next build --webpack
pnpm scan:secrets
git diff --check
```

Nếu test mới được thêm vào core suite/package scripts, chạy command canonical mới thay cho command ad-hoc. Ghi riêng inherited lint/build debt; không gọi pass khi required check fail.

## Release boundary

- Feature branch → validate → commit/push → approval → một merge vào `main` → một Vercel Git deployment.
- Không chạy `vercel --prod`.
- Plan hiện tại không cần Supabase migration hoặc Edge Function deploy. Nếu implementation phát sinh thay đổi Supabase resource, tuân thủ invariant deploy production ngay của repo và xin đúng approval trước side effect.
- Sau deployment, smoke behavior thật: guide interactions, mobile/keyboard, exact semantic copy, và một V2 debate audit row có evidence refs hợp lệ. HTTP 200 riêng lẻ không đủ.

## Explicit non-goals

- Không clone UI KFSP.
- Không reverse-engineer 4M/CANSLIM/price-potential formula.
- Không thêm recommendation, trade execution hoặc personalized advice.
- Không auto-show tutorial, coach marks hoặc animation liên tục.
- Không thêm tooltip cho mọi cell hoặc đổ toàn catalog vào một modal dài.
- Không cho LLM browse/fetch thêm dữ liệu trong debate.
- Không để LLM tính lại deterministic Council signal.
- Không backfill/rewrite historical LLM debates.

## Handoff completion checklist

- [ ] Shared semantic registry + version
- [ ] Accessible metric guide dialog
- [ ] Context deep-links từ core metrics
- [ ] Exact beginner copy + anti-meaning
- [ ] Prompt evidence option không leak vào page payload
- [ ] Packet V2 + compact dictionary
- [ ] Structured evidence refs + strict server validator
- [ ] Prompt version V2, V1 immutable
- [ ] Focused tests + core regression
- [ ] Browser QA 4 viewport + keyboard + reduced motion
- [ ] Docs updated to shipped state
- [ ] Release only after approval
