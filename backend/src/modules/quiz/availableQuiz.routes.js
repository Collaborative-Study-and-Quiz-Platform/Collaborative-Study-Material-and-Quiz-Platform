const express = require("express");
const { listAvailableQuizzes } = require("./availableQuiz.controller");

const authenticateToken = require("../../middleware/authenticateToken");
const authorizeRoles = require("../../middleware/authorizeRoles");

const router = express.Router();

router.use(authenticateToken, authorizeRoles("student"));

router.get("/", listAvailableQuizzes);

module.exports = router;
