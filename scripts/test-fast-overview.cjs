async function test() {
  const symbol = "MSN";
  
  const [ssiRes, vpsRes] = await Promise.allSettled([
    fetch(`https://iboard-query.ssi.com.vn/stock/${symbol}`, {
      headers: { "User-Agent": "Mozilla/5.0 StockOS/1.0" },
      signal: AbortSignal.timeout(3500),
    }).then((r) => (r.ok ? r.json() : null)),
    fetch(`https://bgapidatafeed.vps.com.vn/getliststockdata/${symbol}`, {
      headers: { "User-Agent": "Mozilla/5.0 StockOS/1.0" },
      signal: AbortSignal.timeout(3500),
    }).then((r) => (r.ok ? r.json() : null)),
  ]);

  const ssiData = ssiRes.status === "fulfilled" ? ssiRes.value?.data : null;
  const vpsData = vpsRes.status === "fulfilled" && Array.isArray(vpsRes.value) ? vpsRes.value[0] : null;

  console.log("ssiData:", ssiData);
  console.log("vpsData:", vpsData ? { sym: vpsData.sym, lastPrice: vpsData.lastPrice, r: vpsData.r } : null);
}
test();
