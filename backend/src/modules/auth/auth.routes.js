const express = require("express");
const {
  login,
  register,
  getCurrentUser
} = require("./auth.controller");

const authenticateToken = require("../../middleware/authenticateToken");
const authorizeRoles = require("../../middleware/authorizeRoles");

const router = express.Router();

router.post("/login", login);
router.post("/register", register);
router.get(
  "/me",
  authenticateToken,
  authorizeRoles("student", "instructor", "admin"),
  getCurrentUser
);

module.exports = router;