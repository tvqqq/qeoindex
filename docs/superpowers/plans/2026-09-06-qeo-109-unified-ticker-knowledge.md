# QEO-109 Unified Ticker Knowledge — Implementation Plan

## Goal

Give every ticker a unified, provenance-preserving retrieval layer shared by Research Report Q&A, AI Council and Stock Q&A while reducing PostgreSQL large-text growth.

## Architecture

- PostgreSQL: structured canonical/control plane.
- Supabase Storage: large/cold immutable evidence.
- Qdrant `ticker_knowledge`: derived dense+sparse retrieval projection.
- Notion: canonical current Stock Thesis; projected to Qdrant for runtime reads.

## Delivery order

1. **QEO-110** — domain identity/provenance/authority/version contracts, typed outage behavior, server-only Qdrant/OpenAI boundary.
2. **QEO-111** — deterministic compressed cold evidence archive + checksum restore contract; persist pointers from owning control-plane records during projector/consumer integration.
3. **QEO-112** — one shared Qdrant collection, payload indexes, dense+sparse RRF retrieval, exact ticker isolation, source-version-aware deletion.
4. **QEO-113** — project Research Reports + Council history with immutable point-in-time provenance.
5. **QEO-114** — mirror current Notion Stock Thesis as a rebuildable projection.
6. **QEO-115** — shared Ticker Context Builder with deterministic current-state loading, authority/relevance/recency ranking and bounded context.
7. **QEO-116** — migrate report Q&A retrieval behind exact report/content/chunk filters while preserving fail-closed citations and PostgreSQL FTS fallback during rollout.
8. **QEO-117** — AI Council consumes shared retrieval but freezes exact retrieved point/source/version identity in canonical Council evidence.
9. **QEO-118** — Stock Q&A multi-source endpoint over the same Context Builder.
10. **QEO-119** — production backfill, rebuild rehearsal, shadow evaluation, observability, then only proven-safe PostgreSQL large-text/GIN cleanup.

## Safety gates

- Qdrant is never authoritative.
- Retrieval outage is distinct from valid zero-result retrieval.
- Every Qdrant query starts with ticker isolation.
- Broker views remain `SOURCE_OPINION`.
- Historical Council evidence is immutable and cannot hindsight-rewrite after re-indexing.
- No destructive PostgreSQL cleanup before dual-read evaluation and rebuild proof.

## TDD tranche 1

Foundation tests first cover:

- stable ticker-scoped identities;
- deterministic sparse lexical anchors for financial terms/numbers;
- dense+sparse RRF request contract with ticker-first filter;
- explicit outage/degrade path;
- cold archive round-trip, idempotent retry and checksum fail-closed behavior.

After foundation CI is green, continue with projector/context/consumer tests in dependency order.
