import fs from "fs"
import path from "path"

const DATABASE_ID = process.env.NOTION_DATABASE_ID || "5a0d4faf-9e5d-4fcc-b523-08ed8e5b1772"
const NOTION_TOKEN = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN

if (!NOTION_TOKEN) {
  console.error("❌ Thiếu NOTION_API_KEY hoặc NOTION_TOKEN. Hãy cung cấp token hợp lệ để chạy cập nhật icon trên Notion.")
  process.exit(1)
}

const logoIndexPath = path.join(process.cwd(), "public", "logos", "index.json")
let logoMap: Record<string, any> = {}
if (fs.existsSync(logoIndexPath)) {
  logoMap = JSON.parse(fs.readFileSync(logoIndexPath, "utf8"))
}

async function updateNotionIcons() {
  console.log(`Bắt đầu đồng bộ icon logo cho database Notion: ${DATABASE_ID}...`)

  // 1. Query all pages from database (with pagination)
  let hasMore = true
  let nextCursor: string | undefined = undefined
  const allPages: any[] = []

  while (hasMore) {
    const body: any = { page_size: 100 }
    if (nextCursor) body.start_cursor = nextCursor

    const res = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    })

    if (!res.ok) {
      const err = await res.text()
      console.error(`❌ Không thể truy vấn database Notion (${res.status}): ${err}`)
      console.log("\n👉 Gợi ý: Hãy mở trang Notion đó -> Nhấn nút '...' ở góc phải -> 'Add connections' / 'Connect to' -> Chọn Integration tương ứng.")
      return
    }

    const data = await res.json()
    allPages.push(...(data.results || []))
    hasMore = data.has_more
    nextCursor = data.next_cursor || undefined
  }

  console.log(`Tìm thấy ${allPages.length} trang trong database Notion. Đang tiến hành update icon...`)

  let success = 0
  let failed = 0

  for (const page of allPages) {
    // Extract ticker from properties
    let ticker = ""
    for (const [key, prop] of Object.entries(page.properties || {})) {
      const p = prop as any
      if (p.type === "title" && p.title?.[0]?.plain_text) {
        ticker = p.title[0].plain_text.trim().toUpperCase()
        break
      } else if (key.toLowerCase() === "ticker" || key.toLowerCase() === "symbol" || key.toLowerCase() === "mã") {
        if (p.type === "rich_text" && p.rich_text?.[0]?.plain_text) {
          ticker = p.rich_text[0].plain_text.trim().toUpperCase()
          break
        } else if (p.type === "select" && p.select?.name) {
          ticker = p.select.name.trim().toUpperCase()
          break
        }
      }
    }

    if (!ticker) {
      console.log(`- Bỏ qua trang ID ${page.id}: Không tìm thấy tên mã cổ phiếu`)
      continue
    }

    const logoInfo = logoMap[ticker]
    const logoUrl = logoInfo?.externalUrl || `https://qeoindex.com/logos/${ticker}.svg`

    try {
      const patchRes = await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${NOTION_TOKEN}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          icon: {
            type: "external",
            external: {
              url: logoUrl
            }
          }
        })
      })

      if (patchRes.ok) {
        success++
        console.log(`✅ [${success}/${allPages.length}] Đã cập nhật icon cho mã: ${ticker}`)
      } else {
        failed++
        const errText = await patchRes.text()
        console.warn(`⚠️ Thất bại cho mã ${ticker}: ${errText.slice(0, 100)}`)
      }
    } catch (e: any) {
      failed++
      console.error(`❌ Lỗi khi cập nhật ${ticker}:`, e.message)
    }

    // Rate limiting: sleep 350ms between updates
    await new Promise((resolve) => setTimeout(resolve, 350))
  }

  console.log(`\n🎉 Hoàn thành cập nhật Notion Icons: Thành công ${success}, Thất bại ${failed}.`)
}

updateNotionIcons()
