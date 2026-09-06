# Unified Ticker Knowledge

`modules/ticker-knowledge` is QeoIndex's shared retrieval boundary for per-ticker AI context (QEO-109).

## Ownership model

| Layer | Responsibility | Canonical? |
|---|---|---|
| Supabase PostgreSQL | Structured relational identities, versions, state, scores, archive pointers | Yes for structured application state |
| Supabase Storage | Large/cold immutable evidence and replay payloads | Yes for archived payload bytes |
| Qdrant `ticker_knowledge` | Dense + sparse retrieval projection across ticker knowledge | **No — derived/rebuildable** |

Qdrant must never become the only copy of research evidence or Council history. Losing the collection must be recoverable from PostgreSQL structured/version sources plus verified Storage archives.

**Notion Stock Thesis is intentionally outside this feature.** Legacy Notion data is not a runtime dependency, source type, authority, acceptance action, benchmark dependency, or rebuild source for `ticker_knowledge`.

## Knowledge families

Research Report projections:

- `REPORT_CHUNK`
- `REPORT_SUMMARY`
- `BROKER_VIEW`
- `FUNDAMENTAL_FACT` / `COMPANY_EVENT` only when derived from exact evidence with preserved provenance

AI Council projections:

- `COUNCIL_MEMORY`
- `COUNCIL_SCENARIO`
- `COUNCIL_OUTCOME`
- `COUNCIL_ERROR`
- `LESSON`
- `MARKET_CONTEXT` when applicable

Retired from this feature:

- `CURRENT_THESIS`
- `THESIS_HISTORY`
- `NOTION_THESIS`
- `CANONICAL_THESIS`
- `rebuild_theses`

## Collection topology

There is exactly one logical application collection:

```text
ticker_knowledge
```

Do not create one collection per ticker. Every query starts with an exact `ticker` payload filter before optional knowledge/source/provenance filters and relevance ranking.

Named vectors:

- `dense`: semantic embedding (OpenAI by default).
- `lexical`: deterministic local sparse financial-token encoder (`qeo-financial-lexical-hash-v1`).

Hybrid retrieval uses Qdrant prefetch + reciprocal-rank fusion (RRF). The local sparse encoder preserves exact anchors such as ticker symbols, years, target prices and financial vocabulary without requiring a second hosted model.

## Identity and update policy

`createTickerKnowledgeIdentity()` hashes a stable logical identity:

```text
schema | ticker | knowledge_type | source_type | source_id | logical_key
```

Report and Council projectors preserve exact source-version identity in their logical keys/provenance. Retries with the same logical identity are idempotent. Source-version deletion always requires exact:

```text
ticker + source_type + source_id + source_version
```

Later report reprocessing or Council updates do not hindsight-rewrite historical point identity. Old source versions remain until an explicit exact-version tombstone is executed.

## Authority is data, not prose

Persisted/filterable authority classes:

- `VERIFIED_FACT`
- `DETERMINISTIC_SIGNAL`
- `SOURCE_OPINION`
- `AI_INFERENCE`
- `HISTORICAL_LESSON`

A broker recommendation/target is `SOURCE_OPINION`; retrieval relevance must never silently upgrade it into a verified fact or override deterministic Council state.

## Provenance/version contract

Every point carries source identity plus relevant report/analysis/run/page/chunk/storage pointers. Derived payloads additionally persist:

- schema version;
- projection version;
- embedding model/version;
- sparse encoder/version;
- `indexed_at`.

Point-in-time consumers, especially AI Council, freeze the exact retrieved point IDs + source/version provenance in their own canonical evidence snapshot. Re-indexing Qdrant later must not rewrite historical Council context.

Report Q&A hydrates canonical PostgreSQL text/page only after exact Qdrant identity/provenance match; Qdrant text is never trusted as citation authority by itself.

## Failure behavior

Provider/network/timeouts are represented by `TickerKnowledgeUnavailableError`. Callers that may safely continue without semantic memory use `queryTickerKnowledgeSafely()` and explicitly handle `status: "unavailable"` separately from a valid empty result.

Never interpret a Qdrant outage as "no evidence exists".

Stock/Ticker Q&A may preserve bounded mandatory deterministic Council state from canonical PostgreSQL when semantic retrieval is unavailable, but must expose the degraded retrieval status.

## Server configuration

Server-only environment variables:

- `QDRANT_URL`
- `QDRANT_API_KEY`
- `OPENAI_API_KEY`
- `TICKER_KNOWLEDGE_EMBEDDING_MODEL` (default `text-embedding-3-small`)
- `TICKER_KNOWLEDGE_VECTOR_SIZE` (default `1536`)

The collection name is intentionally fixed to `ticker_knowledge` to prevent accidental collection-per-ticker drift.

## Cold evidence

`createSupabaseColdEvidenceStore()` archives deterministic canonical JSON envelopes as gzip (`json.gz`) because gzip is supported by the current Node runtime and repository cold-store conventions. The format is versioned so another compressor can be introduced later without changing source identities.

Archive durability requires upload followed by download + content checksum verification. Retries reuse an existing object only when decompressed canonical content matches. Restore validates compressed checksum, content checksum, format version and source identity before returning payloads.

The returned `ColdEvidencePointer` is stored by the owning PostgreSQL control-plane record. This module does not delete or mutate canonical relational data.

## Production control plane

Root Admin acceptance operations are intentionally limited to:

```text
backfill_reports
backfill_council
```

Both are bounded and cursor-resumable. `rebuild_theses` is retired and rejected.

The readiness GET proves collection/schema/index readiness plus a ticker-filtered hybrid query. A valid pre-backfill probe may return `resultCount=0`; evidence population is a separate backfill gate.

## Rebuild contract

A full rebuild is one-way:

```text
PostgreSQL structured/version sources + verified Storage archives
        -> deterministic Report + Council projectors
        -> embeddings + sparse vectors
        -> Qdrant ticker_knowledge
```

A rebuild drill must prove that complete loss of Qdrant derived state is recoverable without Notion.

Consumer migrations stay rollback/fallback capable until production benchmark and canary acceptance prove retrieval/citation behavior. PostgreSQL FTS/chunk cleanup belongs to QEO-119 and occurs only after backfill, benchmark, canary and rebuild evidence show it is safe.
