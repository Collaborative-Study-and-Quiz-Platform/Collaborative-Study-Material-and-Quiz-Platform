const mongoose = require("mongoose");
const Attempt = require("../../models/Attempt");
const Quiz = require("../../models/Quiz");

// Extra time allowed after the timer ends, so a submit sent just before
// time-out is not rejected because of network delay
const GRACE_PERIOD_MS = 30 * 1000;
const MAX_SHORT_ANSWER_LENGTH = 5000;

function sendError(res, statusCode, message, extra = {}) {
  return res.status(statusCode).json({
    status: "error",
    message,
    ...extra
  });
}

function hasTimedOut(attempt, now = Date.now()) {
  return now > attempt.expiresAt.getTime() + GRACE_PERIOD_MS;
}

// Questions as a student sees them: no correct answers, no bank references
function studentQuestions(quiz) {
  return quiz.questions.map((question) => ({
    _id: question._id,
    text: question.text,
    type: question.type,
    options: question.options,
    marks: question.marks
  }));
}

function attemptView(attempt, quiz) {
  const view = {
    _id: attempt._id,
    quiz: attempt.quiz,
    status: attempt.status,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    submittedAt: attempt.submittedAt,
    answers: attempt.answers.map((answer) => ({
      questionId: answer.questionId,
      response: answer.response
    })),
    answeredCount: attempt.answers.length,
    totalQuestions: quiz.questions.length
  };

  if (attempt.status === "in_progress") {
    view.remainingSeconds = Math.max(
      0,
      Math.ceil((attempt.expiresAt.getTime() - Date.now()) / 1000)
    );
    view.quizTitle = quiz.title;
    view.questions = studentQuestions(quiz);
  }

  return view;
}

// Ends an attempt. F-023 (Automatic Grading) will add scoring here
async function finalizeAttempt(attempt, status) {
  attempt.status = status;
  attempt.submittedAt = status === "auto_submitted" ? attempt.expiresAt : new Date();
  await attempt.save();
  return attempt;
}

async function finalizeIfTimedOut(attempt) {
  if (attempt.status === "in_progress" && hasTimedOut(attempt)) {
    await finalizeAttempt(attempt, "auto_submitted");
  }
  return attempt;
}

function normalizeResponse(question, response) {
  if (response === null || response === undefined) {
    return { clear: true };
  }

  if (question.type === "true_false") {
    const value = typeof response === "boolean"
      ? String(response)
      : typeof response === "string" ? response.trim().toLowerCase() : null;

    if (value === "") {
      return { clear: true };
    }

    return ["true", "false"].includes(value)
      ? { value }
      : { error: "Answer must be true or false" };
  }

  if (typeof response !== "string") {
    return { error: "Answer must be text" };
  }

  const value = question.type === "mcq" ? response.trim() : response;

  if (!value.trim()) {
    return { clear: true };
  }

  if (question.type === "mcq" && !question.options.includes(value)) {
    return { error: "Answer must be one of the options" };
  }

  if (value.length > MAX_SHORT_ANSWER_LENGTH) {
    return { error: `Answer must be ${MAX_SHORT_ANSWER_LENGTH} characters or fewer` };
  }

  return { value };
}

// Checks the answers payload: [{ questionId, response }]. A null or empty
// response clears that answer
function validateAnswers(quiz, answers) {
  const errors = {};
  const changes = [];

  if (!Array.isArray(answers)) {
    errors.answers = "answers must be a list";
    return { errors, changes };
  }

  const questionsById = new Map(
    quiz.questions.map((question) => [question._id.toString(), question])
  );
  const seen = new Set();

  answers.forEach((answer, index) => {
    const key = `answers.${index}`;

    if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
      errors[key] = "Each answer must be an object";
      return;
    }

    const id = typeof answer.questionId === "string" ? answer.questionId : "";
    const question = questionsById.get(id);

    if (!question) {
      errors[`${key}.questionId`] = "Question is not part of this quiz";
      return;
    }

    if (seen.has(id)) {
      errors[`${key}.questionId`] = "The same question is answered more than once";
      return;
    }
    seen.add(id);

    const result = normalizeResponse(question, answer.response);

    if (result.error) {
      errors[`${key}.response`] = result.error;
    } else {
      changes.push({ questionId: id, ...result });
    }
  });

  return { errors, changes };
}

function applyAnswers(attempt, changes) {
  const answers = new Map(
    attempt.answers.map((answer) => [answer.questionId.toString(), answer.response])
  );

  changes.forEach((change) => {
    if (change.clear) {
      answers.delete(change.questionId);
    } else {
      answers.set(change.questionId, change.value);
    }
  });

  attempt.answers = [...answers].map(([questionId, response]) => ({ questionId, response }));
}

async function loadQuiz(req, res) {
  if (!mongoose.isValidObjectId(req.params.quizId)) {
    sendError(res, 404, "Quiz not found");
    return null;
  }

  const quiz = await Quiz.findById(req.params.quizId);

  if (!quiz) {
    sendError(res, 404, "Quiz not found");
    return null;
  }

  return quiz;
}

async function loadAttempt(req, res, quiz) {
  const attempt = await Attempt.findOne({ quiz: quiz._id, student: req.user.id });

  if (!attempt) {
    sendError(res, 404, "You have not started this quiz");
    return null;
  }

  return finalizeIfTimedOut(attempt);
}

function closedResponse(res, attempt, quiz) {
  const message = attempt.status === "auto_submitted"
    ? "Time is up. Your saved answers were submitted automatically"
    : "This attempt has already been submitted";

  return sendError(res, 409, message, { attempt: attemptView(attempt, quiz) });
}

// Starts the timer, or returns the attempt already in progress
async function startAttempt(req, res, next) {
  try {
    const quiz = await loadQuiz(req, res);
    if (!quiz) {
      return undefined;
    }

    let attempt = await Attempt.findOne({ quiz: quiz._id, student: req.user.id });

    if (!attempt) {
      const startedAt = new Date();

      try {
        attempt = await Attempt.create({
          quiz: quiz._id,
          student: req.user.id,
          startedAt,
          expiresAt: new Date(startedAt.getTime() + quiz.durationMinutes * 60 * 1000)
        });

        return res.status(201).json({
          status: "success",
          message: "Quiz attempt started",
          attempt: attemptView(attempt, quiz)
        });
      } catch (error) {
        // Two start requests at the same moment: use the one that won
        if (error.code !== 11000) {
          throw error;
        }
        attempt = await Attempt.findOne({ quiz: quiz._id, student: req.user.id });
      }
    }

    await finalizeIfTimedOut(attempt);

    if (attempt.status !== "in_progress") {
      return closedResponse(res, attempt, quiz);
    }

    return res.status(200).json({
      status: "success",
      message: "Quiz attempt resumed",
      attempt: attemptView(attempt, quiz)
    });
  } catch (error) {
    return next(error);
  }
}

async function getAttempt(req, res, next) {
  try {
    const quiz = await loadQuiz(req, res);
    if (!quiz) {
      return undefined;
    }

    const attempt = await loadAttempt(req, res, quiz);
    if (!attempt) {
      return undefined;
    }

    return res.status(200).json({
      status: "success",
      attempt: attemptView(attempt, quiz)
    });
  } catch (error) {
    return next(error);
  }
}

// Shared by saving progress and submitting
async function updateAttempt(req, res, next, submit) {
  try {
    const quiz = await loadQuiz(req, res);
    if (!quiz) {
      return undefined;
    }

    const attempt = await loadAttempt(req, res, quiz);
    if (!attempt) {
      return undefined;
    }

    if (attempt.status !== "in_progress") {
      return closedResponse(res, attempt, quiz);
    }

    const body = req.body || {};
    const answers = body.answers === undefined && submit ? [] : body.answers;
    const { errors, changes } = validateAnswers(quiz, answers);

    if (Object.keys(errors).length > 0) {
      return sendError(res, 422, "Answers are invalid", { errors });
    }

    applyAnswers(attempt, changes);

    if (submit) {
      await finalizeAttempt(attempt, "submitted");
    } else {
      await attempt.save();
    }

    return res.status(200).json({
      status: "success",
      message: submit ? "Quiz submitted" : "Answers saved",
      attempt: attemptView(attempt, quiz)
    });
  } catch (error) {
    return next(error);
  }
}

function saveAnswers(req, res, next) {
  return updateAttempt(req, res, next, false);
}

function submitAttempt(req, res, next) {
  return updateAttempt(req, res, next, true);
}

module.exports = {
  startAttempt,
  getAttempt,
  saveAnswers,
  submitAttempt,
  finalizeAttempt,
  GRACE_PERIOD_MS
};
