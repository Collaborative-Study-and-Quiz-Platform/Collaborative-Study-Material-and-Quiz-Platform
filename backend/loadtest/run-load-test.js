"use strict";

// Load tests for CSQP-NF-001 (response time) and CSQP-NF-002 (concurrent users).
//
// Run from the backend folder with:  npm run loadtest
//
// It starts the API on a random local port with an in-memory MongoDB (the same
// one the unit tests use), creates one test user, then drives the API with 100
// virtual users and prints a PASS/FAIL table. No real database is touched.

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { burstLoad, steadyLoad } = require("./loadRunner");

const CONCURRENT_USERS = 100;
const MAX_P90_MS = 2000; // CSQP-NF-001: 90% of responses within 2 seconds
const TEST_EMAIL = "loadtest@example.com";
const TEST_PASSWORD = "load-test-password";

function buildScenarios(baseUrl, token) {
  const jsonHeaders = { "Content-Type": "application/json" };
  const loginRequest = () => ({
    url: `${baseUrl}/api/auth/login`,
    options: {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD })
    }
  });
  const currentUserRequest = () => ({
    url: `${baseUrl}/api/auth/me`,
    options: { method: "GET", headers: { Authorization: `Bearer ${token}` } }
  });
  const healthRequest = () => ({
    url: `${baseUrl}/api/health`,
    options: { method: "GET" }
  });

  return [
    {
      requirement: "NF-001",
      name: "Health check, 100 users, 1 request/s each",
      run: () => steadyLoad({
        users: CONCURRENT_USERS,
        durationMs: 10000,
        thinkTimeMs: 1000,
        buildRequest: healthRequest
      }),
      passes: (summary) => summary.failed === 0 && summary.p90 <= MAX_P90_MS
    },
    {
      requirement: "NF-001",
      name: "Current user (JWT + DB read), 100 users, 1 request/s each",
      run: () => steadyLoad({
        users: CONCURRENT_USERS,
        durationMs: 10000,
        thinkTimeMs: 1000,
        buildRequest: currentUserRequest
      }),
      passes: (summary) => summary.failed === 0 && summary.p90 <= MAX_P90_MS
    },
    {
      requirement: "NF-001",
      name: "Login (bcrypt + DB read), 100 users, 1 login per 10 s each",
      run: () => steadyLoad({
        users: CONCURRENT_USERS,
        durationMs: 20000,
        thinkTimeMs: 10000,
        buildRequest: loginRequest
      }),
      passes: (summary) => summary.failed === 0 && summary.p90 <= MAX_P90_MS
    },
    {
      requirement: "NF-002",
      name: "Burst: 100 simultaneous current-user requests",
      run: () => burstLoad({
        users: CONCURRENT_USERS,
        buildRequest: currentUserRequest
      }),
      passes: (summary) => summary.failed === 0
    },
    {
      requirement: "NF-002",
      name: "Burst: 100 simultaneous logins",
      run: () => burstLoad({
        users: CONCURRENT_USERS,
        buildRequest: loginRequest
      }),
      passes: (summary) => summary.failed === 0
    }
  ];
}

async function runScenarios(baseUrl, token) {
  const outcomes = [];

  for (const scenario of buildScenarios(baseUrl, token)) {
    console.log(`Running: ${scenario.name} ...`);
    const summary = await scenario.run();
    outcomes.push({ scenario, summary, passed: scenario.passes(summary) });
  }

  return outcomes;
}

function printReport(outcomes) {
  const ms = (value) => `${Math.round(value)}`;

  console.log("\nResults (times in milliseconds)\n");
  console.log("| Req | Scenario | Requests | Failed | p50 | p90 | p99 | Max | Result |");
  console.log("|---|---|---|---|---|---|---|---|---|");

  for (const { scenario, summary, passed } of outcomes) {
    console.log(
      `| ${scenario.requirement} | ${scenario.name} | ${summary.requests} | ` +
      `${summary.failed} | ${ms(summary.p50)} | ${ms(summary.p90)} | ` +
      `${ms(summary.p99)} | ${ms(summary.max)} | ${passed ? "PASS" : "FAIL"} |`
    );
  }

  console.log(
    `\nNF-001 passes when there are no failed requests and p90 <= ${MAX_P90_MS} ms.` +
    "\nNF-002 passes when all 100 simultaneous requests succeed (latency is reported for information)."
  );

  for (const { scenario, summary } of outcomes) {
    if (summary.firstFailure) {
      console.log(`First failure in "${scenario.name}": ${summary.firstFailure}`);
    }
  }
}

async function main() {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "load-test-secret";

  const app = require("../src/app");
  const User = require("../src/models/User");
  const { getJwtConfig } = require("../src/config/auth");

  const mongoServer = await MongoMemoryServer.create();
  let server;

  try {
    await mongoose.connect(mongoServer.getUri());
    await User.init();

    const user = await User.create({
      name: "Load Test User",
      email: TEST_EMAIL,
      password: await bcrypt.hash(TEST_PASSWORD, 12),
      role: "student"
    });
    const { secret, expiresIn } = getJwtConfig();
    const token = jwt.sign(
      { sub: user._id.toString(), role: user.role },
      secret,
      { expiresIn }
    );

    server = await new Promise((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const outcomes = await runScenarios(baseUrl, token);
    printReport(outcomes);

    if (outcomes.some((outcome) => !outcome.passed)) {
      process.exitCode = 1;
    }
  } finally {
    if (server) {
      server.close();
    }
    await mongoose.disconnect();
    await mongoServer.stop();
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(process.exitCode || 0))
    .catch((error) => {
      console.error("Load test could not run:", error);
      process.exit(1);
    });
}

module.exports = { buildScenarios, printReport, runScenarios };