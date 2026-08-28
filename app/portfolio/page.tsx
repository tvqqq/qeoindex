import type { Metadata } from "next"

import { PortfolioPage } from "@/components/portfolio/portfolio-page"

export const metadata: Metadata = {
  title: "Danh mục & Theo dõi — QeoIndex",
  description: "Quản lý danh mục đầu tư và danh sách theo dõi cổ phiếu.",
}

export const dynamic = "force-dynamic"

export default async function PortfolioRoute() {
  return <PortfolioPage />
}
