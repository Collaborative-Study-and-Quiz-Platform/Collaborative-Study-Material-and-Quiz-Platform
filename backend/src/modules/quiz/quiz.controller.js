const mongoose = require("mongoose");
const Question = require("../../models/Question");
const Quiz = require("../../models/Quiz");
const {
  normalizeQuestionInput,
  validateQuestionInput,
  toSavedFields
} = require("../questionBank/questionBank.controller");

const MAX_QUESTIONS = 100;
const MAX_DURATION_MINUTES = 600;
const MAX_MARKS = 100;

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : value;
}

function isWholeNumber(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function validateSettings(body, errors) {
  const title = normalizeText(body.title);
  const description = body.description === undefined ? "" : normalizeText(body.description);

  if (typeof title !== "string" || !title) {
    errors.title = "Quiz title is required";
  } else if (title.length > 200) {
    errors.title = "Quiz title must be 200 characters or fewer";
  }

  if (typeof description !== "string") {
    errors.description = "Description must be text";
  } else if (description.length > 2000) {
    errors.description = "Description must be 2000 characters or fewer";
  }

  if (!isWholeNumber(body.durationMinutes, 1, MAX_DURATION_MINUTES)) {
    errors.durationMinutes = `Duration must be a whole number of minutes from 1 to ${MAX_DURATION_MINUTES}`;
  }

  if (typeof body.passingScore !== "number"
    || Number.isNaN(body.passingScore)
    || body.passingScore < 0
    || body.passingScore > 100) {
    errors.passingScore = "Passing score must be a percentage from 0 to 100";
  }

  if (body.showAnswers !== undefined && typeof body.showAnswers !== "boolean") {
    errors.showAnswers = "showAnswers must be true or false";
  }

  return {
    title,
    description,
    durationMinutes: body.durationMinutes,
    passingScore: body.passingScore,
    showAnswers: body.showAnswers === true
  };
}

// Checks every question entry. An entry either points to a bank question
// ({ questionId, marks }) or describes a new one ({ question: {...}, marks })
function validateQuestionEntries(entries, errors) {
  const plan = [];

  if (!Array.isArray(entries) || entries.length === 0) {
    errors.questions = "A quiz needs at least one question";
    return plan;
  }

  if (entries.length > MAX_QUESTIONS) {
    errors.questions = `A quiz can have at most ${MAX_QUESTIONS} questions`;
    return plan;
  }

  const seenIds = new Set();

  entries.forEach((entry, index) => {
    const key = `questions.${index}`;

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors[key] = "Each question entry must be an object";
      return;
    }

    const marks = entry.marks === undefined ? 1 : entry.marks;
    if (!isWholeNumber(marks, 1, MAX_MARKS)) {
      errors[`${key}.marks`] = `Marks must be a whole number from 1 to ${MAX_MARKS}`;
    }

    const hasId = entry.questionId !== undefined;
    const hasNew = entry.question !== undefined;

    if (hasId === hasNew) {
      errors[key] = "Give either questionId for a bank question or question for a new one";
      return;
    }

    if (hasId) {
      const id = typeof entry.questionId === "string" ? entry.questionId.trim() : "";

      if (!mongoose.isValidObjectId(id)) {
        errors[`${key}.questionId`] = "Question ID is invalid";
      } else if (seenIds.has(id)) {
        errors[`${key}.questionId`] = "The same bank question is used more than once";
      } else {
        seenIds.add(id);
        plan.push({ index, questionId: id, marks });
      }
      return;
    }

    const newQuestion = normalizeQuestionInput(
      entry.question && typeof entry.question === "object" ? entry.question : {}
    );
    const questionErrors = validateQuestionInput(newQuestion);

    Object.entries(questionErrors).forEach(([field, message]) => {
      errors[`${key}.question.${field}`] = message;
    });

    if (Object.keys(questionErrors).length === 0) {
      plan.push({ index, newQuestion, marks });
    }
  });

  return plan;
}

async function loadBankQuestions(plan, errors) {
  const ids = plan.filter((item) => item.questionId).map((item) => item.questionId);
  const found = await Question.find({ _id: { $in: ids }, isDeleted: false });
  const byId = new Map(found.map((question) => [question._id.toString(), question]));

  plan.forEach((item) => {
    if (item.questionId && !byId.has(item.questionId)) {
      errors[`questions.${item.index}.questionId`] = "Question not found in the question bank";
    }
  });

  return byId;
}

function snapshot(question, marks) {
  return {
    sourceQuestion: question._id,
    text: question.text,
    type: question.type,
    options: question.type === "mcq" ? [...question.options] : [],
    correctAnswer: question.correctAnswer,
    marks
  };
}

function invalidQuizResponse(res, errors) {
  return res.status(400).json({
    status: "error",
    message: "Quiz details are invalid",
    errors
  });
}

async function createQuiz(req, res, next) {
  const body = req.body || {};
  const errors = {};
  const settings = validateSettings(body, errors);
  const plan = validateQuestionEntries(body.questions, errors);

  try {
    const bankQuestions = await loadBankQuestions(plan, errors);

    if (Object.keys(errors).length > 0) {
      return invalidQuizResponse(res, errors);
    }

    // Everything is valid, so new questions can now be added to the bank
    const newItems = plan.filter((item) => item.newQuestion);
    const createdQuestions = newItems.length === 0
      ? []
      : await Question.insertMany(newItems.map((item) => ({
        ...toSavedFields(item.newQuestion),
        createdBy: req.user.id
      })));

    newItems.forEach((item, position) => {
      item.source = createdQuestions[position];
    });

    const questions = plan.map((item) => snapshot(
      item.source || bankQuestions.get(item.questionId),
      item.marks
    ));

    const quiz = await Quiz.create({
      ...settings,
      questions,
      totalMarks: questions.reduce((sum, question) => sum + question.marks, 0),
      createdBy: req.user.id
    });

    return res.status(201).json({
      status: "success",
      message: "Quiz created",
      quiz: quiz.toJSON()
    });
  } catch (error) {
    return next(error);
  }
}

// Instructors see their own quizzes; Admins see every quiz
async function listQuizzes(req, res, next) {
  const filter = req.user.role === "admin" ? {} : { createdBy: req.user.id };

  try {
    const quizzes = await Quiz.find(filter).sort({ createdAt: -1 });

    return res.status(200).json({
      status: "success",
      count: quizzes.length,
      quizzes: quizzes.map((quiz) => quiz.toJSON())
    });
  } catch (error) {
    return next(error);
  }
}

async function getQuiz(req, res, next) {
  const notFound = () => res.status(404).json({
    status: "error",
    message: "Quiz not found"
  });

  if (!mongoose.isValidObjectId(req.params.id)) {
    return notFound();
  }

  try {
    const quiz = await Quiz.findById(req.params.id);

    if (!quiz) {
      return notFound();
    }

    if (req.user.role !== "admin" && quiz.createdBy.toString() !== req.user.id) {
      return res.status(403).json({
        status: "error",
        message: "You can only view quizzes you created"
      });
    }

    return res.status(200).json({
      status: "success",
      quiz: quiz.toJSON()
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createQuiz,
  listQuizzes,
  getQuiz
};
