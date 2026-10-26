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

const resultSchema = new mongoose.Schema(
  {
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    answered: {
      type: Boolean,
      required: true
    },
    // null means the question waits for manual grading (short answer)
    isCorrect: {
      type: Boolean,
      default: null
    },
    marksAwarded: {
      type: Number,
      default: null
    },
    maxMarks: {
      type: Number,
      required: true
    }
  },
  { _id: false }
);

const gradingSchema = new mongoose.Schema(
  {
    results: {
      type: [resultSchema],
      default: []
    },
    score: {
      type: Number,
      required: true
    },
    maxScore: {
      type: Number,
      required: true
    },
    pendingMarks: {
      type: Number,
      required: true
    },
    percentage: {
      type: Number,
      required: true
    },
    gradingStatus: {
      type: String,
      enum: ["complete", "pending_manual"],
      required: true
    },
    passed: {
      type: Boolean,
      default: null
    },
    gradedAt: {
      type: Date,
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
    },
    grading: {
      type: gradingSchema,
      default: undefined
    }
  },
  { timestamps: true }
);

// One attempt per student per quiz
attemptSchema.index({ quiz: 1, student: 1 }, { unique: true });

module.exports = mongoose.model("Attempt", attemptSchema);
module.exports.ATTEMPT_STATUSES = ATTEMPT_STATUSES;
