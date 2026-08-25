import { queryDataSource, type NotionPage } from "./notion/client.ts"
import { checkboxValue, numberValue, pageProperties, richText, selectText, titleText } from "./notion/properties.ts"
import { selectWyckoffV2Universe, type WyckoffV2UniverseRow } from "./wyckoff-v2-universe.ts"

export const WYCKOFF_V2_UNIVERSE_DATA_SOURCE_ID = process.env.NOTION_WYCKOFF_UNIVERSE_DATA_SOURCE_ID ?? "210c502d-0c32-4fdd-9d69-7ef18e2be7d5"

export function parseWyckoffV2UniversePage(page: NotionPage): WyckoffV2UniverseRow | null {
  const props = pageProperties(page)
  const ticker = titleText(props.Ticker).trim().toUpperCase()
  if (!ticker) return null
  return {
    ticker,
    active: checkboxValue(props.Active),
    exchange: selectText(props.Exchange),
    rank: numberValue(props.Rank),
    sector: richText(props.Sector),
  }
}

export async function loadWyckoffV2Universe() {
  const result = await queryDataSource(WYCKOFF_V2_UNIVERSE_DATA_SOURCE_ID, {
    pageSize: 100,
    maxPages: 3,
    errorContext: "Notion Wyckoff v2 Universe query",
  })
  const rows = result.results
    .map(parseWyckoffV2UniversePage)
    .filter((row): row is WyckoffV2UniverseRow => Boolean(row))
  if (!rows.length) throw new Error("Wyckoff v2 Universe query returned no ticker rows")
  return selectWyckoffV2Universe(rows)
}
