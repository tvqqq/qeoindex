const fs = require("fs");
const path = require("path");

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

const targetDir = path.join(process.cwd(), "public", "logos");
if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

function parseImageDimensions(buffer) {
  // PNG
  if (buffer.length > 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height, type: "png" };
  }
  // JPEG
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

async function fetchCandidate(src) {
  try {
    const res = await fetch(src.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 500) return null;
    const dims = parseImageDimensions(buf);
    if (!dims || dims.width <= 0 || dims.height <= 0) return null;

    const ratio = dims.width / dims.height;
    const diffFromSquare = Math.abs(ratio - 1);
    const isSquare = diffFromSquare <= 0.25; // within 25% of square

    return {
      name: src.name,
      url: src.url,
      width: dims.width,
      height: dims.height,
      type: dims.type,
      ratio: ratio.toFixed(2),
      isSquare,
      diffFromSquare,
      sizeBytes: buf.length,
      buffer: buf
    };
  } catch (e) {
    return null;
  }
}

async function processTicker(ticker) {
  const sources = [
    // 1. Ruatichsan (Square stock logos)
    { name: "ruatichsan-jpeg", url: `https://ruatichsan.com/images/logos/${ticker}.jpeg` },
    { name: "ruatichsan-png", url: `https://ruatichsan.com/images/logos/${ticker}.png` },
    { name: "ruatichsan-jpg", url: `https://ruatichsan.com/images/logos/${ticker}.jpg` },
    // 2. 24hMoney (Financial media company logos)
    { name: "24hmoney-jpg", url: `https://cdn.24hmoney.vn/upload/images_cr/2021-12-03/partner/images/uploaded/dulieudownload/logodn/${ticker}.jpg` },
    { name: "24hmoney-png", url: `https://cdn.24hmoney.vn/upload/images_cr/2021-12-03/partner/images/uploaded/dulieudownload/logodn/${ticker}.png` },
    // 3. Vietstock Official Portal
    { name: "vietstock", url: `https://finance.vietstock.vn/image/${ticker}` }
  ];

  const candidates = (await Promise.all(sources.map(fetchCandidate))).filter(Boolean);

  if (candidates.length === 0) return null;

  // Sorting priorities:
  // 1. Prefer Square (closest to 1:1 ratio)
  // 2. Prefer Ruatichsan / 24hMoney if square
  // 3. Higher resolution / file size
  candidates.sort((a, b) => {
    // If one is closer to square (ratio 1.0)
    if (a.isSquare && !b.isSquare) return -1;
    if (!a.isSquare && b.isSquare) return 1;
    if (a.isSquare && b.isSquare) {
      if (Math.abs(a.diffFromSquare - b.diffFromSquare) > 0.05) {
        return a.diffFromSquare - b.diffFromSquare;
      }
      // If both equally square, prefer Ruatichsan or 24hMoney
      const aIsFav = a.name.includes("ruatichsan") || a.name.includes("24hmoney");
      const bIsFav = b.name.includes("ruatichsan") || b.name.includes("24hmoney");
      if (aIsFav && !bIsFav) return -1;
      if (!aIsFav && bIsFav) return 1;
    }
    // Else higher resolution / size
    return b.sizeBytes - a.sizeBytes;
  });

  const best = candidates[0];

  // Save as standard PNG/JPEG
  const ext = "png";
  const filePath = path.join(targetDir, `${ticker}.${ext}`);
  fs.writeFileSync(filePath, best.buffer);

  return {
    ticker,
    chosenSource: best.name,
    originalUrl: best.url,
    dimensions: `${best.width}x${best.height}`,
    ratio: best.ratio,
    isSquare: best.isSquare,
    sizeBytes: best.sizeBytes,
    localUrl: `/logos/${ticker}.png`
  };
}

async function run() {
  console.log(`Starting parallel download & square-ratio selection for all ${tickers.length} tickers...`);

  const CONCURRENCY = 10;
  const finalMap = {};
  let totalSquare = 0;

  for (let i = 0; i < tickers.length; i += CONCURRENCY) {
    const chunk = tickers.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(processTicker));
    for (const r of results) {
      if (r) {
        finalMap[r.ticker] = r;
        if (r.isSquare) totalSquare++;
      }
    }
    process.stdout.write(".");
  }

  fs.writeFileSync(path.join(targetDir, "index.json"), JSON.stringify(finalMap, null, 2), "utf8");

  console.log(`\n\nAll ${tickers.length} tickers processed!`);
  console.log(`- Perfect Square / Near-Square logos: ${totalSquare}/${tickers.length}`);
  console.log(`- Ruatichsan & 24hMoney sources selected: ${Object.values(finalMap).filter(x => x.chosenSource.includes("ruatichsan") || x.chosenSource.includes("24hmoney")).length}/${tickers.length}`);
}

run();
