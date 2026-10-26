const express = require("express");
const {
  createQuestion,
  listQuestions,
  getQuestion,
  updateQuestion,
  deleteQuestion
} = require("./questionBank.controller");

const authenticateToken = require("../../middleware/authenticateToken");
const authorizeRoles = require("../../middleware/authorizeRoles");

const router = express.Router();

router.use(authenticateToken, authorizeRoles("instructor", "admin"));

router.post("/", createQuestion);
router.get("/", listQuestions);
router.get("/:id", getQuestion);
router.put("/:id", updateQuestion);
router.delete("/:id", deleteQuestion);

module.exports = router;
