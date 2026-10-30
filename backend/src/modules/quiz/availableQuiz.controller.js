const Attempt = require("../../models/Attempt");
const Question = require("../../models/Question");
const Quiz = require("../../models/Quiz");
const { finalizeIfTimedOut } = require("../attempt/attempt.controller");

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

// Lists quizzes a student can take, newest first, with their own attempt.
// Every quiz is listed for now; CSQP-F-021 (Schedule Quiz) will limit this
// to quizzes inside their scheduled window.
async function listAvailableQuizzes(req, res, next) {
  try {
    const quizzes = await Quiz.find().sort({ createdAt: -1 });
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
