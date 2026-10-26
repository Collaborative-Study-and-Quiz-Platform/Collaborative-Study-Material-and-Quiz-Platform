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

let mongoServer;

const instructorId = new mongoose.Types.ObjectId().toString();
const studentId = new mongoose.Types.ObjectId().toString();
const otherStudentId = new mongoose.Types.ObjectId().toString();

function tokenFor(id, role) {
  return jwt.sign({ sub: id, role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

const studentToken = tokenFor(studentId, "student");
const otherStudentToken = tokenFor(otherStudentId, "student");
const instructorToken = tokenFor(instructorId, "instructor");

async function createQuiz({ showAnswers, withShortAnswer = false }) {
  const sourceQuestion = new mongoose.Types.ObjectId();
  const questions = [
    {
      sourceQuestion,
      text: "Which protocol is used to send email?",
      type: "mcq",
      options: ["SMTP", "FTP", "HTTP", "SSH"],
      correctAnswer: "SMTP",
      marks: 4
    },
    {
      sourceQuestion,
      text: "TCP is connection-oriented.",
      type: "true_false",
      correctAnswer: "true",
      marks: 2
    },
    {
      sourceQuestion,
      text: "UDP guarantees delivery.",
      type: "true_false",
      correctAnswer: "false",
      marks: 2
    }
  ];

  if (withShortAnswer) {
    questions.push({
      sourceQuestion,
      text: "Explain the three-way handshake.",
      type: "short_answer",
      marks: 2
    });
  }

  return Quiz.create({
    title: "Networks Quiz 1",
    durationMinutes: 10,
    passingScore: 50,
    showAnswers,
    totalMarks: questions.reduce((sum, question) => sum + question.marks, 0),
    createdBy: instructorId,
    questions
  });
}

function ids(quiz) {
  return quiz.questions.map((question) => question._id.toString());
}

function url(quiz, path = "") {
  return `/api/quizzes/${quiz._id}/attempt${path}`;
}

function start(quiz, token = studentToken) {
  return request(app).post(url(quiz, "/start")).set("Authorization", `Bearer ${token}`);
}

function submit(quiz, answers, token = studentToken) {
  return request(app)
    .post(url(quiz))
    .set("Authorization", `Bearer ${token}`)
    .send({ answers });
}

function getResult(quiz, token = studentToken) {
  return request(app).get(url(quiz, "/result")).set("Authorization", `Bearer ${token}`);
}

// MCQ right, first True/False wrong, second True/False unanswered
async function takeQuiz(quiz, token = studentToken) {
  const [mcqId, tfId] = ids(quiz);
  await start(quiz, token);
  return submit(quiz, [
    { questionId: mcqId, response: "SMTP" },
    { questionId: tfId, response: "false" }
  ], token);
}

before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([Attempt.init(), Quiz.init()]);
});

after(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await Promise.all([Attempt.deleteMany({}), Quiz.deleteMany({})]);
});

describe("TC-Quiz-06: the result screen shows the student's score", () => {
  test("shows the score summary after submission", async () => {
    const quiz = await createQuiz({ showAnswers: false });
    await takeQuiz(quiz);

    const response = await getResult(quiz);

    assert.equal(response.status, 200);
    const { result } = response.body;
    assert.equal(result.quizTitle, "Networks Quiz 1");
    assert.equal(result.quizId, quiz._id.toString());
    assert.equal(result.status, "submitted");
    assert.equal(result.score, 4);
    assert.equal(result.maxScore, 8);
    assert.equal(result.percentage, 50);
    assert.equal(result.passingScore, 50);
    assert.equal(result.passed, true);
    assert.equal(result.gradingStatus, "complete");
    assert.equal(result.totalQuestions, 3);
    assert.equal(result.answeredCount, 2);
    assert.equal(result.correctCount, 1);
    assert.ok(result.submittedAt);
    assert.ok(result.gradedAt);
  });

  test("shows the result of an attempt that was auto-submitted", async () => {
    const quiz = await createQuiz({ showAnswers: false });
    const [mcqId] = ids(quiz);
    await start(quiz);
    await request(app)
      .put(url(quiz, "/answers"))
      .set("Authorization", `Bearer ${studentToken}`)
      .send({ answers: [{ questionId: mcqId, response: "SMTP" }] });
    await Attempt.updateOne(
      { student: studentId },
      { expiresAt: new Date(Date.now() - 60 * 1000) }
    );

    const response = await getResult(quiz);

    assert.equal(response.status, 200);
    assert.equal(response.body.result.status, "auto_submitted");
    assert.equal(response.body.result.score, 4);
  });

  test("shows pending marks while short answers wait for manual grading", async () => {
    const quiz = await createQuiz({ showAnswers: false, withShortAnswer: true });
    await takeQuiz(quiz);

    const { result } = (await getResult(quiz)).body;

    assert.equal(result.gradingStatus, "pending_manual");
    assert.equal(result.pendingMarks, 2);
    assert.equal(result.passed, null);
  });

  test("grades an older submitted attempt that has no grading yet", async () => {
    const quiz = await createQuiz({ showAnswers: false });
    const [mcqId] = ids(quiz);
    await Attempt.create({
      quiz: quiz._id,
      student: studentId,
      status: "submitted",
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 1000),
      submittedAt: new Date(),
      answers: [{ questionId: mcqId, response: "SMTP" }]
    });

    const response = await getResult(quiz);
    const stored = await Attempt.findOne({ student: studentId });

    assert.equal(response.status, 200);
    assert.equal(response.body.result.score, 4);
    assert.equal(stored.grading.score, 4);
  });
});

describe("TC-Quiz-06: correct answers shown only if the Instructor enabled them", () => {
  test("with showAnswers on, every question is reviewed with the correct answer", async () => {
    const quiz = await createQuiz({ showAnswers: true });
    await takeQuiz(quiz);

    const { result } = (await getResult(quiz)).body;

    assert.equal(result.answersVisible, true);
    assert.equal(result.review.length, 3);
    assert.deepEqual(
      result.review.map((item) => [item.yourResponse, item.correctAnswer, item.isCorrect, item.marksAwarded]),
      [
        ["SMTP", "SMTP", true, 4],
        ["false", "true", false, 0],
        [null, "false", false, 0]
      ]
    );
    assert.equal(result.review[0].text, "Which protocol is used to send email?");
    assert.deepEqual(result.review[0].options, ["SMTP", "FTP", "HTTP", "SSH"]);
    assert.equal(result.review[0].maxMarks, 4);
  });

  test("with showAnswers off, no review or answer key is sent", async () => {
    const quiz = await createQuiz({ showAnswers: false });
    await takeQuiz(quiz);

    const response = await getResult(quiz);
    const body = JSON.stringify(response.body);

    assert.equal(response.body.result.answersVisible, false);
    assert.equal(response.body.result.review, undefined);
    assert.equal(body.includes("correctAnswer"), false);
    assert.equal(body.includes("isCorrect"), false);
  });

  test("short answers in the review show the student's answer but no marks yet", async () => {
    const quiz = await createQuiz({ showAnswers: true, withShortAnswer: true });
    const [mcqId, , , shortId] = ids(quiz);
    await start(quiz);
    await submit(quiz, [
      { questionId: mcqId, response: "SMTP" },
      { questionId: shortId, response: "SYN, SYN-ACK, ACK" }
    ]);

    const { result } = (await getResult(quiz)).body;
    const shortItem = result.review[3];

    assert.equal(shortItem.type, "short_answer");
    assert.equal(shortItem.yourResponse, "SYN, SYN-ACK, ACK");
    assert.equal(shortItem.correctAnswer, null);
    assert.equal(shortItem.isCorrect, null);
    assert.equal(shortItem.marksAwarded, null);
  });
});

describe("TC-Quiz-06: results are private and only after submission", () => {
  test("results are not available while the attempt is in progress", async () => {
    const quiz = await createQuiz({ showAnswers: true });
    await start(quiz);

    const response = await getResult(quiz);

    assert.equal(response.status, 409);
    assert.equal(response.body.message, "Results are available after the quiz is submitted");
  });

  test("returns 404 when the student never attempted the quiz", async () => {
    const quiz = await createQuiz({ showAnswers: true });

    const response = await getResult(quiz);

    assert.equal(response.status, 404);
  });

  test("each student only sees their own result", async () => {
    const quiz = await createQuiz({ showAnswers: false });
    await takeQuiz(quiz);
    await start(quiz, otherStudentToken);
    await submit(quiz, [], otherStudentToken);

    const own = await getResult(quiz);
    const other = await getResult(quiz, otherStudentToken);

    assert.equal(own.body.result.score, 4);
    assert.equal(other.body.result.score, 0);
    assert.notEqual(own.body.result.attemptId, other.body.result.attemptId);
  });

  test("instructors and requests without a token cannot use the student result route", async () => {
    const quiz = await createQuiz({ showAnswers: true });

    const instructor = await getResult(quiz, instructorToken);
    const anonymous = await request(app).get(url(quiz, "/result"));

    assert.equal(instructor.status, 403);
    assert.equal(anonymous.status, 401);
  });
});
