async function testProviders() {
  const symbol = "STB"
  
  const endpoints = [
    // VNDirect
    `https://finfo-api.vndirect.com.vn/v4/stocks?q=code:${symbol}`,
    `https://finfo-api.vndirect.com.vn/v4/stock_intraday_latest?filter=code:${symbol}`,
    `https://finfo-api.vndirect.com.vn/v4/foreign_trading?filter=code:${symbol}&sort=date:desc&size=5`,
    // VPS
    `https://bgapidatafeed.vps.com.vn/getliststockdata/${symbol}`,
    `https://bgapidatafeed.vps.com.vn/getstockdata/${symbol}`,
  ]

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })
      console.log(`[${res.status}] ${url}`)
      if (res.ok) {
        const text = await res.text()
        console.log(`=> ${text.slice(0, 400)}`)
      }
    } catch (e) {
      console.log(`ERR ${url}:`, e.message)
    }
  }
}

testProviders()
