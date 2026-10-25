# CSQP Sprint 1 Test Execution Summary

**Project:** Collaborative Study Material and Quiz Platform (CSQP)  
**Execution date:** 2026-10-25  
**Environment:** Linux, Node.js v18.19.1, npm 9.2.0  
**Test type:** Automated backend integration tests  
**Scope:** Implemented issues with verified automated tests only

## Issue #2 — User Registration

**Feature tested:** `POST /api/auth/register` for Student and Instructor account creation, validation, duplicate-email handling, password hashing, and Admin self-registration protection.

| Test case ID | Test case description | Expected result | Actual result | Status |
|---|---|---|---|---|
| TC-REG-01 | `registers a student without returning the password hash` | A valid Student registration returns HTTP 201 with the normalized user profile and no password hash. | Registration returned HTTP 201; role was `student`; the password field was absent from the response. | PASS |
| TC-REG-02 | `registers an instructor and normalizes role and email` | A valid Instructor registration succeeds; role and email are normalized consistently. | Registration returned HTTP 201; role was normalized to `instructor` and email to lowercase. | PASS |
| TC-REG-03 | `rejects missing fields and invalid email` | Missing required fields and malformed email return HTTP 400 with clear validation errors. | Missing fields and invalid email were rejected with HTTP 400 and the expected validation messages. | PASS |
| TC-REG-04 | `rejects duplicate email registrations` | A second registration using an existing email returns HTTP 409 with a duplicate-account message. | Duplicate email registration returned HTTP 409 with the expected error message. | PASS |
| TC-REG-05 | `stores a bcrypt password hash instead of plaintext` | The database stores a bcrypt hash; the plaintext password is not stored. | The stored value differed from the plaintext and bcrypt comparison succeeded. | PASS |
| TC-REG-06 | `rejects admin self-registration` | A registration request with the Admin role is rejected with HTTP 400 and no account is created. | Admin self-registration returned HTTP 400 and created zero users. | PASS |

### Automated execution

**Test file:** `backend/test/auth-registration.test.js`

**Command executed:**

```sh
cd backend
npm test
```

**Execution summary:**

```text
tests 6
pass 6
fail 0
cancelled 0
skipped 0
```

The tests used an in-memory MongoDB instance. The execution completed successfully.

### Manual testing

No manual browser or `curl` tests were executed as part of this report. The results above are automated test results only.

## Other issues

No other GitHub issues are included because no additional issue-specific implementation and automated test coverage were verified in the repository during this execution.
