// Builds the quiz results CSV (CSQP-F-026): one row per student attempt.

// Spreadsheet apps run cells starting with these characters as formulas,
// so such values are prefixed with an apostrophe to keep them as plain text
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value) {
  if (value === null || value === undefined) {
    return "";
  }
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === "string" && FORMULA_START.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvLine(values) {
  return values.map(csvCell).join(",");
}

function passedLabel(grading) {
  if (!grading) {
    return "";
  }
  if (grading.gradingStatus !== "complete") {
    return "Pending";
  }
  return grading.passed ? "Yes" : "No";
}

// rows: [{ student: { name, email }, attempt }]
function buildResultsCsv(quiz, rows) {
  const questionHeaders = quiz.questions.map((question, index) => `Q${index + 1} marks (out of ${question.marks})`);
  const lines = [csvLine([
    "Student name",
    "Student email",
    "Status",
    "Started at",
    "Submitted at",
    "Score",
    "Max score",
    "Percentage",
    "Passed",
    "Grading status",
    "Pending marks",
    ...questionHeaders
  ])];

  rows.forEach(({ student, attempt }) => {
    const { grading } = attempt;
    const marks = new Map((grading?.results || []).map((result) => [result.questionId.toString(), result.marksAwarded]));

    lines.push(csvLine([
      student.name,
      student.email,
      attempt.status,
      attempt.startedAt,
      attempt.submittedAt,
      grading?.score,
      grading?.maxScore ?? quiz.totalMarks,
      grading?.percentage,
      passedLabel(grading),
      grading?.gradingStatus,
      grading?.pendingMarks,
      ...quiz.questions.map((question) => marks.get(question._id.toString()))
    ]));
  });

  // The byte order mark makes Excel read the file as UTF-8
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function resultsFilename(quiz, now = new Date()) {
  const slug = quiz.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "quiz";
  return `${slug}-results-${now.toISOString().slice(0, 10)}.csv`;
}

module.exports = {
  buildResultsCsv,
  csvCell,
  resultsFilename
};
