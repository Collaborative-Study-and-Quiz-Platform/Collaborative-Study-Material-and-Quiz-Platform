// Automatic grading of objective questions (CSQP-F-023).
// MCQ and True/False answers are checked against the quiz's own copy of the
// answer key. Short-answer questions are left for manual grading (CSQP-F-024).

const AUTO_GRADED_TYPES = new Set(["mcq", "true_false"]);

function isAutoGraded(question) {
  return AUTO_GRADED_TYPES.has(question.type);
}

function normalizeAnswer(question, value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return question.type === "true_false" ? trimmed.toLowerCase() : trimmed;
}

function isCorrectAnswer(question, response) {
  const expected = normalizeAnswer(question, question.correctAnswer);
  const given = normalizeAnswer(question, response);

  return expected !== null && expected !== "" && given === expected;
}

function roundToTwo(value) {
  return Math.round(value * 100) / 100;
}

// Returns the grading for one attempt without saving anything
function gradeAttempt(quiz, answers) {
  const responses = new Map(
    answers.map((answer) => [answer.questionId.toString(), answer.response])
  );

  let score = 0;
  let maxScore = 0;
  let pendingMarks = 0;

  const results = quiz.questions.map((question) => {
    const response = responses.get(question._id.toString());
    maxScore += question.marks;

    if (!isAutoGraded(question)) {
      pendingMarks += question.marks;
      return {
        questionId: question._id,
        answered: response !== undefined,
        isCorrect: null,
        marksAwarded: null,
        maxMarks: question.marks
      };
    }

    const isCorrect = response !== undefined && isCorrectAnswer(question, response);
    const marksAwarded = isCorrect ? question.marks : 0;
    score += marksAwarded;

    return {
      questionId: question._id,
      answered: response !== undefined,
      isCorrect,
      marksAwarded,
      maxMarks: question.marks
    };
  });

  const gradingStatus = pendingMarks > 0 ? "pending_manual" : "complete";
  const percentage = maxScore > 0 ? roundToTwo((score / maxScore) * 100) : 0;

  return {
    results,
    score,
    maxScore,
    pendingMarks,
    percentage,
    gradingStatus,
    // A pass or fail is only decided once every question has been marked
    passed: gradingStatus === "complete" ? percentage >= quiz.passingScore : null,
    gradedAt: new Date()
  };
}

module.exports = {
  gradeAttempt,
  isAutoGraded,
  isCorrectAnswer
};
