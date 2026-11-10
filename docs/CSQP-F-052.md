# CSQP-F-052 — Rate Study Material

TC-Collab-03 / AC-052: authenticated students can submit or update a 1–5 star vote. The row immediately displays the server-confirmed average, count and own rating without reloading the library.

## Storage and contracts

`MaterialRating` contains required material/student ObjectId references, integer rating (1–5), and createdAt/updatedAt. A unique `{ material: 1, student: 1 }` index enforces one vote per pair and supports summary aggregation by material. No material fields, timestamps, files or counters are modified.

- `PUT /api/materials/:id/rating`: students only. JSON body must contain exactly `{ "rating": 1 }` through `{ "rating": 5 }`. Identity comes exclusively from the JWT. Both create and update return 200.
- `GET /api/materials/:id/rating`: students and instructors who uploaded the material. No query parameters or nonempty body accepted.
- Both return `{ status: "success", materialId, averageRating, ratingCount, myRating }`. Averages retain database precision; the UI rounds only its display to one decimal. Zero votes produce `averageRating: null, ratingCount: 0, myRating: null`. Instructors always receive `myRating: null`. No individual student ballots or identities are returned.
- Existing `GET /api/materials` adds `ratingSummary: { averageRating, ratingCount, myRating }` to each visible row through one bulk aggregation, rather than per-row reads. An aggregation failure leaves existing materials available with `ratingSummary: null` (unavailable, distinct from zero ratings), with an explicit UI retry.
- Errors use existing `{ status: "error", message }`: 400 invalid ID/body/query/rating, 401 invalid/absent JWT or unavailable student account on PUT, 403 forbidden role, 404 missing/deletion-marked/inaccessible material, 415 non-JSON PUT, 500 database failure. Existing global JSON/security validation applies first. Personalized responses use `Cache-Control: private, no-store`.

## Concurrency and visibility

Atomic upsert is scoped to JWT student + material. The controller awaits model initialization (including the compound index under existing Mongoose auto-index conventions). A compound-index E11000 collision retries a non-upsert update with the requested value; unrelated duplicate-key failures remain errors. There is no server.js change or new production dependency. If deployment disables automatic index building, provision the unique index before accepting rating writes.

GET/PUT and list queries require `{ deletedAt: null }`, matching both legacy missing markers and F-014's future nullable marker. Instructor reads also scope by uploadedBy. PUT rechecks the parent after writing. Parent deletion is not transactional with voting: an orphan vote may remain after a deletion race, but cannot be accessed through rating endpoints or visible lists. F-014 integration should add explicit rating cleanup to its deletion policy. A deletion after the final visibility check can still race an in-flight response, as with existing material reads.

A summary is a primary-database aggregate snapshot; simultaneous writes may change a summary immediately after it is returned. The unique constraint prevents duplicated votes, not concurrent users changing the average. No denormalized average/count can drift. No cross-browser push synchronization or vote-removal endpoint is included.

## UI and lifecycle

A compact purple average/count precedes the unchanged file action component. Students have a star button opening a small row-local form with native, labelled radio controls and Submit/Update/Refresh buttons. Instructors see only compact averages/counts (and a read retry if unavailable). No automatic per-row GET is needed when list summaries are present.

The list reconciles only the affected summary. Filters, grouped disclosures, previews, downloads and row instances remain mounted during rating interactions. A synchronous request ref prevents duplicate submissions. Starting a write aborts and invalidates existing reads; late successes/errors/finalizers are ignored. A confirmed 404 clears the summary and disables the composer for that row/session. The rating component is keyed by material ID and token; cleanup aborts requests and late results cannot update a new rating session. The library also cancels superseded list requests and hides data until it belongs to the current token, preventing old personalized summaries from leaking across account changes. Failed writes retain the selected rating and require an explicit retry. Retrying an ambiguous PUT is safe because setting the same vote is idempotent.

## Tests and manual verification

Backend tests use MongoMemoryServer and temporary upload directories; no production database is read or written. Coverage includes RBAC/ownership, protected fields, invalid input, exact/fractional averages, persistence, concurrent upserts, forced duplicate-key handling, bulk aggregation, failure injection, parent deletion races, cache policy and unchanged physical bytes/metadata/counters. Existing View/Download tests remain part of the full suite.

Mounted frontend tests use React act/createRoot with a lightweight Happy DOM dev dependency and deferred network promises, alongside existing SSR tests. They check controls, immediate authoritative updates, duplicate protection, retries, stale GET successes/failures, terminal 404s, session changes, and preservation of real library row/action/preview/download instances, filters and disclosures. Happy DOM does not verify browser layout, native arrow-key behavior or real PDF/download rendering.

Commands: `cd backend && npm test`; `cd frontend && npm test`, `npm run lint`, `npm run build`; `git diff --check`.

Manual browser checklist (not claimed as executed):

1. Student A selects 5 and submits; average 5.0, count 1, own vote selected.
2. Student B submits 1; average 3.0, count 2. A refreshes ratings to see this value.
3. A updates to 3; average 2.0, count remains 2. Reload and sign in again to verify persistence.
4. Owning instructor sees average/count without submission controls; another instructor cannot read this material's ratings; admin/anonymous requests are rejected.
5. Tab to the star action, activate it, select native radios with arrow keys and submit using the keyboard; check focus indication and spoken feedback.
6. Expand course/subject/topic, set filters, open preview and start a download; submit a rating and confirm existing interactions remain intact.
7. Simulate failed reads/writes and an unavailable material; check explicit retry, preserved selection, disabled unavailable form and no stale result restoration.
8. Check compact purple styling at desktop and narrow mobile widths and real preview/download behavior.

## Pending feature integration

F-052 is independent of F-013/F-014/F-050. No branch code is copied or imported. Expected shared conflict locations are material.controller.js (list enrichment/deletedAt), material.routes.js (additional endpoints), MaterialLibrary.jsx (adjacent row controls and local reconciliation), and frontend package manifests (test tooling). MaterialActions and existing shared CSS were not modified; rating CSS is isolated and leaves existing file actions intact.

- F-013: enrich bookmark material lists using the shared bulk summary service; reconcile summaries into its shared material state without resetting bookmark status or mounted actions. Preserve authenticated scope and private caching.
- F-014: retain IDs and ratingSummary on metadata edits; preserve deletedAt visibility predicates; decide cascade/retention for ratings after deletion. Keep new Edit/Delete controls and dialogs beside existing controls.
- F-050: compose the Comments action/panel beside the star and file actions; preserve independent row-local drafts/request lifecycles. Do not share terminal/request state across unrelated panels unintentionally.
- Resolve routes additively, retain ownership/RBAC per endpoint, combine dev test dependencies/scripts without duplicates, and rerun all feature suites and keyboard/preview/download acceptance checks after integration.
