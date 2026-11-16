# Updated Test Cases (Test Plan section 15, final)

**Project:** Collaborative Study Material and Quiz Platform (CSQP), Team 13
**Updates:** Test Plan v1.0 section 15 after Sprint 1 and Sprint 2

Status key: **Original** = in Test Plan v1.0. **New** = added during the sprints, as section 15 planned ("to be expanded during execution"). **Updated** = original case whose steps changed.

Results for every case are in `Unit_Test_Report.md` and `System_Validation_Report.md`.

| TC ID | Req Ref | Description / Steps | Expected Result | Priority | Type | Automated in | Status |
|---|---|---|---|---|---|---|---|
| TC-Auth-01 | CSQP-F-001 | Register a Student and an Instructor with valid name, email, password, role. Try missing fields, bad email, duplicate email, Admin role. | Valid accounts created (201) without password in response; invalid input 400; duplicate 409; Admin self-registration rejected. | High | Functional | `backend/test/auth-registration.test.js` | Updated |
| TC-Auth-02 | CSQP-F-002 | Log in with valid, wrong and unknown credentials. | Valid login returns JWT and safe profile; wrong password and unknown email give the same generic error. | High | Functional | `backend/test/auth-registration.test.js` | Original |
| TC-Auth-03 | CSQP-F-003 | As a Student, call Instructor-only endpoints (create quiz, question bank). As Instructor, call Student-only endpoints. | HTTP 403; no token gives 401; client-supplied role headers are ignored. | High | Functional | `protected-routes.test.js`, `quiz.test.js`, `quiz-attempt.test.js` | Original |
| TC-Auth-04 | CSQP-F-004 | Request password reset, use the link, reuse it, use an expired token. | Reset email sent; new password works; reused or expired token rejected. | High | Functional | `password-reset.test.js` | New |
| TC-Mat-01 | CSQP-F-010 | As Instructor, upload PDF, DOCX and PPT with course, subject, topic. Try wrong type, oversized file, bad tags. | Valid files stored with tags; invalid uploads rejected and no file left behind. | High | Functional | `material-upload.test.js` | Original |
| TC-Mat-02 | CSQP-F-011 | As Student, search by keyword and filter by course, subject, topic. | Matching results returned within 2 s on a seeded dataset. | High | Functional | `material-search.test.js` | Original |
| TC-Mat-03 | CSQP-F-012 | As Student, preview and download a material. | Download count increases once per download; preview does not count. | High | Functional | `material-file.test.js` | New |
| TC-Mat-04 | CSQP-F-013 | Save and remove a bookmark, log out and back in. | Bookmark persists across sessions; repeated save is idempotent. | Medium | Functional | `material-bookmark.test.js`, frontend bookmark tests | New |
| TC-Mat-05 | CSQP-F-014 | As owning Instructor, edit metadata and delete a material. Try as another Instructor. | Owner edits and deletes; others get 403; download count and file kept on edit. | High | Functional | `material-management.test.js` | New |
| TC-Quiz-01 | CSQP-F-020 | Create a quiz with MCQ, True/False and short-answer questions, duration and passing score. | Quiz saved with all questions and settings; new questions also added to the bank. | High | Functional | `quiz.test.js` | Original |
| TC-Quiz-02 | CSQP-F-021 | Schedule a quiz with start and end time. As Student, try to start before, during and after the window. | Start allowed only inside the window; attempt never runs past window end. | High | Functional | `quiz-schedule.test.js` | New |
| TC-Quiz-03 | CSQP-F-022 | Start an active quiz, answer some questions, let the timer expire without submitting. | Quiz auto-submits and keeps every answer saved before time-out. | High | Functional | `quiz-attempt.test.js`, `available-quizzes.test.js` | Original |
| TC-Quiz-04 | CSQP-F-023 | Submit a quiz with correct, wrong and blank objective answers. | Score matches the answer key; short answers wait for manual grading. | High | Functional | `automatic-grading.test.js` | New |
| TC-Quiz-05 | CSQP-F-024 | As Instructor, open submissions and grade short answers. Try invalid marks. | Marks added to auto score; pass decided when all graded; student notified once; invalid marks 422. | High | Functional | `manual-grading.test.js` | New |
| TC-Quiz-06 | CSQP-F-025 | As Student, view result with show-answers on and off. | Score shown; correct answers only when enabled; only own results visible. | High | Functional | `quiz-results.test.js` | New |
| TC-Quiz-07 | CSQP-F-026 | As Instructor, export results as CSV. | One row per attempt with score and timestamps; formula-like text kept as plain text. | Medium | Functional | `results-export.test.js` | New |
| TC-QB-01 | CSQP-F-030 | Add, edit and delete a question with subject, topic, difficulty. | Saved and retrievable by metadata after each operation; delete is soft. | High | Functional | `question-bank.test.js` | Original |
| TC-QB-02 | CSQP-F-031 | Tag questions and filter by subject, topic, difficulty, type, tag. | Only matching questions returned; bad filters rejected. | Medium | Functional | `question-search.test.js` | New |
| TC-QB-03 | CSQP-F-032 | Import questions from the CSV template and an Excel file with some invalid rows. | Valid rows saved; each invalid row reported with its reason; duplicates skipped. | Medium | Functional | `question-import.test.js`, `question-import-parser.test.js` | New |
| TC-QB-04 | CSQP-F-033 | Add a question almost identical to an existing one. | Duplicate warning lists similar questions before saving; instructor can still save. | Medium | Functional | `duplicate-questions.test.js` | New |
| TC-Perf-01 | CSQP-F-040 | Request an individual performance report for a student with completed attempts. | Report reflects all completed attempts grouped by topic. | High | Functional | `analytics-service/tests/` | Original |
| TC-Perf-02 | CSQP-F-041 | Request a class-level report for a quiz. | Class statistics and per-question success rate match a manually computed sample. | Medium | Functional | `analytics-service/tests/` | New |
| TC-Perf-03 | CSQP-F-042 | Open the analytics dashboard as Student and as Instructor. | Charts render correctly for the seeded dataset; no NaN or empty values. | Medium | Functional | `frontend/test/analytics-dashboard.test.mjs` | New |
| TC-Perf-04 | CSQP-F-043 | Export a performance report. | Exported file contains the same figures as the dashboard. | Low | Functional | `frontend/test/analytics-export.test.mjs` | New |
| TC-Collab-01 | CSQP-F-050 | Post a comment on a material; view as another user. | Comment visible to others; profanity and unsafe input rejected; posting rate-limited. | Medium | Functional | `material-comments.test.js`, `material-comment-rate-limit.test.js` | New |
| TC-Collab-02 | CSQP-F-051 | Register, then complete grading of a submission. | Welcome and grading notifications appear for the right user only. | Medium | Functional | `sprint2-security.test.js`, `manual-grading.test.js` | New |
| TC-Collab-03 | CSQP-F-052 | Two students rate a material 5 and 1, then one changes to 3. | Average 3, then 2, count stays 2; one rating per student. | Low | Functional | `material-rating.test.js` | New |
| TC-Perf-NF-01 | CSQP-NF-001 | Load test with 100 virtual users on health, current user and login. | 90th percentile at most 2 s, no failed requests. | High | Non-Functional | `npm run loadtest` | Updated (Node load runner, see D-06) |
| TC-Scale-01 | CSQP-NF-002 | 100 simultaneous requests during a quiz window. | All complete without errors. | High | Non-Functional | `npm run loadtest` | Original |
| TC-Ops-01 | CSQP-NF-003 | Run uptime monitor and review the report. | Availability at least 99% over the observation period. | Medium | Non-Functional | `npm run uptime:report` | New |
| TC-UX-01 | CSQP-NF-004 | Check layout on 3 screen sizes and keyboard navigation. | Usable on desktop and mobile; checklist items met. | Medium | Non-Functional | `responsive-accessibility-checklist.md` (manual) | Original |
| TC-CI-01 | CSQP-NF-005 | Open a pull request to `main`. | CI runs backend tests with coverage at least 70% (lines, statements, functions, branches), frontend lint and build, and analytics tests. | High | Non-Functional | `.github/workflows/ci.yml` | New |
| TC-Sec-01 | CSQP-SR-001 | Send a plain HTTP request in production mode. | Rejected; server requires TLS or a trusted TLS-terminating proxy. | High | Security | `sprint2-security.test.js` | New |
| TC-Sec-02 | CSQP-SR-002 | Register a user, inspect the stored password. | Only a bcrypt hash stored; never returned or logged. | High | Security | `auth-registration.test.js` | Original |
| TC-Sec-03 | CSQP-SR-003 | Use an expired access token, then the refresh flow, then reuse an old refresh token. | Expired token rejected; refresh issues a new token; reused refresh token revoked. | High | Security | `sprint2-security.test.js` | New |
| TC-Sec-04 | CSQP-SR-004 | Call every protected route with a disallowed role. | HTTP 403 on all protected routes. | High | Security | `protected-routes.test.js` | New |
| TC-Sec-05 | CSQP-SR-005 | Send Mongo operator and script payloads; send many login requests quickly. | Payloads rejected; login throttled with rate-limit headers. | High | Security | `sprint2-security.test.js` | New |
