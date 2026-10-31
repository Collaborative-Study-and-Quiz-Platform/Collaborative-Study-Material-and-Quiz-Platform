const Question = require("../../models/Question");
const {
  normalizeQuestionInput,
  validateQuestionInput,
  toSavedFields
} = require("./questionBank.controller");
const {
  ImportFileError,
  parseSpreadsheet,
  buildColumnMap,
  rowToBody
} = require("./questionImport.parser");

const MAX_IMPORT_FILE_SIZE = 1024 * 1024;
const MAX_IMPORT_ROWS = 500;
const CASE_INSENSITIVE = { locale: "en", strength: 2 };
const OPTION_LETTERS = "abcdef";

function failure(res, message, extra = {}) {
  return res.status(400).json({ status: "error", message, ...extra });
}

function duplicateKey(question) {
  return [question.subject, question.topic, question.text]
    .map((value) => value.toLowerCase())
    .join("\u0000");
}

// Lets the sheet say the correct answer as an option letter (B) or number (2)
function resolveOptionReference(body) {
  const answer = body.correctAnswer;
  const type = typeof body.type === "string" ? body.type.trim().toLowerCase() : "";

  if (type !== "mcq" || typeof answer !== "string" || body.options.includes(answer)) {
    return;
  }
  const letter = OPTION_LETTERS.indexOf(answer.toLowerCase());
  const position = /^[1-6]$/.test(answer) ? Number(answer) - 1 : letter;
  const option = answer.length === 1 ? body.options[position] : undefined;

  if (option !== undefined) {
    body.correctAnswer = option;
  }
}

function isBlankRow(row) {
  return row.cells.every((cell) => String(cell).trim() === "");
}

// Bulk import (CSV or Excel). Valid rows are saved; invalid rows are reported
// with the row number and the reason, and never block the valid ones.
async function importQuestions(req, res, next) {
  if (!req.file) {
    return failure(res, "Upload a .csv or .xlsx file in the \"file\" field");
  }

  let rows;
  try {
    rows = parseSpreadsheet(req.file).filter((row) => !isBlankRow(row));
  } catch (error) {
    if (error instanceof ImportFileError) {
      return failure(res, error.message);
    }
    return next(error);
  }

  if (rows.length === 0) {
    return failure(res, "The file is empty");
  }

  const [header, ...dataRows] = rows;
  const columns = buildColumnMap(header.cells);

  if (columns.missing.length > 0) {
    return failure(res, `Missing required columns: ${columns.missing.join(", ")}`, {
      missingColumns: columns.missing
    });
  }
  if (dataRows.length === 0) {
    return failure(res, "The file has a header row but no questions");
  }
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return failure(res, `A file can contain at most ${MAX_IMPORT_ROWS} questions`);
  }

  const rowErrors = [];
  const valid = [];
  const firstRowOf = new Map();

  dataRows.forEach((row) => {
    const body = rowToBody(row.cells, columns);
    resolveOptionReference(body);

    const question = normalizeQuestionInput(body);
    const errors = validateQuestionInput(question);

    if (Object.keys(errors).length === 0) {
      const key = duplicateKey(question);
      if (firstRowOf.has(key)) {
        errors.text = `Duplicate of row ${firstRowOf.get(key)} in this file`;
      } else {
        firstRowOf.set(key, row.rowNumber);
      }
    }

    if (Object.keys(errors).length > 0) {
      rowErrors.push({ row: row.rowNumber, errors });
    } else {
      valid.push({ row: row.rowNumber, question });
    }
  });

  try {
    if (valid.length > 0) {
      const existing = await Question.find({
        isDeleted: false,
        text: { $in: valid.map((item) => item.question.text) }
      })
        .collation(CASE_INSENSITIVE)
        .select("text subject topic")
        .lean();
      const existingKeys = new Set(existing.map(duplicateKey));

      for (let i = valid.length - 1; i >= 0; i -= 1) {
        if (existingKeys.has(duplicateKey(valid[i].question))) {
          rowErrors.push({
            row: valid[i].row,
            errors: { text: "This question already exists in the question bank" }
          });
          valid.splice(i, 1);
        }
      }
    }

    rowErrors.sort((a, b) => a.row - b.row);
    const summary = {
      totalRows: dataRows.length,
      imported: valid.length,
      failed: rowErrors.length
    };

    if (valid.length === 0) {
      return failure(res, "No valid questions were found in the file", {
        summary,
        errors: rowErrors
      });
    }

    const saved = await Question.insertMany(
      valid.map((item) => ({ ...toSavedFields(item.question), createdBy: req.user.id }))
    );

    return res.status(201).json({
      status: "success",
      message: `Imported ${summary.imported} of ${summary.totalRows} questions`,
      summary,
      errors: rowErrors,
      questions: saved.map((question) => question.toJSON())
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  importQuestions,
  MAX_IMPORT_FILE_SIZE,
  MAX_IMPORT_ROWS
};