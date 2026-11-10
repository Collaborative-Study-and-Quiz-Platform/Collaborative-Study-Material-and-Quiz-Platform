
const express = require("express");
const {
  login,
  register,
  getCurrentUser,
  refreshSession,
  logout
} = require("./auth.controller");

const {
  forgotPassword,
  resetPassword
} = require("../passwordReset/passwordReset.controller");

const authenticateToken = require("../../middleware/authenticateToken");
const authorizeRoles = require("../../middleware/authorizeRoles");
const { createRateLimiter } = require("../../middleware/rateLimit");

const router = express.Router();

const loginRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: "Too many authentication attempts. Try again later."
});
const registrationRateLimit = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: "Too many registration requests. Try again later."
});
const resetRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many password-reset requests. Try again later."
});
const sessionRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Too many session requests. Try again later."
});

router.post("/login", loginRateLimit, login);
router.post("/register", registrationRateLimit, register);

router.post("/forgot-password", resetRateLimit, forgotPassword);
router.post("/reset-password", resetRateLimit, resetPassword);
router.post("/refresh", sessionRateLimit, refreshSession);
router.post("/logout", sessionRateLimit, logout);

router.get(
  "/me",
  authenticateToken,
  authorizeRoles("student", "instructor", "admin"),
  getCurrentUser
);

module.exports = router;
