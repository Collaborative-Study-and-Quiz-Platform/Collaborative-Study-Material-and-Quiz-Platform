const express = require("express");
const multer = require("multer");
const authenticateToken = require("../../middleware/authenticateToken");
const authorizeRoles = require("../../middleware/authorizeRoles");
const { createMaterial, listMaterials, MAX_FILE_SIZE } = require("./material.controller");

const { viewMaterial, downloadMaterial } = require("./materialFile.controller");

const { createComment, listComments } = require("./materialComment.controller");
const { createRateLimiter } = require("../../middleware/rateLimit");
const { updateMaterial, deleteMaterial } = require("./materialManagement.controller");
const { listBookmarks, saveBookmark, removeBookmark } = require("./bookmark.controller");

const router = express.Router();
const commentAccess = [
  (_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); },
  authenticateToken,
  authorizeRoles("student", "instructor")
];
const commentPostLimit = createRateLimiter({
  windowMs: Number(process.env.MATERIAL_COMMENT_RATE_LIMIT_WINDOW_MS || 60000),
  max: Number(process.env.MATERIAL_COMMENT_RATE_LIMIT_MAX || 10),
  message: "Too many comments. Please wait before posting again."
});
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

router.get(
  "/",
  authenticateToken,
  authorizeRoles("student", "instructor"),
  listMaterials
);

router.get("/:id/comments", ...commentAccess, listComments);
router.post("/:id/comments", ...commentAccess, commentPostLimit, createComment);
router.patch("/:id", authenticateToken, authorizeRoles("instructor"), updateMaterial);
router.delete("/:id", authenticateToken, authorizeRoles("instructor"), deleteMaterial);
router.get("/bookmarks", authenticateToken, authorizeRoles("student"), listBookmarks);
router.put("/:id/bookmark", authenticateToken, authorizeRoles("student"), saveBookmark);
router.delete("/:id/bookmark", authenticateToken, authorizeRoles("student"), removeBookmark);

router.get("/:id/view", authenticateToken, authorizeRoles("student", "instructor"), viewMaterial);
router.get("/:id/download", authenticateToken, authorizeRoles("student"), downloadMaterial);

module.exports = router;
