const express = require("express");
const authenticateToken = require("../../middleware/authenticateToken");
const {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead
} = require("./notification.controller");

const router = express.Router();

router.use(authenticateToken);
router.get("/", listNotifications);
router.patch("/read-all", markAllNotificationsRead);
router.patch("/:notificationId/read", markNotificationRead);

module.exports = router;
