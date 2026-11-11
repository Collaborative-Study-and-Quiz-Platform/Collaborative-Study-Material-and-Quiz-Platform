# CSQP-F-014 — Edit/Delete Study Material

TC-Mat-05. This feature is based on main at 1876553 and intentionally has no
Bookmark imports, schema changes, cascades or dependency on F-013.

## API

Both endpoints require `Authorization: Bearer <token>` with role `instructor`.
Ownership is taken exclusively from JWT identity and included in database writes.
Other instructors receive the same 404 as a missing material; students/admins
receive 403. Invalid/missing authentication returns 401.

- `PATCH /api/materials/:id`, JSON body containing any nonempty subset of
  `originalFilename`, `course`, `subject`, `topic`.
  Returns 200 `{ status: "success", message, material }`.
  Unknown/protected fields are rejected. Tags are trimmed, nonempty and limited
  to 100 characters. Filenames are trimmed, limited to 255 characters, have no
  path separators or control characters and retain the validated file extension.
  Only supplied metadata paths are written. ID, uploader, file bytes, storage
  name, upload date and download count are preserved. Response excludes storage
  location/name, version and deletion marker. Same-field edits use last-write-wins.
- `DELETE /api/materials/:id`, without body or query parameters.
  Returns 200 `{ status: "success", message: "Study material deleted" }` once
  filesystem and database cleanup complete. A fully removed record returns 404
  on retry. Concurrent requests may return 200 or 404; the final state is deleted.

Other errors: 400 invalid IDs/fields, 415 unsupported PATCH content type, 500
unexpected database/storage failures. Client responses never include private paths.

## Staged deletion and recovery

The nullable `deletedAt` marker makes materials immediately unavailable to new
list/preview/download requests. Missing legacy markers are treated as active.
Deletion derives a single validated basename under `MATERIAL_UPLOAD_DIR` and uses
`unlink`, never a client path or stored absolute location. It never follows the
final symlink or recursively deletes directories. ENOENT permits database cleanup.

The database record is physically removed only after unlink succeeds. On an error
it remains hidden and retains the information needed for the owner to retry DELETE.
A 500 can therefore mean partial completion: retry the same DELETE even if the
material has disappeared from listing. A failed final database removal is also
retryable because an already missing file is accepted. An operator can retry using
the retained material ID after correcting filesystem/database availability.
There is no automatic cleanup worker or restore API in this scope.

Already-open streams may finish; previously fetched blobs/downloads cannot be
revoked. Existing completion counting is unchanged and cannot recreate deleted
records. Metadata PATCH cannot update a deletion-marked record, even if it was
marked after the initial ownership lookup.

## My Uploads

Instructor rows add Edit/Delete beside View. Edit is prefilled; Delete requires
confirmation and initially focuses Cancel. Pending requests are guarded, failures
remain retryable, dialogs restore focus, and successful mutations update local data
before background revalidation. Applied search filters remain in place; option
lists are rebuilt from the instructor's full library when needed. Unaffected rows,
previews and native disclosure nodes remain mounted during background refresh.
Student actions and instructor download restrictions are unchanged.

## F-013 integration checklist

Expected textual conflicts: `material.routes.js`, `MaterialLibrary.jsx`,
`MaterialActions.jsx`, and the frontend package manifests if both branches add
happy-dom. Management CSS is isolated in `material-management.css`; App/sidebar
and global App.css are untouched by F-014.

When the independent PRs are eventually integrated:

- Keep all bookmark routes/actions and the management routes/actions. Do not infer
  management permission from `!canDownload`; pass it only for instructor rows.
- Preserve both dialog state paths and shared bookmark state when combining the
  library. Background revalidation must keep confirmed rows mounted.
- Preserve IDs on PATCH and monotonic download-count reconciliation from F-013.
- Bookmark population/listing must require active materials (`deletedAt: null`),
  omit null/missing population results, and compute count after omission.
- Bookmark PUT must check material existence with `deletedAt: null`. A race with
  deletion can leave a stale reference; it must stay invisible and removable.
- Preserve idempotent stale-bookmark removal. Eager bookmark cascade cleanup is
  optional; do not require it for correctness or assume MongoDB foreign keys.
- Refresh bookmark metadata after edits and invalidate deleted materials on the
  existing focus/navigation revalidation path. Add integration tests for updates,
  staged failures, completed deletions and stale bookmarks.
- Resolve manifests once and run TC-Mat-04, TC-Mat-05 and existing material tests.

## Verification

Backend tests use MongoMemoryServer and a process-specific temporary upload tree;
frontend interaction tests use Node's test runner, React act and development-only
happy-dom. No production database or upload directory is used.

Run from backend: `npm test`.
Run from frontend: `node --test test/*.test.mjs`, `npm run lint`, `npm run build`.
Run at repository root: `git diff --check`.

Manual browser checklist:

1. Instructor A edits filename/tags; verify search/grouping and download filename.
2. Verify Instructor B cannot edit/delete A's IDs through direct API calls.
3. Verify students/admins cannot mutate materials and students see no management UI.
4. Cancel and Escape deletion; verify no mutation, then confirm and verify removal.
5. Check validation, pending guards, failed requests/retry and keyboard focus.
6. Preserve an unrelated preview and expanded sections during mutation refresh.
7. Verify PDF preview, DOCX/PPT fallbacks, upload and download counters still work.
8. With disposable data, simulate missing files/cleanup failure and retry deletion;
   marked records must remain absent from Browse and file endpoints.
9. After F-013 integration, verify saved metadata changes and deleted bookmarks vanish.

DOM tests cover component/request lifecycle, not native PDF rendering, the browser's
modal top layer or operating-system file-save UI. Real browser checks remain manual.
