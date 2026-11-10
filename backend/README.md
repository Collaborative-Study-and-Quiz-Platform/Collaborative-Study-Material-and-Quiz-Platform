# Backend

Node.js and Express REST API.

Planned feature modules in `src/modules`: auth, material, quiz, questionBank, analytics-client, collaboration.

## User Registration

`POST /api/auth/register` creates a Student or Instructor account.

Request body:

```json
{
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "password": "secure-password",
  "role": "student"
}
```

`role` must be `student` or `instructor` (case-insensitive). Admin accounts are created manually or from seeded data and cannot be self-registered. Emails are normalized to lowercase and passwords are stored only as bcrypt hashes.

A successful request returns HTTP `201` with the created user's `name`, `email`, `role`, and timestamps. The password hash is never returned. Invalid input returns `400`; an existing email returns `409`.

## Running

From `backend/`:

```sh
npm install
npm start
```

Set `MONGODB_URI` in the ignored `.env` file before starting the server.

Set `JWT_SECRET` to a random value of at least 32 bytes in production. Access tokens
expire after 15 minutes by default (`JWT_EXPIRES_IN`, maximum `1h`); refresh tokens
expire after 7 days by default (`JWT_REFRESH_EXPIRES_IN`, maximum `30d`). See
`.env.example`; never commit real secrets.

## User Login

`POST /api/auth/login` accepts:

```json
{
  "email": "ada@example.com",
  "password": "secure-password"
}
```

A successful request returns HTTP `200` with an `accessToken` (also available in
the compatibility `token` field), a refresh token, and safe user details. Invalid
or unknown credentials return HTTP `401` with the same message. Missing or
malformed fields return HTTP `400`. The JWT contains the user ID (`sub`) and role.

`POST /api/auth/refresh` accepts `{ "refreshToken": "<current refresh token>" }`,
marks the token as used, and returns a new access and refresh token. Refresh-token
reuse revokes the token family. `POST /api/auth/logout` accepts the current refresh
token and revokes its family. The database stores only a SHA-256 hash of each
refresh token. Keep tokens out of URLs and logs; clients should retain refresh
tokens only for the active session and send them only to refresh/logout.

Authentication endpoints are rate limited by client IP. Login allows 15 requests
per 15 minutes, registration 20 requests per hour, password reset 10 requests per
15 minutes, and refresh/logout 30 requests per 15 minutes. If deploying multiple
backend replicas, enforce equivalent limits at the shared gateway as well.

## Notifications

Registration and quiz submission create in-app notifications. Users can retrieve
their own notifications with `GET /api/notifications`, filter unread messages with
`?unread=true`, and mark messages read with
`PATCH /api/notifications/:notificationId/read` or `PATCH /api/notifications/read-all`.
The authenticated user's ID is applied server-side, so notification records cannot
be read or changed by another user.

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and
`SMTP_FROM` to enable email delivery. SMTP connections require TLS 1.2 or newer.
In-app notifications remain available when SMTP is not configured; email delivery
failures are logged without losing the in-app notification.

## TLS and availability

In production the server requires TLS 1.2 or newer. For direct TLS termination,
configure both `HTTPS_KEY_FILE` and `HTTPS_CERT_FILE`. Behind a reverse proxy,
configure `TRUST_PROXY_HOPS` to the exact number of trusted proxy hops, and
configure that proxy to accept TLS 1.2+ only and redirect/reject plain HTTP.
Production MongoDB connections also require TLS. HTTPS responses include HSTS.

`GET /api/health/live` reports process liveness. `GET /api/health/ready` (also
`/api/ready`) returns `200` only when MongoDB is connected and `503` otherwise.
Use readiness for an external uptime monitor and configure the probe to check the
deployed URL, not localhost. To record a local JSONL observation log every minute,
run `npm run uptime:monitor` from `backend/`; set `HEALTHCHECK_URL`,
`UPTIME_INTERVAL_MS`, and `UPTIME_LOG_FILE` for deployment. Generate a report with
`npm run uptime:report`. The report only passes the 99% target after it contains
at least 14 days of observations. Store and review the log as part of the operations
record; this code cannot claim availability before the observation period.

All JSON request bodies are limited to 1 MiB, malformed JSON is rejected, and
dangerous Mongo-style keys and active HTML/script payloads are rejected before
route handlers. Route-level validators enforce each endpoint's field and value
constraints. JSON responses are rendered as text in the frontend.

## Current User

`GET /api/auth/me` returns the authenticated user's safe details.

Include the JWT in the request header:

```http
Authorization: Bearer <token>
```

Missing, invalid, or expired tokens return HTTP `401`. The password hash is never returned.

## Role-based access control

Use `authenticateToken` followed by `authorizeRoles` on protected routes:

```js
router.post(
  "/materials",
  authenticateToken,
  authorizeRoles("instructor"),
  createMaterial
);
```

Supported roles are `student`, `instructor`, and `admin`. `authorizeRoles` reads the role from the verified JWT context (`req.user`) and returns HTTP `403` for forbidden or invalid roles/configurations. Client-supplied body, query, or header roles are ignored. Admin accounts are assigned manually or through seeded data; self-registration remains restricted to Student and Instructor.

Create the initial Admin account through the seed command, not the public registration endpoint:

```sh
ADMIN_NAME="Platform Administrator" \
ADMIN_EMAIL="admin@example.com" \
ADMIN_PASSWORD="use-a-long-random-password" \
npm run seed:admin
```

The command normalizes the email, hashes the password with bcrypt, and refuses to replace an existing non-admin account. Keep these values in the ignored `.env` file or provide them through a secret-management system; never commit them.

## Tests

Run the automated registration and authentication tests from `backend/`:

```sh
npm test
```

## Question Bank

All `/api/questions` routes need a JWT for an Instructor or Admin. Students get HTTP `403` and requests without a token get HTTP `401`.

`POST /api/questions` adds a question:

```json
{
  "text": "Which protocol is used to send email?",
  "type": "mcq",
  "options": ["SMTP", "FTP", "HTTP", "SSH"],
  "correctAnswer": "SMTP",
  "subject": "Computer Networks",
  "topic": "Application Layer",
  "difficulty": "easy"
}
```

`type` is `mcq`, `true_false`, or `short_answer`, and `difficulty` is `easy`, `medium`, or `hard` (both case-insensitive). MCQ questions need 2 to 6 unique options, and `correctAnswer` must match one of them. True/False questions need `correctAnswer` set to `true` or `false` and take no options. Short-answer questions may include an optional model answer in `correctAnswer`. A successful request returns HTTP `201` with the saved question; invalid input returns `400`.

`GET /api/questions` lists questions, newest first. Filter with any of `subject`, `topic`, `difficulty`, and `type`, for example `/api/questions?subject=Computer%20Networks&difficulty=easy`. Subject and topic match case-insensitively. Invalid `difficulty` or `type` values return `400`.

`GET /api/questions/:id` returns one question, or `404` if it does not exist or was deleted.

`PUT /api/questions/:id` edits a question. Send only the fields to change; the rest keep their current values. Changing a question away from `mcq` clears its options.

`DELETE /api/questions/:id` soft-deletes a question. It disappears from the bank but stays in the database so existing quizzes are not affected.

Only the Instructor who created a question, or an Admin, can edit or delete it. Other Instructors get `403`.

### Search, filters and tags

Questions can carry up to 10 optional `tags` (each up to 30 characters), sent as a list or as comma-separated text, for example `"tcp, reliability"`. Tags are saved trimmed, in lower case, and without repeats. Bulk imports accept an optional `tags` column in the same format.

`GET /api/questions` also accepts `q` (words that must all appear in the question text, ignoring case) and `tag` (one or more comma-separated tags, all required). Every filter given must match (CSQP-F-031), so `/api/questions?q=handshake&tag=tcp&difficulty=hard` returns only hard questions tagged `tcp` whose text contains "handshake". Search text over 100 characters, or a repeated `q` or `tag` parameter, returns `400`.

`GET /api/questions/tags` lists the tags in use with how many questions have each, most used first, for suggestions.

## Study material upload

`POST /api/materials` accepts a `multipart/form-data` request with a `file` field and
the required `course`, `subject`, and `topic` tag fields. Only authenticated users
with the `instructor` role can upload; requests from students and admins return `403`,
and requests without a valid JWT return `401`.

Only PDF, DOCX, and legacy PPT files are accepted. The default maximum file size is
10 MiB (`MATERIAL_MAX_FILE_SIZE_BYTES=10485760`). Files are stored with generated
names in `MATERIAL_UPLOAD_DIR` (default `./uploads/materials`) and their metadata,
tags, and uploader ID are persisted in MongoDB. The upload directory should remain
outside source control.

The backend is authoritative for the configured file-size limit; the frontend
submits files to the API and displays the server validation response.

## Quizzes

All `/api/quizzes` routes need a JWT for an Instructor or Admin. Students get HTTP `403` and requests without a token get HTTP `401`.

`POST /api/quizzes` creates a quiz:

```json
{
  "title": "Networks Quiz 1",
  "description": "Covers the application and transport layers.",
  "durationMinutes": 30,
  "passingScore": 60,
  "showAnswers": true,
  "questions": [
    { "questionId": "<id of a question bank question>", "marks": 2 },
    {
      "question": {
        "text": "Explain the three-way handshake.",
        "type": "short_answer",
        "subject": "Computer Networks",
        "topic": "Transport Layer",
        "difficulty": "hard"
      },
      "marks": 5
    }
  ]
}
```

`durationMinutes` is a whole number from 1 to 600, and `passingScore` is a percentage from 0 to 100. `description` and `showAnswers` are optional; `showAnswers` defaults to `false` and controls whether students may later see the correct answers. A quiz has 1 to 100 questions. Each entry either uses an existing question bank question with `questionId`, or describes a new question in `question` using the same fields as `POST /api/questions`; new questions are also added to the question bank. `marks` is a whole number from 1 to 100 and defaults to 1. A successful request returns HTTP `201` with the quiz and its `totalMarks`; invalid input returns `400` with an error for each problem, for example `questions.1.question.options`.

The quiz stores its own copy of every question, so editing or deleting a question in the bank later does not change existing quizzes.

`GET /api/quizzes` lists quizzes, newest first. Instructors see the quizzes they created and Admins see all quizzes.

`GET /api/quizzes/:id` returns one quiz. Other Instructors get `403`, and an unknown ID returns `404`.

## Quiz Attempts

All `/api/quizzes/:quizId/attempt` routes need a JWT for a Student. Instructors and Admins get HTTP `403` and requests without a token get HTTP `401`. Each student has one attempt per quiz.

`POST /api/quizzes/:quizId/attempt/start` starts the timer and returns HTTP `201` with the attempt: its `expiresAt` deadline, `remainingSeconds`, and the questions without their correct answers. Calling it again while the attempt is in progress returns HTTP `200` with the same attempt and deadline, so refreshing the page never resets the timer.

`PUT /api/quizzes/:quizId/attempt/answers` saves answers during the attempt:

```json
{
  "answers": [
    { "questionId": "<quiz question _id>", "response": "SMTP" },
    { "questionId": "<quiz question _id>", "response": true }
  ]
}
```

Only the answers sent are changed, and a `null` or empty `response` clears that answer. MCQ responses must match one of the options, True/False responses must be `true` or `false`, and short-answer responses are text of up to 5000 characters. Invalid answers return HTTP `422` with an error for each problem.

`POST /api/quizzes/:quizId/attempt` submits the attempt. It accepts the same optional `answers` list as above, applied before submitting, and returns the attempt with `status` set to `submitted`.

`GET /api/quizzes/:quizId/attempt` returns the attempt and its status: `in_progress`, `submitted`, or `auto_submitted`.

The frontend shows the countdown from `expiresAt`, and the server enforces it. Once the deadline has passed by more than 30 seconds, the attempt is submitted automatically with every answer saved before the deadline, even if the browser never submits. Later saves or submits return HTTP `409`, as does starting a quiz that was already submitted.

## Automatic Grading

When an attempt is submitted, or auto-submitted at time-out, its MCQ and True/False questions are graded straight away against the quiz's own copy of the answer key. MCQ answers must match the correct option exactly (surrounding spaces are ignored), and True/False answers ignore case. A correct answer earns the question's full marks; a wrong or unanswered one earns `0`.

The submit response and `GET /api/quizzes/:quizId/attempt` then include the score summary:

```json
{
  "score": 6,
  "maxScore": 8,
  "percentage": 75,
  "passed": true,
  "gradingStatus": "complete",
  "pendingMarks": 0,
  "gradedAt": "2026-10-27T10:15:00.000Z",
  "totalQuestions": 3
}
```

`percentage` is rounded to two decimal places, and a score equal to the quiz's `passingScore` passes. Short-answer questions are not auto-graded: their marks are reported in `pendingMarks`, `gradingStatus` is `pending_manual`, and `passed` stays `null` until an Instructor grades them. The per-question results are stored with the attempt but not returned to students here, so the answer key stays hidden.

## Quiz Results

`GET /api/quizzes/:quizId/attempt/result` shows a Student their own result once the attempt is submitted or auto-submitted. It needs a Student JWT; Instructors and Admins get HTTP `403`. While the attempt is still in progress it returns HTTP `409`, and if the student never started the quiz it returns `404`.

The result always includes the score: `score`, `maxScore`, `percentage`, `passingScore`, `passed`, `gradingStatus`, `pendingMarks`, `totalQuestions`, `answeredCount`, `correctCount`, `submittedAt`, and `gradedAt`.

The answer review depends on the quiz's `showAnswers` setting, chosen by the Instructor when creating the quiz. When it is `true`, `answersVisible` is `true` and `review` lists every question with its `text`, `type`, `options`, the student's `yourResponse` (`null` if unanswered), the `correctAnswer`, `isCorrect`, `marksAwarded`, and `maxMarks`. Short-answer questions show `isCorrect` and `marksAwarded` as `null` until they are graded manually. When `showAnswers` is `false`, `answersVisible` is `false` and no review or answer key is returned.

## Available Quizzes

`GET /api/quizzes/available` lists the quizzes a Student can take, newest first. It needs a Student JWT; Instructors and Admins get HTTP `403` and use `GET /api/quizzes` instead. Each quiz includes its `title`, `description`, `durationMinutes`, `passingScore`, `totalMarks`, `questionCount`, and the `subjects` and `topics` of its questions, but never the questions or answers themselves.

Each quiz also includes the student's own `attempt`, or `null` if they have not started it. The attempt shows its `status` (`in_progress`, `submitted`, or `auto_submitted`) and timing, plus `score`, `maxScore`, `percentage`, `passed`, and `gradingStatus` once it is graded. An attempt whose time ran out is auto-submitted when the list is loaded.

For now every quiz is listed. CSQP-F-021 (Schedule Quiz) will limit the list to quizzes inside their scheduled window.

## Quiz Scheduling

A quiz can be given a window with `availableFrom` and `availableUntil` (ISO date-times). Students can only start the quiz inside that window (CSQP-F-021). A quiz without a window is a draft and is hidden from students.

Set the window when creating the quiz by adding both fields to `POST /api/quizzes`, or later with `PUT /api/quizzes/:id/schedule`:

```json
{
  "availableFrom": "2026-11-12T09:00:00.000Z",
  "availableUntil": "2026-11-12T11:00:00.000Z"
}
```

Send both fields as `null` to remove the schedule. Both times must be given together, the end must be after the start and in the future, and the window must be at least as long as the quiz duration; otherwise the request returns HTTP `400`. Only the Instructor who created the quiz, or an Admin, can schedule it; others get `403`. Instructor quiz responses include `scheduleStatus`: `unscheduled`, `upcoming`, `open`, or `closed`.

For students, `POST /api/quizzes/:quizId/attempt/start` returns HTTP `409` before the start time, after the end time, or when the quiz is not scheduled, with the window in `availableFrom` and `availableUntil`. An attempt's deadline is the earlier of its timer and the window's end, so no attempt runs past closing time. `GET /api/quizzes/available` lists open and upcoming quizzes, each with its window and `scheduleStatus`, plus any quiz the student has already attempted so its result stays reachable.

## Manual Grading

Short-answer questions are graded by hand (CSQP-F-024). These routes need a JWT for the Instructor who created the quiz, or an Admin; other users get HTTP `403`.

`GET /api/quizzes/:quizId/submissions` lists every attempt with the student's name and email, its status, score, and `pendingQuestions` still to grade, plus a count of submissions `awaitingGrading`. Attempts whose time ran out are auto-submitted first.

`GET /api/quizzes/:quizId/submissions/:attemptId` shows one submission: every question with the student's response, the correct or model answer, and the marks awarded so far.

`PUT /api/quizzes/:quizId/submissions/:attemptId/grades` saves marks for short answers:

```json
{
  "grades": [
    { "questionId": "<quiz question _id>", "marks": 1.5, "feedback": "Good, but name the flags." }
  ]
}
```

`marks` is a number from 0 to the question's marks, in steps of 0.5, and `feedback` is optional text of up to 1000 characters. Only short-answer questions can be graded this way; invalid grades return HTTP `422`, and an attempt still in progress returns `409`. The attempt's `score`, `percentage`, `pendingMarks`, `gradingStatus`, and `passed` are recalculated from all question marks, so manual marks are added to the auto-graded score. Marks can be changed later. When the last short answer is graded the student gets a notification, and their result (`GET /api/quizzes/:quizId/attempt/result`) shows the new score, with each short answer's marks and feedback in the answer review when answers are visible.

## Export Quiz Results

`GET /api/quizzes/:quizId/submissions/export` downloads every attempt at a quiz as a CSV file (CSQP-F-026), for the Instructor who created the quiz or an Admin; others get HTTP `403`. The file is named after the quiz and the date, for example `transport-layer-quiz-results-2026-11-10.csv`.

The first row holds the column names and each further row is one student attempt, oldest first: `Student name`, `Student email`, `Status`, `Started at`, `Submitted at` (ISO timestamps), `Score`, `Max score`, `Percentage`, `Passed` (`Yes`, `No`, or `Pending` while short answers wait for grading), `Grading status`, `Pending marks`, and the marks for each question (`Q1 marks (out of 2)`, and so on). Attempts still in progress have an empty score, and attempts whose time ran out are auto-submitted before export.

Values containing commas, quotes, or line breaks are quoted, and text starting with `=`, `+`, `-`, or `@` is prefixed with `'` so spreadsheet apps do not run it as a formula. The file starts with a UTF-8 byte order mark so Excel shows names correctly.

## Duplicate Question Detection

Adding a question that is near-identical to one already in the bank returns a duplicate warning before anything is saved (CSQP-F-033). Question texts are compared after lower-casing and removing punctuation, accents, and extra spaces, using a basic string-similarity score (the Sorensen-Dice coefficient over pairs of characters). A score of 85% or more counts as a likely duplicate. Questions by every Instructor are checked, since the bank is shared; deleted questions are not.

`POST /api/questions` and `PUT /api/questions/:id` (when the text changes) then return HTTP `409` with `code: "DUPLICATE_QUESTION"` and up to five `duplicates`, most similar first, each with its `_id`, `text`, `subject`, `topic`, and `similarity` percentage. To save anyway, send the same request again with `"allowDuplicate": true`.

`POST /api/questions/check-duplicates` with `{ "text": "...", "excludeId": "<optional question id>" }` runs the same check without saving and returns `hasDuplicates` and `duplicates`. The quiz builder uses it before adding a newly written question, and offers to use the existing bank question instead.
