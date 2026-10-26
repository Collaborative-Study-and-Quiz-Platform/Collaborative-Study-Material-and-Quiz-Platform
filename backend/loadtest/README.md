# Load tests (CSQP-NF-001, CSQP-NF-002)

Run from `backend/`:

    npm run loadtest

Starts the API with an in-memory MongoDB and drives it with 100 virtual users.
Exits with code 1 if any scenario fails.

- NF-001 passes when there are no failed requests and the 90th percentile is <= 2000 ms.
- NF-002 passes when all 100 simultaneous requests succeed.

## Results (developer laptop, API + load generator + test MongoDB on one machine)

| Scenario | Default (4 libuv threads) | UV_THREADPOOL_SIZE=8 |
|---|---|---|
| Health, 100 users, 1 req/s | p90 20 ms, PASS | p90 11 ms, PASS |
| Current user, 100 users, 1 req/s | p90 43 ms, PASS | p90 37 ms, PASS |
| Login, 100 users, 1 login / 10 s | p90 2928 ms, FAIL | p90 560 ms, PASS |
| 100 simultaneous current-user | 0 failures, PASS | 0 failures, PASS |
| 100 simultaneous logins | 0 failures, slowest 12.9 s | 0 failures, slowest 6.9 s |

## Finding

Login hashes passwords with bcrypt (cost 12, required by CSQP-SR-002). bcrypt runs on
Node's libuv thread pool, which has 4 threads by default, so concurrent logins queue.
Raising the pool size removes the bottleneck for the steady-load scenario. Suggested
follow-up for the team: set `UV_THREADPOOL_SIZE` (for example 8) in the deployment
environment, and re-run this test on the deployment hardware.

Results are single runs on one machine and will vary. The login scenario (every user
logging in every 10 s) is deliberately harsher than typical use.

This tests the API only; the "page load" part of NF-001 needs the frontend.