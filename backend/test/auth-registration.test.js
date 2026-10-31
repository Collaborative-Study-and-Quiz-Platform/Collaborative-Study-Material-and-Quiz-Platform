const assert = require("node:assert/strict");
const { after, afterEach, before, test } = require("node:test");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const express = require("express");
const request = require("supertest");
const authenticateToken = require("../src/middleware/authenticateToken");
const authorizeRoles = require("../src/middleware/authorizeRoles");
const { createAdminAccount } = require("../src/scripts/seedAdmin");
process.env.JWT_SECRET = "test-only-jwt-secret";
process.env.JWT_EXPIRES_IN = "1h";
const app = require("../src/app");
const User = require("../src/models/User");

let mongoServer;

async function register(overrides = {}) {
  return request(app).post("/api/auth/register").send({
    name: "Test User",
    email: "test@example.com",
    password: "secure-password",
    role: "student",
    ...overrides
  });
}

async function login(overrides = {}) {
  return request(app).post("/api/auth/login").send({
    email: "test@example.com",
    password: "secure-password",
    ...overrides
  });
}

function createRoleProtectedApp() {
  const roleApp = express();
  roleApp.use(express.json());
  roleApp.get(
    "/student",
    authenticateToken,
    authorizeRoles("student"),
    (req, res) => res.json({ user: req.user })
  );
  roleApp.get(
    "/instructor",
    authenticateToken,
    authorizeRoles("instructor"),
    (req, res) => res.json({ user: req.user })
  );
  roleApp.get(
    "/admin",
    authenticateToken,
    authorizeRoles("admin"),
    (req, res) => res.json({ user: req.user })
  );
  roleApp.get(
    "/invalid-configuration",
    authenticateToken,
    authorizeRoles("owner"),
    (req, res) => res.json({ user: req.user })
  );
  return roleApp;
}

function tokenFor(role, overrides = {}) {
  return jwt.sign(
    {
      sub: `${role}-user`,
      role,
      ...overrides
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await User.init();
});

after(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await User.deleteMany({});
});

test("registers a student without returning the password hash", async () => {
  const response = await register();

  assert.equal(response.status, 201);
  assert.equal(response.body.user.role, "student");
  assert.equal(response.body.user.email, "test@example.com");
  assert.equal(response.body.user.password, undefined);
});

test("registers an instructor and normalizes role and email", async () => {
  const response = await register({
    email: " Instructor@Example.COM ",
    role: "INSTRUCTOR"
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.user.role, "instructor");
  assert.equal(response.body.user.email, "instructor@example.com");
});

test("rejects missing fields and invalid email", async () => {
  const missingFields = await request(app)
    .post("/api/auth/register")
    .send({});
  const invalidEmail = await register({ email: "not-an-email" });

  assert.equal(missingFields.status, 400);
  assert.equal(missingFields.body.errors.name, "Name is required");
  assert.equal(invalidEmail.status, 400);
  assert.equal(invalidEmail.body.errors.email, "Email must be a valid email address");
});

test("rejects duplicate email registrations", async () => {
  await register();
  const response = await register({ name: "Another User" });

  assert.equal(response.status, 409);
  assert.equal(response.body.message, "An account with this email already exists");
});

test("stores a bcrypt password hash instead of plaintext", async () => {
  await register({ password: "secure-password" });
  const user = await User.findOne({ email: "test@example.com" }).select("+password");

  assert.notEqual(user.password, "secure-password");
  assert.equal(await bcrypt.compare("secure-password", user.password), true);
});

test("hashes passwords written directly through the user model", async () => {
  const user = await User.create({
    name: "Model User",
    email: "model@example.com",
    password: "model-password",
    role: "student"
  });
  const storedUser = await User.findById(user._id).select("+password");

  assert.notEqual(storedUser.password, "model-password");
  assert.equal(await bcrypt.compare("model-password", storedUser.password), true);
});

test("rejects admin self-registration", async () => {
  const response = await register({ role: "admin" });

  assert.equal(response.status, 400);
  assert.equal(response.body.errors.role, "Role must be student or instructor");
  assert.equal(await User.countDocuments(), 0);
});

test("creates an admin only through the authorized seed process", async () => {
  const admin = await createAdminAccount({
    name: "Platform Administrator",
    email: " Admin@Example.COM ",
    password: "admin-password"
  });
  const storedAdmin = await User.findOne({
    email: "admin@example.com"
  }).select("+password");

  assert.equal(admin.role, "admin");
  assert.equal(storedAdmin.role, "admin");
  assert.notEqual(storedAdmin.password, "admin-password");
  assert.equal(await bcrypt.compare("admin-password", storedAdmin.password), true);
});

test("logs in with valid credentials and returns safe user details", async () => {
  await register();
  const response = await login();

  assert.equal(response.status, 200);
  assert.equal(response.body.user.email, "test@example.com");
  assert.equal(response.body.user.password, undefined);
  assert.equal(typeof response.body.token, "string");
});

test("rejects an incorrect password with a generic authentication error", async () => {
  await register();
  const response = await login({ password: "wrong-password" });

  assert.equal(response.status, 401);
  assert.equal(response.body.message, "Invalid email or password");
});

test("rejects an unknown email without revealing account existence", async () => {
  const response = await login({ email: "unknown@example.com" });

  assert.equal(response.status, 401);
  assert.equal(response.body.message, "Invalid email or password");
});

test("rejects missing or malformed login inputs", async () => {
  const missingInputs = await request(app).post("/api/auth/login").send({});
  const malformedEmail = await login({ email: "not-an-email" });

  assert.equal(missingInputs.status, 400);
  assert.equal(missingInputs.body.errors.email, "Email is required");
  assert.equal(missingInputs.body.errors.password, "Password is required");
  assert.equal(malformedEmail.status, 400);
  assert.equal(
    malformedEmail.body.errors.email,
    "Email must be a valid email address"
  );
});

test("signs a verifiable JWT containing only the user id and role", async () => {
  await register({ role: "instructor" });
  const response = await login();
  const payload = jwt.verify(response.body.token, process.env.JWT_SECRET);

  assert.equal(payload.sub, (await User.findOne({ email: "test@example.com" }))._id.toString());
  assert.equal(payload.role, "instructor");
  assert.equal(payload.password, undefined);
  assert.equal(payload.iat !== undefined, true);
  assert.equal(payload.exp !== undefined, true);
});

test("does not expose password data in the login response", async () => {
  await register();
  const response = await login();
  const responseText = JSON.stringify(response.body);

  assert.equal(responseText.includes("secure-password"), false);
  assert.equal(responseText.includes("$2b$"), false);
  assert.equal(response.body.user.password, undefined);
});

test("rejects requests to the current-user route without a token", async () => {
  const response = await request(app).get("/api/auth/me");

  assert.equal(response.status, 401);
  assert.equal(response.body.message, "Authentication required");
});

test("rejects requests to the current-user route with an invalid token", async () => {
  const response = await request(app)
    .get("/api/auth/me")
    .set("Authorization", "Bearer invalid-token");

  assert.equal(response.status, 401);
  assert.equal(response.body.message, "Invalid or expired token");
});

test("returns the authenticated user's safe details", async () => {
  await register({ role: "instructor" });
  const loginResponse = await login();

  const response = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${loginResponse.body.token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "success");
  assert.equal(response.body.user.email, "test@example.com");
  assert.equal(response.body.user.role, "instructor");
  assert.equal(response.body.user.password, undefined);
});

test("rejects unauthenticated role-protected requests with 401", async () => {
  const response = await request(createRoleProtectedApp()).get("/student");

  assert.equal(response.status, 401);
});

test("allows a student to access a student-permitted route", async () => {
  const response = await request(createRoleProtectedApp())
    .get("/student")
    .set("Authorization", `Bearer ${tokenFor("student")}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.user.role, "student");
});

test("allows an instructor to access an instructor-permitted route", async () => {
  const response = await request(createRoleProtectedApp())
    .get("/instructor")
    .set("Authorization", `Bearer ${tokenFor("instructor")}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.user.role, "instructor");
});

test("allows an admin to access an admin-permitted route", async () => {
  const response = await request(createRoleProtectedApp())
    .get("/admin")
    .set("Authorization", `Bearer ${tokenFor("admin")}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.user.role, "admin");
});

test("rejects students and instructors from admin-only routes with 403", async () => {
  const roleApp = createRoleProtectedApp();
  const studentResponse = await request(roleApp)
    .get("/admin")
    .set("Authorization", `Bearer ${tokenFor("student")}`);
  const instructorResponse = await request(roleApp)
    .get("/admin")
    .set("Authorization", `Bearer ${tokenFor("instructor")}`);

  assert.equal(studentResponse.status, 403);
  assert.equal(instructorResponse.status, 403);
});

test("rejects students from instructor-only routes with 403", async () => {
  const response = await request(createRoleProtectedApp())
    .get("/instructor")
    .set("Authorization", `Bearer ${tokenFor("student")}`);

  assert.equal(response.status, 403);
});

test("rejects authenticated users with missing or invalid roles", async () => {
  const roleApp = createRoleProtectedApp();
  const missingRoleResponse = await request(roleApp)
    .get("/student")
    .set("Authorization", `Bearer ${tokenFor(undefined, { role: undefined })}`);
  const invalidRoleResponse = await request(roleApp)
    .get("/student")
    .set("Authorization", `Bearer ${tokenFor("moderator")}`);

  assert.equal(missingRoleResponse.status, 403);
  assert.equal(invalidRoleResponse.status, 403);
});

test("fails closed when a route has an invalid role configuration", async () => {
  const response = await request(createRoleProtectedApp())
    .get("/invalid-configuration")
    .set("Authorization", `Bearer ${tokenFor("student")}`);

  assert.equal(response.status, 403);
});

test("does not trust a client-supplied role header or request body", async () => {
  const response = await request(createRoleProtectedApp())
    .get("/admin")
    .set("Authorization", `Bearer ${tokenFor("student")}`)
    .set("X-Role", "admin")
    .send({ role: "admin" });

  assert.equal(response.status, 403);
});
