// Research snapshot only. Do not reuse this file as production market-board universe membership.
// Canonical Top 100 membership remains the Notion `Wyckoff Universe — Top 100 HOSE` database.

export type FaValuation = "Rất hấp dẫn" | "Hấp dẫn" | "Hợp lý" | "Khá cao" | "Đắt–rủi ro"

export interface FaScreenRow {
  rank: number
  ticker: string
  sector: string
  pe: number
  pb: number
  roe: number
  grade: string
  valuation: FaValuation
  confidence: "Medium" | "Low–Medium"
}

export const FA_SCREEN_SNAPSHOT_DATE = "2026-08-17"
export const FA_SCREEN_SOURCE = "Finhay MCP"

type FaTuple = readonly [number, string, string, number, number, number, string, FaValuation]

const ROWS: readonly FaTuple[] = [
  [1,"VIC","BĐS / Conglomerate",68.86,9.64,7.2,"C","Đắt–rủi ro"],
  [2,"VHM","BĐS",7.02,2.17,18.4,"A-","Hấp dẫn"],
  [3,"VCB","Ngân hàng",11.74,2.03,16.7,"A","Hợp lý"],
  [4,"BID","Ngân hàng",8.63,1.49,19.1,"A-","Hấp dẫn"],
  [5,"CTG","Ngân hàng",6.08,1.25,21.3,"A-","Rất hấp dẫn"],
  [6,"TCB","Ngân hàng",8.36,1.31,15.9,"A","Hấp dẫn"],
  [7,"VPB","Ngân hàng",6.68,1.12,14.9,"B+","Hấp dẫn"],
  [8,"MBB","Ngân hàng",6.7,1.36,21.1,"A","Rất hấp dẫn"],
  [9,"GAS","Năng lượng / Khí",14.43,2.68,17.9,"A-","Hợp lý"],
  [10,"HPG","Thép",7.73,1.28,12.6,"A-","Hấp dẫn"],
  [11,"MCH","Tiêu dùng",25.66,9.98,45.1,"A","Hợp lý"],
  [12,"LPB","Ngân hàng",13.86,3.76,25.2,"B+","Đắt–rủi ro"],
  [13,"VPL","Du lịch / Khách sạn",46.89,3.14,3.2,"C","Đắt–rủi ro"],
  [14,"STB","Ngân hàng",44.25,2.28,10.3,"B-","Đắt–rủi ro"],
  [15,"HDB","Ngân hàng",6.93,1.56,25.3,"A-","Hấp dẫn"],
  [16,"BSR","Lọc hóa dầu",6.45,1.71,9.0,"B+","Hấp dẫn"],
  [17,"ACB","Ngân hàng",8.2,1.33,17.6,"A","Hấp dẫn"],
  [18,"VNM","Tiêu dùng",11.74,4.17,26.6,"A","Hấp dẫn"],
  [19,"FPT","Công nghệ",11.71,3.05,28.3,"A","Hấp dẫn"],
  [20,"GVR","Cao su / KCN",17.27,2.06,9.9,"B+","Khá cao"],
  [21,"TCX","Chứng khoán",17.83,2.38,16.1,"B+","Khá cao"],
  [22,"MWG","Bán lẻ",10.84,3.0,23.1,"A-","Hấp dẫn"],
  [24,"VJC","Hàng không",43.53,4.56,10.1,"B+","Khá cao"],
  [25,"HVN","Hàng không",15.76,7.83,-581.9,"C","Đắt–rủi ro"],
  [26,"VCK","Chứng khoán",16.09,2.33,17.8,"B+","Khá cao"],
  [27,"SSI","Chứng khoán",12.76,1.51,13.9,"A-","Hợp lý"],
  [28,"SAB","Tiêu dùng",12.17,3.16,19.3,"A-","Hấp dẫn"],
  [29,"VRE","BĐS bán lẻ",7.51,1.1,14.3,"A-","Rất hấp dẫn"],
  [30,"SHB","Ngân hàng",5.19,0.89,19.0,"B+","Rất hấp dẫn"],
  [31,"SSB","Ngân hàng",17.34,1.26,14.6,"B","Hợp lý"],
  [32,"MSB","Ngân hàng",8.55,1.12,14.2,"B+","Hấp dẫn"],
  [33,"BVH","Bảo hiểm",14.53,1.9,11.9,"B+","Hợp lý"],
  [34,"VIB","Ngân hàng",6.61,1.03,16.4,"B+","Hấp dẫn"],
  [35,"PLX","Phân phối xăng dầu",13.82,1.92,10.3,"B+","Hợp lý"],
  [36,"VPX","Chứng khoán",9.21,1.29,13.9,"B+","Hấp dẫn"],
  [37,"GEE","Thiết bị điện",12.14,5.41,44.5,"B+","Khá cao"],
  [38,"POW","Điện",6.67,0.98,8.4,"B+","Hấp dẫn"],
  [39,"TPB","Ngân hàng",5.27,0.89,17.7,"B+","Rất hấp dẫn"],
  [40,"BCM","KCN / BĐS",20.71,2.04,16.0,"B+","Hợp lý"],
  [41,"VIX","Chứng khoán",8.34,1.01,28.9,"B+","Hấp dẫn"],
  [42,"GEX","Công nghiệp / Hạ tầng",23.52,1.68,11.1,"B","Hợp lý"],
  [43,"EIB","Ngân hàng",64.95,1.34,4.4,"C","Đắt–rủi ro"],
  [44,"NVL","BĐS",7.55,0.66,3.5,"D","Đắt–rủi ro"],
  [45,"GMD","Cảng / Logistics",13.23,2.53,16.1,"A-","Hợp lý"],
  [46,"OCB","Ngân hàng",7.57,0.95,12.2,"B+","Hấp dẫn"],
  [47,"REE","Điện / Hạ tầng",10.83,1.32,13.3,"A-","Hấp dẫn"],
  [48,"HCM","Chứng khoán",25.71,2.32,9.4,"B-","Đắt–rủi ro"],
  [49,"PGV","Điện",5.48,1.51,23.0,"A-","Rất hấp dẫn"],
  [50,"GEL","Hạ tầng / BĐS",134.64,2.15,7.8,"C","Đắt–rủi ro"],
  [51,"KBC","KCN / BĐS",21.97,1.01,9.3,"B+","Hợp lý"],
  [52,"VCI","Chứng khoán",17.27,1.47,8.7,"B","Khá cao"],
  [53,"VND","Chứng khoán",9.17,1.16,10.0,"B","Hợp lý"],
  [54,"NAB","Ngân hàng",5.38,1.0,19.6,"B+","Rất hấp dẫn"],
  [55,"FRT","Bán lẻ",22.47,5.8,27.1,"A-","Khá cao"],
  [56,"KDH","BĐS",11.31,1.07,8.0,"B+","Hấp dẫn"],
  [57,"VPI","BĐS",48.66,3.6,7.4,"C","Đắt–rủi ro"],
  [58,"SBT","Đường / Tiêu dùng",25.81,1.92,7.2,"C+","Khá cao"],
  [59,"PNJ","Bán lẻ / Trang sức",6.44,1.41,23.1,"A","Rất hấp dẫn"],
  [60,"HAG","Nông nghiệp",5.22,1.19,19.1,"B-","Hợp lý"],
  [61,"VGC","VLXD / KCN",12.7,2.21,14.8,"B+","Hấp dẫn"],
  [62,"PVD","Dịch vụ dầu khí",14.94,0.97,6.3,"B","Hợp lý"],
  [63,"DCM","Phân bón",6.17,1.46,18.7,"A-","Rất hấp dẫn"],
  [64,"DGC","Hóa chất",7.68,1.06,21.7,"A","Rất hấp dẫn"],
  [65,"CRV","BĐS",213.81,2.33,1.0,"D","Đắt–rủi ro"],
  [66,"DPM","Phân bón",8.26,1.4,9.6,"B+","Hấp dẫn"],
  [67,"KDC","Tiêu dùng",28.3,3.24,7.8,"C","Đắt–rủi ro"],
  [68,"VBB","Ngân hàng",9.86,1.5,11.4,"C+","Khá cao"],
  [69,"SJS","BĐS",22.94,3.63,11.3,"C","Đắt–rủi ro"],
  [70,"DXG","BĐS",75.89,1.02,3.3,"C-","Đắt–rủi ro"],
  [71,"LGC","Hạ tầng",38.87,-1.32,12.1,"D","Đắt–rủi ro"],
  [72,"TAL","BĐS",13.33,2.2,12.5,"B","Hợp lý"],
  [73,"DHG","Dược",12.7,3.77,20.7,"A-","Hợp lý"],
  [74,"SIP","KCN / Tiện ích",8.44,2.5,27.5,"A","Rất hấp dẫn"],
  [75,"BMP","Nhựa / VLXD",9.39,4.23,44.0,"A","Rất hấp dẫn"],
  [76,"PDR","BĐS",19.47,0.98,4.4,"C+","Khá cao"],
  [77,"BAF","Nông nghiệp",121.49,2.65,3.6,"C","Đắt–rủi ro"],
  [78,"NLG","BĐS",17.92,0.89,6.4,"B+","Hấp dẫn"],
  [79,"VCG","Xây dựng / BĐS",2.91,0.97,32.8,"B","Hợp lý"],
  [80,"VHC","Thủy sản",7.88,1.3,15.8,"A-","Rất hấp dẫn"],
  [81,"TCH","BĐS",36.5,0.94,1.9,"C","Khá cao"],
  [82,"VSH","Thủy điện",10.45,1.92,17.9,"A-","Hấp dẫn"],
  [83,"CTR","Hạ tầng viễn thông",14.88,4.36,30.5,"A-","Hợp lý"],
  [84,"KLB","Ngân hàng",4.44,1.07,24.7,"B+","Rất hấp dẫn"],
  [85,"BWE","Nước / Tiện ích",10.29,1.86,17.4,"A-","Hợp lý"],
  [86,"DSE","Chứng khoán",39.37,1.74,6.5,"C","Đắt–rủi ro"],
  [87,"CII","Hạ tầng",84.95,-1.78,3.5,"D","Đắt–rủi ro"],
  [88,"EVF","Tài chính",9.9,0.94,9.5,"B-","Hợp lý"],
  [89,"PVT","Vận tải dầu khí",7.37,1.11,12.1,"A-","Rất hấp dẫn"],
  [90,"VTP","Logistics",30.82,4.8,24.1,"B+","Khá cao"],
  [91,"HPA","Nông nghiệp",6.34,1.88,49.9,"B+","Hấp dẫn"],
  [92,"ORS","Chứng khoán",21.83,1.11,2.1,"C-","Đắt–rủi ro"],
  [93,"DGW","Phân phối ICT",11.02,2.52,17.1,"A-","Hấp dẫn"],
  [94,"HAH","Vận tải biển",6.87,1.73,29.9,"A-","Rất hấp dẫn"],
  [95,"HSG","Thép",12.98,0.74,6.6,"B","Hợp lý"],
  [96,"PC1","Xây lắp điện / Năng lượng",7.16,1.5,16.3,"A-","Hấp dẫn"],
  [97,"DIG","BĐS",11.5,0.86,6.7,"C+","Hợp lý"],
  [98,"FTS","Chứng khoán",19.87,1.9,9.3,"B-","Khá cao"],
  [99,"VAB","Ngân hàng",5.8,0.77,13.9,"B+","Hấp dẫn"],
  [100,"BVB","Ngân hàng",9.64,1.08,6.1,"C","Khá cao"],
]

const LOW_CONFIDENCE = new Set<string>(["VIC","VPL","TCX","HVN","VCK","VPX","NVL","GEL","CRV","LGC","BAF","VCG","CII","HPA","ORS"])

export const FA_SCREEN_ROWS: readonly FaScreenRow[] = ROWS.map(
  ([rank, ticker, sector, pe, pb, roe, grade, valuation]) => ({
    rank,
    ticker,
    sector,
    pe,
    pb,
    roe,
    grade,
    valuation,
    confidence: LOW_CONFIDENCE.has(ticker) ? "Low–Medium" : "Medium",
  }),
)

export const FA_VALUATION_ORDER: readonly FaValuation[] = [
  "Rất hấp dẫn",
  "Hấp dẫn",
  "Hợp lý",
  "Khá cao",
  "Đắt–rủi ro",
]
