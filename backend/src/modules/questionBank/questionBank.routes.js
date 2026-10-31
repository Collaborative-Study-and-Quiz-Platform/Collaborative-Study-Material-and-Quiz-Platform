const express = require("express");
const multer = require("multer");
const {
  createQuestion,
  listQuestions,
  getQuestion,
  updateQuestion,
  deleteQuestion
} = require("./questionBank.controller");
const { importQuestions, MAX_IMPORT_FILE_SIZE } = require("./questionImport.controller");

const authenticateToken = require("../../middleware/authenticateToken");
const authorizeRoles = require("../../middleware/authorizeRoles");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMPORT_FILE_SIZE,
    files: 1,
    fields: 3,
    parts: 4,
    fieldSize: 100,
    headerPairs: 100
  }
});

function receiveImportFile(req, res, next) {
  upload.single("file")(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        status: "error",
        message: `File must be ${MAX_IMPORT_FILE_SIZE} bytes or smaller`
      });
    }
    if (error instanceof multer.MulterError) {
      return res.status(400).json({
        status: "error",
        message: "Invalid file upload"
      });
    }
    if (error) {
      return next(error);
    }
    return next();
  });
}

router.use(authenticateToken, authorizeRoles("instructor", "admin"));

router.post("/import", receiveImportFile, importQuestions);
router.post("/", createQuestion);
router.get("/", listQuestions);
router.get("/:id", getQuestion);
router.put("/:id", updateQuestion);
router.delete("/:id", deleteQuestion);

module.exports = router;