const express = require("express");
const {
  listSubmissions,
  getSubmission,
  gradeSubmission
} = require("./manualGrading.controller");

const authenticateToken = require("../../middleware/authenticateToken");
const authorizeRoles = require("../../middleware/authorizeRoles");

const router = express.Router({ mergeParams: true });

router.use(authenticateToken, authorizeRoles("instructor", "admin"));

router.get("/", listSubmissions);
router.get("/:attemptId", getSubmission);
router.put("/:attemptId/grades", gradeSubmission);

module.exports = router;
