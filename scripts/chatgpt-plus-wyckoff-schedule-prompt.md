# ChatGPT Plus schedule prompt — QeoIndex Wyckoff scan

Copy the block below into a ChatGPT Plus scheduled task after configuring a private QeoIndex Custom GPT Action. Put `SCANNER_RUN_SECRET` in the Action bearer-auth setting, never in this prompt or chat history.

Recommended schedule: `07:05 Asia/Ho_Chi_Minh, Monday–Friday` (after completed Daily data is available; adjust only after provider timing is verified).

```text
Tên task: QeoIndex — quét Wyckoff Top 100 mỗi ngày

Mỗi thứ Hai đến thứ Sáu lúc 07:05 theo múi giờ Asia/Ho_Chi_Minh, hãy chạy quy trình sau bằng QeoIndex Scanner Action đã kết nối. Không scrape TradingView, không tự tạo OHLCV, không suy diễn kết quả từ lần chạy cũ và không ghi secret vào nội dung trả lời.

1. Gọi POST /api/wyckoff/run theo đúng 10 batch tuần tự, mỗi batch 10 mã:
   - ?offset=0&limit=10
   - tiếp tục offset 10, 20, 30, 40, 50, 60, 70, 80, 90 với limit=10
   Chỉ bắt đầu batch kế tiếp sau khi batch hiện tại trả kết quả. Không retry quá 1 lần cho cùng batch.

2. Với từng response, lưu và kiểm tra các field thật: ok, requested, completed[], skipped[], errors[], generatedAt, universeDate. HTTP 200 không tự động có nghĩa là scan thành công.

3. Chấp nhận run đầy đủ khi và chỉ khi:
   - tổng requested = 100;
   - mỗi ticker chỉ xuất hiện một lần trong toàn bộ completed + errors;
   - tổng completed + errors = 100;
   - errors = 0;
   - mọi completed item có timeframes = 5;
   - không có giá/OHLC bằng 0 hoặc xác suất giả do ChatGPT tự điền.

4. Nếu có lỗi:
   - không gọi run thành công;
   - liệt kê batch, ticker và error nguyên ý nhưng rút gọn, không lộ header/secret;
   - không tự sửa Notion và không tạo record thay thế;
   - đề nghị operator kiểm tra provider/Notion rồi chạy lại đúng batch lỗi.

5. Nếu thành công, trả báo cáo tiếng Việt ngắn gọn:
   - thời gian generatedAt;
   - requested/completed/errors và 10 runId để audit;
   - xác nhận đủ 500 snapshot timeframe (100 mã × 5 khung) từ completed[].timeframes;
   - provider breakdown Daily/1H từ completed[];
   - tối đa 10 mã có event Spring, UT/UTAD, SOS hoặc SOW nếu Action cung cấp latest snapshot; nếu Action không trả field này, ghi rõ “không có trong response”, tuyệt đối không đoán;
   - link mở page: https://qeoindex.qeoqeo.com/insights/wyckoff?ticker=<TICKER>&timeframe=1D

6. Nhắc rằng Bull/Base/Bear là xác suất từ rule-engine và các đường projection là kịch bản có điều kiện, không phải dự báo chắc chắn hay khuyến nghị đầu tư.
```

## Action requirements

- Base URL: `https://qeoindex.qeoqeo.com`.
- Operation: `POST /api/wyckoff/run` with integer query parameters `offset` and `limit` (`limit` tối đa 10).
- Authentication: HTTP bearer stored privately in the Custom GPT Action configuration.
- The Action must allow a long-running response or the schedule must use smaller batches. Do not make the endpoint public to accommodate ChatGPT Tasks.
- ChatGPT Plus Tasks are an orchestrator here, not the source of market data or the system of record. The QeoIndex server performs provider fetch, Wyckoff rules, and canonical persistence.
