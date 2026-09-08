import type { RiskSizingTerm } from "./types.ts"

export const MCDOWELL_RISK_AMOUNT_FORMULA = "Risk Amount = Account Size × Risk %"
export const MCDOWELL_TRADE_SIZE_FORMULA = "Trade Size = (Risk Amount − Commission) / Difference Between Entry and Stop"
export const QEOINDEX_TRADE_SIZE_EXTENDED_FORMULA = "Trade Size = (Risk Amount − Estimated Commission − Slippage Allowance) / Risk per Share"

export const RISK_SIZING_TERMS = {
  accountEquity: {
    label: "Account Equity",
    help: "Vốn tài khoản dùng cho phép tính tại thời điểm hiện tại. QeoIndex lấy Initial Capital cộng Realized P&L và Unrealized P&L; dữ liệu giá thiếu sẽ được đánh dấu partial.",
    sourceKind: "product",
  },
  riskPerTrade: {
    label: "Risk per Trade",
    help: "Tỷ lệ Account Equity tối đa được đưa vào Risk Amount cho một Trade. Mức 2% là điểm khởi đầu/trần ví dụ trong McDowell, không phải bảo đảm tránh thua lỗ.",
    sourceKind: "book",
  },
  riskAmount: {
    label: "Risk Amount",
    help: "Số tiền rủi ro theo công thức McDowell trước khi chuyển thành Trade Size.",
    sourceKind: "book",
    formula: MCDOWELL_RISK_AMOUNT_FORMULA,
  },
  plannedEntry: {
    label: "Planned Entry",
    help: "Giá dự kiến vào lệnh, dùng cùng Initial Stop để xác định khoảng rủi ro trên mỗi cổ phiếu.",
    sourceKind: "book",
  },
  initialStop: {
    label: "Initial Stop",
    help: "Tên rút gọn của Initial Stop-Loss Exit. Stop phải được xác định trước entry từ cấu trúc giá, volatility hoặc rule của hệ thống; không suy ra từ một % cố định.",
    sourceKind: "book",
  },
  stopDistance: {
    label: "Stop Distance",
    help: "Khoảng cách tuyệt đối và phần trăm giữa Planned Entry và Initial Stop. Đây là phép tính sản phẩm từ chênh lệch Entry–Stop dùng trong công thức Trade Size.",
    sourceKind: "product",
  },
  riskPerShare: {
    label: "Risk per Share",
    help: "Khoảng tiền giữa Planned Entry và Initial Stop cho mỗi cổ phiếu trong long Trade.",
    sourceKind: "book",
  },
  estimatedCommission: {
    label: "Estimated Commission",
    help: "Ước tính commission được trừ khỏi Risk Amount trước khi tính Trade Size theo công thức in trong sách.",
    sourceKind: "book",
  },
  slippageAllowance: {
    label: "Slippage Allowance",
    help: "Phần đệm trượt giá do QeoIndex tách riêng để tính thận trọng hơn. Đây là product extension; công thức in trong sách không có hạng mục riêng này.",
    sourceKind: "extension",
  },
  availableTradeRiskBudget: {
    label: "Available Risk Budget",
    help: "Risk Amount còn lại sau Estimated Commission và Slippage Allowance. Đây là product extension để tách rõ phần ngân sách còn dùng cho khoảng Entry–Stop.",
    sourceKind: "extension",
  },
  tradeSize: {
    label: "Trade Size",
    help: "Số cổ phiếu tối đa theo Risk Amount, chi phí và khoảng Entry–Stop. QeoIndex làm tròn xuống theo regular-lot convention đã chọn.",
    sourceKind: "extension",
    formula: QEOINDEX_TRADE_SIZE_EXTENDED_FORMULA,
  },
  positionValue: {
    label: "Position Value",
    help: "Giá trị danh nghĩa của Trade Size tại Planned Entry; đây không phải Risk Amount.",
    sourceKind: "product",
  },
  activeRisk: {
    label: "Active Risk",
    help: "Tổng downside risk đã biết của các open logical Trades tới stop hiện hành. Trade thiếu stop được giữ ở trạng thái Risk Unknown thay vì tính bằng 0.",
    sourceKind: "product",
  },
  maxActiveRisk: {
    label: "Max Active Risk",
    help: "Giới hạn Active Risk của Money Management Plan cho portfolio. Các mức như 6% hoặc 10% trong sách là ví dụ cấu hình, không phải mặc định bắt buộc.",
    sourceKind: "product",
  },
  remainingRiskBudget: {
    label: "Remaining Risk Budget",
    help: "Phần Max Active Risk còn lại sau known Active Risk và planned Trade risk; không được dùng để tuyên bố an toàn khi có Risk Unknown.",
    sourceKind: "product",
  },
  projectedActiveRisk: {
    label: "Projected Active Risk",
    help: "Known Active Risk cộng risk của Trade đang lập kế hoạch. Đây là phép tính sản phẩm phục vụ cảnh báo trước entry.",
    sourceKind: "product",
  },
  riskAddedByPlannedTrade: {
    label: "Risk Added by Planned Trade",
    help: "Tổng risk consumption của Trade đang lập kế hoạch sau commission và Slippage Allowance.",
    sourceKind: "product",
  },
  winRatio: {
    label: "Win Ratio",
    help: "Số winning closed logical Trades chia cho tổng closed logical Trades đủ điều kiện.",
    sourceKind: "book",
  },
  payoffRatio: {
    label: "Payoff Ratio",
    help: "Average Winning Trade chia cho trị tuyệt đối của Average Losing Trade.",
    sourceKind: "book",
  },
  optimalF: {
    label: "Optimal f",
    help: "Giá trị toán học theo McDowell dùng Win Ratio và Payoff Ratio. QeoIndex chỉ hiển thị thông tin, không tự áp vào Risk per Trade.",
    sourceKind: "book",
  },
} as const satisfies Record<string, RiskSizingTerm>
