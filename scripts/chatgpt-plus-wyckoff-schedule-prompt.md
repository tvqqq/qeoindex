# ChatGPT Web prompt — Wyckoff Top 100 → Notion unified staging

Contract version: `notion-unified-v1` (2026-08-23).

- [Notion contract page](https://app.notion.com/p/3c52172825508193a861e662379530db)
- Universe: `collection://210c502d-0c32-4fdd-9d69-7ef18e2be7d5`
- Runs: `collection://4efe8131-196a-4b4e-8a9c-dea48c51a554`
- Snapshots: `collection://f9d84b24-965a-4008-a339-5a62db409ecf`
- Schedule ChatGPT Web: Monday–Friday after completed EOD data and before the 17:00 ICT ingestion cron.

Copy the complete block below into a ChatGPT Web task/conversation that can access the QeoIndex Notion workspace.

```text
Tên tác vụ: QeoIndex — Wyckoff Top 100 → Notion unified staging

MỤC TIÊU
Quét đúng 100 cổ phiếu Active trong “Wyckoff Universe — Top 100 HOSE”, phân tích 1H/4H/1D/1W/1M khi có đủ dữ liệu, rồi ghi staging facts vào Notion unified. Không gọi endpoint QeoIndex, không dùng/yêu cầu SCANNER_RUN_SECRET và không ghi vào Daily Wyckoff Scan cũ.

NOTION IDS
- Universe: collection://210c502d-0c32-4fdd-9d69-7ef18e2be7d5
- Runs: collection://4efe8131-196a-4b4e-8a9c-dea48c51a554
- Snapshots: collection://f9d84b24-965a-4008-a339-5a62db409ecf
- Contract: https://app.notion.com/p/3c52172825508193a861e662379530db

VERSION CỐ ĐỊNH
- Prompt Version = notion-unified-v1
- Model Version = qeo-wyckoff-rule-v1
- Aggregation Version = vn-session-v1
- Universe Key = hose_top100
- Run Key = WYCKOFF-<YYYY-MM-DD>-EOD-v1, dùng ngày completed Daily bar mới nhất theo Asia/Ho_Chi_Minh.

DATA RULES
1. Chỉ dùng OHLCV/indicator có nguồn URL và timestamp kiểm chứng được. Không đọc giá từ screenshot, không tự tạo OHLCV, volume, indicator, phase hay xác suất.
2. Chỉ dùng completed bars. 4H aggregate theo phiên Việt Nam; 1W/1M aggregate từ Daily. Không trộn incomplete live bar.
3. Mỗi timeframe cần tối thiểu 60 completed bars. Nếu thiếu vẫn tạo row, đặt History Status = Incomplete và Validation Status = Valid; để trống analysis/probabilities/levels/scenarios. Evidence JSON phải có missingReason và completedBars thật.
4. Record Complete phải có Bull + Base + Bear = đúng 100. Đây là conditional rule-engine output, không phải dự báo chắc chắn hay khuyến nghị đầu tư.
5. Spring/UTAD chỉ là candidate tới khi có Test/follow-through. Phase D cần Hold → Test → Follow-through; một breakout candle không đủ.

A. UNIVERSE
- Query đúng 100 row Active, sort Rank 1→100.
- Xác minh ticker unique, rank unique 1–100, Exchange = HOSE.
- Nếu lỗi: tạo run Status = Error, ghi Error Summary rồi dừng; không tạo data giả.

B. RUN MANIFEST
- Tìm Run Key hiện tại. Nếu Ingested thì dừng. Nếu Writing thì resume, không duplicate.
- Nếu chưa có, tạo Runs record với đúng field:
  Run và Run Key = <Run Key>; Scan Date; Status = Writing; Universe Key = hose_top100;
  Universe Count = 100; Snapshot Expected = 500; Snapshot Complete = 0;
  Snapshot Incomplete = 0; Error Count = 0; Model Version; Aggregation Version;
  Started At = current ISO datetime; Prompt Version = notion-unified-v1.

C. SNAPSHOTS
- Xử lý theo Rank, batch tối đa 10 ticker. Sau mỗi batch đếm lại row.
- Mỗi ticker phải có đúng 5 Snapshot Key: <Run Key>|<Ticker>|<1H|4H|1D|1W|1M>.
- Query Snapshot Key trước khi write; update row có sẵn, không tạo duplicate.
- Field mapping bắt buộc:
  Snapshot = <Ticker> · <Timeframe> · <Scan Date>; Snapshot Key; Run Key; Ticker; Rank;
  Exchange; Sector; Timeframe; Bar Closed At; History Bar Count; History Status;
  Provider; Provider Detail; Source URL; Fetched At; Model Version; Aggregation Version;
  Phase; Wyckoff State; TA Bias; Confidence; Bull/Base/Bear Probability;
  Support; Resistance; Confirmation; Invalidation; What Changed;
  Technical JSON; Evidence JSON; Markers JSON; Scenarios JSON;
  Validation Status = Valid hoặc Invalid; Validation Error để trống khi Valid.

JSON CONTRACT
- JSON phải parse được, English camelCase keys, không dùng Markdown code fence trong property.
- Technical JSON: price, changePct, volume, ma20, ma50, ma200, rsi14, macd, macdSignal, atr14, relVolume.
- Evidence JSON: provider, providerDetail, sourceUrl, fetchedAt, firstBarAt, lastBarAt, completedBars, derived, rulesTriggered, missingReason.
- Markers JSON: array của time, label, tone, detail.
- Scenarios JSON: array của key, label, probability, target, description, path; path points có time/value.
- Mỗi JSON phải nằm trong giới hạn text của Notion. Rút gọn rules trước; không bao giờ cắt thành JSON invalid.

D. FINAL VALIDATION
- Universe Count = 100; đúng 500 Snapshot Key unique; mỗi ticker đủ 5 timeframe enum.
- Complete + Incomplete = 500; Rejected/Invalid = 0.
- Complete: Bar Closed At có giá trị, Provider không rỗng, History Bar Count >= 60, Technical JSON.price > 0, probability sum = 100.
- Incomplete: Evidence JSON.missingReason có giá trị và không chứa analysis/probability tự điền.
- Model/Aggregation/Prompt versions đồng nhất.

E. CLOSE RUN
- Nếu đạt: Status = Ready; ghi Snapshot Complete/Incomplete thật; Error Count = 0;
  Completed At; Provider Summary; Validation Hash = SHA-256 của danh sách đã sort gồm Snapshot Key + Bar Closed At + History Status.
- Nếu không đạt: Status = Partial hoặc Error; ghi Error Count/Error Summary thật. Không đặt Ready để thử cron.

BÁO CÁO CUỐI
Trả tiếng Việt gồm Run Key, Scan Date, ticker count, Complete/Incomplete/Invalid counts,
provider breakdown, tối đa 10 event Spring/UTAD/SOS/SOW có evidence, link contract page,
và câu: “Notion chỉ là staging; cron 17:00 sẽ validate lại trước khi publish Supabase.”
```

## 17:00 ingestion contract

The server cron uses a Notion integration token, never a ChatGPT secret. It queries the newest `Ready` run, atomically claims it as `Ingesting`, validates all 500 keys, publishes facts to Supabase, optionally caches the published payload in Redis, then marks the run `Ingested`. Redis is disposable; Supabase remains the operational source of truth.
