async function testSSIEndpoints() {
  const symbol = "STB"
  
  const endpoints = [
    `https://iboard-query.ssi.com.vn/stock/STB`,
    `https://iboard-query.ssi.com.vn/stock/foreign/STB`,
    `https://iboard-query.ssi.com.vn/statistics/foreign-flow?symbol=STB`,
    `https://iboard-query.ssi.com.vn/stock/orderbook/STB`,
    `https://iboard-query.ssi.com.vn/v2/stock/exchange/hose`,
  ]

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })
      console.log(`[${res.status}] ${url}`)
      if (res.ok) {
        const text = await res.text()
        console.log(`=> ${text.slice(0, 300)}`)
      }
    } catch (e) {
      console.log(`ERR ${url}:`, e.message)
    }
  }
}

testSSIEndpoints()
