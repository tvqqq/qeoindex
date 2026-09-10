import Link from "next/link"

import styles from "@/components/home/top-stocks-marquee.module.css"
import { stockLogoUrl } from "@/modules/market/stock-logo-url"

export interface TopStocksMarqueeStock {
  ticker: string
  companyName: string | null
  logoPath: string | null
}

function LogoGroup({
  stocks,
  duplicate = false,
}: {
  stocks: TopStocksMarqueeStock[]
  duplicate?: boolean
}) {
  return (
    <div className={styles.group} aria-hidden={duplicate || undefined}>
      {stocks.map((stock) => {
        const label = stock.companyName
          ? `${stock.ticker} · ${stock.companyName}`
          : stock.ticker

        return (
          <Link
            key={stock.ticker}
            href={`/insights/${stock.ticker}`}
            prefetch={false}
            tabIndex={duplicate ? -1 : undefined}
            className={styles.logoLink}
            aria-label={duplicate ? undefined : `Mở phân tích ${label}`}
            title={label}
          >
            <img
              src={stockLogoUrl(stock.logoPath || stock.ticker)}
              alt={duplicate ? "" : label}
              width={48}
              height={48}
              loading="lazy"
              decoding="async"
              className={styles.logo}
            />
          </Link>
        )
      })}
    </div>
  )
}

export function TopStocksMarquee({ stocks }: { stocks: TopStocksMarqueeStock[] }) {
  if (stocks.length === 0) return null

  return (
    <section
      className={styles.shell}
      aria-labelledby="home-top-stocks-marquee-title"
      data-home-top-stocks-marquee
    >
      <p id="home-top-stocks-marquee-title" className={styles.title}>
        Top 200 cổ phiếu được chọn lọc
      </p>

      <div className={styles.viewport}>
        <div className={styles.track}>
          <LogoGroup stocks={stocks} />
          <LogoGroup stocks={stocks} duplicate />
        </div>
      </div>
    </section>
  )
}
