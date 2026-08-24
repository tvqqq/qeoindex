export const NOTION_API_VERSION = "2026-03-11"

const NOTION_API_BASE = "https://api.notion.com/v1"
const DEFAULT_QUERY_TIMEOUT_MS = 10_000
const MAX_PAGE_SIZE = 100

export type NotionProperties = Record<string, unknown>

export interface NotionPage {
  id: string
  url?: string
  last_edited_time?: string
  properties?: NotionProperties
  [key: string]: unknown
}

export interface NotionBlock {
  id: string
  type: string
  has_children?: boolean
  [key: string]: unknown
}

export interface NotionQueryOptions {
  filter?: Record<string, unknown>
  sorts?: ReadonlyArray<Record<string, unknown>>
  pageSize?: number
  startCursor?: string
  maxPages?: number
  filterProperties?: string[]
  errorContext?: string
  timeoutMs?: number
}

export interface NotionQueryResult {
  results: NotionPage[]
  hasMore: boolean
  nextCursor: string | null
}

export interface NotionBlockChildrenOptions {
  pageSize?: number
  startCursor?: string
  maxPages?: number
  errorContext?: string
  timeoutMs?: number
}

export interface NotionBlockChildrenResult {
  results: NotionBlock[]
  hasMore: boolean
  nextCursor: string | null
}

type NotionRequestOptions = {
  method: "POST" | "PATCH"
  body: Record<string, unknown>
  errorContext: string
  timeoutMs?: number
}

export function notionToken() {
  return process.env.NOTION_API_KEY ?? process.env.NOTION_TOKEN ?? ""
}

export function isNotionConfigured() {
  return Boolean(notionToken())
}

function notionHeaders() {
  const apiKey = notionToken()
  if (!apiKey) throw new Error("NOTION_API_KEY is not configured")
  return {
    Authorization: `Bearer ${apiKey}`,
    "Notion-Version": NOTION_API_VERSION,
    "Content-Type": "application/json",
  }
}

function timeoutSignal(timeoutMs?: number) {
  return typeof timeoutMs === "number" && timeoutMs > 0
    ? AbortSignal.timeout(timeoutMs)
    : undefined
}

function errorPayload(payload: unknown, maxLength = 300) {
  try {
    return JSON.stringify(payload).slice(0, maxLength)
  } catch {
    return String(payload).slice(0, maxLength)
  }
}

async function requestNotion<T>(path: string, options: NotionRequestOptions): Promise<T> {
  const response = await fetch(`${NOTION_API_BASE}${path}`, {
    method: options.method,
    headers: notionHeaders(),
    body: JSON.stringify(options.body),
    cache: "no-store",
    ...(options.timeoutMs ? { signal: timeoutSignal(options.timeoutMs) } : {}),
  })
  const payload = await response.json() as T
  if (!response.ok) {
    throw new Error(`${options.errorContext} failed (${response.status}): ${errorPayload(payload)}`)
  }
  return payload
}

async function requestNotionGet<T>(
  path: string,
  options: { errorContext: string; timeoutMs?: number },
): Promise<T> {
  const response = await fetch(`${NOTION_API_BASE}${path}`, {
    method: "GET",
    headers: notionHeaders(),
    cache: "no-store",
    ...(options.timeoutMs ? { signal: timeoutSignal(options.timeoutMs) } : {}),
  })
  const payload = await response.json() as T
  if (!response.ok) {
    throw new Error(`${options.errorContext} failed (${response.status}): ${errorPayload(payload)}`)
  }
  return payload
}

function boundedPageSize(pageSize?: number) {
  return Math.max(1, Math.min(MAX_PAGE_SIZE, pageSize ?? MAX_PAGE_SIZE))
}

export async function queryDataSource(dataSourceId: string, options: NotionQueryOptions = {}): Promise<NotionQueryResult> {
  const results: NotionPage[] = []
  let startCursor = options.startCursor
  let hasMore = false
  let nextCursor: string | null = null
  const maxPages = Math.max(1, options.maxPages ?? 1)
  const query = new URLSearchParams()
  for (const property of options.filterProperties ?? []) query.append("filter_properties[]", property)
  const suffix = query.size ? `?${query.toString()}` : ""

  for (let page = 0; page < maxPages; page += 1) {
    const payload = await requestNotion<{
      results?: NotionPage[]
      has_more?: boolean
      next_cursor?: string | null
    }>(`/data_sources/${dataSourceId}/query${suffix}`, {
      method: "POST",
      errorContext: options.errorContext ?? "Notion query",
      timeoutMs: options.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS,
      body: {
        page_size: boundedPageSize(options.pageSize),
        ...(options.filter ? { filter: options.filter } : {}),
        ...(options.sorts ? { sorts: options.sorts } : {}),
        ...(startCursor ? { start_cursor: startCursor } : {}),
      },
    })

    results.push(...(payload.results ?? []))
    hasMore = Boolean(payload.has_more && payload.next_cursor)
    nextCursor = hasMore ? payload.next_cursor ?? null : null
    if (!hasMore || !nextCursor) break
    startCursor = nextCursor
  }

  return { results, hasMore, nextCursor }
}

export async function retrieveBlockChildren(
  blockId: string,
  options: NotionBlockChildrenOptions = {},
): Promise<NotionBlockChildrenResult> {
  const results: NotionBlock[] = []
  let startCursor = options.startCursor
  let hasMore = false
  let nextCursor: string | null = null
  const maxPages = Math.max(1, options.maxPages ?? 1)

  for (let page = 0; page < maxPages; page += 1) {
    const query = new URLSearchParams({ page_size: String(boundedPageSize(options.pageSize)) })
    if (startCursor) query.set("start_cursor", startCursor)

    const payload = await requestNotionGet<{
      results?: NotionBlock[]
      has_more?: boolean
      next_cursor?: string | null
    }>(`/blocks/${blockId}/children?${query.toString()}`, {
      errorContext: options.errorContext ?? "Notion block children",
      timeoutMs: options.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS,
    })

    results.push(...(payload.results ?? []))
    hasMore = Boolean(payload.has_more && payload.next_cursor)
    nextCursor = hasMore ? payload.next_cursor ?? null : null
    if (!hasMore || !nextCursor) break
    startCursor = nextCursor
  }

  return { results, hasMore, nextCursor }
}

export async function createDataSourcePage(
  dataSourceId: string,
  properties: NotionProperties,
  options: { errorContext?: string; timeoutMs?: number } = {},
): Promise<NotionPage> {
  return requestNotion<NotionPage>("/pages", {
    method: "POST",
    errorContext: options.errorContext ?? "Notion page create",
    timeoutMs: options.timeoutMs,
    body: {
      parent: { type: "data_source_id", data_source_id: dataSourceId },
      properties,
    },
  })
}

export async function updatePageProperties(
  pageId: string,
  properties: NotionProperties,
  options: { errorContext?: string; timeoutMs?: number } = {},
): Promise<NotionPage> {
  return requestNotion<NotionPage>(`/pages/${pageId}`, {
    method: "PATCH",
    errorContext: options.errorContext ?? "Notion page update",
    timeoutMs: options.timeoutMs,
    body: { properties },
  })
}
