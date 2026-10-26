const express = require("express");
const {
  startAttempt,
  getAttempt,
  saveAnswers,
  submitAttempt
} = require("./attempt.controller");

const authenticateToken = require("../../middleware/authenticateToken");
const authorizeRoles = require("../../middleware/authorizeRoles");

const router = express.Router({ mergeParams: true });

router.use(authenticateToken, authorizeRoles("student"));

router.post("/start", startAttempt);
router.get("/", getAttempt);
router.put("/answers", saveAnswers);
router.post("/", submitAttempt);

module.exports = router;
