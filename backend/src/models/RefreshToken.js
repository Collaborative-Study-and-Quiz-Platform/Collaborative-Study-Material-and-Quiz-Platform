const mongoose = require("mongoose");

const refreshTokenSchema = new mongoose.Schema({
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
  familyId: {
    type: String,
    required: true,
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 }
  },
  usedAt: {
    type: Date,
    default: null
  },
  revokedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

module.exports = mongoose.model("RefreshToken", refreshTokenSchema);
