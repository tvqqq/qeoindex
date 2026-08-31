export type MetricSource = "kfsp" | "qeoindex" | "market_feed"

export type MetricDirection = "higher_is_supportive" | "higher_is_risk" | "context_only" | "categorical"

export type MetricCategory =
  | "market"
  | "quality"
  | "relative_strength"
  | "momentum"
  | "rotation"
  | "risk"
  | "valuation"
  | "liquidity"

export type MetricUnit =
  | "score_0_100"
  | "percent"
  | "price_thousand_vnd"
  | "billion_vnd"
  | "ratio"
  | "state"
  | "text"
  | "volume"

export interface InsightMetricSemantic {
  key: string
  label: string
  aliases: string[]
  category: MetricCategory
  source: MetricSource
  unit: MetricUnit
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

export interface CompactAiMetricSemantic {
  key: string
  label: string
  category: MetricCategory
  source: MetricSource
  unit: MetricUnit
  horizon: string | null
  direction: MetricDirection
  meaning: string
  interpretationRules: string[]
  forbiddenInferences: string[]
  provenanceNote: string
}

export const INSIGHTS_METRIC_GUIDE_VERSION = "metric-guide-v1"

export const INSIGHTS_METRIC_SEMANTICS: readonly InsightMetricSemantic[] = [
  {
    key: "market_breadth",
    label: "Độ rộng thị trường",
    aliases: ["do_rong", "market_breadth", "advances_declines", "do_rong_thi_truong"],
    category: "market",
    source: "market_feed",
    unit: "ratio",
    horizon: "1D",
    direction: "higher_is_supportive",
    beginner: {
      what: "Số mã tăng so với số mã giảm; cho biết mức lan tỏa dòng tiền của phiên trên sàn HOSE.",
      read: "Tỷ lệ tăng/giảm > 1.5 cho thấy thị trường tăng diện rộng; tỷ lệ < 0.7 cảnh báo áp lực bán lan tỏa.",
      combineWith: ["market_liquidity", "vnindex_close", "market_risk_score"],
      notMeaning: "Index tăng không đồng nghĩa đa số cổ phiếu tăng; chỉ số có thể bị kéo bởi một vài mã vốn hóa lớn trong khi phần lớn cổ phiếu giảm.",
    },
    ai: {
      meaning: "Ratio of advancing stocks to declining stocks on HOSE for the current trading session.",
      interpretationRules: [
        "Ratio > 1.5 indicates broad-market accumulation and healthy market participation.",
        "Ratio < 0.7 indicates broad-market distribution and defensive pressure.",
        "Divergence between positive index move and negative breadth indicates narrow, fragile participation.",
      ],
      forbiddenInferences: [
        "Do not infer all individual sectors or stocks are rising just because the headline index is positive.",
        "Do not treat market breadth alone as a timing signal for single stock entry.",
      ],
    },
    provenanceNote: "Market feed từ sàn HOSE qua TradingView/DNSE snapshot.",
  },
  {
    key: "market_liquidity",
    label: "Thanh khoản thị trường",
    aliases: ["thanh_khoan", "market_liquidity", "gia_tri_giao_dich", "gtgd"],
    category: "market",
    source: "market_feed",
    unit: "billion_vnd",
    horizon: "1D",
    direction: "context_only",
    beginner: {
      what: "Tổng giá trị giao dịch của sàn và tỷ lệ phần trăm thay đổi so với phiên liền trước.",
      read: "Giá tăng kèm thanh khoản tăng xác nhận dòng tiền vào; giá giảm thanh khoản lớn cảnh báo phân phối.",
      combineWith: ["market_breadth", "vnindex_close", "market_risk_score"],
      notMeaning: "Thanh khoản cao có thể do mua chủ động hoặc bán mạnh; phải đọc cùng hướng giá và độ rộng.",
    },
    ai: {
      meaning: "Aggregate traded value on HOSE in billion VND and percentage change versus previous trading session.",
      interpretationRules: [
        "Rising index with rising volume confirms broad buying demand.",
        "Falling index with elevated volume indicates broad selling/distribution pressure; participant identity is not observable from aggregate volume alone.",
      ],
      forbiddenInferences: [
        "Do not equate high liquidity solely with buying or infer the identity/class of market participants.",
        "Do not ignore price spread and breadth when interpreting liquidity spikes.",
      ],
    },
    provenanceNote: "Market feed tổng giá trị giao dịch sàn HOSE.",
  },
  {
    key: "market_risk_score",
    label: "Risk score thị trường",
    aliases: ["risk_score", "market_risk_score", "rui_ro_thi_truong"],
    category: "risk",
    source: "qeoindex",
    unit: "score_0_100",
    horizon: "1D",
    direction: "higher_is_risk",
    beginner: {
      what: "Chỉ số đo lường mức độ rủi ro thị trường ngắn hạn theo công thức heuristic của QeoIndex, thang điểm 5–95.",
      read: "<= 35 là rủi ro thấp, xu hướng ổn định; 36–60 là trung bình, cần chọn lọc; > 60 là rủi ro cao, ưu tiên phòng thủ.",
      combineWith: ["market_breadth", "market_liquidity", "vnindex_close"],
      notMeaning: "Không phải xác suất thị trường giảm và không phải model độc quyền của KFSP.",
    },
    ai: {
      meaning: "QeoIndex proprietary short-term market risk heuristic calculated from breadth decline proportion (up to 55 pts) and index return momentum (up to 45 pts), clamped 5-95.",
      interpretationRules: [
        "Risk score > 60 advises defensive posture, smaller position sizes, and tighter invalidation stops.",
        "Risk score <= 35 indicates supportive environment for momentum and breakout setups.",
      ],
      forbiddenInferences: [
        "Do not interpret as a calibrated mathematical probability of market decline.",
        "Do not attribute this metric to KFSP proprietary models.",
      ],
    },
    provenanceNote: "Heuristic tính từ tỷ lệ mã giảm và biến động VNIndex tại lib/insights-data.ts.",
  },
  {
    key: "kfsp_canslim_score",
    label: "Điểm CANSLIM",
    aliases: ["CANSLIM", "diem_canslim", "canslim_score", "canslim"],
    category: "quality",
    source: "kfsp",
    unit: "score_0_100",
    horizon: "quarterly",
    direction: "higher_is_supportive",
    beginner: {
      what: "Điểm sàng lọc tăng trưởng theo 7 tiêu chí CANSLIM của William O'Neil do KFSP cung cấp, thang điểm 0–100.",
      read: ">= 70: tiêu chí tăng trưởng tốt; 50–69: khá; < 50: yếu tố tăng trưởng chưa nổi bật.",
      combineWith: ["kfsp_score_4m", "rs_short", "kfsp_stock_rrg_state"],
      notMeaning: "Không biết chi tiết trọng số độc quyền của provider; điểm cao không tự tạo điểm mua nếu điểm vào kỹ thuật chưa xuất hiện.",
    },
    ai: {
      meaning: "Provider-calculated 0-100 composite score based on William O'Neil CANSLIM growth criteria.",
      interpretationRules: [
        "Score >= 70 confirms strong historical growth characteristics.",
        "Score < 50 indicates lagging growth credentials.",
      ],
      forbiddenInferences: [
        "Do not invent individual CANSLIM component weights or internal formulas.",
        "Do not assert that a high CANSLIM score alone creates an immediate trade entry.",
      ],
    },
    provenanceNote: "KFSP provider score từ bảng xếp hạng snapshot hàng ngày.",
  },
  {
    key: "kfsp_score_4m",
    label: "Điểm 4M",
    aliases: ["4M", "diem_4m", "score_4m", "fourm"],
    category: "quality",
    source: "kfsp",
    unit: "score_0_100",
    horizon: "quarterly",
    direction: "higher_is_supportive",
    beginner: {
      what: "Điểm đánh giá chất lượng và độ bền vững doanh nghiệp theo phương pháp 4M (Meaning, Moat, Management, Margin of Safety) do KFSP chấm, thang điểm 0–100.",
      read: ">= 70: chất lượng cơ bản vững chắc; 50–69: khá; < 50: lợi thế cạnh tranh hoặc sức khỏe tài chính chưa rõ.",
      combineWith: ["kfsp_canslim_score", "roe_ttm_pct", "pe_ttm", "pb_ttm"],
      notMeaning: "Không phải định giá mục tiêu và không thay thế việc phân tích báo cáo tài chính chi tiết.",
    },
    ai: {
      meaning: "Provider-calculated 0-100 score assessing business quality, competitive moat, and sustainability under 4M methodology.",
      interpretationRules: [
        "Score >= 70 indicates durable business moat and sound fundamentals.",
        "Combine with CANSLIM for dual quality-growth filtering.",
      ],
      forbiddenInferences: [
        "Do not state precise internal component weighting of KFSP 4M.",
        "Do not treat 4M score as fair value or intrinsic valuation target.",
      ],
    },
    provenanceNote: "KFSP provider score từ bảng xếp hạng snapshot hàng ngày.",
  },
  {
    key: "kfsp_price_potential",
    label: "Tiềm năng giá",
    aliases: ["tiem_nang_gia", "price_potential", "dinh_gia_kfsp"],
    category: "valuation",
    source: "kfsp",
    unit: "text",
    horizon: "medium_term",
    direction: "higher_is_supportive",
    beginner: {
      what: "Nhãn phân loại của KFSP AI so sánh mức giá hiện tại với giá trị nội tại ước tính của provider.",
      read: "Tăng ↑↑↑ hoặc Tăng ↑↑ thể hiện định giá còn dư địa lớn; Giảm ↓↓ cảnh báo thị giá cao hơn giá trị ước tính.",
      combineWith: ["kfsp_score_4m", "pe_ttm", "pb_ttm", "rs_short"],
      notMeaning: "Không phải giá mục tiêu (price target), không phải thời điểm kích hoạt lệnh và không phải cam kết lợi nhuận.",
    },
    ai: {
      meaning: "Provider qualitative classification comparing current price to estimated provider fair value.",
      interpretationRules: [
        "Higher upward potential (Tăng ↑↑↑) reflects wider estimated provider safety margin.",
        "Downward labels suggest current price exceeds provider estimate.",
      ],
      forbiddenInferences: [
        "Do not treat as a price target, guaranteed return, or timing signal.",
        "Do not label as QeoIndex intrinsic valuation model.",
      ],
    },
    provenanceNote: "KFSP AI qualitative label từ snapshot hàng ngày.",
  },
  {
    key: "kfsp_stock_rs_score",
    label: "RS-S cổ phiếu",
    aliases: ["stock_rs", "rs_s_co_phieu", "kfsp_stock_rs_score"],
    category: "relative_strength",
    source: "kfsp",
    unit: "score_0_100",
    horizon: "short_term",
    direction: "higher_is_supportive",
    beginner: {
      what: "Điểm sức mạnh giá tương đối của cổ phiếu so với toàn thị trường do KFSP tính, thang điểm 0–100.",
      read: ">= 80: thuộc top 20% cổ phiếu mạnh nhất; < 40: yếu hơn đa số thị trường.",
      combineWith: ["kfsp_sector_rs_score", "rs_medium", "kfsp_stock_rrg_state"],
      notMeaning: "Không phải chỉ báo dao động RSI và không dùng ngưỡng 100 của biểu đồ RRG.",
    },
    ai: {
      meaning: "KFSP 0-100 percentile relative strength score for the stock versus the market universe.",
      interpretationRules: [
        "Score >= 80 indicates top quintile relative strength.",
        "Score < 40 indicates lagging relative performance.",
      ],
      forbiddenInferences: [
        "Do not confuse 0-100 RS score with 0-100 RSI oscillator.",
        "Do not confuse 0-100 RS score with RRG 100-centered RS-Ratio axis.",
      ],
    },
    provenanceNote: "KFSP provider metric.",
  },
  {
    key: "kfsp_sector_rs_score",
    label: "RS-S ngành",
    aliases: ["sector_rs", "rs_nganh", "kfsp_sector_rs_score"],
    category: "relative_strength",
    source: "kfsp",
    unit: "score_0_100",
    horizon: "short_term",
    direction: "higher_is_supportive",
    beginner: {
      what: "Điểm sức mạnh giá tương đối của nhóm ngành so với thị trường, thang điểm 0–100.",
      read: ">= 70: ngành đang hút dòng tiền dẫn dắt; < 40: ngành yếu, thiếu lực đỡ chung.",
      combineWith: ["kfsp_stock_rs_score", "kfsp_sector_rrg_state"],
      notMeaning: "Ngành mạnh không đảm bảo mọi mã trong ngành đều tăng; vẫn cần lọc cổ phiếu dẫn đầu ngành.",
    },
    ai: {
      meaning: "KFSP 0-100 percentile relative strength score for the sector against other sectors.",
      interpretationRules: [
        "Score >= 70 indicates supportive sector tailwind.",
        "Sector RS < 40 suggests lack of group sponsorship.",
      ],
      forbiddenInferences: [
        "Do not assume all stocks in a strong sector are automatic buys.",
        "Do not mix sector score with stock score.",
      ],
    },
    provenanceNote: "KFSP provider metric.",
  },
  {
    key: "rs_short",
    label: "RSs — Sức mạnh ngắn hạn",
    aliases: ["RSs", "rs_short", "rss", "suc_manh_ngan_han"],
    category: "relative_strength",
    source: "kfsp",
    unit: "score_0_100",
    horizon: "1W-2W",
    direction: "higher_is_supportive",
    beginner: {
      what: "Sức mạnh giá tương đối ngắn hạn của cổ phiếu so với thị trường trong read-model của QeoIndex, thang điểm 0–100.",
      read: ">= 70: sức mạnh ngắn hạn vượt trội; 40–69: trung tính; < 40: yếu ngắn hạn.",
      combineWith: ["rs_medium", "kfsp_stock_rrg_state", "weekly_change_pct"],
      notMeaning: "Không phải chỉ báo RSI 14 phiên; không dùng mốc cân bằng 100 của RRG.",
    },
    ai: {
      meaning: "Short-term relative price strength on a 0-100 scale normalized in QeoIndex read-model.",
      interpretationRules: [
        "RSs > 70 indicates strong short-term outperformance.",
        "RSs < 40 indicates short-term lagging.",
      ],
      forbiddenInferences: [
        "Never confuse RSs with RSI (Relative Strength Index).",
        "Never apply RRG 100 baseline to RSs 0-100 scale.",
      ],
    },
    provenanceNote: "Mapped from provider rs_s / rs_short.",
  },
  {
    key: "rs_medium",
    label: "RSm — Sức mạnh trung hạn",
    aliases: ["RSm", "rs_medium", "rsm", "suc_manh_trung_han"],
    category: "relative_strength",
    source: "kfsp",
    unit: "score_0_100",
    horizon: "1M-3M",
    direction: "higher_is_supportive",
    beginner: {
      what: "Sức mạnh giá tương đối trung hạn của cổ phiếu so với thị trường, thang điểm 0–100.",
      read: ">= 70 kết hợp RSs cao thể hiện xu hướng bền vững; nếu RSs giảm nhưng RSm cao là nhịp điều chỉnh trong trend lớn.",
      combineWith: ["rs_short", "monthly_change_pct", "kfsp_score_4m"],
      notMeaning: "Không phải RS-Momentum của RRG và không phải RSI.",
    },
    ai: {
      meaning: "Medium-term relative price strength on a 0-100 scale normalized in QeoIndex read-model.",
      interpretationRules: [
        "RSm > 70 confirms sustained medium-term outperformance.",
        "RSs > RSm indicates accelerating short-term momentum; RSs < RSm indicates momentum pullback.",
      ],
      forbiddenInferences: [
        "Do not confuse RSm with RRG RS-Momentum coordinate.",
        "Do not confuse with RSI.",
      ],
    },
    provenanceNote: "Mapped from provider rs_m_co_phieu / rs_medium.",
  },
  {
    key: "kfsp_stock_rrg_state",
    label: "RRG cổ phiếu",
    aliases: ["RRG", "rrg_co_phieu", "stock_rrg", "kfsp_stock_rrg_state"],
    category: "rotation",
    source: "kfsp",
    unit: "state",
    horizon: "medium_term",
    direction: "categorical",
    beginner: {
      what: "Trạng thái luân chuyển của cổ phiếu theo 4 góc phần tư RRG (Relative Rotation Graph): Dẫn dắt, Suy yếu, Đội sổ, Phục hồi.",
      read: "Dẫn dắt: RS mạnh & gia tốc tăng; Suy yếu: RS mạnh nhưng giảm tốc; Đội sổ: RS yếu & giảm tốc; Phục hồi: RS yếu nhưng đang tăng tốc.",
      combineWith: ["kfsp_sector_rrg_state", "rs_short", "rs_medium"],
      notMeaning: "Trạng thái tĩnh không cho biết hướng xoay và độ dài vector; một điểm Dẫn dắt có thể đang mất đà, Phục hồi vẫn đang dưới benchmark.",
    },
    ai: {
      meaning: "Categorical quadrant state of stock in Relative Rotation Graph (Dẫn dắt / Suy yếu / Đội sổ / Phục hồi) based on RS-Ratio and RS-Momentum.",
      interpretationRules: [
        "Dẫn dắt (Leading) indicates high relative strength.",
        "Phục hồi (Improving) indicates momentum turning up while RS is still below benchmark.",
        "Suy yếu (Weakening) indicates losing momentum.",
        "Đội sổ (Lagging) indicates underperformance.",
      ],
      forbiddenInferences: [
        "Do not assert rotation trajectory direction or velocity when packet lacks time-series vector.",
        "Do not make buy/sell inferences purely from categorical state.",
      ],
    },
    provenanceNote: "KFSP RRG quadrant state.",
  },
  {
    key: "kfsp_sector_rrg_state",
    label: "RRG ngành",
    aliases: ["rrg_nganh", "sector_rrg", "kfsp_sector_rrg_state"],
    category: "rotation",
    source: "kfsp",
    unit: "state",
    horizon: "medium_term",
    direction: "categorical",
    beginner: {
      what: "Trạng thái luân chuyển của nhóm ngành theo 4 góc phần tư RRG so với VNIndex.",
      read: "Ưu tiên chọn cổ phiếu khi ngành của nó nằm ở Dẫn dắt hoặc Phục hồi.",
      combineWith: ["kfsp_stock_rrg_state", "kfsp_sector_rs_score"],
      notMeaning: "Không phản ánh vị thế của từng mã riêng lẻ trong ngành.",
    },
    ai: {
      meaning: "Categorical quadrant state of sector in Relative Rotation Graph.",
      interpretationRules: [
        "Sector in Leading/Improving provides group backdrop sponsorship.",
        "Sector in Lagging warns of structural headwind.",
      ],
      forbiddenInferences: [
        "Do not claim sector rotation direction without historical trail.",
      ],
    },
    provenanceNote: "KFSP RRG quadrant state cho ngành.",
  },
  {
    key: "weekly_change_pct",
    label: "Biến động tuần (1W)",
    aliases: ["1W", "weekly_change", "weekly_change_pct", "eod_week", "bien_dong_tuan"],
    category: "momentum",
    source: "kfsp",
    unit: "percent",
    horizon: "1W",
    direction: "higher_is_supportive",
    beginner: {
      what: "Phần trăm thay đổi giá của cổ phiếu trong cửa sổ 1 tuần theo tính toán của provider.",
      read: "Tăng mạnh (> +5%) cho thấy đà bứt phá ngắn hạn; giảm sâu (> -5%) cảnh báo áp lực chốt lời/bán mạnh.",
      combineWith: ["monthly_change_pct", "price_vs_sma20_pct", "volume_vs_previous_session_pct"],
      notMeaning: "Đây là biến động cửa sổ provider, không phải delta snapshot 7D trong dialog lịch sử của QeoIndex.",
    },
    ai: {
      meaning: "1-week price change percentage calculated in provider snapshot window.",
      interpretationRules: [
        "Use with monthly change to measure momentum acceleration or exhaustion.",
      ],
      forbiddenInferences: [
        "Do not confuse provider 1W change with QeoIndex 7D snapshot delta.",
      ],
    },
    provenanceNote: "KFSP provider metric eod_week.",
  },
  {
    key: "monthly_change_pct",
    label: "Biến động tháng (1M)",
    aliases: ["1M", "monthly_change", "monthly_change_pct", "eod_month", "bien_dong_thang"],
    category: "momentum",
    source: "kfsp",
    unit: "percent",
    horizon: "1M",
    direction: "higher_is_supportive",
    beginner: {
      what: "Phần trăm thay đổi giá của cổ phiếu trong cửa sổ 1 tháng theo provider.",
      read: "Thể hiện xu hướng giá trung hạn; so sánh với 1W để biết đà tăng đang tăng tốc hay chững lại.",
      combineWith: ["weekly_change_pct", "rs_medium", "price_vs_sma50_pct"],
      notMeaning: "Không phải delta snapshot 30D của QeoIndex history dialog.",
    },
    ai: {
      meaning: "1-month price change percentage calculated in provider snapshot window.",
      interpretationRules: [
        "Measures medium-term price trend progression.",
      ],
      forbiddenInferences: [
        "Do not confuse provider 1M change with QeoIndex 30D snapshot delta.",
      ],
    },
    provenanceNote: "KFSP provider metric eod_month.",
  },
  {
    key: "kfsp_composite_score",
    label: "Qeo composite",
    aliases: ["rating", "rating_score", "kfsp_composite_score", "diem_tong_hop"],
    category: "quality",
    source: "qeoindex",
    unit: "score_0_100",
    horizon: "daily",
    direction: "higher_is_supportive",
    beginner: {
      what: "Điểm tổng hợp do QeoIndex tính bằng trung bình cộng số học (arithmetic mean) của các chỉ số sẵn có: 4M, CANSLIM, RS-S cổ phiếu, RS-S ngành.",
      read: ">= 75: thuộc nhóm toàn diện hàng đầu; 60–74: khá tốt; < 50: thiếu động lực tổng thể. Các thành phần null bị loại khỏi phép tính trung bình.",
      combineWith: ["kfsp_score_4m", "kfsp_canslim_score", "rs_short", "kfsp_stock_rrg_state"],
      notMeaning: "Không phải khuyến nghị của provider, không phải xác suất tăng giá và không phải alpha đã backtest.",
    },
    ai: {
      meaning: "QeoIndex composite score calculated as arithmetic mean of available components (4M, CANSLIM, stock RS-S, sector RS-S); null components excluded.",
      interpretationRules: [
        "Score >= 75 indicates broad multi-factor alignment.",
        "Check component breakdown to ensure score is not skewed by a single factor.",
      ],
      forbiddenInferences: [
        "Do not treat as provider investment recommendation, probability of price appreciation, or backtested alpha.",
      ],
    },
    provenanceNote: "Công thức mean(4M, CANSLIM, stock RS-S, sector RS-S) tại supabase/functions/kfsp-rating-sync/index.ts.",
  },
  {
    key: "beta",
    label: "Hệ số Beta",
    aliases: ["Beta", "beta", "he_so_beta"],
    category: "risk",
    source: "kfsp",
    unit: "ratio",
    horizon: "historical",
    direction: "higher_is_risk",
    beginner: {
      what: "Hệ số đo lường độ biến động và độ nhạy của giá cổ phiếu so với biến động chung của thị trường.",
      read: "Beta > 1.2: biến động mạnh hơn thị trường; Beta < 0.8: phòng thủ, biến động thấp hơn thị trường.",
      combineWith: ["market_risk_score", "price_vs_sma50_pct", "weekly_change_pct"],
      notMeaning: "Không đo lường mọi loại rủi ro (phi hệ thống, thanh khoản) và không dự báo chiều đi của giá.",
    },
    ai: {
      meaning: "Market sensitivity coefficient relative to the VNIndex.",
      interpretationRules: [
        "Beta > 1.3 increases volatility risk in down markets.",
        "Beta < 0.8 provides defensive low-correlation characteristics.",
      ],
      forbiddenInferences: [
        "Do not treat Beta as a direction predictor or sole risk measurement.",
      ],
    },
    provenanceNote: "KFSP provider valuation / price volatility metric.",
  },
  {
    key: "pe_ttm",
    label: "P/E (TTM)",
    aliases: ["P/E", "pe", "pe_ttm", "he_so_pe", "dinh_gia_pe"],
    category: "valuation",
    source: "kfsp",
    unit: "ratio",
    horizon: "trailing_12m",
    direction: "higher_is_risk",
    beginner: {
      what: "Tỷ số giá thị trường trên lợi nhuận mỗi cổ phiếu trong 12 tháng gần nhất (Trailing Twelve Months).",
      read: "P/E thấp so với ngành có thể do định giá rẻ hoặc do triển vọng tăng trưởng suy giảm; P/E cao đòi hỏi tăng trưởng lợi nhuận cao bù đắp.",
      combineWith: ["pb_ttm", "net_income_growth_pct", "roe_ttm_pct", "kfsp_score_4m"],
      notMeaning: "P/E thấp không có nghĩa là cổ phiếu an toàn để mua ngay (nguy cơ bẫy giá trị).",
    },
    ai: {
      meaning: "Price to earnings ratio based on trailing twelve months earnings.",
      interpretationRules: [
        "Evaluate P/E in context of sector average and earnings growth rate.",
      ],
      forbiddenInferences: [
        "Do not infer undervaluation from low P/E alone without examining earnings quality.",
      ],
    },
    provenanceNote: "KFSP valuation metric.",
  },
  {
    key: "pb_ttm",
    label: "P/B (TTM)",
    aliases: ["P/B", "pb", "pb_ttm", "he_so_pb", "dinh_gia_pb"],
    category: "valuation",
    source: "kfsp",
    unit: "ratio",
    horizon: "trailing_12m",
    direction: "higher_is_risk",
    beginner: {
      what: "Tỷ số giá thị trường trên giá trị sổ sách mỗi cổ phiếu 12 tháng gần nhất.",
      read: "Thường dùng cho ngành tài chính, ngân hàng, bất động sản; P/B < 1 có thể phản ánh thị giá dưới giá trị tài sản ròng.",
      combineWith: ["pe_ttm", "roe_ttm_pct", "kfsp_score_4m"],
      notMeaning: "P/B thấp không phản ánh chất lượng tài sản thực tế nếu tài sản có nguy cơ trích lập giảm giá.",
    },
    ai: {
      meaning: "Price to book value ratio based on trailing twelve months book value.",
      interpretationRules: [
        "Useful for capital-intensive, financial, and banking sectors.",
        "High ROE with moderate P/B indicates efficient capital generation.",
      ],
      forbiddenInferences: [
        "Do not assume asset value is liquid or accurately stated when P/B is below 1.",
      ],
    },
    provenanceNote: "KFSP valuation metric.",
  },
  {
    key: "net_revenue_growth_pct",
    label: "Tăng trưởng doanh thu",
    aliases: ["revenue_growth", "tang_truong_doanh_thu", "net_revenue_growth_pct"],
    category: "quality",
    source: "kfsp",
    unit: "percent",
    horizon: "quarterly_or_ttm",
    direction: "higher_is_supportive",
    beginner: {
      what: "Tốc độ tăng trưởng doanh thu thuần so với cùng kỳ năm trước.",
      read: "> 20% là tăng trưởng mạnh, đáp ứng tiêu chuẩn tăng trưởng CANSLIM.",
      combineWith: ["net_income_growth_pct", "net_margin_ttm_pct", "kfsp_canslim_score"],
      notMeaning: "Doanh thu tăng nhưng lợi nhuận giảm cho thấy biên lãi đang bị bào mòn.",
    },
    ai: {
      meaning: "Net revenue growth percentage versus comparable period.",
      interpretationRules: [
        "Growth > 20% supports CANSLIM growth criteria.",
        "Divergence between revenue growth and income growth highlights margin dynamics.",
      ],
      forbiddenInferences: [
        "Do not extrapolate historical growth without industry demand context.",
      ],
    },
    provenanceNote: "KFSP fundamentals metric.",
  },
  {
    key: "net_income_growth_pct",
    label: "Tăng trưởng LN sau thuế",
    aliases: ["net_income_growth", "tang_truong_loi_nhuan", "net_income_growth_pct"],
    category: "quality",
    source: "kfsp",
    unit: "percent",
    horizon: "quarterly_or_ttm",
    direction: "higher_is_supportive",
    beginner: {
      what: "Tốc độ tăng trưởng lợi nhuận sau thuế so với cùng kỳ.",
      read: "> 25% là tiêu chuẩn tăng trưởng xuất sắc theo CANSLIM; cần kiểm tra lợi nhuận từ cốt lõi hay bất thường.",
      combineWith: ["net_revenue_growth_pct", "roe_ttm_pct", "kfsp_canslim_score"],
      notMeaning: "Lợi nhuận tăng đột biến từ bán tài sản hoặc thu nhập một lần không tạo ra tăng trưởng bền vững.",
    },
    ai: {
      meaning: "Net income growth percentage versus comparable period.",
      interpretationRules: [
        "Growth > 25% provides strong fundamental acceleration evidence.",
        "Scrutinize whether growth stems from operations or non-operating gains.",
      ],
      forbiddenInferences: [
        "Do not assume one-off earnings spikes represent core operating momentum.",
      ],
    },
    provenanceNote: "KFSP fundamentals metric.",
  },
  {
    key: "roe_ttm_pct",
    label: "ROE (TTM)",
    aliases: ["ROE", "roe", "roe_ttm_pct", "ty_suat_loi_nhuan_von_chu"],
    category: "quality",
    source: "kfsp",
    unit: "percent",
    horizon: "trailing_12m",
    direction: "higher_is_supportive",
    beginner: {
      what: "Tỷ suất sinh lời trên vốn chủ sở hữu trong 12 tháng gần nhất (Return on Equity).",
      read: ">= 17% là doanh nghiệp sử dụng vốn rất hiệu quả theo tiêu chí 4M/CANSLIM; < 10% là hiệu quả thấp.",
      combineWith: ["net_margin_ttm_pct", "pb_ttm", "kfsp_score_4m"],
      notMeaning: "ROE cao do dùng đòn bẩy nợ quá lớn có thể tiềm ẩn rủi ro tài chính cao.",
    },
    ai: {
      meaning: "Return on equity percentage over trailing twelve months.",
      interpretationRules: [
        "ROE >= 17% satisfies high-quality hurdle.",
        "Combine with debt/leverage indicators to assess quality of return.",
      ],
      forbiddenInferences: [
        "Do not assume high ROE is sustainable if driven solely by high financial leverage.",
      ],
    },
    provenanceNote: "KFSP fundamentals metric.",
  },
  {
    key: "net_margin_ttm_pct",
    label: "Biên lợi nhuận ròng",
    aliases: ["net_margin", "bien_loi_nhuan_rong", "net_margin_ttm_pct"],
    category: "quality",
    source: "kfsp",
    unit: "percent",
    horizon: "trailing_12m",
    direction: "higher_is_supportive",
    beginner: {
      what: "Tỷ lệ lợi nhuận sau thuế trên doanh thu thuần 12 tháng gần nhất.",
      read: "Biên lãi cao và ổn định hoặc mở rộng thể hiện lợi thế cạnh tranh (Moat) và quyền định giá của doanh nghiệp.",
      combineWith: ["net_revenue_growth_pct", "roe_ttm_pct", "kfsp_score_4m"],
      notMeaning: "Biên lãi cao trong ngành có tính chu kỳ có thể đã đạt đỉnh của chu kỳ kinh doanh.",
    },
    ai: {
      meaning: "Net profit margin percentage (net income / net revenue) over trailing twelve months.",
      interpretationRules: [
        "Expanding net margin indicates pricing power and operating leverage.",
      ],
      forbiddenInferences: [
        "Do not treat cyclical peak margins as permanent moats.",
      ],
    },
    provenanceNote: "KFSP fundamentals metric.",
  },
  {
    key: "price_vs_sma10_pct",
    label: "Giá vs SMA10",
    aliases: ["price_vs_sma10", "price_vs_sma10_pct", "gia_vs_sma10"],
    category: "momentum",
    source: "kfsp",
    unit: "percent",
    horizon: "10D",
    direction: "higher_is_supportive",
    beginner: {
      what: "Khoảng cách phần trăm giữa giá hiện tại và đường trung bình động 10 phiên.",
      read: "Giá > SMA10 thể hiện xung lực tăng siêu ngắn hạn tích cực.",
      combineWith: ["price_vs_sma20_pct", "rsi_14"],
      notMeaning: "Không khẳng định giá không đảo chiều trong phiên.",
    },
    ai: {
      meaning: "Percentage distance of current price from 10-day simple moving average.",
      interpretationRules: ["Positive value reflects ultra-short-term momentum."],
      forbiddenInferences: ["Do not use SMA10 alone as trend confirmation without medium-term SMAs."],
    },
    provenanceNote: "KFSP technical metric.",
  },
  {
    key: "price_vs_sma20_pct",
    label: "Giá vs SMA20",
    aliases: ["price_vs_sma20", "price_vs_sma20_pct", "gia_vs_sma20"],
    category: "momentum",
    source: "kfsp",
    unit: "percent",
    horizon: "20D",
    direction: "higher_is_supportive",
    beginner: {
      what: "Khoảng cách phần trăm giữa giá hiện tại và đường trung bình động 20 phiên.",
      read: "Giá > SMA20 xác nhận xu hướng ngắn hạn tích cực; đường SMA20 đóng vai trò hỗ trợ động.",
      combineWith: ["price_vs_sma50_pct", "macd_vs_signal", "weekly_change_pct"],
      notMeaning: "Vượt SMA20 có thể là cú nảy kỹ thuật nếu thiếu khối lượng xác nhận.",
    },
    ai: {
      meaning: "Percentage distance of current price from 20-day simple moving average.",
      interpretationRules: ["Price above SMA20 denotes constructive short-term trend."],
      forbiddenInferences: ["Do not treat SMA20 cross as definitive trend change without volume confirmation."],
    },
    provenanceNote: "KFSP technical metric.",
  },
  {
    key: "price_vs_sma50_pct",
    label: "Giá vs SMA50",
    aliases: ["price_vs_sma50", "price_vs_sma50_pct", "gia_vs_sma50"],
    category: "momentum",
    source: "kfsp",
    unit: "percent",
    horizon: "50D",
    direction: "higher_is_supportive",
    beginner: {
      what: "Khoảng cách phần trăm giữa giá hiện tại và đường trung bình động 50 phiên.",
      read: "Đường SMA50 là ranh giới xu hướng trung hạn; giá nằm trên SMA50 cho thấy xu hướng trung hạn tích cực và SMA50 thường được theo dõi như hỗ trợ động.",
      combineWith: ["price_vs_sma20_pct", "price_vs_sma200_pct", "rs_medium"],
      notMeaning: "Khoảng cách quá xa (> 15-20% trên SMA50) cảnh báo rủi ro điều chỉnh kỹ thuật.",
    },
    ai: {
      meaning: "Percentage distance of current price from 50-day simple moving average.",
      interpretationRules: [
        "Price > SMA50 establishes medium-term bullish baseline.",
        "Extension > 15% above SMA50 signals mean-reversion risk.",
      ],
      forbiddenInferences: ["Do not assume price cannot pull back to test SMA50 support."],
    },
    provenanceNote: "KFSP technical metric.",
  },
  {
    key: "price_vs_sma100_pct",
    label: "Giá vs SMA100",
    aliases: ["price_vs_sma100", "price_vs_sma100_pct", "gia_vs_sma100"],
    category: "momentum",
    source: "kfsp",
    unit: "percent",
    horizon: "100D",
    direction: "higher_is_supportive",
    beginner: {
      what: "Khoảng cách phần trăm giữa giá hiện tại và đường trung bình động 100 phiên.",
      read: "Hỗ trợ xác nhận xu hướng trung-dài hạn.",
      combineWith: ["price_vs_sma50_pct", "price_vs_sma200_pct"],
      notMeaning: "Không phải điểm mua ngắn hạn.",
    },
    ai: {
      meaning: "Percentage distance of current price from 100-day simple moving average.",
      interpretationRules: ["Provides intermediate trend support context."],
      forbiddenInferences: ["Do not use for short-term trade timing."],
    },
    provenanceNote: "KFSP technical metric.",
  },
  {
    key: "price_vs_sma200_pct",
    label: "Giá vs SMA200",
    aliases: ["price_vs_sma200", "price_vs_sma200_pct", "gia_vs_sma200"],
    category: "momentum",
    source: "kfsp",
    unit: "percent",
    horizon: "200D",
    direction: "higher_is_supportive",
    beginner: {
      what: "Khoảng cách phần trăm giữa giá hiện tại và đường trung bình động dài hạn 200 phiên.",
      read: "Giá > SMA200 khẳng định chu kỳ tăng dài hạn (major bull cycle).",
      combineWith: ["price_vs_sma50_pct", "kfsp_score_4m", "monthly_change_pct"],
      notMeaning: "Giá nằm trên SMA200 không loại trừ các nhịp chỉnh 10-15% trong xu hướng lớn.",
    },
    ai: {
      meaning: "Percentage distance of current price from 200-day simple moving average.",
      interpretationRules: ["Price > SMA200 defines structural macro bull posture."],
      forbiddenInferences: ["Do not assume structural bull prevents severe cyclical pullbacks."],
    },
    provenanceNote: "KFSP technical metric.",
  },
  {
    key: "rsi_14",
    label: "RSI (14)",
    aliases: ["RSI", "rsi_14", "rsi", "suc_manh_tuong_quan_rsi"],
    category: "momentum",
    source: "kfsp",
    unit: "score_0_100",
    horizon: "14D",
    direction: "context_only",
    beginner: {
      what: "Chỉ báo sức mạnh tương quan 14 phiên (Relative Strength Index), đo lường tốc độ và sự thay đổi của biến động giá trên thang 0–100.",
      read: "RSI > 70: vùng quá mua (overbought); RSI < 30: vùng quá bán (oversold); 45–60: vùng cân bằng/tích lũy lành mạnh.",
      combineWith: ["price_vs_sma20_pct", "macd_vs_signal", "rs_short"],
      notMeaning: "RSI là chỉ báo dao động (oscillator) 14 phiên, KHÁC HOÀN TOÀN với điểm sức mạnh tương đối RSs/RSm và KHÁC với biểu đồ RRG.",
    },
    ai: {
      meaning: "14-period Relative Strength Index oscillator bounded between 0 and 100.",
      interpretationRules: [
        "RSI > 70 denotes overbought condition and elevated pullback risk.",
        "RSI < 30 denotes oversold condition.",
        "RSI 50-65 in uptrends indicates healthy momentum continuation.",
      ],
      forbiddenInferences: [
        "NEVER confuse RSI oscillator with RS relative strength score (RSs/RSm).",
        "Do not treat RSI > 70 as an automatic sell trigger in strong momentum breakouts.",
      ],
    },
    provenanceNote: "KFSP technical indicator rsi_14.",
  },
  {
    key: "macd_vs_signal",
    label: "MACD vs Signal",
    aliases: ["macd", "macd_vs_signal", "vi_tri_macd"],
    category: "momentum",
    source: "kfsp",
    unit: "text",
    horizon: "technical",
    direction: "categorical",
    beginner: {
      what: "Vị thế của đường MACD so với đường tín hiệu (Signal Line).",
      read: "MACD cắt lên trên Signal: tín hiệu động lượng tăng phát triển; MACD cắt xuống dưới Signal: cảnh báo suy yếu động lượng.",
      combineWith: ["price_vs_sma20_pct", "rsi_14", "volume_vs_previous_session_pct"],
      notMeaning: "Có thể phát tín hiệu nhiễu khi thị trường đi ngang (sideway) trong biên hẹp.",
    },
    ai: {
      meaning: "Relative position of MACD line versus its signal line.",
      interpretationRules: [
        "Bullish crossover indicates expanding positive momentum.",
        "Bearish crossover warns of loss of momentum.",
      ],
      forbiddenInferences: ["Do not rely on MACD crossovers during tight consolidation/sideway regimes."],
    },
    provenanceNote: "KFSP technical metric.",
  },
  {
    key: "volume_1d",
    label: "KLGD 1D",
    aliases: ["volume_1d", "klgd_hom_nay", "klgd_1d", "volume"],
    category: "liquidity",
    source: "kfsp",
    unit: "volume",
    horizon: "1D",
    direction: "higher_is_supportive",
    beginner: {
      what: "Khối lượng giao dịch của phiên gần nhất.",
      read: "So sánh với KLGD TB 20 phiên để đo mức độ sôi động của dòng tiền.",
      combineWith: ["average_volume_20d", "volume_vs_previous_session_pct", "weekly_change_pct"],
      notMeaning: "KLGD cao ở phiên giảm mạnh thể hiện cung lớn, không phải tín hiệu tích cực.",
    },
    ai: {
      meaning: "Single session trading volume.",
      interpretationRules: ["Assess relative to 20-day volume baseline."],
      forbiddenInferences: ["Do not evaluate volume without considering candle direction and spread."],
    },
    provenanceNote: "KFSP liquidity metric.",
  },
  {
    key: "average_volume_20d",
    label: "KLGD TB 20D",
    aliases: ["average_volume_20d", "klgd_tb_20d", "klgd_tb_20_ngay"],
    category: "liquidity",
    source: "kfsp",
    unit: "volume",
    horizon: "20D",
    direction: "higher_is_supportive",
    beginner: {
      what: "Khối lượng giao dịch trung bình trong 20 phiên gần nhất.",
      read: "Dùng làm mốc tham chiếu chuẩn để nhận diện phiên đột biến khối lượng.",
      combineWith: ["volume_1d", "volume_vs_previous_session_pct"],
      notMeaning: "Không phải khối lượng mua ròng.",
    },
    ai: {
      meaning: "20-day average trading volume baseline.",
      interpretationRules: ["Volume > 1.5x 20-day average denotes elevated market participation/activity; participant identity is unknown from aggregate volume alone."],
      forbiddenInferences: ["Do not treat baseline average as evidence of any participant class intent."],
    },
    provenanceNote: "KFSP liquidity metric.",
  },
  {
    key: "volume_vs_previous_session_pct",
    label: "KLGD vs phiên trước",
    aliases: ["volume_vs_prev", "volume_vs_previous_session_pct", "klgd_vs_hom_qua"],
    category: "liquidity",
    source: "kfsp",
    unit: "percent",
    horizon: "1D",
    direction: "context_only",
    beginner: {
      what: "Tỷ lệ phần trăm thay đổi khối lượng giao dịch so với phiên liền trước.",
      read: "Khối lượng tăng mạnh (> 50%) kèm giá tăng bứt phá xác nhận xung lực mua chủ động.",
      combineWith: ["traded_value_vs_previous_session_pct", "weekly_change_pct"],
      notMeaning: "Khối lượng tăng không đồng nghĩa với gom hàng nếu giá giảm sâu.",
    },
    ai: {
      meaning: "Percentage change in daily volume relative to previous trading session.",
      interpretationRules: [
        "Volume expansion on breakout confirms demand conviction.",
        "Volume contraction on mild pullback indicates healthy lack of supply.",
      ],
      forbiddenInferences: ["Do not infer accumulation without price confirmation."],
    },
    provenanceNote: "KFSP liquidity metric.",
  },
  {
    key: "traded_value_vs_previous_session_pct",
    label: "GTGD vs phiên trước",
    aliases: ["traded_value_vs_prev", "traded_value_vs_previous_session_pct", "gtgd_vs_hom_qua"],
    category: "liquidity",
    source: "kfsp",
    unit: "percent",
    horizon: "1D",
    direction: "context_only",
    beginner: {
      what: "Tỷ lệ phần trăm thay đổi giá trị giao dịch so với phiên liền trước.",
      read: "Cho biết quy mô dòng tiền bằng tiền mặt tăng hay giảm so với phiên trước.",
      combineWith: ["volume_vs_previous_session_pct", "market_liquidity"],
      notMeaning: "Không phân biệt được giá trị do lệnh mua hay lệnh bán chủ động.",
    },
    ai: {
      meaning: "Percentage change in traded value relative to previous trading session.",
      interpretationRules: ["Value expansion confirms larger monetary commitment."],
      forbiddenInferences: ["Do not infer buyer dominance from aggregate traded value alone."],
    },
    provenanceNote: "KFSP liquidity metric.",
  },
  {
    key: "net_foreign_trading_billion",
    label: "GD Khối ngoại ròng",
    aliases: ["net_foreign", "net_foreign_trading_billion", "gd_nuoc_ngoai_rong"],
    category: "liquidity",
    source: "kfsp",
    unit: "billion_vnd",
    horizon: "1D",
    direction: "context_only",
    beginner: {
      what: "Giá trị mua ròng hoặc bán ròng của nhà đầu tư nước ngoài trong phiên, đơn vị tỷ đồng.",
      read: "Dương là mua ròng; âm là bán ròng. Mua ròng liên tục tạo lực cầu hỗ trợ thị giá.",
      combineWith: ["net_proprietary_trading_billion", "volume_1d", "weekly_change_pct"],
      notMeaning: "Khối ngoại chỉ chiếm khoảng 8-12% thanh khoản toàn thị trường; không quyết định tuyệt đối xu hướng.",
    },
    ai: {
      meaning: "Net buy/sell value in billion VND by foreign investors for the session.",
      interpretationRules: [
        "Positive value denotes foreign net buying tailwind.",
        "Persistent negative value acts as supply overhang.",
      ],
      forbiddenInferences: ["Do not treat foreign trading as sole determinant of trend direction."],
    },
    provenanceNote: "KFSP general trading-flow metric.",
  },
  {
    key: "net_proprietary_trading_billion",
    label: "GD Tự doanh ròng",
    aliases: ["net_proprietary", "net_proprietary_trading_billion", "gd_tu_doanh_rong"],
    category: "liquidity",
    source: "kfsp",
    unit: "billion_vnd",
    horizon: "1D",
    direction: "context_only",
    beginner: {
      what: "Giá trị mua ròng hoặc bán ròng của khối tự doanh các công ty chứng khoán trong phiên, đơn vị tỷ đồng.",
      read: "Dương là mua ròng; âm là bán ròng.",
      combineWith: ["net_foreign_trading_billion", "volume_1d"],
      notMeaning: "Tự doanh có thể giao dịch phục vụ phòng vệ chứng quyền/phái sinh chứ không chỉ đầu tư thuần túy.",
    },
    ai: {
      meaning: "Net buy/sell value in billion VND by securities company proprietary trading desks for the session.",
      interpretationRules: ["Positive value denotes proprietary net accumulation support."],
      forbiddenInferences: ["Do not ignore that proprietary flow may hedge derivatives/covered warrants."],
    },
    provenanceNote: "KFSP general trading-flow metric.",
  },
  {
    key: "vnindex_close",
    label: "VNIndex Đóng cửa",
    aliases: ["vnindex_close", "vnindex_price", "diem_vnindex"],
    category: "market",
    source: "qeoindex",
    unit: "price_thousand_vnd",
    horizon: "1D",
    direction: "higher_is_supportive",
    beginner: {
      what: "Điểm số đóng cửa của chỉ số VNIndex tại ngày snapshot.",
      read: "So sánh điểm số với các mốc hỗ trợ, kháng cự và đường SMA20 để xác định bối cảnh thị trường chung.",
      combineWith: ["vnindex_sma20", "vnindex_return_20d_pct", "market_risk_score"],
      notMeaning: "Điểm số chỉ số không thay thế việc phân tích từng nhóm ngành và từng cổ phiếu cụ thể.",
    },
    ai: {
      meaning: "Closing level of the VNIndex benchmark for the specified snapshot date.",
      interpretationRules: ["Serves as broad-market reference baseline for relative strength comparisons."],
      forbiddenInferences: ["Do not cite external intraday price levels not included in the evidence packet."],
    },
    provenanceNote: "Market feed quote tại lib/ai-council-market.ts.",
  },
  {
    key: "vnindex_sma20",
    label: "VNIndex SMA20",
    aliases: ["vnindex_sma20", "sma20_vnindex"],
    category: "market",
    source: "qeoindex",
    unit: "price_thousand_vnd",
    horizon: "20D",
    direction: "higher_is_supportive",
    beginner: {
      what: "Đường trung bình động 20 phiên của chỉ số VNIndex.",
      read: "VNIndex đóng cửa trên SMA20 cho thấy thị trường đang trong xu hướng tăng ngắn hạn.",
      combineWith: ["vnindex_close", "vnindex_regime", "market_breadth"],
      notMeaning: "close > sma20 chỉ là vị thế xu hướng trung hạn, không tự chứng minh môi trường hoàn toàn risk-on không rủi ro.",
    },
    ai: {
      meaning: "20-day simple moving average of the VNIndex benchmark.",
      interpretationRules: [
        "VNIndex close above SMA20 reflects constructive intermediate posture.",
        "VNIndex close below SMA20 indicates intermediate trend weakness.",
      ],
      forbiddenInferences: [
        "Close > SMA20 alone does not prove unconditional risk-on or guarantee breakout success.",
      ],
    },
    provenanceNote: "Market benchmark derivation tại lib/ai-council-market.ts.",
  },
  {
    key: "vnindex_return_20d_pct",
    label: "VNIndex Biến động 20D",
    aliases: ["vnindex_return_20d", "vnindex_return_20d_pct", "hieu_suat_20d_vnindex"],
    category: "market",
    source: "qeoindex",
    unit: "percent",
    horizon: "20D",
    direction: "higher_is_supportive",
    beginner: {
      what: "Hiệu suất thay đổi phần trăm của chỉ số VNIndex trong 20 phiên giao dịch gần nhất.",
      read: "> +2%: thị trường có đà tăng trưởng tốt; < -2%: thị trường đang suy yếu trong 20 phiên.",
      combineWith: ["vnindex_regime", "market_risk_score"],
      notMeaning: "Hiệu suất quá khứ 20 phiên không dự báo chắc chắn 20 phiên tiếp theo.",
    },
    ai: {
      meaning: "20-session trailing return percentage of the VNIndex benchmark.",
      interpretationRules: [
        "Return > +2% supports constructive/bullish regime categorization.",
        "Return < -2% supports defensive/bearish regime categorization.",
      ],
      forbiddenInferences: ["Do not extrapolate trailing 20-session return as guaranteed future trajectory."],
    },
    provenanceNote: "Market benchmark derivation tại lib/ai-council-market.ts.",
  },
  {
    key: "vnindex_regime",
    label: "Trạng thái thị trường (Regime)",
    aliases: ["vnindex_regime", "market_regime", "che_do_thi_truong"],
    category: "market",
    source: "qeoindex",
    unit: "state",
    horizon: "multi_session",
    direction: "categorical",
    beginner: {
      what: "Phân loại trạng thái thị trường chung (bull, neutral, bear, distribution) dựa trên vị thế VNIndex so với SMA20 và ngưỡng return 20 phiên ±2%.",
      read: "Bull: môi trường thuận lợi để giải ngân; Bear: thận trọng, giảm tỷ trọng; Neutral: chọn lọc kỹ.",
      combineWith: ["market_risk_score", "market_breadth", "market_liquidity"],
      notMeaning: "Regime thị trường là bối cảnh tham khảo, không thay thế tín hiệu xác nhận của từng mã cổ phiếu.",
    },
    ai: {
      meaning: "Derived market regime (e.g. bull, neutral, bear, distribution) computed from VNIndex close vs SMA20 and ±2% 20-day return thresholds.",
      interpretationRules: [
        "Bull regime provides favorable macro backdrop for long setups.",
        "Bear/distribution regime raises risk bars and demands strict invalidation triggers.",
      ],
      forbiddenInferences: [
        "Do not invent macro or news facts outside the benchmark packet.",
        "Do not override deterministic risk gate based solely on favorable regime.",
      ],
    },
    provenanceNote: "Derived per lib/ai-council-market.ts.",
  },
  {
    key: "ma_breadth",
    label: "Độ rộng đường trung bình (MA Breadth)",
    aliases: ["above_ma10_pct", "above_ma20_pct", "above_ma50_pct", "above_ma200_pct", "ma_breadth", "do_rong_ma"],
    category: "market",
    source: "market_feed",
    unit: "percent",
    horizon: "1D",
    direction: "higher_is_supportive",
    beginner: {
      what: "Tỷ lệ phần trăm cổ phiếu trên thị trường đang giao dịch phía trên đường trung bình MA10, MA20, MA50 hoặc MA200.",
      read: "> 60%: thị trường có độ lan tỏa tăng giá rộng; < 40%: phần lớn cổ phiếu suy yếu ngắn/trung hạn.",
      combineWith: ["market_breadth", "vnindex_regime"],
      notMeaning: "Độ rộng cao không bảo đảm mọi cổ phiếu đều tăng.",
    },
    ai: {
      meaning: "Percentage of stocks trading above key moving averages (MA10/20/50/200).",
      interpretationRules: [
        "Broad participation above MA20 and MA50 confirms underlying market health.",
        "Divergence between index gains and collapsing MA breadth signals narrow leadership.",
      ],
      forbiddenInferences: ["Do not extrapolate high MA breadth into an unconditional buy signal."],
    },
    provenanceNote: "Tính toán từ snapshot thị trường sau phiên đóng cửa.",
  },
  {
    key: "distribution_count",
    label: "Số ngày phân phối (Distribution Days)",
    aliases: ["distribution_count", "distribution_days", "so_ngay_phan_phoi"],
    category: "risk",
    source: "qeoindex",
    unit: "score_0_100",
    horizon: "multi_session",
    direction: "higher_is_risk",
    beginner: {
      what: "Số phiên thị trường giảm giá trên 0.2% với khối lượng cao hơn phiên trước trong cửa sổ 25 phiên.",
      read: "1-2 ngày: an toàn; 3-4 ngày: cảnh báo phân hóa; 5-6 ngày: rủi ro áp lực bán lớn.",
      combineWith: ["market_risk_score", "vnindex_regime"],
      notMeaning: "Nhiều ngày phân phối là tín hiệu quản trị rủi ro, không đồng nghĩa thị trường sẽ sập ngay.",
    },
    ai: {
      meaning: "Count of institutional distribution days observed in the trailing 25-session window.",
      interpretationRules: [
        "Distribution count >= 5 triggers defensive risk stance.",
        "Distribution count <= 2 reflects constructive institutional support.",
      ],
      forbiddenInferences: ["Do not declare market collapse based on distribution count alone."],
    },
    provenanceNote: "Theo dõi phiên giảm giá với khối lượng gia tăng trong 25 phiên.",
  },
  {
    key: "foreign_flow",
    label: "Dòng tiền Khối ngoại (Foreign Net Flow)",
    aliases: ["foreign_net_value", "foreign_flow", "khoi_ngoai_mua_ban_rong"],
    category: "liquidity",
    source: "market_feed",
    unit: "billion_vnd",
    horizon: "1D",
    direction: "higher_is_supportive",
    beginner: {
      what: "Giá trị mua ròng hoặc bán ròng của nhà đầu tư nước ngoài trong phiên giao dịch (tính bằng tỷ đồng).",
      read: "Dương (+): khối ngoại mua ròng; Âm (-): khối ngoại bán ròng.",
      combineWith: ["proprietary_flow", "total_traded_value"],
      notMeaning: "Khối ngoại mua ròng không bảo đảm cổ phiếu sẽ tăng giá ngay lập tức.",
    },
    ai: {
      meaning: "Net buy or sell value in billion VND by foreign institutional/retail participants.",
      interpretationRules: [
        "Persistent net foreign accumulation supports large-cap liquidity.",
        "Heavy foreign selling may create index drag even during domestic retail strength.",
      ],
      forbiddenInferences: ["Do not assume foreign flow direction equals total market direction."],
    },
    provenanceNote: "Dữ liệu khớp lệnh và thỏa thuận chính thức từ Sở giao dịch.",
  },
  {
    key: "proprietary_flow",
    label: "Dòng tiền Tự doanh (Proprietary Net Flow)",
    aliases: ["proprietary_net_value", "proprietary_flow", "tu_doanh_mua_ban_rong"],
    category: "liquidity",
    source: "market_feed",
    unit: "billion_vnd",
    horizon: "1D",
    direction: "higher_is_supportive",
    beginner: {
      what: "Giá trị mua ròng hoặc bán ròng của khối tự doanh các công ty chứng khoán trong phiên (tỷ đồng).",
      read: "Dương (+): tự doanh mua ròng; Âm (-): tự doanh bán ròng.",
      combineWith: ["foreign_flow", "total_traded_value"],
      notMeaning: "Tự doanh giao dịch vì nhiều mục đích bao gồm hedging phái sinh và tạo lập.",
    },
    ai: {
      meaning: "Net proprietary trading flow in billion VND across brokerages.",
      interpretationRules: ["Proprietary flow context helps understand domestic institutional posture."],
      forbiddenInferences: ["Do not infer long-term fundamental views from single-session proprietary trading."],
    },
    provenanceNote: "Báo cáo giao dịch tự doanh sau phiên.",
  },
  {
    key: "sector_rotation_state",
    label: "Pha luân chuyển dòng tiền ngành (Sector Rotation)",
    aliases: ["sector_rotation_state", "rotation_state", "pha_luan_chuyen_nganh"],
    category: "rotation",
    source: "qeoindex",
    unit: "state",
    horizon: "multi_session",
    direction: "categorical",
    beginner: {
      what: "Xác định pha luân chuyển của nhóm ngành theo 4 trạng thái: Dẫn dắt, Phục hồi, Suy yếu, Tụt hậu.",
      read: "Dẫn dắt: dòng tiền mạnh; Phục hồi: dòng tiền bắt đầu vào; Suy yếu/Tụt hậu: dòng tiền rút bớt.",
      combineWith: ["sector_rs_score", "traded_value"],
      notMeaning: "Ngành dẫn dắt có thể tích lũy ngắn hạn, ngành tụt hậu có thể bật hồi kỹ thuật.",
    },
    ai: {
      meaning: "Categorical sector rotation state: leading, recovering, weakening, lagging.",
      interpretationRules: [
        "Leading and recovering sectors represent constructive areas for leadership setups.",
        "Lagging sectors warrant caution despite low valuation.",
      ],
      forbiddenInferences: ["Do not fabricate RRG coordinates when only categorical state is published."],
    },
    provenanceNote: "Mô hình luân chuyển RRG ngành của QeoIndex.",
  },
  {
    key: "effort_result",
    label: "Nỗ lực và Kết quả ngành (Effort vs Result)",
    aliases: ["effort_result_state", "effort_pct", "result_pct", "no_luc_ket_qua"],
    category: "relative_strength",
    source: "qeoindex",
    unit: "text",
    horizon: "1D",
    direction: "categorical",
    beginner: {
      what: "So sánh giữa Nỗ lực (thanh khoản) và Kết quả (biến động giá %) theo nguyên lý Wyckoff/VSA.",
      read: "Nỗ lực lớn + Kết quả tăng mạnh: hấp thụ tốt; Nỗ lực lớn nhưng không tăng giá: dấu hiệu phân phối.",
      combineWith: ["sector_rotation_state", "traded_value"],
      notMeaning: "Phân tích nỗ lực kết quả cần nhìn trong bối cảnh xu hướng nhiều phiên.",
    },
    ai: {
      meaning: "Wyckoff Effort versus Result comparison between volume participation and price outcome.",
      interpretationRules: ["High effort with low progress signals absorption or exhaustion."],
      forbiddenInferences: ["Do not claim certainty of reversal from a single-session effort/result reading."],
    },
    provenanceNote: "Phân tích tương quan thanh khoản và biến động giá theo phương pháp Wyckoff.",
  },
] as const

const METRIC_MAP_BY_KEY = new Map<string, InsightMetricSemantic>()
const METRIC_MAP_BY_ALIAS = new Map<string, InsightMetricSemantic>()

for (const metric of INSIGHTS_METRIC_SEMANTICS) {
  METRIC_MAP_BY_KEY.set(metric.key.toLowerCase(), metric)
  for (const alias of metric.aliases) {
    METRIC_MAP_BY_ALIAS.set(alias.toLowerCase(), metric)
  }
}

export function getMetricSemantic(keyOrAlias: string): InsightMetricSemantic | null {
  if (!keyOrAlias) return null
  const normalized = keyOrAlias.trim().toLowerCase()
  return METRIC_MAP_BY_KEY.get(normalized) || METRIC_MAP_BY_ALIAS.get(normalized) || null
}

export function buildAiMetricDictionary(keys: string[]): CompactAiMetricSemantic[] {
  const result: CompactAiMetricSemantic[] = []
  const seen = new Set<string>()

  for (const key of keys) {
    const semantic = getMetricSemantic(key)
    if (!semantic || seen.has(semantic.key)) continue
    seen.add(semantic.key)

    result.push({
      key: semantic.key,
      label: semantic.label,
      category: semantic.category,
      source: semantic.source,
      unit: semantic.unit,
      horizon: semantic.horizon,
      direction: semantic.direction,
      meaning: semantic.ai.meaning,
      interpretationRules: semantic.ai.interpretationRules,
      forbiddenInferences: semantic.ai.forbiddenInferences,
      provenanceNote: semantic.provenanceNote,
    })
  }

  return result
}
