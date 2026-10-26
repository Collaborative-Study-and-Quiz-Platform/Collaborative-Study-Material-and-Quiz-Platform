const mongoose = require("mongoose");

const QUESTION_TYPES = ["mcq", "true_false", "short_answer"];
const DIFFICULTY_LEVELS = ["easy", "medium", "hard"];

const questionSchema = new mongoose.Schema(
  {
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000
    },
    type: {
      type: String,
      enum: QUESTION_TYPES,
      required: true
    },
    options: {
      type: [String],
      default: []
    },
    correctAnswer: {
      type: String,
      trim: true,
      maxlength: 2000
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    topic: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    difficulty: {
      type: String,
      enum: DIFFICULTY_LEVELS,
      required: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    isDeleted: {
      type: Boolean,
      default: false,
      select: false
    },
    deletedAt: {
      type: Date,
      select: false
    }
  },
  { timestamps: true }
);

questionSchema.index({ subject: 1, topic: 1, difficulty: 1, type: 1 });

questionSchema.set("toJSON", {
  transform: (document, returnedQuestion) => {
    delete returnedQuestion.isDeleted;
    delete returnedQuestion.deletedAt;
    delete returnedQuestion.__v;
  }
});

module.exports = mongoose.model("Question", questionSchema);
module.exports.QUESTION_TYPES = QUESTION_TYPES;
module.exports.DIFFICULTY_LEVELS = DIFFICULTY_LEVELS;
