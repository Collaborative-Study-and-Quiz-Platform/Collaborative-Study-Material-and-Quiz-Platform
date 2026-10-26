const mongoose = require("mongoose");
const { QUESTION_TYPES } = require("./Question");

// Each quiz keeps its own copy of its questions, so later edits or
// deletions in the question bank never change a quiz students have taken
const quizQuestionSchema = new mongoose.Schema(
  {
    sourceQuestion: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
      required: true
    },
    text: {
      type: String,
      required: true,
      trim: true
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
      trim: true
    },
    marks: {
      type: Number,
      required: true,
      min: 1
    }
  },
  { _id: true }
);

const quizSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: ""
    },
    durationMinutes: {
      type: Number,
      required: true,
      min: 1
    },
    passingScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },
    showAnswers: {
      type: Boolean,
      default: false
    },
    questions: {
      type: [quizQuestionSchema],
      required: true
    },
    totalMarks: {
      type: Number,
      required: true,
      min: 1
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    }
  },
  { timestamps: true }
);

quizSchema.index({ createdBy: 1, createdAt: -1 });

quizSchema.set("toJSON", {
  transform: (document, returnedQuiz) => {
    delete returnedQuiz.__v;
  }
});

module.exports = mongoose.model("Quiz", quizSchema);
