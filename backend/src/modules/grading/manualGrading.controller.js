// Manual grading of short-answer questions (CSQP-F-024). The quiz owner or
// an Admin reviews submitted attempts and enters marks for each short answer;
// the attempt's score, percentage, and pass/fail are then recalculated.
const mongoose = require("mongoose");
const Attempt = require("../../models/Attempt");
const Quiz = require("../../models/Quiz");
const User = require("../../models/User");
const { createNotification } = require("../notification/notification.service");
const { finalizeIfTimedOut } = require("../attempt/attempt.controller");
const { gradeAttempt, summarizeResults } = require("./grading.service");

const MAX_FEEDBACK_LENGTH = 1000;

function sendError(res, statusCode, message, extra = {}) {
  return res.status(statusCode).json({ status: "error", message, ...extra });
}

// Loads the quiz and checks the user may grade it, or sends the error
async function loadOwnedQuiz(req, res) {
  if (!mongoose.isValidObjectId(req.params.quizId)) {
    sendError(res, 404, "Quiz not found");
    return null;
  }

  const quiz = await Quiz.findById(req.params.quizId);
  if (!quiz) {
    sendError(res, 404, "Quiz not found");
    return null;
  }

  if (req.user.role !== "admin" && quiz.createdBy.toString() !== req.user.id) {
    sendError(res, 403, "You can only grade quizzes you created");
    return null;
  }

  return quiz;
}

async function loadSubmission(req, res, quiz) {
  if (!mongoose.isValidObjectId(req.params.attemptId)) {
    sendError(res, 404, "Submission not found");
    return null;
  }

  const attempt = await Attempt.findOne({ _id: req.params.attemptId, quiz: quiz._id });
  if (!attempt) {
    sendError(res, 404, "Submission not found");
    return null;
  }

  await finalizeIfTimedOut(attempt, quiz);

  // Attempts submitted before automatic grading existed are graded now
  if (attempt.status !== "in_progress" && !attempt.grading) {
    attempt.grading = gradeAttempt(quiz, attempt.answers);
    await attempt.save();
  }

  return attempt;
}

function studentSummary(user, fallbackId) {
  return user
    ? { _id: user._id, name: user.name, email: user.email }
    : { _id: fallbackId, name: "Unknown student", email: "" };
}

function scoreSummary(attempt) {
  if (!attempt.grading) {
    return {};
  }
  const { grading } = attempt;
  return {
    score: grading.score,
    maxScore: grading.maxScore,
    percentage: grading.percentage,
    passed: grading.passed,
    gradingStatus: grading.gradingStatus,
    pendingMarks: grading.pendingMarks,
    pendingQuestions: grading.results.filter((result) => result.marksAwarded === null).length
  };
}

// GET /api/quizzes/:quizId/submissions
async function listSubmissions(req, res, next) {
  try {
    const quiz = await loadOwnedQuiz(req, res);
    if (!quiz) {
      return undefined;
    }

    const attempts = await Attempt.find({ quiz: quiz._id }).sort({ submittedAt: -1, startedAt: -1 });
    await Promise.all(attempts.map((attempt) => finalizeIfTimedOut(attempt, quiz)));

    const students = await User.find({ _id: { $in: attempts.map((attempt) => attempt.student) } }).select("name email");
    const studentsById = new Map(students.map((user) => [user._id.toString(), user]));

    const submissions = attempts.map((attempt) => ({
      _id: attempt._id,
      student: studentSummary(studentsById.get(attempt.student.toString()), attempt.student),
      status: attempt.status,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      ...scoreSummary(attempt)
    }));

    return res.status(200).json({
      status: "success",
      quiz: { _id: quiz._id, title: quiz.title, totalMarks: quiz.totalMarks, passingScore: quiz.passingScore },
      count: submissions.length,
      awaitingGrading: submissions.filter((item) => item.gradingStatus === "pending_manual").length,
      submissions
    });
  } catch (error) {
    return next(error);
  }
}

function submissionDetail(attempt, quiz, user) {
  const responses = new Map(attempt.answers.map((answer) => [answer.questionId.toString(), answer.response]));
  const results = new Map((attempt.grading?.results || []).map((result) => [result.questionId.toString(), result]));

  return {
    _id: attempt._id,
    student: studentSummary(user, attempt.student),
    status: attempt.status,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    manuallyGradedAt: attempt.grading?.manuallyGradedAt || null,
    ...scoreSummary(attempt),
    questions: quiz.questions.map((question) => {
      const id = question._id.toString();
      const result = results.get(id);
      return {
        questionId: question._id,
        text: question.text,
        type: question.type,
        options: question.options,
        correctAnswer: question.correctAnswer || null,
        response: responses.has(id) ? responses.get(id) : null,
        maxMarks: question.marks,
        marksAwarded: result ? result.marksAwarded : null,
        isCorrect: result ? result.isCorrect : null,
        manuallyGraded: Boolean(result?.manuallyGraded),
        feedback: result?.feedback || ""
      };
    })
  };
}

// GET /api/quizzes/:quizId/submissions/:attemptId
async function getSubmission(req, res, next) {
  try {
    const quiz = await loadOwnedQuiz(req, res);
    if (!quiz) {
      return undefined;
    }
    const attempt = await loadSubmission(req, res, quiz);
    if (!attempt) {
      return undefined;
    }
    const user = await User.findById(attempt.student).select("name email");

    return res.status(200).json({ status: "success", submission: submissionDetail(attempt, quiz, user) });
  } catch (error) {
    return next(error);
  }
}

// Checks { grades: [{ questionId, marks, feedback? }] } against the quiz
function validateGrades(quiz, grades) {
  const errors = {};
  const changes = [];

  if (!Array.isArray(grades) || grades.length === 0) {
    errors.grades = "Send at least one grade";
    return { errors, changes };
  }

  const questions = new Map(quiz.questions.map((question) => [question._id.toString(), question]));
  const seen = new Set();

  grades.forEach((grade, index) => {
    const key = `grades.${index}`;
    if (!grade || typeof grade !== "object" || Array.isArray(grade)) {
      errors[key] = "Each grade must be an object";
      return;
    }

    const id = typeof grade.questionId === "string" ? grade.questionId : "";
    const question = questions.get(id);
    if (!question) {
      errors[`${key}.questionId`] = "Question is not part of this quiz";
      return;
    }
    if (question.type !== "short_answer") {
      errors[`${key}.questionId`] = "Only short-answer questions are graded by hand";
      return;
    }
    if (seen.has(id)) {
      errors[`${key}.questionId`] = "The same question is graded more than once";
      return;
    }
    seen.add(id);

    const { marks } = grade;
    if (typeof marks !== "number" || !Number.isFinite(marks) || marks < 0 || marks > question.marks) {
      errors[`${key}.marks`] = `Marks must be a number from 0 to ${question.marks}`;
    } else if (Math.round(marks * 2) !== marks * 2) {
      errors[`${key}.marks`] = "Marks can only be given in steps of 0.5";
    }

    let feedback;
    if (grade.feedback !== undefined && grade.feedback !== null) {
      if (typeof grade.feedback !== "string") {
        errors[`${key}.feedback`] = "Feedback must be text";
      } else if (grade.feedback.trim().length > MAX_FEEDBACK_LENGTH) {
        errors[`${key}.feedback`] = `Feedback must be ${MAX_FEEDBACK_LENGTH} characters or fewer`;
      } else {
        feedback = grade.feedback.trim();
      }
    }

    changes.push({ questionId: id, marks, feedback, maxMarks: question.marks });
  });

  return { errors, changes };
}

// PUT /api/quizzes/:quizId/submissions/:attemptId/grades
async function gradeSubmission(req, res, next) {
  try {
    const quiz = await loadOwnedQuiz(req, res);
    if (!quiz) {
      return undefined;
    }
    const attempt = await loadSubmission(req, res, quiz);
    if (!attempt) {
      return undefined;
    }

    if (attempt.status === "in_progress") {
      return sendError(res, 409, "This attempt has not been submitted yet");
    }

    const { errors, changes } = validateGrades(quiz, (req.body || {}).grades);
    if (Object.keys(errors).length > 0) {
      return sendError(res, 422, "Grades are invalid", { errors });
    }

    const wasComplete = attempt.grading.gradingStatus === "complete";
    const byQuestion = new Map(changes.map((change) => [change.questionId, change]));

    attempt.grading.results.forEach((result) => {
      const change = byQuestion.get(result.questionId.toString());
      if (!change) {
        return;
      }
      result.marksAwarded = change.marks;
      result.isCorrect = change.marks === change.maxMarks;
      result.manuallyGraded = true;
      if (change.feedback !== undefined) {
        result.feedback = change.feedback;
      }
    });

    Object.assign(attempt.grading, summarizeResults(attempt.grading.results, quiz.passingScore), {
      manuallyGradedAt: new Date(),
      manuallyGradedBy: req.user.id
    });
    attempt.markModified("grading");
    await attempt.save();

    if (!wasComplete && attempt.grading.gradingStatus === "complete") {
      await createNotification({
        userId: attempt.student,
        type: "quiz_result",
        title: `Quiz graded: ${quiz.title}`,
        message: `Your short answers have been graded. Final score: ${attempt.grading.score}/${attempt.grading.maxScore}.`,
        metadata: { quizId: quiz._id, attemptId: attempt._id }
      });
    }

    const user = await User.findById(attempt.student).select("name email");
    return res.status(200).json({
      status: "success",
      message: attempt.grading.gradingStatus === "complete" ? "Grading complete" : "Grades saved",
      submission: submissionDetail(attempt, quiz, user)
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listSubmissions,
  getSubmission,
  gradeSubmission,
  validateGrades
};
