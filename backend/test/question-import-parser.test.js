const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const {
  ImportFileError,
  parseCsv,
  parseXlsx,
  parseSpreadsheet,
  buildColumnMap,
  rowToBody
} = require("../src/modules/questionBank/questionImport.parser");
const { buildXlsx } = require("./helpers/xlsx");

function cells(rows) {
  return rows.map((row) => row.cells);
}

describe("CSV parsing", () => {
  test("splits simple rows and numbers them from 1", () => {
    const rows = parseCsv("a,b,c\n1,2,3\n");

    assert.deepEqual(cells(rows), [["a", "b", "c"], ["1", "2", "3"]]);
    assert.deepEqual(rows.map((row) => row.rowNumber), [1, 2]);
  });

  test("handles quotes, commas and line breaks inside fields, and doubled quotes", () => {
    const rows = parseCsv("text,note\r\n\"Is 2 + 2, really 4?\",\"He said \"\"yes\"\"\"\r\n\"line one\nline two\",x\r\n");

    assert.deepEqual(cells(rows), [
      ["text", "note"],
      ["Is 2 + 2, really 4?", "He said \"yes\""],
      ["line one\nline two", "x"]
    ]);
  });

  test("ignores a leading byte order mark and reads semicolon or tab separated files", () => {
    assert.deepEqual(cells(parseCsv("\uFEFFa;b\n1;2")), [["a", "b"], ["1", "2"]]);
    assert.deepEqual(cells(parseCsv("a\tb\n1\t2")), [["a", "b"], ["1", "2"]]);
  });

  test("keeps empty fields and a last row with no line break", () => {
    assert.deepEqual(cells(parseCsv("a,b,c\n1,,3")), [["a", "b", "c"], ["1", "", "3"]]);
  });

  test("rejects a quote that is never closed", () => {
    assert.throws(() => parseCsv("a,b\n\"oops,1"), ImportFileError);
  });
});

describe("XLSX parsing", () => {
  test("reads text, numbers and booleans from the first sheet", () => {
    const rows = parseXlsx(buildXlsx([
      ["text", "marks", "flag"],
      ["Is 5 > 3 & 2 < 4?", 42, true]
    ]));

    assert.deepEqual(cells(rows), [["text", "marks", "flag"], ["Is 5 > 3 & 2 < 4?", "42", "TRUE"]]);
    assert.deepEqual(rows.map((row) => row.rowNumber), [1, 2]);
  });

  test("keeps column positions when a cell is empty", () => {
    const rows = parseXlsx(buildXlsx([["a", null, "c"]]));

    assert.deepEqual(cells(rows), [["a", "", "c"]]);
  });

  test("rejects files that are not workbooks", () => {
    assert.throws(() => parseXlsx(Buffer.from("this is not a zip file at all, just text")), ImportFileError);
    assert.throws(() => parseXlsx(buildXlsx([["a"]]).subarray(0, 60)), ImportFileError);
  });
});

describe("file type detection", () => {
  test("chooses the reader from the file extension", () => {
    const csv = parseSpreadsheet({ originalname: "Questions.CSV", buffer: Buffer.from("a,b\n1,2") });
    const xlsx = parseSpreadsheet({ originalname: "questions.xlsx", buffer: buildXlsx([["a", "b"], ["1", "2"]]) });

    assert.deepEqual(cells(csv), [["a", "b"], ["1", "2"]]);
    assert.deepEqual(cells(xlsx), [["a", "b"], ["1", "2"]]);
  });

  test("rejects other extensions and fake .xlsx files", () => {
    assert.throws(() => parseSpreadsheet({ originalname: "q.xls", buffer: Buffer.from("x") }), /Only \.csv and \.xlsx/);
    assert.throws(() => parseSpreadsheet({ originalname: "q.pdf", buffer: Buffer.from("x") }), ImportFileError);
    assert.throws(() => parseSpreadsheet({ originalname: "q.xlsx", buffer: Buffer.from("plain text") }), ImportFileError);
  });
});

describe("columns and rows", () => {
  const header = ["Question", "Type", "Subject", "Topic", "Level", "Option A", "Option B", "Option C", "Answer", "Notes"];

  test("matches header names ignoring case, spaces and aliases", () => {
    const map = buildColumnMap(header);

    assert.deepEqual(map.missing, []);
    assert.deepEqual(map.optionColumns, [5, 6, 7]);
    assert.equal(map.fields.text, 0);
    assert.equal(map.fields.difficulty, 4);
    assert.equal(map.fields.correctAnswer, 8);
  });

  test("lists the required columns that are missing", () => {
    assert.deepEqual(buildColumnMap(["text", "type", "difficulty"]).missing, ["subject", "topic"]);
  });

  test("builds a question body from separate option columns", () => {
    const body = rowToBody(["Capital of France?", "mcq", "Geography", "Europe", "easy", "Paris", "Rome", " ", "Paris"], buildColumnMap(header));

    assert.deepEqual(body.options, ["Paris", "Rome"]);
    assert.equal(body.text, "Capital of France?");
    assert.equal(body.correctAnswer, "Paris");
  });

  test("builds options from one pipe separated column", () => {
    const map = buildColumnMap(["text", "type", "subject", "topic", "difficulty", "options", "correctAnswer"]);
    const body = rowToBody(["Q", "mcq", "S", "T", "easy", "A | B |C", "B"], map);

    assert.deepEqual(body.options, ["A", "B", "C"]);
  });

  test("leaves a blank correct answer out", () => {
    const map = buildColumnMap(["text", "type", "subject", "topic", "difficulty", "correctAnswer"]);

    assert.equal("correctAnswer" in rowToBody(["Q", "short_answer", "S", "T", "easy", ""], map), false);
  });
});