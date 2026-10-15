# Insights handover: KFSP source contract and operations

Tài liệu này là source of truth cho `/insights`. Bản audit ngày 2026-08-31 bắt đầu từ commit `bf5054d` và đối chiếu trực tiếp với trang **Kungfu Stocks Pro - Ngành** cùng JavaScript bundle đang chạy của KFSP.

## 1. Nguyên tắc bắt buộc

- Dữ liệu thị trường, ngành và định giá hiển thị trên Insights phải đến từ KFSP và có `as_of`/`session_date` rõ ràng.
- Không có preview rows, số mẫu, lịch sử tạo bằng công thức, ngày hard-code hoặc fallback từ một metric khác.
- Trường KFSP thiếu phải giữ `null` và UI hiển thị `—`/empty state.
- Không tự suy ra RRG, MA, độ lệch chuẩn, Nỗ lực hoặc Kết quả. P/E/P/B provider giữ nguyên; ngoại lệ Qeo estimate có công thức riêng tại mục 3.4 và không được trộn vào giá trị KFSP.
- Giá trị tự tính của hệ thống phải được phân biệt với dữ liệu gốc, có công thức và owner rõ ràng; không được gắn nhãn như điểm KFSP.
- Provider drift hoặc thiếu P0 làm run `failing`; snapshot cũ đang tốt không bị thay bằng snapshot thiếu dữ liệu.

## 2. Luồng dữ liệu

```mermaid
flowchart LR
  KFSP["KFSP REST + Socket.IO\ncontracts của /nganh"] --> Edge["market-insight-eod-sync\ncontract v2, fail closed"]
  Edge --> Stage["market_insight_snapshot_staging"]
  Stage --> RPC["publish_market_insight_snapshot_v2"]
  RPC --> Daily["market_insight_daily"]
  RPC --> Indexes["market_insight_indexes"]
  RPC --> Sectors["market_insight_sectors"]
  RPC --> Leaders["market_insight_leaders"]
  KFSPStock["KFSP stock filter/detail APIs"] --> RatingSync["kfsp-rating-sync"]
  RatingSync --> Ratings["insights_stock_ratings"]
  RatingSync --> Candidates["kfsp_universe_candidate_snapshots\nfull provider feed"]
  Daily & Indexes & Candidates --> QeoEstimate["Qeo ex VIC/VHM estimate\noptional post-publish step"]
  QeoEstimate --> QeoDaily["market_insight_qeo_ex_vnindex_daily\n+ member evidence"]
  Daily & Indexes & Sectors & Leaders & Ratings --> Loader["server loaders"]
  QeoDaily --> Loader
  Loader --> UI["/insights"]
```

`market-insight-eod-sync` tự lấy bốn chỉ số từ KFSP `getliveindex`; unified EOD workflow không gửi TradingView `canonicalIndexes` vào collector nữa.

## 3. Contract KFSP đã verify

### 3.1. Market health và index

| KFSP call | Payload dùng | Cách lưu/hiển thị |
| --- | --- | --- |
| `getmarketpulsemabyindex("VNINDEX")` | `name[]`, `above[]`, `under[]` | `% trên MA = above / (above + under) * 100` cho MA10/20/50/200. Đây là phép đổi shape trực tiếp. |
| `getdatariskindex("VNINDEX", 200)` | `{ risk, tradingdate }[]` | Giữ nguyên thang `0..1`; không nhân 100 khi lưu. UI có thể format thành tỷ lệ nhưng tooltip giữ giá trị gốc. |
| `getpsychologyindicator("VNINDEX", 200)` | `{ value, tradingdate }[]` | Giữ nguyên thang `0..100`. Nhãn: `<20` Sợ hãi tột độ, `20–39` Sợ hãi, `40–59` Trung lập, `60–79` Tham lam, `>=80` Tham lam tột độ. |
| `getvaluationindex("VNINDEX", 200)` | `price`, `pe`, `pb`, các field `pe_*std_*`, `pb_*std_*` | Vẽ trực tiếp P/E, P/B và dải 1SD/2SD của provider. Không tạo SD từ history giá và không suy P/B từ P/E. |
| `getliveindex(["VNINDEX","VN30","HNXINDEX","UPCOMINDEX"])` | `stockcode`, `lastprice`, `change`, `perchange`, `advances`, `declines`, `nochange`, `totalvol`, `totalvalue`, `time` | Map mã `HNXINDEX → HNX`, `UPCOMINDEX → UPCOM`; các giá trị khác giữ nguyên đơn vị provider. |

REST KFSP `market_pulse/getContent` cung cấp `distribution_count`; không gắn thêm cửa sổ “25 phiên” vì response không công bố window. REST cash-flow cung cấp khối ngoại/tự doanh theo đúng field provider.

### 3.2. Ngành

| KFSP call | Ý nghĩa chính xác |
| --- | --- |
| `getdataibdnganh()` | `ten_nganh`, `closeprice`, `rss`, `totalval_market_pulse`, `totalvalbefore_market_pulse`, `percent_market_pulse`, `percent_market_pulse_marketcap`. |
| `percent_market_pulse` | **Nỗ lực**: % thay đổi giá trị giao dịch hiện tại so với phiên trước. Có thể lớn hơn 100%; minimum hợp lệ là `-100%`. |
| `percent_market_pulse_marketcap` | **Kết quả**: % thay đổi giá ngành. Đồng thời là `average_change_pct` trong read model. |
| `getincreasesdecreasesnganh(names)` | Số mã tăng/giảm/đứng giá từng ngành. Coverage chỉ đạt khi match đủ mọi ngành của snapshot. |
| `getdatarrgnganh(names, "VNINDEX", 9)` | Lịch sử ngày + status provider: `Dẫn dắt`, `Phục hồi`, `Suy yếu`, `Đội sổ`. Response 9 phiên dùng trên `/nganh` đang theo thứ tự cũ → mới; current state là phần tử cuối. |
| `getdatama(slugs)` | `ma10`, `ma20`, `ma50` có giá trị `up`/`down`. Slug phải khớp hàm của KFSP, gồm special case `NÔNG - LÂM - NGƯ → nong_lam_ngu` và giữ punctuation khác. |

UI không còn:

- tự xếp RRG từ biến động/độ rộng;
- suy MA từ RS hoặc momentum;
- tính ngược GTGD phiên trước từ Nỗ lực;
- dùng ngày, sparkline, VNINDEX, GTGD hoặc ticker pill hard-code;
- tạo P/E/P/B/risk history giả.

### 3.3. Stock ratings

- Chỉ đọc snapshot `source = 'kfsp'` và `is_published = true` từ `public.insights_stock_ratings`.
- 4M, CANSLIM, RS-S, RS-M, RRG, giá, volume, valuation và các `kfsp_metrics` giữ nguyên provider value sau normalize đơn vị đã document.
- Component thiếu giữ `null`; không lấy composite để lấp 4M/CANSLIM/RS.
- `kfsp_price_potential` chỉ nhận label string provider. Không tự tạo label từ fair value/price.
- Cột DB `kfsp_composite_score` là legacy name. Giá trị là **điểm tổng hợp**:

```text
mean(các giá trị có mặt trong [KFSP 4M, KFSP CANSLIM, KFSP stock RS-S, KFSP sector RS-S])
```

Null bị loại khỏi mean; nếu cả bốn null thì composite null. UI ghi “Điểm tổng hợp” hoặc “Nguồn KFSP · điểm tổng hợp”, không gọi đây là model/composite của KFSP.

`Radar trạng thái thị trường` là heuristic UI riêng, owner tại `modules/research/insights/rating-model.ts`; công thức/weights nằm trong file và UI ghi rõ đây không phải logic proprietary của KFSP. Nếu thay đổi công thức phải cập nhật tests và metric guide trong cùng commit.

### 3.4. VNI (trừ VIN) · HOSE loại VIC, VHM

Đây là chuỗi ước tính, không phải VNINDEX chính thức, không phải chỉ số có divisor chính thức và không khẳng định danh sách thành phần chính thức. UI overlay bốn series trong cùng chart định giá: VNINDEX và P/E/P/B KFSP, VNI (trừ VIN) và P/E/P/B (trừ VIN). “Trừ VIN” nghĩa là loại đúng hai mã VIC và VHM. Series chỉ số dùng trục trái, series định giá dùng trục phải; dữ liệu ghép theo ngày giao dịch ISO đầy đủ, không chuẩn hóa. Tooltip và chú giải ghi rõ phạm vi loại VIC/VHM, còn các dải độ lệch chuẩn KFSP chỉ áp dụng cho metric KFSP.

Nguồn là toàn bộ kết quả KFSP `/api/filter` của cùng một `kfsp_rating_sync_runs` đã hoàn tất sau 15:00 ICT trong đúng ngày phiên, không phải 200 mã canonical. EOD đọc candidate theo `sync_run_id`, phân trang toàn bộ `provider_row_count`, kiểm tra thời điểm từng hàng, mỗi mã trong HOSE feed gồm đúng ba ký tự chữ/số viết hoa (mã dài hơn như ETF/chứng quyền hoặc mã sai định dạng khiến phiên không đủ điều kiện, không bị lọc âm thầm), vốn hóa/giá/biến động hợp lệ và yêu cầu cả VIC, VHM có mặt trước khi loại hai mã này. `fetched_at` là thời điểm Qeo nhận phản hồi filter; trường `thoigian` từ provider không được dùng vì không đủ tin cậy để xác nhận thời điểm cập nhật. Nguồn cần tối thiểu 350 mã HOSE, ít nhất 90% số mã HOSE quan sát ở lần trước và không thấp hơn số tăng + đứng giá + giảm của VNINDEX khi số breadth này có sẵn. 413 mã là số quan sát của feed đã kiểm tra, không phải số lượng membership cố định; breadth chỉ là kiểm tra cận dưới, không chứng minh danh tính thành phần chỉ số.

Điểm đầu tiên có nguồn EOD đầy đủ lấy VNINDEX đã publish cùng phiên làm mốc gốc bất biến. Từ phiên tiếp theo, chuỗi tính:

```text
vốn hóa tham chiếu từng mã = vốn hóa hiện tại / (1 + biến động giá phiên / 100)
Qeo phiên này = Qeo phiên trước × (Σ vốn hóa hiện tại HOSE trừ VIC/VHM / Σ vốn hóa tham chiếu HOSE trừ VIC/VHM)
```

Đây là điều chỉnh theo tham chiếu lợi suất giá do KFSP cung cấp; thay đổi divisor hoặc corporate action không được tự suy diễn. Khi đã có mốc gốc, một phiên thị trường đã publish nhưng thiếu Qeo sẽ làm chuỗi điểm dừng. RPC cũng đối chiếu phiên hiện tại và phiên liền trước trong lịch sử định giá KFSP với phiên thị trường đã lưu, để phát hiện cả trường hợp toàn bộ Market Close bỏ lỡ một phiên. Không nối qua ngày thiếu dữ liệu và không tự đặt mốc mới. P/E/P/B vẫn được lưu từ nguồn đầy đủ của phiên hiện tại khi chuỗi điểm bị dừng. Các lần chạy thiếu dữ liệu trước mốc gốc đầu tiên được lưu `unavailable`; phiên hợp lệ đầu tiên mới được làm mốc.

P/E và P/B dùng trực tiếp các field `pe_ttm`/`pb_ttm` của filter feed, không suy từ EPS/BVPS. Để định nghĩa mẫu không đổi giữa các ngày, mỗi point luôn dùng nhóm có bội số dương, hữu hạn:

```text
P/E nhóm dương = Σ vốn hóa mã có P/E dương / Σ(vốn hóa mã / P/E mã)
P/B nhóm dương = Σ vốn hóa mã có P/B dương / Σ(vốn hóa mã / P/B mã)
```

VIC và VHM bị loại trước mọi phép cộng. P/E/P/B thiếu, bằng 0 hoặc âm không vào mẫu số. UI ghi `P/E (trừ VIN)` hoặc `P/B (trừ VIN)` cùng phạm vi mẫu `nhóm có P/E dương` hoặc `nhóm có P/B dương`, kèm số mã có metric trên tổng số mã retained của chính phiên và tỷ lệ vốn hóa bao phủ; thiếu một metric không xóa point của metric còn lại. Tooltip hiển thị thời điểm hệ thống nhận snapshot và ghi rõ đây không phải timestamp cập nhật từ nhà cung cấp. Mọi giá trị P/E/P/B và tick trục định giá hiển thị đúng hai chữ số thập phân.

Riêng prefix lịch sử 2026-10-01 đến 2026-10-12 được khôi phục một lần từ các phiên EOD và nguồn HOSE đầy đủ đã lưu, tính lùi từ mốc Qeo bất biến 2026-10-13 (1,719.42). Các run KFSP đã lưu có 1.752 dòng đến hết 2026-10-08 và 1.753 dòng từ 2026-10-09; mỗi ngày phải khớp chính xác một run hoàn tất sau 15:00 ICT, provider `kfsp`, cùng contract version với mốc gốc, cùng số dòng candidate và cùng danh sách HOSE đã kiểm tra. Bản ghi dùng calculation version riêng; mỗi phiên lùi dùng tỷ lệ vốn hóa tham chiếu/vốn hóa hiện tại của phiên kế tiếp và giữ nguyên source run, member evidence cùng hash. Đây là ước tính theo nguồn đã lưu, không phải VNINDEX chính thức. Không dựng ngược P/E/P/B: metric chỉ có giá trị khi nguồn đúng ngày có thành viên với tỷ lệ dương hợp lệ; nếu không, lưu null và mode unavailable. Dry-run kiểm tra toàn bộ phiên, provenance, tính liên tục và phép tính trước khi insert; publish chỉ thêm các hàng prefix còn thiếu và retry chỉ chấp nhận dữ liệu khớp hoàn toàn. Các điểm đã có từ 2026-10-13 trở đi không bị sửa hoặc xóa. Bảng summary lưu source run/contract, source và retained hash, số lượng/coverage, base date/value, timestamp quan sát và trạng thái. Bảng member service-role-only giữ bằng chứng từng mã. Candidate PE/PB được giữ 14 ngày theo retention hiện hữu, còn estimate/member history có bảng lưu riêng.

## 4. Storage contract v2

Migrations:

- `supabase/migrations/20260830113000_kfsp_insights_exact_contract_v2.sql`: schema/constraints và RPC v2.
- `supabase/migrations/20260831002500_fix_kfsp_insights_v2_staging_capture.sql`: giữ payload v2 trong biến transaction trước khi publisher v1 cleanup staging; nếu bỏ guard này, history/MA/RRG sẽ không được persist.

### `market_insight_daily`

- Direct fields: `sentiment_score`, `risk_score`, `distribution_count`, MA breadth, cash flows, totals.
- History JSON: `sentiment_history`, `risk_history`, `valuation_history`.
- `risk_score` constraint: `0..1`.
- `market_regime` và `distribution_window` nullable; collector v2 không tự tính hai field này.

### `market_insight_sectors`

- Direct fields: `close_price`, `traded_value`, `previous_traded_value`, `average_change_pct`, breadth, `rs_score`, `rotation_state`, `effort_pct`, `result_pct`, `ma10_state`, `ma20_state`, `ma50_state`, `rotation_history`.
- `strength_ratio`, `momentum_ratio`, `effort_result_state` giữ nullable và không được local normalizer dựng lên.

### Atomic publish

`publish_market_insight_snapshot_v2(uuid)` gọi publisher v1 để giữ lock/P0 validation/four-table replace, sau đó ghi các cột v2 trong cùng transaction. Chỉ `service_role` được execute.

## 5. Scheduler và deployment

| Job | Lịch UTC | Lịch ICT | Vai trò |
| --- | --- | --- | --- |
| `kfsp-rating-daily-7am-ict` | `0 0 * * *` | 07:00 hàng ngày | Stock rating snapshot. |
| `qeoindex-eod-pipeline-1515-ict` | `15 8 * * 1-5` | 15:15 thứ Hai–thứ Sáu | Unified EOD; phase `MARKET_CLOSE_COLLECT` gọi `market-insight-eod-sync`. |

Khi thay đổi resource Supabase:

```bash
npx supabase db push
npx supabase functions deploy market-insight-eod-sync --no-verify-jwt
npx supabase functions deploy kfsp-rating-sync --no-verify-jwt # chỉ khi function rating thay đổi
```

Không log token, credential hoặc URL có query token. Token KFSP chỉ nằm trong Edge Function secret/cache được bảo vệ.

Trạng thái production ngày 2026-08-31: contract v2 và hai function trên đã deploy. Các snapshot 2026-08-26 đến 2026-08-28 vẫn mang `contract_version = 1`; migration sửa thang risk và đưa các trường từng bị map/suy diễn sai về null, không giả lập history/provider fields mới. Chúng sẽ được thay bằng snapshot v2 ở lần unified EOD thành công tiếp theo. Backfill lịch sử là thao tác replace dữ liệu production và chỉ chạy khi có phê duyệt riêng.

## 6. Verification runbook

### Local gates

```bash
pnpm typecheck
node --test tests/market-insight-validation.test.ts tests/market-insight-edge-types.test.ts
pnpm test:core
pnpm lint:touched
pnpm scan:secrets
pnpm build
```

Material UI change phải kiểm tra bằng browser thật: desktop + mobile, ba view `Nhịp đập TT` / `Nỗ lực - Kết quả` / `Sức khỏe TT`, empty state, tooltip, modal stock, không console error.

Bubble universe: the post-session `Bubbles · Bản đồ giao dịch thị trường` reads a separate latest-published KFSP query, not the composite-ranked detail result. It keeps rows with `average_volume_50_sessions > 300000`, orders descending by that provider-owned `avg50` field with ticker ascending as the tie-break, and limits the result to 200. KFSP defines `avg50` as average trading volume over 50 sessions, but this repository does not establish whether the provider unit is shares or lots; copy must keep that unit unqualified. Missing values are excluded and a smaller result is displayed honestly.

Kết quả acceptance ngày 2026-08-31 trên Chrome đã xác thực với local production build `localhost:3001`: ở mobile 390x844, cả trạng thái đóng và mở đều có `clientWidth/scrollWidth = 390/390`; dropdown nằm trong rect `16..374` (rộng 358px) và hiển thị đủ 4 links. Empty state thiếu Kết quả KFSP hiển thị trung thực; chọn `1W` + `Columns` cho Top 100, document width vẫn 390; console có 0 errors/0 warnings (chỉ log dự kiến của Vercel Analytics/Speed Insights trên localhost). Sau khi reset viewport về desktop 2294px, dropdown có rect `453..843` (rộng 390px), không có document overflow. Đây là acceptance lịch sử của local production build, chưa phải verification trên Vercel production đã deploy.

Top 200 bubble QA trên browser thật chưa được thực hiện; cần acceptance mới trên desktop/mobile trước release.

### Production SQL

```sql
select session_date, risk_score, sentiment_score,
       jsonb_array_length(risk_history) as risk_points,
       jsonb_array_length(sentiment_history) as sentiment_points,
       jsonb_array_length(valuation_history) as valuation_points,
       market_regime, distribution_window, quality_status
from public.market_insight_daily
order by session_date desc
limit 5;

select session_date, count(*) as sectors,
       count(*) filter (where rs_score is not null) as with_rs,
       count(*) filter (where rotation_state <> 'unknown') as with_rrg,
       count(*) filter (where effort_pct is not null and result_pct is not null) as with_effort_result,
       count(*) filter (where ma10_state is not null and ma20_state is not null and ma50_state is not null) as with_ma
from public.market_insight_sectors
group by session_date
order by session_date desc
limit 5;

select as_of_date, count(*) as rows,
       count(*) filter (where kfsp_score_4m is not null) as with_4m,
       count(*) filter (where kfsp_canslim_score is not null) as with_canslim,
       count(*) filter (where kfsp_composite_score is not null) as with_qeo_composite
from public.insights_stock_ratings
where source = 'kfsp' and is_published
group by as_of_date
order by as_of_date desc
limit 5;
```

Đối chiếu ít nhất một snapshot với DOM KFSP `/nganh`: risk giữ thang `0..1`, sentiment/MA breadth khớp, số ngành khớp, và với một ngành phải khớp đồng thời `Giá`, `RS`, `Nỗ lực`, `Kết quả`, RRG, MA10/20/50.

## 7. Release boundary

- Supabase migration/function deploy áp dụng ngay theo project invariant.
- Next.js UI chỉ lên production qua Git Integration: merge/push `main` → đúng một Vercel deployment.
- Không chạy `vercel --prod` và không redeploy chỉ để verify.

## 8. Market-health UI contract (2026-08-31)

- `Nhịp đập thị trường & Sức khoẻ thị trường` composes a 70/30 overview/sentiment row and a responsive risk/valuation row; the old breadth/MA summary column is not rendered.
- The four Market internals charts and two 20-session charts are mounted once in this composition. Their existing bounded chart dimensions, real-data inputs, and empty states remain authoritative.
- Sentiment has no provider-segment selector; the displayed value is the published KFSP market sentiment only.
- VNINDEX liquidity displays the raw provider value with at most two decimals and explicitly labels the provider unit as unverified. No ingestion conversion is implied until the provider contract proves `totalvalue` units.

## 9. Market AI conclusion runtime

- `market-ai-conclusion` is a machine-authenticated Supabase Edge Function. It reads only the same published `market_insight_daily`, `market_insight_indexes`, `market_insight_sectors`, and `market_insight_leaders` snapshot for `latest` or an explicit `session` date.
- Evidence is point-in-time and hashed with `market-ai-conclusion-v2`; the packet is facts-only (`observations=[]`), and its identity includes the completed sync-run id, payload checksum, contract version, session/asOf and source. Mixed `as_of` rows, missing provenance, incomplete mandatory dimensions, or non-healthy snapshot quality complete as `insufficient_evidence` without an LLM call. Claims are validated against exact dimension-owned fact refs, risk indexes, missing-evidence set, and citations.
- A successful call is one structured OpenAI Responses request using the explicitly configured and API-validated `MARKET_AI_MODEL`, medium reasoning and at most 1,800 output tokens. The prompt treats CANSLIM/4M as an explanatory lens only: no invented score/formula or investment advice. Claim/lease/cost/error telemetry is persisted in `market_ai_conclusions`; a model-start marker quarantines expired work as `completion_unknown` so it cannot auto-spend again.
- The function accepts only `x-market-ai-secret` backed by dedicated `MARKET_AI_CONCLUSION_SECRET`. EOD does not dispatch AI automatically. A service-role-only pg_net RPC is available for an explicitly approved/manual invocation and remains unscheduled.
# Market AI runtime note

- Market-level CANSLIM/4M-inspired conclusions use `gpt-5.6-terra` with `reasoning=low`, structured output, immutable evidence provenance, and a hard `$0.03` per-attempt cost gate. The lower reasoning tier is intentional: the model explains precomputed evidence and does not calculate indicators or override deterministic policy.
