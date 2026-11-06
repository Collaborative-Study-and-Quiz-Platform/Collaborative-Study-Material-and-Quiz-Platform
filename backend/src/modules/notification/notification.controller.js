const mongoose = require("mongoose");
const Notification = require("../../models/Notification");

async function listNotifications(req, res, next) {
  try {
    const unreadOnly = req.query.unread;
    if (unreadOnly !== undefined && unreadOnly !== "true" && unreadOnly !== "false") {
      return res.status(400).json({
        status: "error",
        message: "unread must be true or false"
      });
    }

    const filter = { userId: req.user.id };
    if (unreadOnly === "true") {
      filter.readAt = null;
    }
    const [notifications, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).limit(100),
      Notification.countDocuments({ userId: req.user.id, readAt: null })
    ]);

    return res.status(200).json({
      status: "success",
      notifications,
      unreadCount
    });
  } catch (error) {
    return next(error);
  }
}

async function markNotificationRead(req, res, next) {
  if (!mongoose.isValidObjectId(req.params.notificationId)) {
    return res.status(404).json({ status: "error", message: "Notification not found" });
  }
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.notificationId, userId: req.user.id },
      { $set: { readAt: new Date() } },
      { new: true }
    );
    if (!notification) {
      return res.status(404).json({ status: "error", message: "Notification not found" });
    }
    return res.status(200).json({ status: "success", notification });
  } catch (error) {
    return next(error);
  }
}

async function markAllNotificationsRead(req, res, next) {
  try {
    await Notification.updateMany(
      { userId: req.user.id, readAt: null },
      { $set: { readAt: new Date() } }
    );
    return res.status(200).json({ status: "success", message: "Notifications marked as read" });
  } catch (error) {
    return next(error);
  }
}

module.exports = { listNotifications, markNotificationRead, markAllNotificationsRead };
