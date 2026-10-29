
const assert = require("node:assert/strict");
const { after, afterEach, before, test } = require("node:test");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");
const nodemailer = require("nodemailer");

process.env.JWT_SECRET = "test-only-jwt-secret";
process.env.JWT_EXPIRES_IN = "1h";

const app = require("../src/app");
const User = require("../src/models/User");
const PasswordResetToken = require("../src/models/PasswordResetToken");

let mongoServer;
let originalCreateTransport;

before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await User.init();
  await PasswordResetToken.init();

  // Prevent real emails during tests.
  originalCreateTransport = nodemailer.createTransport;
  nodemailer.createTransport = () => ({
    sendMail: async (message) => {
      global.lastResetEmail = message;
      return { messageId: "test-message" };
    }
  });

  process.env.FRONTEND_URL = "http://localhost:5173";
  process.env.SMTP_HOST = "smtp.test.local";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_SECURE = "false";
  process.env.SMTP_USER = "test-user";
  process.env.SMTP_PASS = "test-password";
  process.env.SMTP_FROM = "noreply@example.com";
});

after(async () => {
  nodemailer.createTransport = originalCreateTransport;
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await User.deleteMany({});
  await PasswordResetToken.deleteMany({});
  global.lastResetEmail = undefined;
});

async function createUser() {
  return User.create({
    name: "Password Reset Test",
    email: "reset@example.com",
    password: "old-password",
    role: "student"
  });
}

test("forgot password rejects a missing email", async () => {
  const response = await request(app)
    .post("/api/auth/forgot-password")
    .send({});

  assert.equal(response.status, 400);
});

test("forgot password returns a generic response for an unknown email", async () => {
  const response = await request(app)
    .post("/api/auth/forgot-password")
    .send({ email: "unknown@example.com" });

  assert.equal(response.status, 200);
  assert.match(response.body.message, /If an account exists/i);
  assert.equal(global.lastResetEmail, undefined);
});

test("forgot password creates a token and sends an email", async () => {
  await createUser();

  const response = await request(app)
    .post("/api/auth/forgot-password")
    .send({ email: "RESET@example.com" });

  assert.equal(response.status, 200);
  assert.ok(global.lastResetEmail);
  assert.equal(global.lastResetEmail.to, "reset@example.com");
  assert.match(global.lastResetEmail.text, /localhost:5173\/reset-password\?token=/);

  const tokenMatch = global.lastResetEmail.text.match(/[?&]token=([a-f0-9]+)/);
  assert.ok(tokenMatch, "Email should contain a reset token");

  const rawToken = tokenMatch[1];
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const record = await PasswordResetToken.findOne({ tokenHash });
  assert.ok(record);
  assert.ok(record.expiresAt > new Date());
  assert.ok(record.expiresAt <= new Date(Date.now() + 31 * 60 * 1000));
});

test("reset password rejects an invalid token", async () => {
  const response = await request(app)
    .post("/api/auth/reset-password")
    .send({
      token: "invalid-token",
      newPassword: "new-secure-password"
    });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /invalid, expired, or already used/i);
});

test("reset password rejects an expired token", async () => {
  const user = await createUser();
  const tokenHash = crypto.createHash("sha256").update("expired-token").digest("hex");

  await PasswordResetToken.create({
    userId: user._id,
    tokenHash,
    expiresAt: new Date(Date.now() - 60_000)
  });

  const response = await request(app)
    .post("/api/auth/reset-password")
    .send({
      token: "expired-token",
      newPassword: "new-secure-password"
    });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /invalid, expired, or already used/i);
});

test("reset password updates the password and prevents token reuse", async () => {
  const user = await createUser();
  const rawToken = "valid-reset-token";
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  await PasswordResetToken.create({
    userId: user._id,
    tokenHash,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000)
  });

  const response = await request(app)
    .post("/api/auth/reset-password")
    .send({
      token: rawToken,
      newPassword: "new-secure-password"
    });

  assert.equal(response.status, 200);
  assert.match(response.body.message, /Password reset successfully/i);

  const updatedUser = await User.findById(user._id).select("+password");
  const bcrypt = require("bcrypt");

  assert.equal(
    await bcrypt.compare("new-secure-password", updatedUser.password),
    true
  );

  const reusedResponse = await request(app)
    .post("/api/auth/reset-password")
    .send({
      token: rawToken,
      newPassword: "another-secure-password"
    });

  assert.equal(reusedResponse.status, 400);
});
