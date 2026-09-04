/**
 * EOD Canonical Shares Outstanding for Universe Stocks.
 * Source of Truth: TradingView Scanner & HOSE/HNX Listed Shares.
 *
 * This module is imported by client orderbook UI, so it must remain browser-safe.
 * Canonical universe membership is resolved server-side and passed explicitly to
 * provider helpers rather than importing the server-only universe service here.
 */
export const STATIC_SHARES_FALLBACK: Record<string, number> = {
  BCM: 1035000000, BVH: 742323000, VPX: 1875000000, GVR: 4000000000, HSG: 807263000,
  DIG: 796431000, PVD: 927764000, VPI: 320050000, CII: 671985000, GMD: 426495000,
  MCH: 1307400000, VND: 1522300000, NLG: 485097000, TCH: 912109000, SBT: 906415000,
  HAG: 1267400000, BMP: 81860900, GEX: 1308470000, PGV: 1213350000, VRE: 2272320000,
  VIC: 7554899036, VNM: 2089960000, PHR: 135499000, VJC: 769093000, KDC: 276345000,
  SSB: 3428800000, OCB: 3062510000, POW: 3067850000, VSH: 236241000, VTP: 201894000,
  HVN: 3111500000, BWE: 251347000, BAF: 364824920, CTR: 128109530, SSI: 3001321201,
  VBB: 1184586500, HAH: 188340000, CTG: 7766940000, SIP: 242112950, TCB: 7086240000,
  GEL: 890000000, VPB: 7933920000, HPA: 285000000, SHB: 5343700000, NAB: 2158820000,
  PDR: 997809000, DMX: 1267722000, GAS: 2412950000, VHC: 209453000, VGC: 448350000,
  VIB: 3404010000, EVF: 760566000, LPB: 2987280000, DPM: 679925000, KBC: 941755000,
  PC1: 411285000, DXG: 1268110000, FTS: 381146000, SJS: 297475000, TAL: 503999700,
  ACB: 5804420000, EIB: 1862720000, TPB: 2774050000, MSB: 3120000000, TCX: 2773900100,
  BID: 7778260000, FPT: 1714330000, DGW: 221161000, ORS: 623931000, MBB: 10068800000,
  HPG: 8442970000, DHG: 130746000, VCB: 8355680000, VCG: 698186000, DSE: 428249820,
  DCM: 529400000, BSR: 5007300000, GEE: 640499200, REE: 622899000, SAB: 1282560000,
  NVL: 2402070000, HCM: 1349950000, CRV: 687399900, PLX: 1270590000, HDB: 5005280000,
  PNJ: 511722000, DGC: 379778000, VHM: 8214820000, STB: 1885220000, VCI: 1152230000,
  MSN: 1534950000, KLB: 748988340, FRT: 178815000, VPL: 1877450300, KDH: 1122210000,
  VCK: 2434919700, PVT: 516919000, VIX: 2450290000, MWG: 1468427883,
}

/** EOD foreign-room compatibility fallback. Dynamic/provider values remain authoritative. */
export const STATIC_FOREIGN_ROOM_FALLBACK: Record<string, number> = {
  VIC:3482802109,VHM:1783816638,VCB:825739393,BID:907534955,CTG:409316368,TCB:142742399,VPB:562895552,MBB:86087905,HPG:2307015615,GAS:1132382707,
  MCH:1104121650,LPB:104869863,VPL:800837391,STB:358116391,HDB:269530003,BSR:2393875762,ACB:355050846,VNM:1050897212,FPT:371445358,GVR:495347995,
  DMX:503771390,TCX:2523089755,MWG:0,MSN:1165982745,VJC:184008517,HVN:666959034,VCK:2346878370,SHB:1418232967,SSI:1746186542,SAB:527807880,
  VRE:882697129,SSB:1020629904,MSB:707241694,VIB:58506419,BVH:160501942,VPX:1798939100,PLX:74865371,GEE:314430240,POW:1398440982,TPB:223021268,
  BCM:347867759,HCM:161790842,EIB:538102099,NVL:1078301975,VIX:2276737614,GMD:39522884,GEX:566844282,OCB:75562665,REE:0,GEL:414644941,
  PGV:561494802,KBC:394130926,VCI:955303402,VND:1390309742,NAB:626081638,FRT:27707172,KDH:288171162,VPI:125989186,SBT:745145216,PNJ:22759825,
  HAG:599049183,VGC:215500359,PVD:384122119,DCM:230554702,DGC:171278567,CRV:343699935,DPM:317519111,KDC:106318325,VBB:355139380,SJS:147067396,
  DXG:404220194,LGC:8539433,TAL:196918065,DHG:60191846,SIP:112871173,BMP:14427706,PDR:428791443,BAF:171473568,NLG:57407330,VCG:328301665,
  VHC:170901259,TCH:382263334,VSH:112957184,CTR:55682297,KLB:211962605,BWE:102824199,DSE:382610971,CII:244032570,EVF:112202862,PVT:179711384,
  VTP:91440136,HPA:282326147,ORS:303847198,DGW:54562592,HAH:41338563,HSG:369619761,PC1:171147720,DIG:369684635,FTS:287249445,PHR:0,
}

let cachedForeignRoomMap: Record<string, number> = { ...STATIC_FOREIGN_ROOM_FALLBACK }

export function getEodForeignRoom(symbol: string): number | null {
  const sym = symbol.trim().toUpperCase()
  if (sym in cachedForeignRoomMap) return cachedForeignRoomMap[sym]
  return STATIC_FOREIGN_ROOM_FALLBACK[sym] ?? null
}

export function setEodForeignRooms(map: Record<string, number>) {
  cachedForeignRoomMap = { ...STATIC_FOREIGN_ROOM_FALLBACK, ...map }
}

let cachedSharesMap: Record<string, number> | null = null
let lastFetchedAt = 0
let cachedUniverseKey = ""

/** Fetches latest EOD shares outstanding for an explicitly supplied canonical universe. */
export async function getUniverseSharesOutstanding(tickers: string[]): Promise<Record<string, number>> {
  const universe = [...new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))]
  if (!universe.length) return STATIC_SHARES_FALLBACK
  const universeKey = universe.join(",")
  const now = Date.now()
  if (cachedSharesMap && cachedUniverseKey === universeKey && now - lastFetchedAt < 12 * 60 * 60 * 1000) return cachedSharesMap

  try {
    const res = await fetch("https://scanner.tradingview.com/vietnam/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filter: [{ left: "name", operation: "in_range", right: universe }],
        symbols: { tickers: [] },
        columns: ["name", "total_shares_outstanding"],
      }),
      signal: AbortSignal.timeout(4000),
    })

    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data?.data)) {
        const nextMap: Record<string, number> = { ...STATIC_SHARES_FALLBACK }
        for (const item of data.data) {
          const sym = item?.d?.[0]
          const shares = Number(item?.d?.[1])
          if (sym && Number.isFinite(shares) && shares > 0) nextMap[sym] = Math.round(shares)
        }
        cachedSharesMap = nextMap
        cachedUniverseKey = universeKey
        lastFetchedAt = now
        return nextMap
      }
    }
  } catch (err) {
    console.warn("[EOD Shares] Fallback to static share mapping:", err)
  }

  return STATIC_SHARES_FALLBACK
}

export function calculateForeignRoomPercent(
  foreignRoom: number | null | undefined,
  symbol: string,
  listedShare?: number | null,
): { percent: number | null; totalShares: number | null } {
  if (typeof foreignRoom !== "number" || foreignRoom <= 0) {
    return { percent: foreignRoom === 0 ? 0 : null, totalShares: listedShare ?? null }
  }

  const total = (listedShare && listedShare > 0) ? listedShare : (STATIC_SHARES_FALLBACK[symbol] ?? null)
  if (!total || total <= 0) return { percent: null, totalShares: null }
  return { percent: Math.min(100, Math.max(0, (foreignRoom / total) * 100)), totalShares: total }
}
