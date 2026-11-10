const mongoose = require("mongoose");
const Question = require("../../models/Question");
const { findDuplicates } = require("./duplicateDetection");

const QUESTION_TYPES = new Set(Question.QUESTION_TYPES);
const DIFFICULTY_LEVELS = new Set(Question.DIFFICULTY_LEVELS);
const METADATA_FIELDS = ["subject", "topic"];
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;
const CASE_INSENSITIVE = { locale: "en", strength: 2 };
const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 30;
const MAX_KEYWORD_LENGTH = 100;

// Accepts tags as a list or as text separated by commas or semicolons,
// and returns them trimmed, lower case, and without repeats
function normalizeTags(value) {
  if (value === undefined || value === null || value === "") {
    return [];
  }
  const parts = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;]/) : null;
  if (!parts) {
    return value;
  }
  const tags = parts
    .map((tag) => (typeof tag === "string" ? tag.trim().toLowerCase().replace(/\s+/g, " ") : tag))
    .filter((tag) => tag !== "");
  return [...new Set(tags)];
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : value;
}

function normalizeChoice(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : value;
}

// Builds a clean question object from the request body
function normalizeQuestionInput(body) {
  const question = {
    text: normalizeText(body.text),
    type: normalizeChoice(body.type),
    subject: normalizeText(body.subject),
    topic: normalizeText(body.topic),
    difficulty: normalizeChoice(body.difficulty),
    tags: normalizeTags(body.tags),
    options: Array.isArray(body.options)
      ? body.options.map(normalizeText)
      : body.options,
    correctAnswer: typeof body.correctAnswer === "boolean"
      ? String(body.correctAnswer)
      : normalizeText(body.correctAnswer)
  };

  if (question.type === "true_false" && typeof question.correctAnswer === "string") {
    question.correctAnswer = question.correctAnswer.toLowerCase();
  }

  return question;
}

function validateOptions(question, errors) {
  if (question.type !== "mcq") {
    if (question.options !== undefined && question.options.length > 0) {
      errors.options = "Options are only allowed for MCQ questions";
    }
    return;
  }

  const { options } = question;

  if (!Array.isArray(options)
    || options.length < MIN_OPTIONS
    || options.length > MAX_OPTIONS) {
    errors.options = `MCQ questions need ${MIN_OPTIONS} to ${MAX_OPTIONS} options`;
  } else if (options.some((option) => typeof option !== "string" || !option)) {
    errors.options = "Every option must be non-empty text";
  } else if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) {
    errors.options = "Options must be unique";
  }
}

function validateCorrectAnswer(question, errors) {
  const { type, correctAnswer, options } = question;

  if (type === "short_answer") {
    if (correctAnswer !== undefined && typeof correctAnswer !== "string") {
      errors.correctAnswer = "Model answer must be text";
    }
    return;
  }

  if (typeof correctAnswer !== "string" || !correctAnswer) {
    errors.correctAnswer = "Correct answer is required";
  } else if (type === "true_false" && !["true", "false"].includes(correctAnswer)) {
    errors.correctAnswer = "Correct answer must be true or false";
  } else if (type === "mcq" && !errors.options && !options.includes(correctAnswer)) {
    errors.correctAnswer = "Correct answer must match one of the options";
  }
}

function validateQuestionInput(question) {
  const errors = {};

  if (typeof question.text !== "string" || !question.text) {
    errors.text = "Question text is required";
  } else if (question.text.length > 2000) {
    errors.text = "Question text must be 2000 characters or fewer";
  }

  if (!QUESTION_TYPES.has(question.type)) {
    errors.type = "Type must be mcq, true_false, or short_answer";
  }

  METADATA_FIELDS.forEach((field) => {
    const label = field.charAt(0).toUpperCase() + field.slice(1);

    if (typeof question[field] !== "string" || !question[field]) {
      errors[field] = `${label} is required`;
    } else if (question[field].length > 100) {
      errors[field] = `${label} must be 100 characters or fewer`;
    }
  });

  if (!DIFFICULTY_LEVELS.has(question.difficulty)) {
    errors.difficulty = "Difficulty must be easy, medium, or hard";
  }

  if (!Array.isArray(question.tags) || question.tags.some((tag) => typeof tag !== "string")) {
    errors.tags = "Tags must be a list of words";
  } else if (question.tags.length > MAX_TAGS) {
    errors.tags = `A question can have at most ${MAX_TAGS} tags`;
  } else if (question.tags.some((tag) => tag.length > MAX_TAG_LENGTH)) {
    errors.tags = `Each tag must be ${MAX_TAG_LENGTH} characters or fewer`;
  }

  if (!errors.type) {
    validateOptions(question, errors);
    validateCorrectAnswer(question, errors);
  }

  return errors;
}

function toSavedFields(question) {
  return {
    text: question.text,
    type: question.type,
    subject: question.subject,
    topic: question.topic,
    difficulty: question.difficulty,
    tags: Array.isArray(question.tags) ? question.tags : [],
    options: question.type === "mcq" ? question.options : [],
    correctAnswer: question.correctAnswer || undefined
  };
}

function duplicateResponse(res, duplicates) {
  return res.status(409).json({
    status: "error",
    code: "DUPLICATE_QUESTION",
    message: "This question looks like a duplicate of one already in the bank",
    duplicates
  });
}

// POST /api/questions/check-duplicates { text, excludeId? }
// Checks for near-identical questions without saving anything
async function checkDuplicates(req, res, next) {
  const body = req.body || {};
  const text = typeof body.text === "string" ? body.text.trim() : "";

  if (!text) {
    return invalidQuestionResponse(res, { text: "Question text is required" });
  }
  if (text.length > 2000) {
    return invalidQuestionResponse(res, { text: "Question text must be 2000 characters or fewer" });
  }
  if (body.excludeId !== undefined && !mongoose.isValidObjectId(body.excludeId)) {
    return invalidQuestionResponse(res, { excludeId: "excludeId must be a question ID" });
  }

  try {
    const duplicates = await findDuplicates(text, { excludeId: body.excludeId });
    return res.status(200).json({
      status: "success",
      hasDuplicates: duplicates.length > 0,
      duplicates
    });
  } catch (error) {
    return next(error);
  }
}

function invalidQuestionResponse(res, errors) {
  return res.status(400).json({
    status: "error",
    message: "Question details are invalid",
    errors
  });
}

function questionNotFound(res) {
  return res.status(404).json({
    status: "error",
    message: "Question not found"
  });
}

function canModify(user, question) {
  return user.role === "admin" || question.createdBy.toString() === user.id;
}

// Finds a question that has not been deleted, or sends the error response
async function findActiveQuestion(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    questionNotFound(res);
    return null;
  }

  const question = await Question.findOne({ _id: req.params.id, isDeleted: false });

  if (!question) {
    questionNotFound(res);
    return null;
  }

  return question;
}

async function createQuestion(req, res, next) {
  const question = normalizeQuestionInput(req.body || {});
  const errors = validateQuestionInput(question);

  if (Object.keys(errors).length > 0) {
    return invalidQuestionResponse(res, errors);
  }

  try {
    // CSQP-F-033: warn before saving a near-identical question
    if (req.body.allowDuplicate !== true) {
      const duplicates = await findDuplicates(question.text);
      if (duplicates.length > 0) {
        return duplicateResponse(res, duplicates);
      }
    }

    const savedQuestion = await Question.create({
      ...toSavedFields(question),
      createdBy: req.user.id
    });

    return res.status(201).json({
      status: "success",
      message: "Question created",
      question: savedQuestion.toJSON()
    });
  } catch (error) {
    return next(error);
  }
}

// Searches and filters the question bank (CSQP-F-030, CSQP-F-031).
// Every filter given must match: q (words in the question text), tag (one
// or more, comma-separated, all required), subject, topic, difficulty, type.
async function listQuestions(req, res, next) {
  const filters = {};
  const errors = {};
  const query = req.query || {};

  if (query.q !== undefined) {
    const keyword = typeof query.q === "string" ? query.q.trim() : "";
    if (typeof query.q !== "string" || keyword.length > MAX_KEYWORD_LENGTH) {
      errors.q = `Search text must be ${MAX_KEYWORD_LENGTH} characters or fewer`;
    } else if (keyword) {
      // Each word must appear somewhere in the question text
      filters.$and = keyword.split(/\s+/).map((word) => ({
        text: { $regex: escapeRegex(word), $options: "i" }
      }));
    }
  }

  if (query.tag !== undefined) {
    const tags = typeof query.tag === "string" ? normalizeTags(query.tag) : null;
    if (!tags) {
      errors.tag = "Tag filter must be text";
    } else if (tags.length > 0) {
      filters.tags = { $all: tags };
    }
  }

  METADATA_FIELDS.forEach((field) => {
    if (typeof query[field] === "string" && query[field].trim()) {
      filters[field] = query[field].trim();
    }
  });

  if (query.difficulty !== undefined) {
    const difficulty = normalizeChoice(query.difficulty);
    if (DIFFICULTY_LEVELS.has(difficulty)) {
      filters.difficulty = difficulty;
    } else {
      errors.difficulty = "Difficulty must be easy, medium, or hard";
    }
  }

  if (query.type !== undefined) {
    const type = normalizeChoice(query.type);
    if (QUESTION_TYPES.has(type)) {
      filters.type = type;
    } else {
      errors.type = "Type must be mcq, true_false, or short_answer";
    }
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({
      status: "error",
      message: "Filter values are invalid",
      errors
    });
  }

  try {
    const questions = await Question.find({ ...filters, isDeleted: false })
      .collation(CASE_INSENSITIVE)
      .sort({ createdAt: -1 });

    return res.status(200).json({
      status: "success",
      count: questions.length,
      questions: questions.map((question) => question.toJSON())
    });
  } catch (error) {
    return next(error);
  }
}

async function getQuestion(req, res, next) {
  try {
    const question = await findActiveQuestion(req, res);
    if (!question) {
      return undefined;
    }

    return res.status(200).json({
      status: "success",
      question: question.toJSON()
    });
  } catch (error) {
    return next(error);
  }
}

// Edits a question; fields not sent keep their current values
async function updateQuestion(req, res, next) {
  try {
    const question = await findActiveQuestion(req, res);
    if (!question) {
      return undefined;
    }

    if (!canModify(req.user, question)) {
      return res.status(403).json({
        status: "error",
        message: "You can only edit questions you created"
      });
    }

    const body = req.body || {};
    const changes = normalizeQuestionInput({ ...question.toObject(), ...body });

    if (body.type !== undefined && changes.type !== "mcq" && body.options === undefined) {
      changes.options = [];
    }

    const errors = validateQuestionInput(changes);

    if (Object.keys(errors).length > 0) {
      return invalidQuestionResponse(res, errors);
    }

    // Only a changed question text is checked again
    const textChanged = changes.text !== question.text;
    if (textChanged && body.allowDuplicate !== true) {
      const duplicates = await findDuplicates(changes.text, { excludeId: question._id });
      if (duplicates.length > 0) {
        return duplicateResponse(res, duplicates);
      }
    }

    question.set(toSavedFields(changes));
    if (!changes.correctAnswer) {
      question.correctAnswer = undefined;
    }
    await question.save();

    return res.status(200).json({
      status: "success",
      message: "Question updated",
      question: question.toJSON()
    });
  } catch (error) {
    return next(error);
  }
}

// Soft delete: the question is hidden from the bank but kept for existing quizzes
async function deleteQuestion(req, res, next) {
  try {
    const question = await findActiveQuestion(req, res);
    if (!question) {
      return undefined;
    }

    if (!canModify(req.user, question)) {
      return res.status(403).json({
        status: "error",
        message: "You can only delete questions you created"
      });
    }

    question.isDeleted = true;
    question.deletedAt = new Date();
    await question.save();

    return res.status(200).json({
      status: "success",
      message: "Question deleted"
    });
  } catch (error) {
    return next(error);
  }
}

// Lists the tags already used in the bank, most used first, for suggestions
async function listTags(req, res, next) {
  try {
    const tags = await Question.aggregate([
      { $match: { isDeleted: false } },
      { $unwind: "$tags" },
      { $group: { _id: "$tags", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 100 }
    ]);

    return res.status(200).json({
      status: "success",
      tags: tags.map((tag) => ({ tag: tag._id, count: tag.count }))
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  checkDuplicates,
  createQuestion,
  listQuestions,
  listTags,
  getQuestion,
  updateQuestion,
  deleteQuestion,
  normalizeQuestionInput,
  validateQuestionInput,
  toSavedFields,
  normalizeTags
};
