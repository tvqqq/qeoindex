export type PerformanceTerm = {
  labelVi: string
  labelEn: string
  formula: string
  helpVi: string
}

export const PERFORMANCE_TERMINOLOGY = {
  documentedPnl: {
    labelVi: "Lãi/lỗ đã ghi nhận",
    labelEn: "Documented P/L",
    formula: "Closed Trade Net P/L / Portfolio Initial Capital",
    helpVi: "Chỉ dùng các Trade logic đã đóng và vốn ban đầu hợp lệ; không thay thế Account Equity.",
  },
  winRatio: {
    labelVi: "Tỷ lệ thắng",
    labelEn: "Win Ratio",
    formula: "Winning Closed Trades / Eligible Closed Trades",
    helpVi: "Đếm Trade logic đã đóng, không đếm từng fill. Mẫu nhỏ không chứng minh hệ thống có lợi thế.",
  },
  payoffRatio: {
    labelVi: "Tỷ lệ lời/lỗ",
    labelEn: "Payoff Ratio",
    formula: "Average Winning Trade / Absolute Average Losing Trade",
    helpVi: "Cần có ít nhất một Trade thắng và một Trade thua; thiếu một phía sẽ hiển thị N/A.",
  },
  commissionRatio: {
    labelVi: "Tỷ lệ phí giao dịch",
    labelEn: "Commission Ratio",
    formula: "Total Commission / Gross Profit",
    helpVi: "Không áp dụng khi Gross Profit không dương.",
  },
  accountEquity: {
    labelVi: "Giá trị tài khoản",
    labelEn: "Account Equity",
    formula: "Cash + Market Value of Open Positions",
    helpVi: "Chuỗi giá trị toàn danh mục sử dụng dữ liệu giá RAW đủ điều kiện; không suy ra từ realized P/L.",
  },
  drawdown: {
    labelVi: "Sụt giảm từ đỉnh",
    labelEn: "Drawdown",
    formula: "(Peak Account Equity - Current Account Equity) / Peak Account Equity",
    helpVi: "Đo mức suy giảm của Account Equity so với đỉnh trước đó. Thiếu dữ liệu giá sẽ fail-closed.",
  },
  benchmark: {
    labelVi: "So sánh VN-Index",
    labelEn: "Benchmark vs VN-Index",
    formula: "Independent cumulative returns from first common complete date",
    helpVi: "Danh mục và VN-Index dùng baseline riêng tại ngày đầu tiên cả hai cùng có dữ liệu hoàn chỉnh.",
  },
  alpha: {
    labelVi: "Chênh lệch hiệu suất",
    labelEn: "Alpha",
    formula: "Portfolio Return - VN-Index Return",
    helpVi: "Chỉ có ý nghĩa khi benchmark có cùng khoảng thời gian hợp lệ.",
  },
  optimalF: {
    labelVi: "Optimal f tham khảo",
    labelEn: "Optimal f",
    formula: "(((Payoff Ratio + 1) × Win Probability) - 1) / Payoff Ratio",
    helpVi: "Đây là chỉ báo mạnh/aggressive để tham khảo, không phải khuyến nghị sizing và không tự động thay đổi thiết lập rủi ro.",
  },
} satisfies Record<string, PerformanceTerm>

export type PerformanceTermKey = keyof typeof PERFORMANCE_TERMINOLOGY

export function performanceTermTitle(key: PerformanceTermKey): string {
  const term = PERFORMANCE_TERMINOLOGY[key]
  return `${term.labelVi}. Thuật ngữ gốc: ${term.labelEn}. Công thức gốc: ${term.formula}. ${term.helpVi}`
}
