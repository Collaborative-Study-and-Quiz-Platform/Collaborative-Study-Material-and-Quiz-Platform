
const mongoose = require("mongoose");

const passwordResetTokenSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  tokenHash: {
    type: String,
    required: true,
    unique: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 }
  },
  usedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

module.exports = mongoose.model(
  "PasswordResetToken",
  passwordResetTokenSchema
);
