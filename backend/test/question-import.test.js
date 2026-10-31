const assert = require("node:assert/strict");
const { after, afterEach, before, describe, test } = require("node:test");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");
process.env.JWT_SECRET = "test-only-jwt-secret";
process.env.JWT_EXPIRES_IN = "1h";
const app = require("../src/app");
const Question = require("../src/models/Question");
const { buildXlsx } = require("./helpers/xlsx");

let mongoServer;

const instructorId = new mongoose.Types.ObjectId().toString();
const studentId = new mongoose.Types.ObjectId().toString();

function tokenFor(id, role) {
  return jwt.sign({ sub: id, role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

const instructorToken = tokenFor(instructorId, "instructor");
const studentToken = tokenFor(studentId, "student");

const HEADER = "text,type,subject,topic,difficulty,option1,option2,option3,option4,correctAnswer";

function importFile(buffer, filename, token = instructorToken) {
  const call = request(app).post("/api/questions/import");
  if (token) {
    call.set("Authorization", `Bearer ${token}`);
  }
  return buffer === undefined ? call : call.attach("file", buffer, { filename });
}

function importCsv(lines, token) {
  return importFile(Buffer.from([HEADER, ...lines].join("\n")), "questions.csv", token);
}

before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Question.init();
});

after(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await Question.deleteMany({});
});

describe("TC-QB-03 bulk question import", () => {
  test("imports every row of a valid CSV file", async () => {
    const response = await importCsv([
      "Which protocol sends email?,mcq,Computer Networks,Application Layer,easy,SMTP,FTP,HTTP,SSH,SMTP",
      "TCP is connection oriented,true_false,Computer Networks,Transport Layer,easy,,,,,TRUE",
      "Explain DNS,short_answer,Computer Networks,Application Layer,hard,,,,,Maps names to addresses"
    ]);

    assert.equal(response.status, 201);
    assert.equal(response.body.status, "success");
    assert.deepEqual(response.body.summary, { totalRows: 3, imported: 3, failed: 0 });
    assert.deepEqual(response.body.errors, []);
    assert.equal(response.body.questions.length, 3);
    assert.equal(response.body.questions[0].createdBy, instructorId);
    assert.equal(response.body.questions[1].correctAnswer, "true");
    assert.equal(await Question.countDocuments(), 3);
  });

  test("imported questions appear in the question bank", async () => {
    await importCsv(["Capital of France?,mcq,Geography,Europe,easy,Paris,Rome,Madrid,,Paris"]);

    const list = await request(app)
      .get("/api/questions")
      .query({ subject: "Geography" })
      .set("Authorization", `Bearer ${instructorToken}`);

    assert.equal(list.body.count, 1);
    assert.deepEqual(list.body.questions[0].options, ["Paris", "Rome", "Madrid"]);
  });

  test("imports an Excel workbook", async () => {
    const workbook = buildXlsx([
      ["text", "type", "subject", "topic", "difficulty", "options", "correctAnswer"],
      ["Which port does HTTPS use?", "mcq", "Networks", "Application Layer", "medium", "80 | 443 | 22", "B"],
      ["UDP is reliable", "true_false", "Networks", "Transport Layer", "easy", null, false]
    ]);

    const response = await importFile(workbook, "questions.xlsx");

    assert.equal(response.status, 201);
    assert.equal(response.body.summary.imported, 2);
    assert.equal(response.body.questions[0].correctAnswer, "443");
    assert.equal(response.body.questions[1].correctAnswer, "false");
  });

  test("saves valid rows and reports each invalid row with its reason", async () => {
    const response = await importCsv([
      "Good question,mcq,Networks,IP,easy,A,B,C,,A",
      "Bad type,essay,Networks,IP,easy,,,,,",
      "Needs a topic,true_false,Networks,,easy,,,,,true",
      "MCQ answer not an option,mcq,Networks,IP,easy,A,B,,,Z",
      ",,,,,,,,,",
      "Another good one,short_answer,Networks,IP,hard,,,,,Model answer"
    ]);

    assert.equal(response.status, 201);
    assert.deepEqual(response.body.summary, { totalRows: 5, imported: 2, failed: 3 });
    assert.deepEqual(response.body.errors.map((item) => item.row), [3, 4, 5]);
    assert.equal(response.body.errors[0].errors.type, "Type must be mcq, true_false, or short_answer");
    assert.equal(response.body.errors[1].errors.topic, "Topic is required");
    assert.equal(response.body.errors[2].errors.correctAnswer, "Correct answer must match one of the options");
    assert.equal(await Question.countDocuments(), 2);
  });

  test("skips duplicates inside the file and questions already in the bank", async () => {
    await Question.create({
      text: "Already here?",
      type: "true_false",
      correctAnswer: "true",
      subject: "Networks",
      topic: "IP",
      difficulty: "easy",
      createdBy: instructorId
    });

    const response = await importCsv([
      "Already here?,true_false,networks,ip,easy,,,,,true",
      "Brand new,true_false,Networks,IP,easy,,,,,true",
      "brand new,true_false,Networks,IP,easy,,,,,false"
    ]);

    assert.equal(response.status, 201);
    assert.equal(response.body.summary.imported, 1);
    assert.equal(response.body.errors[0].errors.text, "This question already exists in the question bank");
    assert.equal(response.body.errors[1].errors.text, "Duplicate of row 3 in this file");
    assert.equal(await Question.countDocuments(), 2);
  });

  test("returns 400 and saves nothing when no row is valid", async () => {
    const response = await importCsv(["Bad,essay,Networks,IP,easy,,,,,"]);

    assert.equal(response.status, 400);
    assert.equal(response.body.message, "No valid questions were found in the file");
    assert.equal(response.body.errors[0].row, 2);
    assert.equal(await Question.countDocuments(), 0);
  });

  test("rejects a file with missing required columns", async () => {
    const response = await importFile(Buffer.from("text,type\nQ,mcq"), "questions.csv");

    assert.equal(response.status, 400);
    assert.deepEqual(response.body.missingColumns, ["subject", "topic", "difficulty"]);
  });

  test("rejects an empty file, a header-only file and a file with too many rows", async () => {
    const empty = await importFile(Buffer.from(""), "questions.csv");
    const headerOnly = await importFile(Buffer.from(HEADER), "questions.csv");
    const tooMany = await importCsv(
      Array.from({ length: 501 }, (unused, i) => `Q${i},short_answer,S,T,easy,,,,,`)
    );

    assert.equal(empty.status, 400);
    assert.equal(headerOnly.status, 400);
    assert.equal(tooMany.status, 400);
    assert.equal(tooMany.body.message, "A file can contain at most 500 questions");
    assert.equal(await Question.countDocuments(), 0);
  });

  test("rejects a missing file, an unsupported file type and an oversized file", async () => {
    const missing = await importFile(undefined, undefined);
    const wrongType = await importFile(Buffer.from("a,b"), "questions.pdf");
    const tooLarge = await importFile(Buffer.alloc(1024 * 1024 + 1, "a"), "questions.csv");

    assert.equal(missing.status, 400);
    assert.equal(wrongType.status, 400);
    assert.equal(wrongType.body.message, "Only .csv and .xlsx files can be imported");
    assert.equal(tooLarge.status, 400);
  });

  test("only instructors and admins can import", async () => {
    const anonymous = await importCsv(["Q,short_answer,S,T,easy,,,,,"], null);
    const student = await importCsv(["Q,short_answer,S,T,easy,,,,,"], studentToken);

    assert.equal(anonymous.status, 401);
    assert.equal(student.status, 403);
    assert.equal(await Question.countDocuments(), 0);
  });
});