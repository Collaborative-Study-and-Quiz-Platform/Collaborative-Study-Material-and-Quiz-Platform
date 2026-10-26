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

Set `JWT_SECRET` to a long, random value and optionally set `JWT_EXPIRES_IN` (default `1h`) in `.env`. See `.env.example`; never commit the real secret.

## User Login

`POST /api/auth/login` accepts:

```json
{
  "email": "ada@example.com",
  "password": "secure-password"
}
```

A successful request returns HTTP `200` with a signed JWT and safe user details. Invalid or unknown credentials return HTTP `401` with the same message. Missing or malformed fields return HTTP `400`. The JWT contains the user ID (`sub`) and role.

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
