const express = require("express");
const multer = require("multer");
const authenticateToken = require("../../middleware/authenticateToken");
const authorizeRoles = require("../../middleware/authorizeRoles");
const { createMaterial, MAX_FILE_SIZE } = require("./material.controller");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
    fields: 3,
    parts: 4,
    fieldSize: 100,
    headerPairs: 100
  }
});

router.post(
  "/",
  authenticateToken,
  authorizeRoles("instructor"),
  (req, res, next) => upload.single("file")(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        status: "error",
        message: `File must be ${MAX_FILE_SIZE} bytes or smaller`
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
  }),
  createMaterial
);

module.exports = router;
