import assert from "node:assert/strict"
import test from "node:test"
import {
  backupLegacyLocalSettings,
  getLegacyBackupKey,
  migrateDrawings,
  type LegacyDrawing,
  type PersistedDrawingV2,
} from "../components/stock-detail/chart/drawings/index.ts"

test("Legacy drawing with valid time + price safely migrates to canonical V2 anchors", () => {
  const legacyDrawings = [
    {
      id: "legacy-trend-1",
      tool: "trendline",
      points: [
        { x: 120, y: 340, time: 1700000000, price: 42.5 },
        { x: 450, y: 180, time: 1700500000, price: 49.8 },
      ],
      color: "#10b981",
      lineWidth: 3,
    },
  ]

  const result = migrateDrawings(legacyDrawings, { defaultTimeframe: "1D" })

  assert.equal(result.migrated.length, 1)
  assert.equal(result.unresolved.length, 0)
  assert.equal(result.warnings.length, 0)

  const migrated = result.migrated[0]
  assert.equal(migrated.schemaVersion, 2)
  assert.equal(migrated.id, "legacy-trend-1")
  assert.equal(migrated.tool, "trendline")
  assert.equal(migrated.sourceTimeframe, "1D")
  assert.equal(migrated.visibility, "global")
  assert.equal(migrated.style.color, "#10b981")
  assert.equal(migrated.style.lineWidth, 3)

  // Anchors must ONLY contain time and price; x and y must NOT be in persisted anchors
  assert.deepEqual(migrated.anchors, [
    { time: 1700000000, price: 42.5 },
    { time: 1700500000, price: 49.8 },
  ])
  assert.equal("x" in migrated.anchors[0], false)
  assert.equal("y" in migrated.anchors[0], false)
})

test("Legacy drawing with missing time or price is NEVER guessed and marked unresolved", () => {
  const unsafeDrawings = [
    {
      id: "legacy-missing-time",
      tool: "horizontal",
      points: [{ x: 200, y: 300, price: 50 }], // missing time
    },
    {
      id: "legacy-missing-price",
      tool: "text",
      points: [{ x: 150, y: 250, time: 1700000000 }], // missing price
      text: "Note",
    },
    {
      id: "legacy-pixels-only",
      tool: "trendline",
      points: [
        { x: 100, y: 200 },
        { x: 300, y: 400 },
      ], // only pixels
    },
  ]

  const result = migrateDrawings(unsafeDrawings)

  assert.equal(result.migrated.length, 0, "No unsafe drawings should be converted to V2")
  assert.equal(result.unresolved.length, 3, "All 3 drawings must be preserved in unresolved")
  assert.equal(result.warnings.length, 3)

  assert.ok(result.warnings.some((w) => w.drawingId === "legacy-missing-time"))
  assert.ok(result.warnings.some((w) => w.drawingId === "legacy-missing-price"))
  assert.ok(result.warnings.some((w) => w.drawingId === "legacy-pixels-only"))
})

test("migrateDrawings passes through already-valid V2 drawings", () => {
  const existingV2: PersistedDrawingV2 = {
    schemaVersion: 2,
    id: "existing-v2",
    tool: "arrow",
    anchors: [
      { time: 1700000000, price: 30 },
      { time: 1700100000, price: 35 },
    ],
    sourceTimeframe: "1h",
    visibility: "source-timeframe",
    style: { color: "#f43f5e", lineWidth: 2 },
  }

  const result = migrateDrawings([existingV2])
  assert.equal(result.migrated.length, 1)
  assert.deepEqual(result.migrated[0], existingV2)
  assert.equal(result.unresolved.length, 0)
})

test("migrateDrawings filters out interactive non-drawing tools (cursor, eraser)", () => {
  const mixed = [
    { id: "tool-cursor", tool: "cursor", points: [{ x: 0, y: 0, time: 1000, price: 10 }] },
    { id: "tool-eraser", tool: "eraser", points: [{ x: 0, y: 0, time: 1000, price: 10 }] },
    { id: "valid-line", tool: "trendline", points: [{ x: 0, y: 0, time: 1000, price: 10 }] },
  ]

  const result = migrateDrawings(mixed)
  assert.equal(result.migrated.length, 1)
  assert.equal(result.migrated[0].id, "valid-line")
  assert.equal(result.unresolved.length, 0)
})

test("backupLegacyLocalSettings preserves backup under expected key and is idempotent", () => {
  // Mock localStorage in Node test environment
  const store = new Map<string, string>()
  const originalWindow = globalThis.window

  const mockStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => store.set(key, val),
  }

  // Attach mock
  // @ts-expect-error Mocking global window for testing
  globalThis.window = { localStorage: mockStorage }

  try {
    const ticker = "fpt"
    const backupKey = getLegacyBackupKey(ticker)
    assert.equal(backupKey, "qeo_chart_settings_legacy_backup_FPT")

    const rawLegacyPayload = JSON.stringify({
      ticker: "FPT",
      drawings: [{ id: "draw-old", x: 10, y: 20 }],
    })

    // First call: creates backup
    const createdFirst = backupLegacyLocalSettings(ticker, rawLegacyPayload)
    assert.equal(createdFirst, true)
    assert.equal(store.get(backupKey), rawLegacyPayload)

    // Second call: does not overwrite existing backup
    const overwrittenPayload = JSON.stringify({ ticker: "FPT", drawings: [] })
    const createdSecond = backupLegacyLocalSettings(ticker, overwrittenPayload)
    assert.equal(createdSecond, false)
    assert.equal(store.get(backupKey), rawLegacyPayload, "Backup must remain original payload")
  } finally {
    globalThis.window = originalWindow
  }
})
