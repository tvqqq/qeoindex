async function test() {
  const symbol = "MSN";
  
  // Test VPS
  const vpsRes = await fetch(`https://bgapidatafeed.vps.com.vn/getliststockdata/${symbol}`, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  const vpsData = (await vpsRes.json())[0];
  console.log("VPS MSN raw:", {
    sym: vpsData.sym,
    lastPrice: vpsData.lastPrice,
    r: vpsData.r,
    c: vpsData.c,
    f: vpsData.f,
    ot: vpsData.ot,
    changePc: vpsData.changePc,
    g1: vpsData.g1,
    g4: vpsData.g4
  });

  // Test DNSE chart api 1m
  const to = Math.floor(Date.now() / 1000);
  const from = to - 86400;
  const dnseRes = await fetch(`https://services.entrade.com.vn/chart-api/v2/ohlcs/stock?resolution=1&symbol=${symbol}&from=${from}&to=${to}`, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  const dnseData = await dnseRes.json();
  console.log("DNSE 1m timestamps count:", dnseData.t?.length);
  if (dnseData.t?.length) {
    const lastIdx = dnseData.t.length - 1;
    console.log("DNSE 1m last bar:", {
      time: new Date(dnseData.t[lastIdx] * 1000).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
      c: dnseData.c[lastIdx],
      v: dnseData.v[lastIdx]
    });
  }
}
test();
