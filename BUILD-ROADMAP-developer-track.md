# Personal AI Search Engine — Build Roadmap (Developer Track)

> Companion to Master Spec v3. Assumes competence with JS/TS, Node, Git, basic SQL, and basic Docker — no fundamentals phase. Structured as implementation phases mapped 1:1 to the spec's architecture, in dependency order, with every checkpoint/exercise from the DB-internals and systems-concepts planning placed at the point it's actually relevant.

---

# Phase 1 — Project Setup

- New repo, TypeScript + Node, folder structure: `src/crawler`, `src/extraction`, `src/indexing`, `src/api`, `src/ai`
- Docker Compose: Postgres + Redis, local dev
- `.env` for `DATABASE_URL`, `REDIS_URL`, later LLM API key — gitignored
- `pg` (or Prisma) client wired up, `ioredis` client wired up, confirm both connect on app boot

**Deliverable:** `docker-compose up` + app boot logs confirm both DB connections live.

---

# Phase 2 — Schema

Prisma (or raw SQL migrations) for:

```
documents
  id, canonical_url, domain, title, description,
  published_at, clean_text, content_hash, simhash,
  near_duplicate_of, crawled_at, lens_tags[]

raw_fetches
  id, url, domain, status_code, headers, raw_html,
  fetched_at, extracted (bool)

lenses
  id, name, description, domains[], mode ('predefined'|'custom'), owner

search_history
  id, query, lens_id, filters, result_count, created_at
```

- Unique constraint on `documents.content_hash`
- Index on `documents.domain`, `documents.crawled_at`
- Migrate against local Postgres, confirm via `psql \d documents`

**Deliverable:** all four tables exist, constraints verified with a manual duplicate-insert test (should fail).

---

# Phase 3 — Step 1: Crawler (Model A, background)

Build in this sub-order — each piece independently testable before the next depends on it.

1. **Fetcher** — single-URL fetch with timeout, custom User-Agent, writes raw HTML + metadata to `raw_fetches`
2. **robots.txt** — fetch/parse/cache per domain, check before every fetch, respect `Crawl-delay`
3. **Link discovery** — Cheerio-based `<a href>` extraction, URL normalization (relative→absolute, strip tracking params, lowercase host)
4. **Redis dedup** — `SADD`/`SISMEMBER` on normalized URLs before a link becomes a job
5. **BullMQ queue** — jobs tagged by domain, per-domain rate limiter (`limiter: { max, duration }`, `Crawl-delay`-aware with sane default fallback), `attempts` + exponential backoff on 5xx/timeout only — never retry 404/403
6. **Seed URLs + scope rules** — seed list per Lens, crawl depth limit, domain-allowlist enforcement during link discovery
7. **Crash resumability** — Redis AOF enabled, kill process mid-crawl, confirm frontier resumes on restart

**Checkpoint (concurrency race):** temporarily replace the BullMQ rate limiter with hand-rolled read-check-increment across concurrent workers on the same domain key — confirm it overshoots the limit. Revert, confirm the atomic limiter holds.

**Deliverable:** unattended crawl of 2-3 real seed domains runs cleanly for several minutes, politely, resumable across a forced restart.

---

# Phase 4 — Step 2: Extraction

1. **Content extraction** — Readability library primary, structural tag-stripping fallback on empty/short output
2. **Metadata extraction** — title/description/canonical/published-date per the field-priority rules in the spec
3. **Exact-dup detection** — hash normalized clean text, unique-constraint-backed insert check
4. **SimHash near-dup detection:**
   - Token shingling → 64-bit fingerprint, computed synchronously in the extraction worker, stored on `documents.simhash`
   - Separate low-priority BullMQ queue: banded lookup (4-band split) against existing fingerprints, Hamming-distance threshold (~≤3 bits) comparison, sets `near_duplicate_of` on the losing doc
   - This is the hardest single piece in the backend — isolate and unit-test the SimHash function and the Hamming comparison independently of the queue plumbing before wiring them together
5. **Decoupled worker + batching** — own BullMQ queue separate from the fetch worker, triggered on successful fetch; bulk-insert in batches of 50-100

**Checkpoint (write skew):** two `psql` sessions racing an insert on the same `content_hash` — confirm the unique constraint correctly errors the second transaction; temporarily drop the constraint to see the duplicate slip through, then restore it.

**Checkpoint (backpressure):** during a larger crawl run, track `count(*) FROM raw_fetches WHERE extracted = false` over time — confirm it stays roughly flat.

**Deliverable:** full crawl→extract pipeline running end to end, clean deduped rows (including a verified near-dup catch on two deliberately-similar test pages) landing in `documents`.

---

# Phase 5 — Step 3: Indexing

```sql
ALTER TABLE documents ADD COLUMN search_vector tsvector;
-- computed at insert time in the extraction worker (application-level, not trigger)
CREATE INDEX CONCURRENTLY documents_search_idx ON documents USING GIN (search_vector);
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

- `setweight` A/B/C tiers: title/description/body
- Default queries exclude `near_duplicate_of IS NOT NULL` (partial index candidate)
- `ts_rank_cd` as the default ranking function over plain `ts_rank`
- Skip `search_vector` recompute when content hash is unchanged

**Checkpoint (B-tree vs GIN):** `EXPLAIN ANALYZE` on `WHERE domain = 'x'` (B-tree) vs `clean_text LIKE '%x%'` (seq scan) against real populated data.

**Checkpoint (query planner):** `EXPLAIN (ANALYZE, BUFFERS)` on the search query at small and larger corpus sizes — confirm Bitmap Index Scan → Bitmap Heap Scan, not Seq Scan.

**Checkpoint (MVCC/VACUUM):** after update/re-extraction churn, check `pg_stat_user_tables.n_dead_tup`, run `VACUUM`, confirm it drops.

**Deliverable:** raw `psql` full-text query against real crawled data returns correctly ranked, weighted results.

---

# Phase 6 — Step 4: Query/Retrieval + API

1. **Basic `GET /search?q=`** — wraps Phase 5's query, no filters/cache/lens yet
2. **Lens resolution (4 modes)** — predefined (editable domain list), custom (full CRUD), "All" (skip domain filter), "Auto" (keyword/category match against lens tags, fallback General)
3. **Filters + pagination** — domain, date, `LIMIT/OFFSET` with approximate counts past a threshold
4. **Caching (build incrementally, test each layer before stacking the next):**
   - Cache-aside: key = `hash(query+lens_id+filters)`, short TTL
   - Stale-while-revalidate: serve expired-within-grace value, async background refresh
   - Stampede protection: `SETNX`-based in-flight lock per cache key
   - Negative caching: cache zero/thin results (post-live-fetch) with shorter TTL
5. **Thin-results → Model B trigger** — threshold check (< N results or low top rank score) → live fetch (Phase 3/4 fetcher+extractor reused synchronously in-request) → `SETNX`-based in-progress lock on the target URL to prevent duplicate concurrent live fetches → write to `documents` → retry query

**Checkpoint (cache stampede):** fire the same uncached query twice in rapid succession without the lock — confirm both hit Postgres; add the lock, confirm the second waits.

**Response contract:**
```json
{
  "query": "...", "lens": "dev", "lens_mode": "predefined|custom|all|auto",
  "raw_results": [{ "title", "url", "snippet", "domain", "rank_score" }],
  "synthesized_answer": null,
  "pagination": { "page": 1, "per_page": 20, "approx_total": "500+" },
  "source": "index" | "live_fetch"
}
```

**Deliverable:** `/search` returns paginated, filtered, cached, ranked results; a deliberately thin query triggers a live fetch and visibly grows the index.

---

# Phase 7 — Step 5: AI Layer

1. **Query understanding** — single LLM call, structured JSON output (cleaned query + extracted filters), optional/toggleable pre-step
2. **Answer synthesis (RAG, wait-then-show)** — top 8-10 `raw_results` → context block → slot-based master prompt (Lens-parameterized: `{lens.name}`, `{lens.description}`, `"All"` mode gets a literal "no domain scoping" description) → single LLM call → cited answer + confidence note
3. **Contract guarantee** — `raw_results` always present regardless of synthesis; `synthesized_answer` additive only; `synthesize=true|false` query param
4. **Failure isolation** — LLM timeout/error wrapped so it never blocks the raw-results response; original vs. AI-cleaned query both logged for debugging

**Deliverable:** real research query returns a cited synthesized answer plus full raw results underneath; toggling AI off still returns a complete response.

---

# Phase 8 — Auth Integration

- Mount `auth-corez-backend` session middleware in front of the search engine's API routes
- Confirm protected routes reject unauthenticated requests, accept valid sessions
- Reuse: DB-backed rate limiting pattern, role-re-fetch-not-token-trust pattern, repository pattern for the data layer

**Deliverable:** authenticated session (via existing auth-corez frontend flow) successfully hits protected `/search`.

---

# Phase 9 — Frontend

Build in dependency order:

1. **Search screen** — Lens selector (all 4 modes, `auto: X` transparency tag), AI toggle, synthesized-answer block (wait-then-show), collapsible raw results (near-dups excluded by default, "show duplicates" expander), `source`/`rank_score`/`indexed Nd ago` per result, pagination
2. **Lens management** — predefined (editable, tagged), custom (full CRUD), "All"/"Auto" pinned non-editable options
3. **History** — past searches, retention-policy note, "Continue research" action wired to Step 1B's prior-context mechanism
4. **Continue Research flow** — carried-forward context summary shown before submission
5. **Crawl/System console** — crawl stats, index stats (doc count, index size, VACUUM/dead-tuple stats, near-dup reconciliation queue depth), live-fetch log, cache hit-rate/TTL — reuses `AdminShell`/`StatCard` from auth-corez-frontend

Reuse auth-corez-frontend's design system, axios-interceptor pattern, `AuthContext`/`ProtectedRoute` throughout.

**Deliverable:** full end-to-end usage from the browser — search, lens filtering, AI synthesis, lens management, live system stats visible on the console screen.

---

# Phase 10 — Deployment

Strict order — each step depends on the previous being live:

1. **Neon Postgres** — free-tier project, run migrations, confirm connectivity from local app before proceeding
2. **Upstash Redis** — free-tier database, confirm BullMQ connects over the TCP endpoint (not REST) from a local test
3. **Vercel** — deploy API as serverless functions, including in-request Model B live-fetch logic; deliberately test the execution-time-ceiling fallback path (don't assume it works untested)
4. **GitHub Actions cron** — scheduled workflow draining the frontier queue in batches (Model A under the free-tier constraint); start conservative (30-60 min interval, small batch size), verify one full run end-to-end before trusting it unattended
5. **Netlify** — deploy frontend pointed at the live Vercel API

**Deliverable:** system runs unattended — crawler keeps working via scheduled GitHub Actions runs, index grows over time, live site serves real searches, $0 cost.

---

# Dependency graph (for reference)

```
Phase 1 (setup) → Phase 2 (schema)
   → Phase 3 (crawler) → Phase 4 (extraction) → Phase 5 (indexing)
       → Phase 6 (query/retrieval + API, includes Model B)
           → Phase 7 (AI layer)
           → Phase 8 (auth integration) [parallel-safe with Phase 7]
               → Phase 9 (frontend)
                   → Phase 10 (deployment)
```

Phases 7 and 8 can be built in either order or in parallel once Phase 6 is stable — neither depends on the other.
