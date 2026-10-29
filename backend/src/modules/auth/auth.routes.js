
const express = require("express");
const {
  login,
  register,
  getCurrentUser
} = require("./auth.controller");

const {
  forgotPassword,
  resetPassword
} = require("../passwordReset/passwordReset.controller");

const authenticateToken = require("../../middleware/authenticateToken");
const authorizeRoles = require("../../middleware/authorizeRoles");

const router = express.Router();

router.post("/login", login);
router.post("/register", register);

router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

router.get(
  "/me",
  authenticateToken,
  authorizeRoles("student", "instructor", "admin"),
  getCurrentUser
);

module.exports = router;
