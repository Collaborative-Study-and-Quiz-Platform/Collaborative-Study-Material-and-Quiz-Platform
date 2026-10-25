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

## Tests

Run the automated registration and authentication tests from `backend/`:

```sh
npm test
```
