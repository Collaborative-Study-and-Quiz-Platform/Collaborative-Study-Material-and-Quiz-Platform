const assert = require("node:assert/strict");
const { after, afterEach, before, test } = require("node:test");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

process.env.JWT_SECRET = "test-only-jwt-secret-with-enough-bytes";
process.env.JWT_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "7d";
process.env.SMTP_HOST = "smtp.test.local";
process.env.SMTP_PORT = "587";
process.env.SMTP_SECURE = "false";
process.env.SMTP_USER = "test-user";
process.env.SMTP_PASS = "test-password";
process.env.SMTP_FROM = "notifications@example.com";
delete process.env.TRUST_PROXY_HOPS;
delete process.env.HTTPS_KEY_FILE;
delete process.env.HTTPS_CERT_FILE;

const app = require("../src/app");
const Notification = require("../src/models/Notification");
const RefreshToken = require("../src/models/RefreshToken");
const User = require("../src/models/User");
const { createRateLimiter } = require("../src/middleware/rateLimit");
const requireSecureTransport = require("../src/middleware/requireSecureTransport");
const { createHttpServer } = require("../src/server");

let mongoServer;
let originalCreateTransport;
const sentEmails = [];

async function register(email = "student@example.com") {
  return request(app).post("/api/auth/register").send({
    name: "Test Student",
    email,
    password: "secure-password",
    role: "student"
  });
}

async function login(email = "student@example.com") {
  return request(app).post("/api/auth/login").send({
    email,
    password: "secure-password"
  });
}

before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([User.init(), Notification.init(), RefreshToken.init()]);
  originalCreateTransport = nodemailer.createTransport;
  nodemailer.createTransport = () => ({
    sendMail: async (message) => {
      sentEmails.push(message);
      return { messageId: "test-message" };
    }
  });
});

after(async () => {
  nodemailer.createTransport = originalCreateTransport;
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  sentEmails.length = 0;
  await Promise.all([
    User.deleteMany({}),
    Notification.deleteMany({}),
    RefreshToken.deleteMany({})
  ]);
});

test("registration creates an in-app welcome notification and sends email", async () => {
  const response = await register();

  assert.equal(response.status, 201);
  const notification = await Notification.findOne({ userId: response.body.user._id });
  assert.equal(notification.type, "welcome");
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, "student@example.com");
});

test("users can only list and mark their own notifications", async () => {
  const firstUser = await register();
  const firstSession = await login();
  await register("other@example.com");
  const otherSession = await login("other@example.com");

  const ownList = await request(app)
    .get("/api/notifications")
    .set("Authorization", `Bearer ${firstSession.body.accessToken}`);
  assert.equal(ownList.status, 200);
  assert.equal(ownList.body.notifications.length, 1);
  assert.equal(ownList.body.unreadCount, 1);

  const otherMark = await request(app)
    .patch(`/api/notifications/${ownList.body.notifications[0]._id}/read`)
    .set("Authorization", `Bearer ${otherSession.body.accessToken}`);
  assert.equal(otherMark.status, 404);

  const marked = await request(app)
    .patch(`/api/notifications/${ownList.body.notifications[0]._id}/read`)
    .set("Authorization", `Bearer ${firstSession.body.accessToken}`);
  assert.equal(marked.status, 200);
  assert.ok(marked.body.notification.readAt);
  assert.ok(firstUser.body.user._id);
});

test("access tokens expire and refresh tokens rotate with reuse revocation", async () => {
  await register();
  const session = await login();
  assert.equal(typeof session.body.refreshToken, "string");
  const payload = jwt.verify(session.body.accessToken, process.env.JWT_SECRET);
  assert.equal(payload.exp - payload.iat, 15 * 60);

  const expiredAccess = jwt.sign(
    { sub: session.body.user._id, role: "student" },
    process.env.JWT_SECRET,
    { expiresIn: -1 }
  );
  const expiredResponse = await request(app)
    .get("/api/notifications")
    .set("Authorization", `Bearer ${expiredAccess}`);
  assert.equal(expiredResponse.status, 401);

  const refreshed = await request(app)
    .post("/api/auth/refresh")
    .send({ refreshToken: session.body.refreshToken });
  assert.equal(refreshed.status, 200);
  assert.notEqual(refreshed.body.refreshToken, session.body.refreshToken);
  assert.doesNotThrow(() => jwt.verify(refreshed.body.accessToken, process.env.JWT_SECRET));

  const replay = await request(app)
    .post("/api/auth/refresh")
    .send({ refreshToken: session.body.refreshToken });
  assert.equal(replay.status, 401);
  const family = await RefreshToken.find({ userId: session.body.user._id });
  assert.ok(family.every((token) => token.revokedAt));
});

test("JSON input rejects Mongo operators and executable HTML payloads", async () => {
  const mongoPayload = await request(app)
    .post("/api/auth/register")
    .set("Content-Type", "application/json")
    .send('{"name":"Test","email":"a@example.com","password":"password","role":"student","$where":"true"}');
  assert.equal(mongoPayload.status, 400);
  assert.equal(mongoPayload.body.message, "Request contains an invalid field name");

  const scriptPayload = await request(app)
    .post("/api/auth/register")
    .send({
      name: "<script>alert(1)</script>",
      email: "xss@example.com",
      password: "secure-password",
      role: "student"
    });
  assert.equal(scriptPayload.status, 400);
  assert.equal(scriptPayload.body.message, "Request contains unsafe content");
});

test("authentication limiter throttles requests and emits standard limits", async () => {
  const limitedApp = express();
  limitedApp.get("/", createRateLimiter({ windowMs: 60000, max: 1 }), (req, res) => {
    res.status(200).send("ok");
  });
  assert.equal((await request(limitedApp).get("/")).status, 200);
  const limited = await request(limitedApp).get("/");
  assert.equal(limited.status, 429);
  assert.equal(limited.headers["ratelimit-limit"], "1");
  assert.ok(limited.headers["retry-after"]);
});

test("liveness and database readiness are reported independently", async () => {
  const live = await request(app).get("/api/health/live");
  const ready = await request(app).get("/api/health/ready");
  assert.equal(live.status, 200);
  assert.equal(live.body.status, "alive");
  assert.equal(ready.status, 200);
  assert.equal(ready.body.status, "ready");
});

test("production transport rejects plain HTTP and server requires TLS termination", () => {
  const previousEnvironment = process.env.NODE_ENV;
  const previousProxyHops = process.env.TRUST_PROXY_HOPS;
  process.env.NODE_ENV = "production";
  delete process.env.TRUST_PROXY_HOPS;
  try {
    let responseStatus;
    let hsts;
    const response = {
      status(status) { responseStatus = status; return this; },
      json() { return this; },
      set(name, value) { if (name === "Strict-Transport-Security") hsts = value; }
    };
    let calledNext = false;
    requireSecureTransport({ secure: false }, response, () => { calledNext = true; });
    assert.equal(responseStatus, 426);
    assert.equal(calledNext, false);

    requireSecureTransport({ secure: true }, response, () => { calledNext = true; });
    assert.equal(hsts, "max-age=31536000; includeSubDomains");
    assert.equal(calledNext, true);
    assert.throws(() => createHttpServer(), /requires HTTPS certificate files or a trusted TLS-terminating proxy/);
  } finally {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
    if (previousProxyHops === undefined) delete process.env.TRUST_PROXY_HOPS;
    else process.env.TRUST_PROXY_HOPS = previousProxyHops;
  }
});
