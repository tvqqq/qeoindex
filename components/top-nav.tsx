"use client"

import { useState } from "react"
import { Bot, Gift, Hexagon } from "lucide-react"

const NAV = ["Bảng điện", "Tin tức", "Phân tích", "Danh mục", "Sàng lọc", "Bảng giá"]

export function TopNav() {
  const [active, setActive] = useState("Bảng điện")

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-panel px-4">
      <div className="flex items-center gap-8">
        {/* logo */}
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand/15">
            <Hexagon className="h-5 w-5 text-brand" strokeWidth={2.2} />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-base font-bold text-foreground">
              Stock<span className="text-brand">OS</span>
            </span>
            <span className="text-[10px] text-muted">Bộ công cụ đầu tư</span>
          </div>
        </div>

        {/* nav */}
        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => {
            const on = item === active
            return (
              <button
                key={item}
                type="button"
                onClick={() => setActive(item)}
                className={[
                  "relative px-3 py-2 text-sm transition-colors",
                  on ? "font-semibold text-brand" : "text-muted-2 hover:text-foreground",
                ].join(" ")}
              >
                {item}
                {on && <span className="absolute inset-x-2 -bottom-[9px] h-0.5 rounded-full bg-brand" />}
              </button>
            )
          })}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Ưu đãi"
          className="rounded-md p-2 text-muted-2 transition-colors hover:bg-panel-2 hover:text-foreground"
        >
          <Gift className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-2 transition-colors hover:bg-panel-2 hover:text-foreground"
        >
          <Bot className="h-4 w-4" />
          <span className="hidden lg:inline">Cộng đồng</span>
        </button>
        <div className="flex items-center gap-2 pl-1">
          <span className="hidden text-sm text-foreground sm:inline">quyenjino96</span>
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand/20 text-sm font-semibold text-brand">
            Q
          </div>
        </div>
      </div>
    </header>
  )
}
