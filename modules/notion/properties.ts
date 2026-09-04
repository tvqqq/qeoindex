import type { NotionPage, NotionProperties } from "@/modules/notion/client"

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" ? value as UnknownRecord : undefined
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

function plainText(items: unknown) {
  return asArray(items)
    .map((item) => asRecord(item)?.plain_text)
    .filter((value): value is string => typeof value === "string")
    .join("")
}

export function pageProperties(page: NotionPage | null | undefined): NotionProperties {
  return page?.properties && typeof page.properties === "object" ? page.properties : {}
}

export function normalizeNotionId(value: string) {
  return value.replaceAll("-", "").toLowerCase()
}

export function titleText(property: unknown) {
  return plainText(asRecord(property)?.title)
}

export function richText(property: unknown) {
  return plainText(asRecord(property)?.rich_text)
}

export function selectText(property: unknown) {
  const name = asRecord(asRecord(property)?.select)?.name
  return typeof name === "string" ? name : ""
}

export function urlText(property: unknown) {
  const value = asRecord(property)?.url
  return typeof value === "string" ? value : ""
}

export function dateText(property: unknown) {
  const start = asRecord(asRecord(property)?.date)?.start
  return typeof start === "string" ? start : ""
}

export function numberValue(property: unknown): number | null {
  const value = asRecord(property)?.number
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function checkboxValue(property: unknown) {
  return Boolean(asRecord(property)?.checkbox)
}

export function multiSelectNames(property: unknown) {
  return asArray(asRecord(property)?.multi_select)
    .map((item) => asRecord(item)?.name)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
}

export function relationIds(property: unknown) {
  return asArray(asRecord(property)?.relation)
    .map((item) => asRecord(item)?.id)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
}

export function titleProperty(value: string) {
  return {
    title: [{ type: "text", text: { content: value.slice(0, 1900) } }],
  }
}

export function richTextProperty(value: string) {
  return {
    rich_text: value
      ? [{ type: "text", text: { content: value.slice(0, 1900) } }]
      : [],
  }
}

export function numberProperty(value: number | null | undefined) {
  return {
    number: typeof value === "number" && Number.isFinite(value) ? value : null,
  }
}
