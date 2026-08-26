# Personal AI Search Engine — Master Spec (Consolidated, v3)

> This document consolidates all planning, architecture, and design decisions from the brainstorming phase into one reference. Intended to be dropped into a new chat as full context before implementation begins.
>
> **v2 changes from original:** Lens system finalized (4 modes), near-duplicate detection promoted from "deferred" to a finalized v1 design, SSE decision resolved (wait-then-show for v1), Deployment section added (100% free-tier).
>
> **v3 changes from v2:** Deployment finalized — frontend on Netlify, API + Model B (live fetch) on Vercel serverless functions, Model A (background crawler) exclusively on GitHub Actions cron (Render dropped — requires a credit card for verification, disqualified under the zero-budget/no-card constraint), Upstash/Neon free-tier terms confirmed. Open Decisions section (Section 7) removed — all items resolved, no longer needed as a tracking section.

---

# 1. PROJECT OVERVIEW

## What it is
A personal, self-hosted search engine that crawls a scoped set of web sources (chosen by the builder, not the whole internet), indexes the content independently (no reliance on Google/Bing APIs), and serves queries via keyword search plus an AI layer for query cleanup and cited answer synthesis.

**Core philosophy:** own the crawl, own the index, own the ranking — fully explainable, no black-box APIs. Built for personal daily research use, not as a SaaS product.

**Primary goal:** maximize real backend learning (concurrency, DB internals, distributed-systems thinking, caching, performance engineering) while producing something genuinely used for real research work — not a portfolio-only project.

## What it explicitly is NOT (v1)
- Not a web-scale/general crawler — scoped to curated domains/Lenses
- Not multi-user / no SaaS-grade auth complexity (single user)
- Not rendering JS-heavy SPA pages (static HTML only for v1)
- Not a distributed multi-node system (single-node, built with patterns that could scale later)

## Builder's stack (from prior work / GitHub)
TypeScript, React, Next.js (App Router), Tailwind CSS, Node.js, PostgreSQL, MongoDB, Docker, AWS, JWT/OAuth. Open to new tools when justified (Redis, BullMQ added deliberately in this project).

## Two crawling models (both used, working together)
- **Model A — background crawler**: always running, builds broad index coverage over time via the frontier queue. Enables fast, instant search against an already-built index.
- **Model B — live/on-demand fetch**: triggered per-prompt, used when the index is thin on a topic or freshness is needed right now. Feeds the same shared `documents` table/index as Model A — every live fetch densifies the background index for free.

Query-time logic: check the index first (fast) → if thin/insufficient, fall back to live fetch (expensive) → write result into the same index either way.

---

# 2. V1 FEATURE LIST (FINALIZED)

### A. Ingestion (crawler)
- Seed URL list (curated starting points)
- Link discovery (follow links within scope)
- Scope rules (domain allowlist, path rules, crawl depth limit)
- `robots.txt` compliance (Disallow/Allow/Crawl-delay respected per domain)
- Per-domain rate limiting / politeness
- **Lens system (finalized — 4 modes at query time):**
  1. **Predefined lenses** — system-shipped (General, Finance, Dev/CS, News, Academic, etc.), each with a curated domain list. Editable by the user (add/remove domains) without losing their "predefined" identity/label.
  2. **Custom lenses** — fully user-created, own name + own domain list, same schema as predefined ones, CRUD from the Lens management screen.
  3. **No lens ("All")** — explicit opt-out of scoping. Searches/crawls across every domain present in the index, no domain allowlist applied. This is a real selectable option, not just "no filter" as a default fallback — it's visible and labeled in the UI so the user always knows what scope they're in.
  4. **Auto** — query is classified (keyword/category match against lens domain-tag vocab, per the v1-scope simple classifier already defined in Section 3) and the best-matching lens is silently selected; falls back to **General** if no lens scores above a confidence threshold. Auto-selection is always shown transparently in the UI (`auto: Finance`) so it never feels like an invisible decision.

  These 4 modes reuse the same underlying `lens_id` (nullable for "All") in both crawl-time scoping and query-time filtering/prompt-parameterization — no separate code path per mode.

### B. Extraction
- HTML → clean text extraction (strip nav/ads/boilerplate)
- Metadata extraction (title, description, canonical URL, published date)
- Exact-duplicate detection (hash normalized extracted text, skip/link duplicates)
- **Near-duplicate detection (finalized — see Section 3 and Step 2 below; no longer deferred)**

### C. Indexing
- Postgres full-text index (`tsvector` + GIN — inverted index)
- Keyword ranking (`ts_rank_cd` — term frequency + proximity based, chosen over plain `ts_rank`)
- Field-weighted ranking (title > description > body, via `setweight` A/B/C tiers)
- Typo tolerance via `pg_trgm` (fuzzy fallback when exact `tsquery` returns too few results)

### D. Query / Retrieval
- Keyword search API
- Pagination — 20 results/page default, configurable; approximate counts past a threshold (avoid expensive exact `COUNT(*)`)
- Domain filter, date filter, **Lens filter (4-mode, per above)**
- Query result caching (cache-aside, stale-while-revalidate, stampede protection, negative caching)

### E. Intelligence Layer (in v1 — not deferred; personal-use priority)
- AI query-understanding pass: typo correction, vague-query expansion, implied filter extraction, "continue research" context folding
- AI answer synthesis: cited answer generated from top ranked results (RAG over own index only — never outside model knowledge)
- Raw results always visible (toggle in UI, guaranteed at API-contract level, not just frontend behavior)
- Slot-based adaptive prompting system: one master prompt structure, parameterized by the active Lens
- **Streaming — finalized: wait-then-show for v1.** No SSE/EventSource in v1. Synthesis runs, full response returned once complete. Rationale: simpler failure handling (Section 4 Step 5 already guarantees synthesis never blocks raw results), fewer moving parts on a free-tier backend that may have cold starts (see Section 7) — a half-streamed response interrupted by a cold-start/timeout is worse UX than a single wait spinner. Streaming remains a clean v2 upgrade (swap the synthesis call for an SSE endpoint; prompt/contract unchanged).

### Explicitly deferred to v2+
- Re-crawl scheduling/freshness automation (v1: manual/triggered crawls)
- JS-rendered page support (headless browser)
- Hybrid/semantic (embedding-based) search
- Query understanding via full ML classification (v1 uses simple keyword/category matching for Lens auto-selection)

---

# 3. CORE CONCEPTS

**Full-text index (inverted index), explained simply:** instead of storing "document → words it contains," store "word → documents containing it" (like a book's back index). This flip is what makes lookups fast — a query becomes one lookup into a pre-built table instead of scanning every document. In Postgres: `to_tsvector()` tokenizes/stems/strips stopwords, the result is stored in a `tsvector` column, and a **GIN index** on that column is the actual on-disk inverted-index structure.

**robots.txt:** a plain-text convention at `domain.com/robots.txt`, not a technical enforcement mechanism — an ethical/reputational convention. Contains `User-agent`, `Disallow`/`Allow` path rules, `Crawl-delay`, `Sitemap` pointer. Crawler fetches + caches parsed rules per domain, checks every URL against them before fetching. No file present = everything allowed by convention.

**Lens = named scope-rule set**, reused in two places:
1. Crawl time — which domains to index at all
2. Query time — which subset of the index to search, and which parameters feed the AI synthesis prompt

Plus the **"All" (no-lens)** and **"Auto"** modes described in Section 2A, which sit on top of the same lens data model rather than being special-cased.

**GIN vs B-tree vs GiST:** B-tree (default) is for equality/range lookups, wrong tool for "contains these words." GIN is built for full-text — one entry per distinct word pointing to every containing row, slower writes/much faster reads (correct trade-off for search). GiST supports fuzzy matching but is generally slower than GIN for exact lexeme lookups — not the standard choice here.

**Why Postgres FTS over a dedicated engine (e.g. Typesense) — deliberate decision:** Typesense offers typo tolerance, real-time indexing, and synonyms out of the box, but as a black-box query layer it skips the exact DB-internals learning (GIN indexes, `tsvector`, `ts_rank_cd`, reading `EXPLAIN ANALYZE`) that is the actual point of this project. Postgres FTS chosen for v1; Typesense remains a documented, valid v2 upgrade path or comparison point.

**Near-duplicate detection — finalized technique: SimHash + banded LSH lookup.**
- **Why SimHash over MinHash/embeddings:** SimHash (Charikar's algorithm) is the standard technique specifically for near-duplicate *web document* detection (this is literally what it was designed and used for at Google-scale), it's cheap to compute (one pass over token shingles → 64-bit fingerprint), and near-dup comparison reduces to Hamming distance on fixed-width integers — no vector DB, no embedding model, no extra inference cost. MinHash/LSH is the right tool for large-scale *set-similarity* corpus dedup (e.g. training-data dedup); embeddings are semantic-similarity, a different (and heavier) problem than "is this basically the same page." For this project's scale and goal (own the technique, explainable), SimHash is the correct, non-compromised choice — not a shortcut.
- **No compromise on correctness of the technique itself:** 64-bit fingerprint, standard 4-band split for candidate lookup (avoids O(n) full-corpus Hamming comparison — only docs sharing a band are compared), Hamming distance threshold (e.g. ≤3 bits) tuned against false-positive rate, not loosened for speed.
- **Where the accepted staleness comes from — architectural, not algorithmic:** the SimHash *value* is computed synchronously at extraction time (cheap, no added write-path latency). The *comparison against the rest of the corpus* runs asynchronously in a low-priority queue, because comparing every new document against all near-neighbors is comparatively expensive and shouldn't block extraction throughput. This means a genuinely near-duplicate document can sit in the index as if it were unique for a short window before the async job reconciles it.
- **Correctness is informed and covered at the next prompt:** once the async reconciliation job runs, the losing duplicate is marked `near_duplicate_of: <canonical_id>` and excluded from default result sets going forward — so the *next* time that topic is queried, the corpus is already clean. This is the same eventual-consistency pattern already applied to the index vs. live web (Section 4, Step 4) — surfaced explicitly via `crawled_at`/dedup-state fields rather than hidden, never silently accepted as "good enough forever."

---

# 4. BACKEND ARCHITECTURE (Steps 1–5, finalized)

## Step 1 — Crawler / Fetch Layer (Background, Model A)

**Role:** given seed URLs + Lens scope rules, produce a polite, resumable stream of `(url, raw_html)` pairs for extraction — without hammering any domain, without crashing on bad responses, without losing progress on restart.

**Stack: Redis + BullMQ** (deliberately chosen over hand-rolled in-process queueing, for production-realistic tooling and to encode concurrency/backpressure mechanics correctly rather than reinventing a worse version).

| Component | Implementation |
|---|---|
| Frontier (what to crawl next) | BullMQ queue, jobs tagged by domain |
| Per-domain politeness/rate limiting | BullMQ rate limiter (`limiter: { max, duration }`) per domain; `Crawl-delay` from robots.txt sets the floor; default fallback if unspecified (e.g. 1 req/2sec). Deliberately atomic (not hand-rolled read-check-write) — avoids the classic two-workers-both-see-a-free-slot race, same principle as atomic balance updates |
| Dedup (seen-URL tracking) | Redis Set (`SADD`/`SISMEMBER`) on normalized URLs (strip tracking params, resolve relative→absolute, lowercase host). O(1) check — deliberately avoids O(n²) risk of a naive in-memory array `.includes()` check at scale |
| Job state / retries | BullMQ native: `attempts`, `backoff: { type: 'exponential', delay }`. Retry-safe failures only (5xx, timeouts) — never retry permanent failures (404, 403) |
| Crash resumability | Redis AOF persistence enabled — frontier survives restarts |
| Fetcher | HTTP fetch with timeout, custom User-Agent (`NaqiSearchBot/1.0`), robots.txt checked before every request |
| Raw storage | Every successful fetch → raw HTML + fetch metadata (status, timestamp, headers) written to Postgres before extraction runs — enables resumability and decouples fetch from extraction |

**Failure modes handled:** domain down/timeout (backoff+retry, then mark failed), 429 rate-limited (harder backoff, respect `Retry-After`), infinite crawl traps (depth limit + per-domain page cap), process crash (Redis-persisted frontier resumes), duplicate content across mirrors (handled downstream in extraction, not here), Redis restart/data loss (AOF persistence mitigates), stalled jobs (BullMQ auto-requeues after timeout).

**Raw HTML retention:** short-lived — kept only long enough for extraction to run (e.g. ~48hr rolling window), then discarded. Prevents blowing free-tier Postgres storage (raw HTML is 20-100KB+/page vs. ~2-10KB extracted text).

## Step 1B — Live/On-Demand Fetch Pathway (Model B)

**Role:** a second pathway, triggered synchronously by a user prompt rather than the background queue. Reuses Step 1's fetcher + Step 2's extractor, but runs per-request with a shorter-lived raw data lifespan. Writes into the same `documents` table as Model A.

**Query-time decision logic:**
```
User query → check existing index first (fast)
   → sufficient results? → return (instant)
   → thin/no results, or explicit fresh-data request?
       → check: does a documents row already exist for this URL/topic?
           → yes: reuse existing formatted data as context (no re-fetch)
           → no: fetch raw HTML → extract → write to documents table
       → return result, index has grown
```

**Idempotency (closing the duplicate-in-flight-request gap):**
```
key = hash(normalized_url)
SETNX in_progress:{key} = 1   (Redis, atomic "set if not exists")
  → succeeds: no fetch in flight — proceed, delete key when done
  → fails: a fetch for this URL is already running — wait/re-check documents table,
    or return "fetch already in progress"
```
This closes the race where a second identical request arrives while the first is still processing and a naive "check if exists" would let both proceed.

**Raw HTML lifecycle (session-scoped, not crawl-window-scoped):** deleted after 1hr of no new prompts (idle timeout), or immediately if a rate/fetch limit is hit before that — whichever comes first. If raw HTML has already been deleted but a `documents` row (formatted result) exists for the relevant URL/topic, reuse that as prior context instead of re-fetching — prevents duplicate fetches and wasted budget.

**"Continue research" mechanism:** user provides prior context (from active session or external notes). Before any new live fetch, check `documents` table for existing relevant content first (same dedup principle, applied at query time). The AI query-understanding layer (Step 5) uses this to avoid re-covering researched ground.

**Data retention — clarified split:**
| Data | Persistence |
|---|---|
| `documents` table (index — background + live-fetched) | Persists indefinitely, never wiped |
| Raw HTML (live fetch) | Session-scoped: 1hr idle or rate-limit hit |
| Raw HTML (background crawler) | Short rolling window (~48hr), just long enough for extraction |
| Search/query history + AI-synthesized results | Pruned on rolling schedule (e.g. last 30 days) — separate table, unaffected by index persistence |

## Step 2 — Extraction / Parsing Layer

**Role:** raw HTML (Postgres) → clean, structured, indexable content. Runs as its own decoupled process/queue (own BullMQ queue, separate from fetch worker) — extraction logic can be re-run on the existing corpus without re-crawling. I/O-bound fetching and CPU-bound extraction scale independently.

**Pipeline:**
```
Raw HTML → HTML parsing (Cheerio, never regex) → boilerplate removal → clean text
                                                 → metadata extraction
                                                 → exact-dup check (content hash)
                                                 → SimHash fingerprint (sync, cheap)
                                                 → write to documents table
                                                 → enqueue async near-dup reconciliation job (low-priority queue)
```

- **Main content extraction:** readability-style library (Mozilla `readability` or equivalent) as primary — scores DOM nodes by text/link density. Structural tag-stripping (`nav`, `footer`, `script`, `style`, `aside` removed; `article`/`main`/`p` kept) as fallback when readability returns empty/too-short content.
- **Metadata:** title (`<title>`, fallback `og:title`), description (`meta description`/`og:description`), canonical URL (`<link rel="canonical">` — used over fetched URL for dedup/display), published date (`article:published_time`, JSON-LD `datePublished`, fallback regex last resort), domain (derived from URL).
- **Exact-duplicate detection:** hash the extracted clean text (not raw HTML) after normalization, check against a Postgres unique index on `content_hash` before insert. DB-level constraint (not just app-level check) prevents races when two workers extract near-simultaneously — a real write-skew scenario, closed by the DB constraint rather than app logic alone.
- **Near-duplicate detection:** SimHash fingerprint computed synchronously in the extraction worker (cheap, no added write-path latency), stored in a `simhash` column. Async, low-priority BullMQ job compares each new document's fingerprint against banded candidates already in the corpus (banded lookup, not full O(n) scan); matches within the Hamming threshold get `near_duplicate_of` set on the losing document (older/lower-trust doc kept as canonical by default rule, configurable). See Section 3 for the full rationale and the accepted staleness window.
- **Batching:** extraction is not latency-sensitive but runs over large batches — bulk-insert in moderate batches (e.g. 50-100 documents) balancing memory vs. round-trip overhead, rather than one-row-at-a-time streaming (which is the right call for the AI synthesis response instead — except v1 doesn't stream that either, per Section 2E).

**Failure modes:** near-empty extracted text (JS-rendered shell) → flag `low_content`, skip indexing; extraction library throws on malformed HTML → catch, fall back to structural stripping, never kill the batch; non-UTF8 encoding → detect/normalize before parsing.

**Output — `documents` table:**
```
documents
  id, canonical_url, domain, title, description,
  published_at, clean_text, content_hash, simhash,
  near_duplicate_of, crawled_at, lens_tags[]
```

## Step 3 — Indexing Layer

**Role:** adds a `search_vector` column + GIN index on top of the existing `documents` table (not a separate data store — same rows already populated by Steps 1/1B/2).

**Postgres implementation:**
```sql
ALTER TABLE documents ADD COLUMN search_vector tsvector;

UPDATE documents SET search_vector =
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(clean_text, '')), 'C');

CREATE INDEX CONCURRENTLY documents_search_idx ON documents USING GIN (search_vector);
```
- `to_tsvector` tokenizes, lowercases, strips stopwords, stems (running→run)
- `setweight` A/B/C = field-weighted ranking (title > description > body)
- `CONCURRENTLY` avoids locking the table during index build
- `search_vector` computed at insert time in the extraction worker (application-level, not DB trigger) — keeps logic visible/debuggable, worker owns sync. Skip recompute if content hash matches existing (unchanged content) to avoid wasted GIN write cost.
- Default search queries exclude rows where `near_duplicate_of IS NOT NULL` (partial index candidate — see Efficiency levers).

**Querying/ranking:**
```sql
SELECT id, title, ts_rank_cd(search_vector, query) AS rank
FROM documents, to_tsquery('english', 'postgres & indexing') AS query
WHERE search_vector @@ query
  AND near_duplicate_of IS NULL
ORDER BY rank DESC LIMIT 20;
```
`ts_rank_cd` chosen over plain `ts_rank` as the v1 default — factors in term proximity, better phrase-relevance for a research tool.

**Efficiency levers:** `CREATE INDEX CONCURRENTLY`, periodic `VACUUM`/`REINDEX` (GIN bloats over time — dead tuples from updates), only index searchable fields (never raw HTML), partial index excluding `low_content`/archived/`near_duplicate_of IS NOT NULL` rows, skip recompute on unchanged content.

**Quality levers (beyond raw `ts_rank_cd`):** combine with domain-trust weighting (reuses Lens domain data), freshness boost (relevant for time-sensitive Lenses only), inbound-link count within own corpus (small-scale PageRank-style signal); `pg_trgm` extension for typo-tolerant fuzzy fallback when exact match returns too few results; query rewriting via the AI layer shifts some fuzzy-matching burden away from the DB; domain-specific dictionary/stopword tuning per Lens category if needed later.

**Verifying index usage:** `EXPLAIN (ANALYZE, BUFFERS)` should show Bitmap Index Scan → Bitmap Heap Scan. A Seq Scan means the index isn't being used (missing, or query doesn't hit `search_vector @@ query`).

## Step 4 — Query / Retrieval Layer

**Full request lifecycle:**
```
1. Raw query in
2. AI query-understanding pass (optional/toggleable) — typo fix, expansion, implied filters, prior-context folding
3. Lens resolution — predefined / custom / "All" (no lens) / auto-classified, fallback "General"
4. Cache check (key = hash(normalized_query + lens_id + filters))
       HIT → return immediately
       MISS → continue
5. Build tsquery + apply filters (domain, date, lens domain-list if any)
6. Run against Postgres FTS index → ranked results (ts_rank_cd + weighting), near-dup rows excluded
7. Enough good results?
       YES → paginate, cache, return
       NO/THIN → trigger Model B live fetch (Step 1B) → index new content → retry query
8. Return: raw ranked results + optional AI-synthesized answer (wait-then-show, not streamed — Section 2E)
```

**Caching (cache-aside, reuses Redis from Step 1):**
- Cache-aside chosen deliberately: read-heavy workload (frequent search vs. infrequent writes from crawling), staleness within TTL is acceptable — write-through/write-behind would be wrong fits here (unneeded write latency / risk to durable data respectively)
- Short TTL (minutes) — the win is absorbing rapid repeat-queries, not long-term staleness tolerance
- Stale-while-revalidate: serve expired-but-within-grace-period cached value immediately, refresh async in background — better than a hard TTL cutoff
- Stampede protection: `SETNX`-based in-flight lock per cache key — concurrent identical requests wait on the first rather than re-running the expensive query
- Negative caching: zero/thin results (even post-live-fetch) get cached too, shorter TTL — prevents repeated wasted live-fetch attempts on a genuinely empty query

**Known, deliberately-accepted trade-offs:**
- No outbox pattern for cache invalidation-on-write. A crash between a Postgres write and a cache-invalidation call could leave a stale cache entry — accepted because the short TTL already bounds the staleness window; full outbox (table + relay process) is overkill at this scale.
- Near-duplicate reconciliation staleness window (Section 3) — accepted for the same reason: bounded, explicit, self-correcting at the next relevant query.

**Distributed-systems reasoning applied to this layer:**
- CAP, per-component not system-wide: Postgres (durable, CP-ish single-node) vs. Redis (AP-leaning — losing cache/queue state degrades gracefully rather than refusing service). Cheap-to-lose data lives in Redis, expensive-to-lose data lives in Postgres.
- Eventual consistency, operationalized: the index is eventually consistent with the live web ("eventually" = the re-crawl interval), and the corpus is eventually consistent with respect to near-duplicates ("eventually" = the async reconciliation job cadence). Both handled by surfacing staleness explicitly (`source` field, `crawled_at` timestamp, `near_duplicate_of`) rather than hiding it.
- Idempotent producers/consumers: crawler (producer) and extraction workers (consumer) both tolerate duplicate delivery without corruption, via content-hash unique constraint + Redis dedup Set/`SETNX` lock.
- 2PC/Sagas: not applicable to current single-logical-system architecture; noted as the right future model if independent multi-step concerns (e.g. document write + embedding job + analytics update) are added later.

**Retrieval query:**
```sql
WHERE search_vector @@ tsquery
  AND near_duplicate_of IS NULL
  AND (lens_mode = 'all' OR domain = ANY(lens.domains))
  AND (published_at >= $date_from)
  AND domain = $specific_domain
ORDER BY ts_rank_cd(search_vector, tsquery) DESC
LIMIT 20 OFFSET $page_offset
```

**Pagination:** offset/limit (`LIMIT 20 OFFSET N`), 20/page default. Approximate result counts past a threshold to avoid expensive exact `COUNT(*)`. Keyset pagination is the faster-at-depth alternative, not needed at this scale but worth knowing as the named trade-off.

**Thin-results trigger:** fewer than N results (e.g. 3), or top `ts_rank_cd` below a minimum threshold → triggers Step 1B live fetch → same table/index, no special-case query logic needed on retry.

**Response shape:**
```json
{
  "query": "...", "lens": "dev", "lens_mode": "predefined" | "custom" | "all" | "auto",
  "raw_results": [ { "title", "url", "snippet", "domain", "rank_score" } ],
  "synthesized_answer": "...",
  "pagination": { "page": 1, "per_page": 20, "approx_total": "500+" },
  "source": "index" | "live_fetch"
}
```

**Failure handling:** live fetch fails/times out → return existing thin results with a note; cache stale after live fetch → bounded by short TTL, optional explicit invalidation; AI synthesis fails → always return raw results regardless, synthesis never blocks real results.

## Step 5 — AI / Intelligence Layer

**A. Query understanding (pre-retrieval):** one LLM call, structured JSON output (cleaned query + extracted filters), small/cheap model sufficient. Handles typo correction, vague-query expansion, implied filter extraction, prior-context folding. Optional per-query (toggleable).

**B. Answer synthesis (post-retrieval, RAG, wait-then-show — Section 2E):**
```
raw_results (top 8-10 by rank_score, near-dups already excluded)
   → build context block: [{title, url, domain, snippet}, ...]
   → inject into prompt template
   → LLM call (single request/response, no SSE in v1)
   → output: synthesized answer + citations mapped to raw_results
```
**Core constraint:** only synthesize from content actually in `raw_results` — never let the model answer from outside training knowledge dressed as a cited source.

**Slot-based master prompt (Lens-parameterized — one structure for every domain and every lens mode, including "All"/"Auto"):**
```
[ROLE] You are a research assistant specialized for {lens.name} research.
[CONTEXT] Constraints: {lens.description}. Date: {current_date}.
          {if continue_research_context}: Prior context: {summary}
[SOURCES] {for each raw_result}: [{index}] {title} — {domain} — {snippet}
[BEHAVIOR RULES]
- Answer only from sources above, no outside knowledge
- Cite source number per claim
- State disagreements explicitly if sources conflict
- Say so plainly if sources don't sufficiently answer the query
[OUTPUT FORMAT] Synthesized answer (inline [n] citations) + confidence note + source list
```
`lens.name`/`lens.description` (already built for Step 4 filtering) reused here to parameterize the prompt — this is the mechanism behind "one adaptive pattern, not N hand-written prompts." For the "All" mode, `lens.description` is simply "no domain scoping — results drawn from the entire index."

**Raw-results-always-visible — contract-level guarantee:** response always includes `raw_results[]` regardless of synthesis; `synthesized_answer` is additive only. Guarantee lives in the API response contract, not frontend toggle behavior.

**Failure handling:** LLM provider down/timeout → return `raw_results` only, `synthesized_answer: null`, never block response; model hallucination risk → mitigated via prompt strictness + citation-mapping check (untraceable claims flagged low confidence); query-understanding over-correction → keep original raw query logged alongside AI-cleaned version for debuggability.

---

# 5. AUTH — REUSED FROM EXISTING PROJECT (auth-corez)

Rather than building auth into the search engine, mount the existing standalone auth system in front of it.

**auth-corez-backend** (Node/Express/TS, Prisma + Postgres/Neon):
- Two-token session model: short-lived stateless JWT access token (15min) + DB-backed opaque refresh token (7-day sliding window) delivered via HttpOnly cookie
- Refresh rotation + reuse/breach detection: a replayed already-rotated token triggers full account-wide session revocation + `breach_suspected` audit event
- Session management (list/revoke individual/revoke-all), password reset (session-revoking on success), event-driven email verification, Google OAuth (Authorization Code flow, CSRF `state` protection, `email_verified`-gated auto-linking)
- Role-based admin API — role re-fetched fresh from DB on every request, never trusted from token
- DB-backed rate limiting + OAuth CSRF state (stateless-safe, survives serverless restarts)
- Full audit trail (append-only event log)
- Repository pattern — controllers never touch Prisma directly

**auth-corez-frontend** (Next.js 16 App Router, TS, Tailwind):
- Axios interceptor: silent token refresh, concurrent 401s share a single in-flight refresh call (avoids false breach-detection triggers)
- Session restoration on load, admin console (security console: overview, users, events, sessions, config)
- Dark instrumentation-styled design language (serif headings, monospace for technical values, flat bordered cards)

**Integration decision:** since the search engine is single-user, mount auth-corez's session middleware in front of the search engine's own API endpoints (`/search`, `/lenses`, etc.) rather than reimplementing any auth logic inside the search engine project. Reusable patterns worth carrying over regardless: DB-backed rate limiting philosophy, role-re-fetch-not-token-trust pattern, repository pattern for the data layer, append-only audit-event-log pattern (could become a `CrawlEvent`/`SearchEvent` log).

---

# 6. FRONTEND PLAN

**Design language:** reuse auth-corez-frontend's dark instrumentation-console aesthetic (serif headings, monospace for technical values — ranks, timestamps, domains — flat bordered cards, one accent color) rather than a generic consumer search UI. Deliberate choice: a research tool showing rank scores and crawl status should look like an instrument panel.

**Reused wholesale from auth-corez-frontend:** all auth pages (login/register/reset/verify/OAuth), the axios interceptor pattern, `AuthContext`/`ProtectedRoute`, the admin console shell component pattern (`AdminShell`, `StatCard`).

## Screens

1. **Search** — Lens selector exposing all 4 modes (predefined / custom / All / Auto, with `auto: X` transparency tag when auto-classified), AI synthesis on/off toggle, synthesized answer block (wait-then-show, no streaming) with confidence + citations, collapsible-not-hidden raw results (near-duplicates excluded by default with a "show duplicates" expander), per-result `source: index|live_fetch` badge + `rank_score` + `indexed Nd ago`, pagination with approx totals.
2. **Lens management** — system Lenses shown editable (domain add/remove) but tagged "predefined"; user Lenses full create/edit/delete (name, description, domain list); "All" and "Auto" shown as always-available pinned options, not editable/deletable.
3. **History** — past searches (query, Lens mode used, timestamp, result count), respects retention/pruning policy with a visible note, each entry has a "Continue research" action.
4. **Continue Research flow** — shows a short summary of carried-forward context before submission (never a silent influence on results).
5. **Crawl / System console** (admin-style, reuses AdminShell pattern) — crawl overview (pages crawled, BullMQ queue depth, per-domain/per-Lens status), index stats (document count, index size, VACUUM/dead-tuple stats, near-dup reconciliation queue depth + last-run timestamp), live-fetch log (cache/index hit vs. real fetch), cache stats (hit rate, TTL config). This is the deliberate "show the backend work" screen.

**State management:** `AuthContext` (reused) + local/context state per search screen — React Context sufficient at this scale, no Redux/Zustand needed.

**API layer:** same `lib/api.ts` axios-instance-with-interceptor pattern, proxied via Next.js rewrites for same-origin (sidesteps CORS, matches auth-corez-frontend's existing approach). No AI-synthesis streaming in v1 (Section 2E) — simple wait-then-show.

---

# 7. DEPLOYMENT (FREE-TIER ONLY — FINALIZED)

**Constraint:** zero budget, no exceptions. Every component must run on a genuinely free tier (no trial credit that expires, no "free for 30 days"). Cold starts / autosuspend / spin-down are accepted trade-offs in exchange for $0 cost — this is a personal tool, not something serving concurrent users, so a 20-50s cold start on first hit after idle is acceptable.

| Component | Service | Why / trade-off |
|---|---|---|
| Frontend (Next.js) | **Netlify (free)** | Free tier handles Next.js hosting without a card, deliberately kept separate from the backend host so the two scale/fail independently |
| Backend API (query/retrieval, Step 4) **and Model B — live/on-demand fetch (Step 1B)** | **Vercel serverless functions (free)** | Model B is not a separate service — it's triggered *inside* the same request that handles `/search`, when Step 4's "thin results" check fires. It runs in-process within the API function, calling Step 1's fetcher + Step 2's extractor synchronously, then writing to the same `documents` table before returning the response. Caveat that has to be designed for, not discovered later: Vercel's free-tier functions have a hard execution-time ceiling. A live fetch → extract → write chain has to carry its own internal timeout comfortably under that ceiling; if it doesn't finish in time, fall back to returning existing thin results with a note (Step 4's failure-handling already specifies this path for "fetch failed" — it now also has to cover "fetch didn't finish in time") |
| Postgres | **Neon free tier** | Already the choice for auth-corez-backend, so one account/tooling set for both DBs. Free tier: autosuspend on idle (cold start on first query after inactivity), enough storage for a personal-scale corpus given the extracted-text-only retention policy (raw HTML already short-lived, keeps DB size down) |
| Redis (BullMQ + caching) | **Upstash free tier** | Confirmed: 256MB storage + 500K commands/month, no credit card required to start, no forced upgrade or expiration — billing only begins if a card is deliberately added later. Free tier includes a real Redis-protocol TCP endpoint (not just REST), which is what BullMQ needs via `ioredis` — a REST-only serverless Redis tier would not support BullMQ's queue/blocking commands. The 500K/month command cap is the number to watch as usage grows (BullMQ job chatter + cache-aside reads add up faster than a naive count suggests), but it's very unlikely to be a real constraint at single-user scale |
| Background crawler (Model A — BullMQ worker/frontier drain) | **GitHub Actions scheduled workflow (cron)** — no longer a fallback, this is the only Model A implementation under the zero-card constraint | Render (the original candidate for a persistent free worker) is disqualified — its free tier requires a credit card for human verification, which fails the no-card requirement outright, and no other component in this stack offers a genuinely free always-on process host. GitHub Actions runs on schedule: wakes up, connects to Upstash Redis + Neon Postgres, drains a batch of the frontier queue, does fetch→extract→index for that batch, exits. This is a deliberate, documented shift from "continuously running" to "frequently triggered" — not a silent downgrade |
| AI calls (query understanding + synthesis) | Whatever provider's free/low-cost tier is available at build time | Not pinned here since pricing/free-tier terms change; keep the LLM call behind a thin interface (already true — Step 5 is provider-agnostic) so swapping providers later doesn't touch the rest of the system |
| Domain | Netlify's free subdomain / Vercel's free `*.vercel.app` subdomain | No custom domain purchase needed to satisfy the zero-budget constraint |

**Consequence this forces on the architecture (worth stating explicitly, not hiding):**
- Model A (background crawler) is **scheduled-batch by design**, not **always-on**, under the free-tier plan. The frontier queue, rate limiting, and resumability design (Step 1) are unaffected — they were already built to survive restarts — but "always running" in the original spec now means "runs on every scheduled trigger until the batch/time budget for that run is spent." There is no continuously-live worker enforcing per-domain politeness *across* runs, only *within* each run — a subtly different execution model from the original always-on assumption, worth remembering when tuning crawl-delay/rate-limit config.
- Model B (live fetch) is bounded by Vercel's per-function execution ceiling, not by any timeout the original spec defined — this is a new constraint introduced by the hosting choice, and the fallback-to-thin-results behavior needs to treat "ran out of time" as routine, not exceptional.
- Cold starts on Vercel + Neon mean the *first* query after a period of inactivity will be slower than steady-state. This is acceptable for a personal research tool used in bursts, and is exactly the kind of trade-off the "eventual consistency, surfaced explicitly" philosophy (Section 4) already covers — note it in the Crawl/System console (Screen 5) as service status rather than pretending it isn't happening.
- If usage patterns later demand a persistent always-on worker for Model A at $0, the next thing to investigate (not decided now, out of scope) is whether Fly.io's free allowance (small always-on VM, no card historically required at low usage — reverify at build time since free-tier terms shift) can host just the worker process while everything else stays as-is. Flagged as the natural next lever if the GitHub Actions cadence proves too coarse, not committed to.
