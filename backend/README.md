# Backend

Node.js and Express REST API.

Planned feature modules in src/modules: auth, material, quiz, questionBank, analytics-client, collaboration.

## User registration

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

Run the automated registration tests with:

```sh
npm test
```
