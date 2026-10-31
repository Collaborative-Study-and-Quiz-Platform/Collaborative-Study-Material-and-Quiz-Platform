const assert = require("node:assert/strict");
const { test } = require("node:test");
const jwt = require("jsonwebtoken");
const request = require("supertest");

process.env.JWT_SECRET = "test-only-jwt-secret";

const app = require("../src/app");
const quizId = "64b000000000000000000001";

const protectedRoutes = [
  { method: "get", path: "/api/auth/me", deniedRole: "guest" },
  { method: "post", path: "/api/questions", deniedRole: "student" },
  { method: "get", path: "/api/questions", deniedRole: "student" },
  { method: "get", path: "/api/questions/64b000000000000000000001", deniedRole: "student" },
  { method: "put", path: "/api/questions/64b000000000000000000001", deniedRole: "student" },
  { method: "delete", path: "/api/questions/64b000000000000000000001", deniedRole: "student" },
  { method: "post", path: "/api/materials", deniedRole: "student" },
  { method: "get", path: "/api/materials", deniedRole: "instructor" },
  { method: "post", path: "/api/quizzes", deniedRole: "student" },
  { method: "get", path: "/api/quizzes", deniedRole: "student" },
  { method: "get", path: `/api/quizzes/${quizId}`, deniedRole: "student" },
  { method: "post", path: `/api/quizzes/${quizId}/attempt/start`, deniedRole: "instructor" },
  { method: "get", path: `/api/quizzes/${quizId}/attempt`, deniedRole: "instructor" },
  { method: "get", path: `/api/quizzes/${quizId}/attempt/result`, deniedRole: "instructor" },
  { method: "put", path: `/api/quizzes/${quizId}/attempt/answers`, deniedRole: "instructor" },
  { method: "post", path: `/api/quizzes/${quizId}/attempt`, deniedRole: "instructor" }
];

function tokenFor(role) {
  return jwt.sign(
    { sub: "protected-route-test-user", role },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

test("every protected API route requires authentication and denies disallowed roles", async () => {
  for (const route of protectedRoutes) {
    const unauthenticated = await request(app)[route.method](route.path);
    const forbidden = await request(app)[route.method](route.path)
      .set("Authorization", `Bearer ${tokenFor(route.deniedRole)}`);

    assert.equal(
      unauthenticated.status,
      401,
      `${route.method.toUpperCase()} ${route.path} should require authentication`
    );
    assert.equal(
      forbidden.status,
      403,
      `${route.method.toUpperCase()} ${route.path} should reject ${route.deniedRole}`
    );
  }
});
