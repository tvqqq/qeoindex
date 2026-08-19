async function testSources() {
  const testTickers = ["VCB", "MSN", "HPG", "VNM", "FPT", "VIC", "VHM", "TCB", "MBB", "MWG", "DGC", "STB", "LPB", "VIX", "SHB", "DIG", "DXG", "PNJ", "FRT", "KDH", "HSG", "PHR", "DMX"];

  console.log("=== 1. Testing Ruatichsan ===");
  let rtsCount = 0;
  for (const t of testTickers) {
    try {
      const urlJpeg = `https://ruatichsan.com/images/logos/${t}.jpeg`;
      const urlPng = `https://ruatichsan.com/images/logos/${t}.png`;
      const urlJpg = `https://ruatichsan.com/images/logos/${t}.jpg`;

      let res = await fetch(urlJpeg, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(3000) });
      let chosenUrl = urlJpeg;
      if (!res.ok) {
        res = await fetch(urlPng, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(3000) });
        chosenUrl = urlPng;
      }
      if (!res.ok) {
        res = await fetch(urlJpg, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(3000) });
        chosenUrl = urlJpg;
      }

      if (res.ok) {
        const len = Number(res.headers.get("content-length") || 0);
        console.log(`Ruatichsan ${t} => OK (${chosenUrl}), len: ${len}`);
        rtsCount++;
      } else {
        console.log(`Ruatichsan ${t} => FAIL (${res.status})`);
      }
    } catch (e) {
      console.log(`Ruatichsan ${t} => Error: ${e.message}`);
    }
  }
  console.log(`Ruatichsan: ${rtsCount}/${testTickers.length}`);

  console.log("\n=== 2. Testing 24hMoney profile HTML / Image API ===");
  try {
    const res = await fetch("https://24hmoney.vn/stock/MSN/profile", {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" }
    });
    console.log("24hmoney MSN profile status:", res.status);
    const html = await res.text();
    const regex = /https?:\/\/[^"'\s\)]+\.(?:png|jpg|jpeg|webp)/gi;
    const matches = html.match(regex) || [];
    console.log("24hmoney MSN image URLs:", matches.filter(u => !u.includes("icon") && !u.includes("avatar")).slice(0, 10));
  } catch (e) {
    console.log("24hmoney error:", e.message);
  }
}
testSources();
