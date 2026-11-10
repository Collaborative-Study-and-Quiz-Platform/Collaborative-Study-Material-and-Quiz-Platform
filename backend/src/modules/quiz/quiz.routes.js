const express = require("express");
const {
  createQuiz,
  listQuizzes,
  getQuiz,
  scheduleQuiz
} = require("./quiz.controller");

const authenticateToken = require("../../middleware/authenticateToken");
const authorizeRoles = require("../../middleware/authorizeRoles");

const router = express.Router();

router.use(authenticateToken, authorizeRoles("instructor", "admin"));

router.post("/", createQuiz);
router.get("/", listQuizzes);
router.get("/:id", getQuiz);
router.put("/:id/schedule", scheduleQuiz);

module.exports = router;
