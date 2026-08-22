export const KFSP_CONTRACT_VERSION = 1

export const KFSP_GROUPS = [
  { key: "overview", label: "Tổng quát" },
  { key: "general", label: "Thông tin chung" },
  { key: "valuation", label: "Định giá" },
  { key: "fundamentals", label: "Cơ bản" },
  { key: "price_volatility", label: "Biến động giá" },
  { key: "price_range", label: "Phạm vi giá" },
  { key: "liquidity", label: "Thanh khoản" },
  { key: "technical", label: "Chỉ báo kỹ thuật" },
  { key: "kfsp", label: "KFSP" },
] as const

export type KfspGroupKey = (typeof KFSP_GROUPS)[number]["key"]
export type KfspMetricFormat = "number" | "percent" | "price" | "volume" | "currency_billion" | "score" | "text" | "link"

export interface KfspFieldDefinition {
  providerKey: string
  key: string
  group: KfspGroupKey
  label: string
  description: string
  format: KfspMetricFormat
}

const common = (providerKey: string, key: string, label: string, description: string, format: KfspMetricFormat = "text"): KfspFieldDefinition => ({
  providerKey, key, group: "overview", label, description, format,
})

const field = (group: KfspGroupKey, providerKey: string, key: string, label: string, description: string, format: KfspMetricFormat = "number"): KfspFieldDefinition => ({
  providerKey, key, group, label, description, format,
})

export const KFSP_FIELD_CATALOG: KfspFieldDefinition[] = [
  common("mack", "ticker", "Mã CK", "Mã giao dịch của cổ phiếu."),
  common("nganh", "sector", "Ngành", "Nhóm ngành do KFSP phân loại."),
  common("san", "exchange", "Sàn", "Sàn giao dịch của cổ phiếu."),
  common("gia_hien_tai", "price", "Giá", "Giá cổ phiếu tại thời điểm snapshot; pipeline chuẩn hóa từ VND sang nghìn đồng.", "price"),
  common("perchange", "price_change_pct", "Thay đổi giá", "Phần trăm thay đổi so với giá tham chiếu của phiên.", "percent"),
  common("diem_canslim", "kfsp_canslim_score", "Điểm CANSLIM", "Điểm sàng lọc CANSLIM do KFSP cung cấp; phương pháp chi tiết thuộc nhà cung cấp.", "score"),
  common("diem_4m", "kfsp_score_4m", "Điểm 4M", "Điểm mô hình 4M do KFSP cung cấp; dùng để so sánh tương đối giữa các mã.", "score"),
  common("dinh_gia", "kfsp_price_potential", "Tiềm năng giá", "Nhãn tăng/giảm do KFSP AI suy ra từ tương quan giá và giá trị ước tính.", "text"),
  common("gia_tri_hien_tai", "kfsp_fair_value", "Giá trị ước tính", "Giá trị hiện tại do KFSP ước tính; chỉ dùng cho phân tích tham khảo.", "price"),
  common("avg50", "average_volume_50_sessions", "KLGD TB 50 phiên", "Khối lượng giao dịch trung bình 50 phiên.", "volume"),
  common("capital", "market_cap_billion", "Vốn hóa", "Vốn hóa thị trường, đơn vị tỷ đồng.", "currency_billion"),
  common("rss", "rs_short", "RSs", "Sức mạnh giá tương đối ngắn hạn; giá trị cao hơn thể hiện vị thế tương đối mạnh hơn."),
  common("rs_m_co_phieu", "rs_medium", "RSm", "Sức mạnh giá tương đối trung hạn."),
  common("rs_l_co_phieu", "rs_long", "RSl", "Sức mạnh giá tương đối dài hạn."),
  common("rsi_14", "rsi_14", "RSI (14)", "Chỉ báo sức mạnh tương đối 14 phiên; thường dùng để nhận diện vùng quá mua/quá bán."),
  common("eod_week", "weekly_change_pct", "Biến động tuần", "Mức thay đổi giá trong một tuần.", "percent"),
  common("eod_month", "monthly_change_pct", "Biến động tháng", "Mức thay đổi giá trong một tháng.", "percent"),
  common("beta", "beta", "Beta", "Độ nhạy của cổ phiếu so với thị trường; không phải thước đo rủi ro tuyệt đối."),
  common("pe", "pe_ttm", "P/E", "Giá thị trường trên lợi nhuận mỗi cổ phiếu trailing twelve months."),
  common("pb", "pb_ttm", "P/B", "Giá thị trường trên giá trị sổ sách mỗi cổ phiếu trailing twelve months."),

  field("general", "ten", "company_name", "Tên công ty", "Tên pháp lý hoặc tên hiển thị của doanh nghiệp.", "text"),
  field("general", "von_dieu_le", "charter_capital_billion", "Vốn điều lệ", "Vốn điều lệ, đơn vị tỷ đồng.", "currency_billion"),
  field("general", "von_hoa_thi_truong", "market_cap_billion", "Vốn hóa thị trường", "Vốn hóa thị trường, đơn vị tỷ đồng.", "currency_billion"),
  field("general", "slcp_luu_hanh", "shares_outstanding", "SLCP lưu hành", "Số lượng cổ phiếu đang lưu hành.", "volume"),
  field("general", "freefloat", "free_float_pct", "Free float", "Tỷ lệ cổ phiếu tự do chuyển nhượng.", "percent"),
  field("general", "room_nuoc_ngoai_con_lai", "foreign_room_remaining_pct", "Room NN còn lại", "Tỷ lệ room sở hữu nước ngoài còn lại.", "percent"),
  field("general", "gd_nuoc_ngoai_rong", "net_foreign_trading_billion", "GDNN ròng", "Giá trị giao dịch ròng của khối ngoại, đơn vị tỷ đồng.", "currency_billion"),
  field("general", "gd_tu_doanh_rong", "net_proprietary_trading_billion", "GDTD ròng", "Giá trị giao dịch ròng của khối tự doanh, đơn vị tỷ đồng.", "currency_billion"),
  field("general", "website", "website", "Website", "Website chính thức của doanh nghiệp.", "link"),

  field("valuation", "eps", "eps_ttm_vnd", "EPS-TTM", "Lợi nhuận trên mỗi cổ phiếu trong 12 tháng gần nhất, đơn vị VND."),
  field("valuation", "tang_truong_eps", "eps_ttm_growth_pct", "Tăng trưởng EPS-TTM", "Tốc độ tăng trưởng EPS trailing twelve months.", "percent"),
  field("valuation", "pe", "pe_ttm", "P/E-TTM", "Giá trên EPS trailing twelve months."),
  field("valuation", "bvps", "bvps_ttm_vnd", "BVPS-TTM", "Giá trị sổ sách trên mỗi cổ phiếu trailing twelve months, đơn vị VND."),
  field("valuation", "tang_truong_bvps", "bvps_ttm_growth_pct", "Tăng trưởng BVPS-TTM", "Tốc độ tăng trưởng BVPS trailing twelve months.", "percent"),
  field("valuation", "pb", "pb_ttm", "P/B-TTM", "Giá trên giá trị sổ sách trailing twelve months."),

  field("fundamentals", "thoigian", "financial_period", "Kỳ BCTC", "Kỳ báo cáo tài chính gần nhất.", "text"),
  field("fundamentals", "doanh_thu_thuan", "net_revenue_ttm_billion", "Doanh thu thuần-TTM", "Doanh thu thuần 12 tháng gần nhất, đơn vị tỷ đồng.", "currency_billion"),
  field("fundamentals", "tang_truong_doanh_thu_thuan", "net_revenue_growth_pct", "Tăng trưởng doanh thu", "Tăng trưởng doanh thu thuần so với kỳ so sánh.", "percent"),
  field("fundamentals", "loi_nhuan_sau_thue", "net_income_ttm_billion", "LN sau thuế-TTM", "Lợi nhuận sau thuế 12 tháng gần nhất, đơn vị tỷ đồng.", "currency_billion"),
  field("fundamentals", "tang_truong_loi_nhuan_sau_thue", "net_income_growth_pct", "Tăng trưởng LN sau thuế", "Tăng trưởng lợi nhuận sau thuế so với kỳ so sánh.", "percent"),
  field("fundamentals", "bien_loi_nhuan_rong", "net_margin_ttm_pct", "Biên lợi nhuận ròng", "Lợi nhuận sau thuế trên doanh thu thuần trailing twelve months.", "percent"),
  field("fundamentals", "roa", "roa_ttm_pct", "ROA-TTM", "Lợi nhuận trên tổng tài sản trailing twelve months.", "percent"),
  field("fundamentals", "roe", "roe_ttm_pct", "ROE-TTM", "Lợi nhuận trên vốn chủ sở hữu trailing twelve months.", "percent"),

  field("price_volatility", "thay_doi_gia_trong_ngay", "price_change_1d_pct", "Thay đổi giá 1D", "Mức thay đổi giá một phiên.", "percent"),
  field("price_volatility", "thay_doi_gia_1_tuan", "price_change_1w_pct", "Thay đổi giá 1W", "Mức thay đổi giá một tuần.", "percent"),
  field("price_volatility", "thay_doi_gia_2_tuan", "price_change_2w_pct", "Thay đổi giá 2W", "Mức thay đổi giá hai tuần.", "percent"),
  field("price_volatility", "thay_doi_gia_1_thang", "price_change_1m_pct", "Thay đổi giá 1M", "Mức thay đổi giá một tháng.", "percent"),
  field("price_volatility", "thay_doi_gia_3_thang", "price_change_3m_pct", "Thay đổi giá 3M", "Mức thay đổi giá ba tháng.", "percent"),
  field("price_volatility", "thay_doi_gia_1_nam", "price_change_1y_pct", "Thay đổi giá 1Y", "Mức thay đổi giá một năm.", "percent"),
  field("price_volatility", "thay_doi_gia_ytd", "price_change_ytd_pct", "Thay đổi giá YTD", "Mức thay đổi giá từ đầu năm.", "percent"),
  field("price_volatility", "beta", "beta", "Beta", "Độ nhạy của cổ phiếu so với thị trường."),

  field("price_range", "do_rong_pham_vi_10_phien", "range_width_10d_pct", "Độ rộng phạm vi 10D", "Chênh lệch giữa đỉnh và đáy trong 10 phiên.", "percent"),
  field("price_range", "vi_tri_gia_so_voi_pham_vi_10_phien", "position_in_10d_range", "Giá vs phạm vi 10D", "Vị trí hiện tại trong phạm vi giá 10 phiên.", "text"),
  field("price_range", "do_rong_pham_vi_20_phien", "range_width_20d_pct", "Độ rộng phạm vi 20D", "Chênh lệch giữa đỉnh và đáy trong 20 phiên.", "percent"),
  field("price_range", "vi_tri_gia_so_voi_pham_vi_20_phien", "position_in_20d_range", "Giá vs phạm vi 20D", "Vị trí hiện tại trong phạm vi giá 20 phiên.", "text"),
  field("price_range", "do_rong_pham_vi_50_phien", "range_width_50d_pct", "Độ rộng phạm vi 50D", "Chênh lệch giữa đỉnh và đáy trong 50 phiên.", "percent"),
  field("price_range", "vi_tri_gia_so_voi_pham_vi_50_phien", "position_in_50d_range", "Giá vs phạm vi 50D", "Vị trí hiện tại trong phạm vi giá 50 phiên.", "text"),
  field("price_range", "do_rong_pham_vi_52_tuan", "range_width_52w_pct", "Độ rộng phạm vi 52W", "Chênh lệch giữa đỉnh và đáy trong 52 tuần.", "percent"),
  field("price_range", "vi_tri_gia_trong_pham_vi_52_tuan", "position_in_52w_range", "Giá vs phạm vi 52W", "Vị trí hiện tại trong phạm vi giá 52 tuần.", "text"),
  field("price_range", "khoang_cach_gia_den_dinh_52_tuan", "distance_to_52w_high_pct", "Giá vs đỉnh 52W", "Khoảng cách từ giá hiện tại tới đỉnh 52 tuần.", "percent"),
  field("price_range", "khoang_cach_gia_den_day_52_tuan", "distance_to_52w_low_pct", "Giá vs đáy 52W", "Khoảng cách từ giá hiện tại tới đáy 52 tuần.", "percent"),

  field("liquidity", "klgd_hom_nay", "volume_1d", "KLGD 1D", "Khối lượng giao dịch phiên gần nhất.", "volume"),
  field("liquidity", "klgd_vs_hom_qua", "volume_vs_previous_session_pct", "KLGD vs phiên trước", "Tỷ lệ khối lượng phiên gần nhất so với phiên trước.", "percent"),
  field("liquidity", "klgd_tb_10_ngay", "average_volume_10d", "KLGD TB 10D", "Khối lượng giao dịch trung bình 10 phiên.", "volume"),
  field("liquidity", "klgd_tb_20_ngay", "average_volume_20d", "KLGD TB 20D", "Khối lượng giao dịch trung bình 20 phiên.", "volume"),
  field("liquidity", "klgd_tb_50_ngay", "average_volume_50d", "KLGD TB 50D", "Khối lượng giao dịch trung bình 50 phiên.", "volume"),
  field("liquidity", "gtgd_hom_nay", "traded_value_1d_billion", "GTGD 1D", "Giá trị giao dịch phiên gần nhất, đơn vị tỷ đồng.", "currency_billion"),
  field("liquidity", "gtgd_vs_hom_qua", "traded_value_vs_previous_session_pct", "GTGD vs phiên trước", "Tỷ lệ giá trị giao dịch phiên gần nhất so với phiên trước.", "percent"),
  field("liquidity", "gtgd_tb_10_ngay", "average_traded_value_10d_billion", "GTGD TB 10D", "Giá trị giao dịch trung bình 10 phiên, đơn vị tỷ đồng.", "currency_billion"),
  field("liquidity", "gtgd_tb_20_ngay", "average_traded_value_20d_billion", "GTGD TB 20D", "Giá trị giao dịch trung bình 20 phiên, đơn vị tỷ đồng.", "currency_billion"),
  field("liquidity", "gtgd_tb_50_ngay", "average_traded_value_50d_billion", "GTGD TB 50D", "Giá trị giao dịch trung bình 50 phiên, đơn vị tỷ đồng.", "currency_billion"),

  field("technical", "gia_vs_sma_10_ngay", "price_vs_sma10_pct", "Giá vs SMA10", "Khoảng cách giữa giá và đường trung bình 10 phiên.", "percent"),
  field("technical", "gia_vs_sma_20_ngay", "price_vs_sma20_pct", "Giá vs SMA20", "Khoảng cách giữa giá và đường trung bình 20 phiên.", "percent"),
  field("technical", "gia_vs_sma_50_ngay", "price_vs_sma50_pct", "Giá vs SMA50", "Khoảng cách giữa giá và đường trung bình 50 phiên.", "percent"),
  field("technical", "gia_vs_sma_100_ngay", "price_vs_sma100_pct", "Giá vs SMA100", "Khoảng cách giữa giá và đường trung bình 100 phiên.", "percent"),
  field("technical", "gia_vs_sma_200_ngay", "price_vs_sma200_pct", "Giá vs SMA200", "Khoảng cách giữa giá và đường trung bình 200 phiên.", "percent"),
  field("technical", "rsi_14", "rsi_14", "RSI (14)", "Chỉ báo sức mạnh tương đối 14 phiên; thường dùng để nhận diện vùng quá mua/quá bán."),
  field("technical", "macd_vs_signal", "macd_vs_signal", "MACD vs Signal", "Vị trí đường MACD so với đường tín hiệu.", "text"),
  field("technical", "gia_trong_bollinger_band", "position_in_bollinger_band", "Giá vs Bollinger Band", "Vị trí giá trong hoặc ngoài dải Bollinger.", "text"),

  field("kfsp", "diem_4m", "kfsp_score_4m", "Điểm 4M", "Điểm mô hình 4M do KFSP cung cấp.", "score"),
  field("kfsp", "diem_canslim", "kfsp_canslim_score", "Điểm CANSLIM", "Điểm mô hình CANSLIM do KFSP cung cấp.", "score"),
  field("kfsp", "rs_s_co_phieu", "kfsp_stock_rs_score", "RS-S cổ phiếu", "Điểm sức mạnh tương đối của cổ phiếu trong mô hình KFSP.", "score"),
  field("kfsp", "rs_nganh", "kfsp_sector_rs_score", "RS-S ngành", "Điểm sức mạnh tương đối của ngành trong mô hình KFSP.", "score"),
  field("kfsp", "rrg_co_phieu", "kfsp_stock_rrg_state", "RRG cổ phiếu", "Trạng thái Relative Rotation Graph của cổ phiếu.", "text"),
  field("kfsp", "rrg_nganh", "kfsp_sector_rrg_state", "RRG ngành", "Trạng thái Relative Rotation Graph của ngành.", "text"),
]

export const KFSP_FIELD_BY_PROVIDER_KEY = new Map(KFSP_FIELD_CATALOG.map((item) => [item.providerKey, item]))
export const KFSP_FIELD_BY_KEY = new Map(KFSP_FIELD_CATALOG.map((item) => [item.key, item]))

export const CANONICAL_TOP100_TICKERS = [
  "VIC", "VHM", "VCB", "BID", "CTG", "TCB", "VPB", "MBB", "HPG", "GAS",
  "MCH", "LPB", "VPL", "STB", "HDB", "BSR", "ACB", "VNM", "FPT", "GVR",
  "DMX", "TCX", "MWG", "MSN", "VJC", "HVN", "VCK", "SHB", "SSI", "SAB",
  "VRE", "SSB", "MSB", "VIB", "BVH", "VPX", "PLX", "GEE", "POW", "TPB",
  "BCM", "HCM", "EIB", "NVL", "VIX", "GMD", "GEX", "OCB", "REE", "GEL",
  "PGV", "KBC", "VCI", "VND", "NAB", "FRT", "KDH", "VPI", "SBT", "PNJ",
  "HAG", "VGC", "PVD", "DCM", "DGC", "CRV", "DPM", "KDC", "VBB", "SJS",
  "DXG", "LGC", "TAL", "DHG", "SIP", "BMP", "PDR", "BAF", "NLG", "VCG",
  "VHC", "TCH", "VSH", "CTR", "KLB", "BWE", "DSE", "CII", "EVF", "PVT",
  "VTP", "HPA", "ORS", "DGW", "HAH", "HSG", "PC1", "DIG", "FTS", "PHR",
] as const
