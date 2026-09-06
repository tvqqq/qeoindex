# Unified Ticker Knowledge

`modules/ticker-knowledge` is QeoIndex's shared retrieval boundary for per-ticker AI context (QEO-109).

## Ownership model

| Layer | Responsibility | Canonical? |
|---|---|---|
| Supabase PostgreSQL | Structured relational identities, versions, state, scores, pointers | Yes for structured application state |
| Supabase Storage | Large/cold immutable evidence and replay payloads | Yes for archived payload bytes |
| Notion | Current human-curated Stock Thesis | Yes for the current thesis |
| Qdrant `ticker_knowledge` | Dense + sparse retrieval projection across ticker knowledge | **No — derived/rebuildable** |

Qdrant must never become the only copy of research evidence, Council history, or the current thesis. Losing the collection must be recoverable by rebuilding it from PostgreSQL + verified Storage archives + Notion.

## Collection topology

There is exactly one logical application collection:

```text
ticker_knowledge
```

Do not create one collection per ticker. Every query must start with an exact `ticker` payload filter before applying optional knowledge/source/provenance filters and relevance ranking.

Named vectors:

- `dense`: semantic embedding (OpenAI by default).
- `lexical`: deterministic local sparse financial-token encoder (`qeo-financial-lexical-hash-v1`).

Hybrid retrieval uses Qdrant prefetch + reciprocal-rank fusion (RRF). The local sparse encoder deliberately preserves exact anchors such as ticker symbols, years, target prices and financial vocabulary without requiring a second hosted model.

## Identity and update policy

`createTickerKnowledgeIdentity()` hashes a stable logical identity:

```text
schema | ticker | knowledge_type | source_type | source_id | logical_key
```

The projector owns `logical_key` policy:

- immutable/versioned sources (report chunks, frozen Council runs): include immutable source-version identity in the logical key;
- mutable current projections (`CURRENT_THESIS`): keep a stable logical slot so a new canonical thesis revision updates the same derived point while provenance/version fields change.

Retries with the same logical identity are idempotent. Source-version deletion always requires exact `ticker + source_type + source_id + source_version`.

## Authority is data, not prose

Required authority classes are persisted and filterable:

- `VERIFIED_FACT`
- `CANONICAL_THESIS`
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

Point-in-time consumers (especially AI Council) must freeze the exact retrieved point IDs + source/version provenance in their own canonical evidence snapshot. Re-indexing Qdrant later must not rewrite historical Council context.

## Failure behavior

Provider/network/timeouts are represented by `TickerKnowledgeUnavailableError`. Callers that may safely continue without semantic memory should use `queryTickerKnowledgeSafely()` and explicitly handle `status: "unavailable"` separately from a valid empty result.

Never interpret a Qdrant outage as "no evidence exists".

## Server configuration

Server-only environment variables:

- `QDRANT_URL`
- `QDRANT_API_KEY`
- `OPENAI_API_KEY`
- `TICKER_KNOWLEDGE_EMBEDDING_MODEL` (default `text-embedding-3-small`)
- `TICKER_KNOWLEDGE_VECTOR_SIZE` (default `1536`)

The collection name is intentionally fixed to `ticker_knowledge` to prevent accidental collection-per-ticker drift.

## Cold evidence

`createSupabaseColdEvidenceStore()` archives deterministic canonical JSON envelopes as gzip (`json.gz`) because gzip is already supported by the current Node runtime and repository cold-store conventions. The format is versioned so zstd can be introduced later without changing source identities.

Archive durability requires upload followed by download + content checksum verification. Retries reuse an existing object only when decompressed canonical content matches. Restore validates compressed checksum, content checksum, format version and source identity before returning payloads.

The returned `ColdEvidencePointer` is designed to be stored by the owning PostgreSQL control-plane record. This module does not delete or mutate canonical relational data.

## Rebuild contract

A full rebuild is intentionally one-way:

```text
PostgreSQL structured sources + verified Storage archives + canonical Notion thesis
        -> deterministic projectors
        -> embeddings + sparse vectors
        -> Qdrant ticker_knowledge
```

Consumer migrations must remain dual-read/fallback capable until production evaluation proves retrieval/citation parity. PostgreSQL FTS/chunk cleanup belongs to QEO-119, never to foundation setup.
