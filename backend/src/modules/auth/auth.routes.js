const express = require("express");
const {
  login,
  register,
  getCurrentUser
} = require("./auth.controller");

const authenticateToken = require("../../middleware/authenticateToken");

const router = express.Router();

router.post("/login", login);
router.post("/register", register);
router.get("/me", authenticateToken, getCurrentUser);

module.exports = router;