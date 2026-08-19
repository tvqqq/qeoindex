const tickers = [
  "VIC", "VHM", "VCB", "BID", "CTG", "TCB", "VPB", "MBB", "HPG", "GAS",
  "MCH", "LPB", "VPL", "STB", "HDB", "BSR", "ACB", "VNM", "FPT", "GVR",
  "DMX", "TCX", "MWG", "MSN", "VJC", "HVN", "VCK", "SHB", "SSI", "SAB",
  "VRE", "SSB", "MSB", "VIB", "BVH", "VPX", "PLX", "GEE", "POW", "TPB",
  "BCM", "HCM", "EIB", "NVL", "VIX", "GMD", "GEX", "OCB", "REE", "GEL",
  "PGV", "KBC", "VCI", "VND", "NAB", "FRT", "KDH", "VPI", "SBT", "PNJ",
  "HAG", "VGC", "PVD", "DCM", "DGC", "CRV", "DPM", "KDC", "VBB", "SJS",
  "DXG", "LGC", "TAL", "DHG", "SIP", "BMP", "PDR", "BAF", "NLG", "VCG",
  "VHC", "TCH", "VSH", "CTR", "KLB", "BWE", "DSE", "CII", "EVF", "PVT",
  "VTP", "HPA", "ORS", "DGW", "HAH", "HSG", "PC1", "DIG", "FTS", "PHR"
];

function getImageSize(buffer) {
  // Simple PNG header dimension parser
  if (buffer.length > 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height, type: "png" };
  }
  // Simple JPEG header dimension parser (SOF0/SOF2 marker)
  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length - 8) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      const len = buffer.readUInt16BE(offset + 2);
      if (marker === 0xc0 || marker === 0xc2) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        return { width, height, type: "jpeg" };
      }
      offset += 2 + len;
    }
  }
  return null;
}

async function check100() {
  console.log("Analyzing 100 tickers across Ruatichsan, 24hMoney, and Vietstock...");

  const results = [];

  for (const t of tickers) {
    const sources = [
      { name: "ruatichsan", url: `https://ruatichsan.com/images/logos/${t}.jpeg` },
      { name: "ruatichsan-png", url: `https://ruatichsan.com/images/logos/${t}.png` },
      { name: "24hmoney-jpg", url: `https://cdn.24hmoney.vn/upload/images_cr/2021-12-03/partner/images/uploaded/dulieudownload/logodn/${t}.jpg` },
      { name: "24hmoney-png", url: `https://cdn.24hmoney.vn/upload/images_cr/2021-12-03/partner/images/uploaded/dulieudownload/logodn/${t}.png` },
      { name: "vietstock", url: `https://finance.vietstock.vn/image/${t}` }
    ];

    let best = null;

    for (const src of sources) {
      try {
        const res = await fetch(src.url, {
          headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
          signal: AbortSignal.timeout(3000)
        });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length > 500) {
            const dims = getImageSize(buf);
            if (dims && dims.width > 0 && dims.height > 0) {
              const ratio = Math.abs(dims.width / dims.height - 1);
              const isSquare = ratio < 0.15; // Within 15% of 1:1
              
              if (!best || (isSquare && !best.isSquare) || (isSquare === best.isSquare && buf.length > best.length)) {
                best = {
                  source: src.name,
                  url: src.url,
                  width: dims.width,
                  height: dims.height,
                  isSquare,
                  length: buf.length,
                  ratio: (dims.width / dims.height).toFixed(2),
                  buffer: buf
                };
              }
            }
          }
        }
      } catch (e) {}
    }

    results.push({ ticker: t, best });
    process.stdout.write(".");
  }

  console.log("\n\nAnalysis complete!");
  const squareCount = results.filter(r => r.best?.isSquare).length;
  console.log(`Square (1:1) logos found: ${squareCount}/${tickers.length}`);
  console.log(`Sample results:`);
  for (const r of results.slice(0, 15)) {
    console.log(`  ${r.ticker}: ${r.best?.source} (${r.best?.width}x${r.best?.height}, ratio: ${r.best?.ratio}, square: ${r.best?.isSquare})`);
  }
}

check100();
