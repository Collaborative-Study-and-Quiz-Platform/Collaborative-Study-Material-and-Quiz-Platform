const express = require("express");
const {
  exportSubmissions,
  listSubmissions,
  getSubmission,
  gradeSubmission
} = require("./manualGrading.controller");

const authenticateToken = require("../../middleware/authenticateToken");
const authorizeRoles = require("../../middleware/authorizeRoles");

const router = express.Router({ mergeParams: true });

router.use(authenticateToken, authorizeRoles("instructor", "admin"));

router.get("/", listSubmissions);
// Before "/:attemptId" so "export" is not read as an attempt ID
router.get("/export", exportSubmissions);
router.get("/:attemptId", getSubmission);
router.put("/:attemptId/grades", gradeSubmission);

module.exports = router;
