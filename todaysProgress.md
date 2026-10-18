here i will mention, everything i did daily

went through code
ran couple of tests 
find alot of errors in logic
enlist them to correct in next session 

To-do before continuing Phase 7

Lens and URL supply

Redesign the lens data model: categories, seed URLs, predefined, custom, all and auto.
Seed lists per category (you research and write these).
Custom lens CRUD, since lens.create doesn’t exist.
Auto mode: pick the lens from which domains the top index hits come from.
“No category and no sources” fallback: tell the user plainly that nothing covers it.
Fix the lens scope mismatch where python.org crawls subdomains but search won’t match them.
Reject lens URLs stored with a scheme, like https://python.org, or normalize them.
Custom URL discovery by sitemap plus limited-depth crawl (we’ll decide this later).

Pipeline wiring
9. Start crawls and workers, and fix the circular imports (queue.ts, processor.ts, seed.ts).
10. Enqueue extraction after each raw fetch.
11. Restore the GIN index on documents and make sure Prisma doesn’t drop it.
12. Model B without client input: take the query, choose the lens URLs, live-fetch, extract, index, then search again.
13. Make predefined lenses crawl in the background so queries return in seconds.
14. Make document creation and its search vector one atomic step, and handle re-crawled pages that changed.

Query path
15. Use websearch_to_tsquery instead of to_tsquery.
16. Validate page, per_page and array-valued q so they can’t return a 500.
17. Add an ORDER BY tiebreaker so pagination is stable.
18. Don’t drop pages with no publishedAt on date filters, and fix the date detection.
19. Add the live-fetch URL to the cache key.
20. Make cache locks use a unique token and release only their own lock.
21. Fall back to the database when Redis fails, and handle the background refresh’s unhandled rejection.
22. Return clean 4xx errors for bad lens values.
23. Limit query length.

Internal AI, then Gemini as optional
24. Internal query cleaning: pg_trgm for typos, chrono-node for dates, stopwords from Postgres.
25. Internal extractive summary: top 5 to 10 documents with a heading, summary and source link each.
26. Gemini becomes an optional upgrade with a single attempt and a short timeout for the pre-step.
27. Don’t cache a failed synthesis for the full TTL.
28. Escape the query and page snippets inside prompts.
29. Make synthesis read document text, not 30-word snippets.

Storage and retention (all in Postgres)
30. 24-hour storage for results and raw data, and 7-day storage for chat plus results.
31. A scheduled cleanup job, and a message on chats whose results expired.
32. Write SearchHistory, and clean up RateLimitEntry, OAuthState and Token rows.
33. Stop storing raw HTML forever, and add removeOnComplete and removeOnFail to BullMQ jobs.

Crawler and extraction
34. Retry 429 and 408 instead of treating them as permanent.
35. Mark a URL as seen when it is crawled, not when queued, and scope the seen set per lens.
36. Add size and content-type limits, and strip NUL bytes before storing.
37. Add default crawl politeness, and treat an unreachable robots.txt as disallow-all.
38. Handle bad canonical links without crashing, and stop pages claiming other pages’ canonicals.
39. Replace the O(N²) near-duplicate check with the 4-band lookup.
40. Make the SimHash threshold work for short pages.
41. Fix redirects, so stored URLs are the final address.
42. Move extraction work out of the API process.

Security and auth (Phase 8)
43. Block requests to internal addresses in any URL fetching, and re-check on redirects.
44. Put auth and a rate limit on /api/search.
45. Check refresh-token expiry, hash the stored tokens, and fix the refresh race conditions.
46. Lowercase emails and fix the Google account-linking hijack.
47. Reset the lockout counter after the lock expires.
48. Fix the rate limiter: atomic counting and trust proxy.
49. Fix the Google OAuth redirect URI and tie state to the browser.
50. Set CORS and cookies for the Netlify-to-Vercel setup.
51. Stop using the fake Ethereal mail server in production.
52. Let logout work with an expired access token.
53. Smaller auth items: audit-log role changes, create the first admin, return 409 on a registration race.

Config and housekeeping
54. Validate REDIS_URL and DIRECT_URL.
55. Fix getConfig so it reports the real rate limits.
56. Remove the dead getCached/setCached code.
57. Fix the 16 test files that fail on the Prisma config, and apply the pending git pushes (GitHub access first).