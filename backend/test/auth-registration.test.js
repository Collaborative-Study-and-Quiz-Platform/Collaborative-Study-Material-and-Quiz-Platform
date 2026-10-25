const assert = require("node:assert/strict");
const { after, afterEach, before, test } = require("node:test");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");
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

test("rejects admin self-registration", async () => {
  const response = await register({ role: "admin" });

  assert.equal(response.status, 400);
  assert.equal(response.body.errors.role, "Role must be student or instructor");
  assert.equal(await User.countDocuments(), 0);
});
