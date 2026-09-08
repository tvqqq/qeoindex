import type { RiskSizingTerm } from "./types.ts"

export const MCDOWELL_RISK_AMOUNT_FORMULA = "Risk Amount = Account Size × Risk %"
export const MCDOWELL_TRADE_SIZE_FORMULA = "Trade Size = (Risk Amount − Commission) / Difference Between Entry and Stop"
export const QEOINDEX_TRADE_SIZE_EXTENDED_FORMULA = "Trade Size = (Risk Amount − Estimated Commission − Slippage Allowance) / Risk per Share"

export const RISK_SIZING_TERMS = {
  accountEquity: {
    labelVi: "Vốn tài khoản",
    labelEn: "Account Equity",
    help: "Vốn tài khoản dùng cho phép tính tại thời điểm hiện tại. QeoIndex lấy vốn ban đầu cộng lãi/lỗ đã thực hiện và lãi/lỗ chưa thực hiện; dữ liệu giá thiếu sẽ được đánh dấu là một phần.",
    sourceKind: "product",
  },
  riskPerTrade: {
    labelVi: "Rủi ro mỗi giao dịch",
    labelEn: "Risk per Trade",
    help: "Tỷ lệ vốn tài khoản tối đa được đưa vào số tiền rủi ro cho một giao dịch. Mức 2% là điểm khởi đầu/trần ví dụ trong McDowell, không phải bảo đảm tránh thua lỗ.",
    sourceKind: "book",
  },
  riskAmount: {
    labelVi: "Số tiền rủi ro",
    labelEn: "Risk Amount",
    help: "Số tiền rủi ro theo công thức McDowell trước khi chuyển thành khối lượng giao dịch.",
    sourceKind: "book",
    formula: MCDOWELL_RISK_AMOUNT_FORMULA,
  },
  plannedEntry: {
    labelVi: "Giá vào lệnh dự kiến",
    labelEn: "Planned Entry",
    help: "Giá dự kiến vào lệnh, dùng cùng mức dừng lỗ ban đầu để xác định khoảng rủi ro trên mỗi cổ phiếu.",
    sourceKind: "book",
  },
  initialStop: {
    labelVi: "Mức dừng lỗ ban đầu",
    labelEn: "Initial Stop",
    help: "Tên rút gọn của Initial Stop-Loss Exit. Mức dừng lỗ phải được xác định trước khi vào lệnh từ cấu trúc giá, biến động hoặc quy tắc của hệ thống; không suy ra từ một tỷ lệ phần trăm cố định.",
    sourceKind: "book",
  },
  stopDistance: {
    labelVi: "Khoảng cách đến dừng lỗ",
    labelEn: "Stop Distance",
    help: "Khoảng cách tuyệt đối và phần trăm giữa giá vào lệnh dự kiến và mức dừng lỗ ban đầu. Đây là phép tính sản phẩm từ chênh lệch Entry–Stop dùng trong công thức Trade Size.",
    sourceKind: "product",
  },
  riskPerShare: {
    labelVi: "Rủi ro trên mỗi cổ phiếu",
    labelEn: "Risk per Share",
    help: "Khoảng tiền giữa giá vào lệnh dự kiến và mức dừng lỗ ban đầu cho mỗi cổ phiếu trong giao dịch mua.",
    sourceKind: "book",
  },
  estimatedCommission: {
    labelVi: "Phí giao dịch ước tính",
    labelEn: "Estimated Commission",
    help: "Phí giao dịch ước tính được trừ khỏi số tiền rủi ro trước khi tính khối lượng giao dịch theo công thức in trong sách.",
    sourceKind: "book",
  },
  slippageAllowance: {
    labelVi: "Phần đệm trượt giá",
    labelEn: "Slippage Allowance",
    help: "Phần đệm trượt giá do QeoIndex tách riêng để tính thận trọng hơn. Đây là phần mở rộng của sản phẩm; công thức in trong sách không có hạng mục riêng này.",
    sourceKind: "extension",
  },
  availableTradeRiskBudget: {
    labelVi: "Ngân sách rủi ro khả dụng",
    labelEn: "Available Risk Budget",
    help: "Số tiền rủi ro còn lại sau phí giao dịch ước tính và phần đệm trượt giá. Đây là phần mở rộng của sản phẩm để tách rõ phần ngân sách còn dùng cho khoảng Entry–Stop.",
    sourceKind: "extension",
  },
  tradeSize: {
    labelVi: "Khối lượng giao dịch",
    labelEn: "Trade Size",
    help: "Số cổ phiếu tối đa theo số tiền rủi ro, chi phí và khoảng Entry–Stop. QeoIndex làm tròn xuống theo quy ước lô chẵn đã chọn.",
    sourceKind: "extension",
    formula: QEOINDEX_TRADE_SIZE_EXTENDED_FORMULA,
  },
  positionValue: {
    labelVi: "Giá trị vị thế",
    labelEn: "Position Value",
    help: "Giá trị danh nghĩa của khối lượng giao dịch tại giá vào lệnh dự kiến; đây không phải số tiền rủi ro.",
    sourceKind: "product",
  },
  activeRisk: {
    labelVi: "Rủi ro đang hoạt động",
    labelEn: "Active Risk",
    help: "Tổng rủi ro giảm giá đã biết của các giao dịch đang mở tới mức dừng lỗ hiện hành. Giao dịch thiếu mức dừng lỗ được giữ ở trạng thái rủi ro chưa xác định thay vì tính bằng 0.",
    sourceKind: "product",
  },
  maxActiveRisk: {
    labelVi: "Rủi ro đang hoạt động tối đa",
    labelEn: "Max Active Risk",
    help: "Giới hạn rủi ro đang hoạt động của Kế hoạch quản trị vốn cho danh mục. Các mức như 6% hoặc 10% trong sách là ví dụ cấu hình, không phải mặc định bắt buộc.",
    sourceKind: "product",
  },
  remainingRiskBudget: {
    labelVi: "Ngân sách rủi ro còn lại",
    labelEn: "Remaining Risk Budget",
    help: "Phần rủi ro đang hoạt động tối đa còn lại sau rủi ro đã biết và rủi ro của các giao dịch đang lập kế hoạch; không được dùng để tuyên bố an toàn khi còn rủi ro chưa xác định.",
    sourceKind: "product",
  },
  projectedActiveRisk: {
    labelVi: "Rủi ro đang hoạt động dự kiến",
    labelEn: "Projected Active Risk",
    help: "Rủi ro đang hoạt động đã biết cộng rủi ro của giao dịch đang lập kế hoạch. Đây là phép tính sản phẩm phục vụ cảnh báo trước khi vào lệnh.",
    sourceKind: "product",
  },
  riskAddedByPlannedTrade: {
    labelVi: "Rủi ro tăng thêm từ giao dịch dự kiến",
    labelEn: "Risk Added by Planned Trade",
    help: "Tổng mức tiêu thụ ngân sách rủi ro của giao dịch đang lập kế hoạch sau phí giao dịch và phần đệm trượt giá.",
    sourceKind: "product",
  },
  winRatio: {
    labelVi: "Tỷ lệ giao dịch thắng",
    labelEn: "Win Ratio",
    help: "Số giao dịch logic đã đóng có lãi chia cho tổng số giao dịch đã đóng đủ điều kiện.",
    sourceKind: "book",
  },
  payoffRatio: {
    labelVi: "Tỷ lệ lãi/lỗ bình quân",
    labelEn: "Payoff Ratio",
    help: "Lãi bình quân của giao dịch thắng chia cho trị tuyệt đối của lỗ bình quân của giao dịch thua.",
    sourceKind: "book",
  },
  optimalF: {
    labelVi: "Optimal f (tham khảo)",
    labelEn: "Optimal f",
    help: "Giá trị toán học theo McDowell dùng tỷ lệ giao dịch thắng và tỷ lệ lãi/lỗ bình quân. QeoIndex chỉ hiển thị để tham khảo, không tự áp vào rủi ro mỗi giao dịch.",
    sourceKind: "book",
  },
} as const satisfies Record<string, RiskSizingTerm>
