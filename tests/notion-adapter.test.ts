import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  createDataSourcePage,
  NOTION_API_VERSION,
  queryDataSource,
  updatePageProperties,
} from "../lib/notion/client.ts"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

function withNotionToken() {
  const previousApiKey = process.env.NOTION_API_KEY
  const previousToken = process.env.NOTION_TOKEN
  process.env.NOTION_API_KEY = "test-token"
  delete process.env.NOTION_TOKEN
  return () => {
    if (previousApiKey === undefined) delete process.env.NOTION_API_KEY
    else process.env.NOTION_API_KEY = previousApiKey
    if (previousToken === undefined) delete process.env.NOTION_TOKEN
    else process.env.NOTION_TOKEN = previousToken
  }
}

test("shared Notion query adapter preserves pagination, filters, and API version", async () => {
  const restoreToken = withNotionToken()
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; init?: RequestInit }> = []
  let page = 0

  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    page += 1
    return new Response(JSON.stringify(page === 1
      ? { results: [{ id: "page-1", properties: {} }], has_more: true, next_cursor: "cursor-2" }
      : { results: [{ id: "page-2", properties: {} }], has_more: false, next_cursor: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch

  try {
    const result = await queryDataSource("source-1", {
      filter: { property: "Status", select: { equals: "Open" } },
      sorts: [{ property: "Date", direction: "descending" }],
      pageSize: 50,
      maxPages: 3,
      filterProperties: ["Status", "Date"],
    })

    assert.deepEqual(result.results.map((item) => item.id), ["page-1", "page-2"])
    assert.equal(result.hasMore, false)
    assert.equal(result.nextCursor, null)
    assert.equal(calls.length, 2)
    assert.match(calls[0].url, /filter_properties%5B%5D=Status/)
    assert.match(calls[0].url, /filter_properties%5B%5D=Date/)

    const firstBody = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>
    const secondBody = JSON.parse(String(calls[1].init?.body)) as Record<string, unknown>
    assert.equal(firstBody.page_size, 50)
    assert.equal(firstBody.start_cursor, undefined)
    assert.equal(secondBody.start_cursor, "cursor-2")

    const headers = calls[0].init?.headers as Record<string, string>
    assert.equal(headers["Notion-Version"], NOTION_API_VERSION)
    assert.equal(headers.Authorization, "Bearer test-token")
    assert.equal(calls[0].init?.cache, "no-store")
  } finally {
    globalThis.fetch = originalFetch
    restoreToken()
  }
})

test("shared Notion write adapter uses data-source parents and page PATCH", async () => {
  const restoreToken = withNotionToken()
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; init?: RequestInit }> = []

  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return new Response(JSON.stringify({ id: calls.length === 1 ? "created" : "updated", properties: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch

  try {
    await createDataSourcePage("source-2", { Name: { title: [] } })
    await updatePageProperties("created", { Status: { select: { name: "Open" } } })

    assert.equal(calls[0].url, "https://api.notion.com/v1/pages")
    assert.equal(calls[0].init?.method, "POST")
    const createBody = JSON.parse(String(calls[0].init?.body)) as {
      parent: { type: string; data_source_id: string }
    }
    assert.deepEqual(createBody.parent, { type: "data_source_id", data_source_id: "source-2" })

    assert.equal(calls[1].url, "https://api.notion.com/v1/pages/created")
    assert.equal(calls[1].init?.method, "PATCH")
  } finally {
    globalThis.fetch = originalFetch
    restoreToken()
  }
})

test("domain modules depend on the shared Notion adapter instead of duplicating transport", () => {
  const domainFiles = [
    "lib/research-data.ts",
    "lib/scanner-data.ts",
    "lib/signal-data.ts",
    "lib/notion-promote.ts",
  ]

  for (const path of domainFiles) {
    const contents = source(path)
    assert.match(contents, /@\/lib\/notion\//, path)
    assert.doesNotMatch(contents, /api\.notion\.com\/v1/, path)
    assert.doesNotMatch(contents, /const NOTION_VERSION/, path)
    assert.doesNotMatch(contents, /function headers\(/, path)
  }

  const client = source("lib/notion/client.ts")
  assert.match(client, /https:\/\/api\.notion\.com\/v1/)
  assert.match(client, /NOTION_API_VERSION = "2026-03-11"/)
  assert.match(client, /AbortSignal\.timeout/)
  assert.match(client, /filter_properties\[\]/)
})
