const express = require("express");
const {
  createQuiz,
  listQuizzes,
  getQuiz
} = require("./quiz.controller");

const authenticateToken = require("../../middleware/authenticateToken");
const authorizeRoles = require("../../middleware/authorizeRoles");

const router = express.Router();

router.use(authenticateToken, authorizeRoles("instructor", "admin"));

router.post("/", createQuiz);
router.get("/", listQuizzes);
router.get("/:id", getQuiz);

module.exports = router;
