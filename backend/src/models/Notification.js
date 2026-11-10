const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ["welcome", "quiz_result", "password_changed", "system"],
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 160
  },
  message: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  readAt: {
    type: Date,
    default: null,
    index: true
  }
}, { timestamps: true });

notificationSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
