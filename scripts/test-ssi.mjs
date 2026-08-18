async function testSSI() {
  const symbol = "STB"
  const res = await fetch(`https://iboard-query.ssi.com.vn/stock/${symbol}`, {
    headers: { "User-Agent": "Mozilla/5.0" }
  })
  const json = await res.json()
  console.log("SSI Full Data:", JSON.stringify(json.data, null, 2))
}

testSSI()
