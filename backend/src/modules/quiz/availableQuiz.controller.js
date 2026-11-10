const Attempt = require("../../models/Attempt");
const Question = require("../../models/Question");
const Quiz = require("../../models/Quiz");
const { finalizeIfTimedOut } = require("../attempt/attempt.controller");
const { scheduleStatus } = require("./quizSchedule");

function distinctSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

// The student's own attempt in a form safe to show: status and score only
function attemptSummary(attempt) {
  if (!attempt) {
    return null;
  }

  const summary = {
    status: attempt.status,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    submittedAt: attempt.submittedAt
  };

  if (attempt.grading) {
    summary.score = attempt.grading.score;
    summary.maxScore = attempt.grading.maxScore;
    summary.percentage = attempt.grading.percentage;
    summary.passed = attempt.grading.passed;
    summary.gradingStatus = attempt.grading.gradingStatus;
  }

  return summary;
}

// Lists the quizzes a student can see, newest first, with their own attempt.
// CSQP-F-021: open and upcoming quizzes are listed, plus any quiz the student
// has already attempted (so results stay reachable). Unscheduled quizzes and
// closed quizzes the student never took are hidden.
async function listAvailableQuizzes(req, res, next) {
  try {
    const now = new Date();
    const attempted = await Attempt.find({ student: req.user.id }).distinct("quiz");
    const quizzes = await Quiz.find({
      $or: [
        { availableFrom: { $ne: null }, availableUntil: { $gt: now } },
        { _id: { $in: attempted } }
      ]
    }).sort({ createdAt: -1 });
    const quizIds = quizzes.map((quiz) => quiz._id);

    const [attempts, sourceQuestions] = await Promise.all([
      Attempt.find({ quiz: { $in: quizIds }, student: req.user.id }),
      Question.find({
        _id: { $in: quizzes.flatMap((quiz) => quiz.questions.map((question) => question.sourceQuestion)) }
      }).select("subject topic")
    ]);

    const attemptsByQuiz = new Map(attempts.map((attempt) => [attempt.quiz.toString(), attempt]));
    const metadataById = new Map(sourceQuestions.map((question) => [question._id.toString(), question]));

    const results = await Promise.all(quizzes.map(async (quiz) => {
      const attempt = attemptsByQuiz.get(quiz._id.toString());
      if (attempt) {
        await finalizeIfTimedOut(attempt, quiz);
      }

      const metadata = quiz.questions
        .map((question) => metadataById.get(question.sourceQuestion.toString()))
        .filter(Boolean);

      return {
        _id: quiz._id,
        title: quiz.title,
        description: quiz.description,
        durationMinutes: quiz.durationMinutes,
        passingScore: quiz.passingScore,
        totalMarks: quiz.totalMarks,
        questionCount: quiz.questions.length,
        subjects: distinctSorted(metadata.map((question) => question.subject)),
        topics: distinctSorted(metadata.map((question) => question.topic)),
        createdAt: quiz.createdAt,
        availableFrom: quiz.availableFrom,
        availableUntil: quiz.availableUntil,
        scheduleStatus: scheduleStatus(quiz, now),
        attempt: attemptSummary(attempt)
      };
    }));

    return res.status(200).json({
      status: "success",
      count: results.length,
      quizzes: results
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listAvailableQuizzes
};
