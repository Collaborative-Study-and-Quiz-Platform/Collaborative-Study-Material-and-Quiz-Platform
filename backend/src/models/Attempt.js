const mongoose = require("mongoose");

const ATTEMPT_STATUSES = ["in_progress", "submitted", "auto_submitted"];

const answerSchema = new mongoose.Schema(
  {
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    response: {
      type: String,
      required: true
    }
  },
  { _id: false }
);

const attemptSchema = new mongoose.Schema(
  {
    quiz: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Quiz",
      required: true
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    status: {
      type: String,
      enum: ATTEMPT_STATUSES,
      default: "in_progress"
    },
    startedAt: {
      type: Date,
      required: true
    },
    expiresAt: {
      type: Date,
      required: true
    },
    submittedAt: {
      type: Date
    },
    answers: {
      type: [answerSchema],
      default: []
    }
  },
  { timestamps: true }
);

// One attempt per student per quiz
attemptSchema.index({ quiz: 1, student: 1 }, { unique: true });

module.exports = mongoose.model("Attempt", attemptSchema);
module.exports.ATTEMPT_STATUSES = ATTEMPT_STATUSES;
