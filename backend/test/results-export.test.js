const assert = require("node:assert/strict");
const { after, afterEach, before, describe, test } = require("node:test");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");
process.env.JWT_SECRET = "test-only-jwt-secret";
process.env.JWT_EXPIRES_IN = "1h";
const app = require("../src/app");
const Attempt = require("../src/models/Attempt");
const Quiz = require("../src/models/Quiz");
const User = require("../src/models/User");
const { csvCell, resultsFilename } = require("../src/modules/grading/resultsCsv");

let mongoServer;
let instructor;
let otherInstructor;
let students;

const HOUR = 60 * 60 * 1000;
const tokenFor = (user, role) => jwt.sign({ sub: user._id.toString(), role }, process.env.JWT_SECRET, { expiresIn: "1h" });

// Minimal CSV reader for the tests: handles quoted cells, "" escapes and CRLF
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const body = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (quoted) {
      if (char === '"' && body[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') { quoted = false; }
      else { cell += char; }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell); cell = "";
    } else if (char === "\r" && body[i + 1] === "\n") {
      row.push(cell); rows.push(row); row = []; cell = ""; i += 1;
    } else {
      cell += char;
    }
  }
  return rows;
}

async function createQuiz(title = "Transport Layer Quiz") {
  const sourceQuestion = new mongoose.Types.ObjectId();
  return Quiz.create({
    title,
    durationMinutes: 10,
    passingScore: 50,
    totalMarks: 4,
    createdBy: instructor._id,
    availableFrom: new Date(Date.now() - HOUR),
    availableUntil: new Date(Date.now() + 24 * HOUR),
    questions: [
      { sourceQuestion, text: "Which protocol sends email?", type: "mcq", options: ["SMTP", "FTP"], correctAnswer: "SMTP", marks: 1 },
      { sourceQuestion, text: "TCP is connection-oriented.", type: "true_false", correctAnswer: "true", marks: 1 },
      { sourceQuestion, text: "Explain the three-way handshake.", type: "short_answer", marks: 2 }
    ]
  });
}

async function submit(quiz, user, answers) {
  const token = tokenFor(user, "student");
  await request(app).post(`/api/quizzes/${quiz._id}/attempt/start`).set("Authorization", `Bearer ${token}`);
  return (await request(app).post(`/api/quizzes/${quiz._id}/attempt`).set("Authorization", `Bearer ${token}`).send({ answers })).body.attempt;
}

function exportCsv(quiz, user = instructor, role = "instructor") {
  return request(app)
    .get(`/api/quizzes/${quiz._id}/submissions/export`)
    .set("Authorization", `Bearer ${tokenFor(user, role)}`)
    .buffer(true)
    .parse((res, callback) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => callback(null, data));
    });
}

before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([Attempt.init(), Quiz.init(), User.init()]);
});

after(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await Promise.all([Attempt.deleteMany({}), Quiz.deleteMany({}), User.deleteMany({})]);
});

async function seedUsers() {
  const created = await User.create([
    { name: "Asha Rao", email: "asha@csqp.com", password: "hashed-password-placeholder", role: "instructor" },
    { name: "Ravi Kumar", email: "ravi@csqp.com", password: "hashed-password-placeholder", role: "instructor" },
    { name: "Sahana", email: "sahana@csqp.com", password: "hashed-password-placeholder", role: "student" },
    { name: "Meera, K", email: "meera@csqp.com", password: "hashed-password-placeholder", role: "student" },
    { name: "=HYPERLINK(\"x\")", email: "tricky@csqp.com", password: "hashed-password-placeholder", role: "student" }
  ]);
  [instructor, otherInstructor, ...students] = created;
}

describe("TC-Quiz-07: export quiz results as CSV (AC-026)", () => {
  test("one row per student attempt with the score and timestamps", async () => {
    await seedUsers();
    const quiz = await createQuiz();
    const [mcqId, tfId, shortId] = quiz.questions.map((question) => question._id.toString());
    const first = await submit(quiz, students[0], [
      { questionId: mcqId, response: "SMTP" },
      { questionId: tfId, response: "true" },
      { questionId: shortId, response: "SYN, SYN-ACK, ACK" }
    ]);
    await request(app)
      .put(`/api/quizzes/${quiz._id}/submissions/${first._id}/grades`)
      .set("Authorization", `Bearer ${tokenFor(instructor, "instructor")}`)
      .send({ grades: [{ questionId: shortId, marks: 1.5 }] });
    await submit(quiz, students[1], [{ questionId: mcqId, response: "FTP" }]);

    const response = await exportCsv(quiz);
    const rows = parseCsv(response.body);

    assert.equal(response.status, 200);
    assert.match(response.headers["content-type"], /^text\/csv/);
    assert.match(response.headers["content-disposition"], /^attachment; filename="transport-layer-quiz-results-\d{4}-\d{2}-\d{2}\.csv"$/);
    assert.match(response.headers["access-control-expose-headers"], /Content-Disposition/);
    assert.deepEqual(rows[0], [
      "Student name", "Student email", "Status", "Started at", "Submitted at", "Score", "Max score",
      "Percentage", "Passed", "Grading status", "Pending marks",
      "Q1 marks (out of 1)", "Q2 marks (out of 1)", "Q3 marks (out of 2)"
    ]);
    assert.equal(rows.length, 3);

    const sahana = rows[1];
    assert.deepEqual(sahana.slice(0, 3), ["Sahana", "sahana@csqp.com", "submitted"]);
    assert.ok(!Number.isNaN(Date.parse(sahana[3])));
    assert.ok(!Number.isNaN(Date.parse(sahana[4])));
    assert.deepEqual(sahana.slice(5), ["3.5", "4", "87.5", "Yes", "complete", "0", "1", "1", "1.5"]);

    const meera = rows[2];
    assert.equal(meera[0], "Meera, K");
    assert.deepEqual(meera.slice(5), ["0", "4", "0", "Pending", "pending_manual", "2", "0", "0", ""]);
  });

  test("attempts in progress are listed without a score, and timed-out ones as auto-submitted", async () => {
    await seedUsers();
    const quiz = await createQuiz();
    const start = (user) => request(app).post(`/api/quizzes/${quiz._id}/attempt/start`).set("Authorization", `Bearer ${tokenFor(user, "student")}`);
    await start(students[0]);
    await start(students[1]);
    await Attempt.updateOne({ student: students[1]._id }, { expiresAt: new Date(Date.now() - 60 * 1000) });

    const rows = parseCsv((await exportCsv(quiz)).body);
    const byEmail = Object.fromEntries(rows.slice(1).map((row) => [row[1], row]));

    assert.equal(byEmail["sahana@csqp.com"][2], "in_progress");
    assert.equal(byEmail["sahana@csqp.com"][4], "");
    assert.equal(byEmail["sahana@csqp.com"][5], "");
    assert.equal(byEmail["meera@csqp.com"][2], "auto_submitted");
    assert.equal(byEmail["meera@csqp.com"][5], "0");
  });

  test("a quiz with no attempts exports just the header row", async () => {
    await seedUsers();
    const quiz = await createQuiz();

    const response = await exportCsv(quiz);
    const rows = parseCsv(response.body);

    assert.equal(response.status, 200);
    assert.equal(rows.length, 1);
    assert.ok(response.body.startsWith("\uFEFF"));
  });

  test("text that looks like a spreadsheet formula is kept as plain text", async () => {
    await seedUsers();
    const quiz = await createQuiz();
    await submit(quiz, students[2], []);

    const rows = parseCsv((await exportCsv(quiz)).body);

    assert.equal(rows[1][0], "'=HYPERLINK(\"x\")");
  });

  test("an older attempt with no grading is graded during export", async () => {
    await seedUsers();
    const quiz = await createQuiz();
    await Attempt.create({
      quiz: quiz._id,
      student: students[0]._id,
      status: "submitted",
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 1000),
      submittedAt: new Date(),
      answers: [{ questionId: quiz.questions[0]._id, response: "SMTP" }]
    });

    const rows = parseCsv((await exportCsv(quiz)).body);

    assert.equal(rows[1][5], "1");
    assert.equal(rows[1][11], "1");
  });

  test("only the quiz owner or an admin can export", async () => {
    await seedUsers();
    const quiz = await createQuiz();

    const other = await exportCsv(quiz, otherInstructor);
    const student = await exportCsv(quiz, students[0], "student");
    const admin = await exportCsv(quiz, otherInstructor, "admin");
    const anonymous = await request(app).get(`/api/quizzes/${quiz._id}/submissions/export`);
    const unknown = await request(app)
      .get(`/api/quizzes/${new mongoose.Types.ObjectId()}/submissions/export`)
      .set("Authorization", `Bearer ${tokenFor(instructor, "instructor")}`);

    assert.equal(other.status, 403);
    assert.equal(student.status, 403);
    assert.equal(admin.status, 200);
    assert.equal(anonymous.status, 401);
    assert.equal(unknown.status, 404);
  });
});

describe("TC-Quiz-07: CSV formatting rules", () => {
  test("quotes commas, quotes and line breaks; leaves numbers alone", () => {
    assert.equal(csvCell("plain"), "plain");
    assert.equal(csvCell("a,b"), "\"a,b\"");
    assert.equal(csvCell("say \"hi\""), "\"say \"\"hi\"\"\"");
    assert.equal(csvCell("two\nlines"), "\"two\nlines\"");
    assert.equal(csvCell(-2), "-2");
    assert.equal(csvCell("-2"), "'-2");
    assert.equal(csvCell("@cmd"), "'@cmd");
    assert.equal(csvCell(null), "");
    assert.equal(csvCell(undefined), "");
  });

  test("file names are safe and dated", () => {
    const now = new Date("2026-11-10T08:00:00Z");

    assert.equal(resultsFilename({ title: "Networks: Quiz #1!" }, now), "networks-quiz-1-results-2026-11-10.csv");
    assert.equal(resultsFilename({ title: "!!!" }, now), "quiz-results-2026-11-10.csv");
  });
});
