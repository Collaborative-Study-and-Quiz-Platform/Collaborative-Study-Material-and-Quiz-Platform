# CSQP-F-050 — Comment on Study Material

Requirement: authenticated Students and Instructors can post comments on material
items. TC-Collab-01 / AC-050: a confirmed post appears immediately under the item;
other viewers see it on their next comment fetch/refresh. No cross-browser live
subscription is included. F-050 remains independent of pending F-013 and F-014.

## Authorization and endpoints

Both routes use existing JWT and student/instructor RBAC middleware. Students can
access comments on any active material; instructors only on their own uploads,
matching existing material visibility. Admins are denied both endpoints. No role
or author identity is taken from the request body. Material lookups require
`deletedAt: null`, which also matches legacy records without that field.

- `POST /api/materials/:id/comments`, JSON `{ "content": "Helpful explanation" }`.
  Only content is accepted, trimmed to 1–2000 characters. Returns
  `201 { status: "success", message: "Comment posted", comment }`.
- `GET /api/materials/:id/comments?limit=20&cursor=...` returns
  `200 { status: "success", comments, hasMore, nextCursor }`.
  Default 20, maximum 50. Unknown parameters and malformed/array values are rejected.
  Results sort newest-first by createdAt and _id. The opaque base64url cursor
  contains a validated canonical timestamp and ObjectId; no unbounded fetch or
  expensive total-count query is used. At most limit+1 records are queried.

Public DTO: `_id, material, author: { _id, name }, content, createdAt, updatedAt`.
Author lookups explicitly project only ID/name. Missing authors on historical
comments appear as `{ _id: null, name: "Former user" }`; a missing author account
cannot post. Emails, passwords, storage information and model versions are excluded.

Errors: 400 invalid IDs/content/fields/pagination; 401 invalid JWT/identity or
missing posting account; 403 admin; 404 missing, marked or inaccessible parent;
415 non-JSON POST; 429 rate limit; 500 generic database failure. The existing JSON
parser may also reject oversized/invalid JSON globally. Comment routes set
`Cache-Control: private, no-store`, including their authentication/RBAC/limit errors.

## Model and abuse prevention

MaterialComment is a separate collection with required material/author references,
trimmed content and timestamps. Its compound index is
`{ material: 1, createdAt: -1, _id: -1 }`. Material metadata and counters are untouched.

The existing rate limiter is reused with a dedicated POST instance:

- `MATERIAL_COMMENT_RATE_LIMIT_MAX`: default 10.
- `MATERIAL_COMMENT_RATE_LIMIT_WINDOW_MS`: default 60000.

Invalid configuration fails startup using the existing limiter validation. This is
an in-memory, per-process IP limit, not a distributed or per-user quota. Users
behind shared NAT share the allowance; restarting a process resets it. GET is not
charged against the POST allowance. Existing proxy trust settings are unchanged.

Content rejects unsafe control characters and existing active-content patterns.
A dependency-free, case-insensitive whole-word English filter rejects three common
profanities. It is deliberately coarse: quotations can be rejected, other languages
and obfuscations are not covered, and it is not comprehensive moderation. Neither
this filter nor regex sanitization is treated as XSS protection: React always
renders comment strings as plain text without HTML/Markdown interpretation.

## UI and asynchronous behavior

Comments toggles an expandable panel below the selected row. Data is fetched only
when opened; the accessible controlled container exists even when closed. The
panel shows loading/empty/error/success states, author, timestamp, preserved line
breaks, draft length, Refresh and Load older comments. It requests 20 at a time.
History pages are loaded only by explicit user action and deduplicated by ID.

A successful POST prepends the server DTO immediately and clears the draft. A
synchronous guard prevents double submits. Drafts remain after errors. Failed or
ambiguous POST requests are never automatically retried; if the response is lost,
refresh before resubmitting because the server may already have saved the comment.
This API does not promise exactly-once posting across manual retries.

Read versions and AbortControllers prevent an old GET from overwriting a confirmed
post. Parent/session keys reset panel state; closing/unmounting cancels reads and
POSTs and ignores late responses. Cancellation cannot undo an already committed
write. Background comment reads retain existing comments/drafts on failure and
never reload material rows, filters, preview dialogs or downloads.

A 404 marks the panel unavailable and disables posting; it does not look like an
empty discussion. No comment edit/delete, replies, reactions or notifications exist.

## Parent deletion and F-013/F-014 integration

Pending features were not merged, copied or imported. Expected textual conflicts:
`material.routes.js`, `MaterialLibrary.jsx`, `MaterialActions.jsx`, the existing
action tests, and frontend package manifests (shared happy-dom test dependency).
Comment CSS is isolated; App/sidebar, global CSS, authentication and other modules
are untouched.

Future integration checklist:

1. Preserve all bookmark, edit/delete and comment actions/routes and optional props.
2. Retain explicit role capabilities. Instructor commenting does not imply access
   to another instructor's uploads, and download permission does not govern comments.
3. Preserve row-local comment state, shared bookmarks, monotonic download counts,
   stable material IDs and mounted rows during background revalidation.
4. F-014's deletedAt marker must gate comments and bookmark queries. A marked or
   hard-deleted parent makes all new comment requests return 404. Metadata edits
   preserve the discussion because the parent ID is stable.
5. MongoDB references are not foreign keys: deletion racing a post can leave an
   inaccessible orphan comment. Parent-gated reads prevent exposure, but physical
   orphan cleanup/cascade and retention policy need a coordinated integration
   change. No parent deletion hooks or cleanup jobs are added by F-050.
6. Reconcile manifests once, then run TC-Mat-04, TC-Mat-05 and TC-Collab-01 together.

A missing physical file does not prohibit discussion of an otherwise accessible
material record. Existing preview/download endpoints retain their own file checks.

## Verification

Backend: `npm test`. New tests use isolated MongoMemoryServer databases; comment
APIs never read or write production files. The default limiter has a separate test
process so the functional tests can configure a larger allowance without bypassing
rate middleware in production.

Frontend: `node --test test/*.test.mjs`, `npm run lint`, `npm run build`.
Tests use React act plus development-only happy-dom for real mounted components,
mocking HTTP responses to exercise races and failures. No test framework/runtime
dependency is added to production. Root: `git diff --check`.

Manual browser checklist:

1. Student opens Comments, posts, and sees the saved comment immediately below the
   item. A second viewer refreshes/reopens and sees it; no page reload is needed.
2. Owning instructor can read/post; another instructor and admins are denied by
   direct API calls as well as the existing visibility restrictions.
3. Check empty/loading/error/retry, draft retention, slow requests, rapid submits,
   whitespace/length/profanity validation and lost-response refresh guidance.
4. Check author fallback, plain-text markup, timestamps, Refresh and older pages.
5. Check Tab/Enter controls, textarea label, live feedback and expanded state.
6. Verify material filters/disclosures, previews and downloads survive discussion.
7. After F-013/F-014 integration, verify bookmarked discussions, metadata edits and
   deletion-marked/removed material behavior.

DOM tests do not replace native browser checks for layout, keyboard focus behavior,
PDF rendering, modal top layers or OS downloads. Those checks remain manual.
