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
const Question = require("../src/models/Question");
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

async function createQuiz(title, questions) {
  const bankQuestions = await Question.create(questions.map((question) => ({
    ...question,
    createdBy: instructorId
  })));

  return Quiz.create({
    title,
    description: `${title} description`,
    durationMinutes: 10,
    passingScore: 50,
    totalMarks: bankQuestions.length,
    createdBy: instructorId,
    questions: bankQuestions.map((question) => ({
      sourceQuestion: question._id,
      text: question.text,
      type: question.type,
      options: question.options,
      correctAnswer: question.correctAnswer,
      marks: 1
    }))
  });
}

const mcq = {
  text: "Which protocol is used to send email?",
  type: "mcq",
  options: ["SMTP", "FTP"],
  correctAnswer: "SMTP",
  subject: "Computer Networks",
  topic: "Application Layer",
  difficulty: "easy"
};
const trueFalse = {
  text: "TCP is connection-oriented.",
  type: "true_false",
  correctAnswer: "true",
  subject: "Computer Networks",
  topic: "Transport Layer",
  difficulty: "easy"
};

function listAvailable(token = studentToken) {
  return request(app).get("/api/quizzes/available").set("Authorization", `Bearer ${token}`);
}

before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([Attempt.init(), Question.init(), Quiz.init()]);
});

after(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await Promise.all([Attempt.deleteMany({}), Question.deleteMany({}), Quiz.deleteMany({})]);
});

describe("Available quizzes for students", () => {
  test("lists quizzes newest first with their details and no answer key", async () => {
    await createQuiz("Older quiz", [mcq]);
    await createQuiz("Newer quiz", [mcq, trueFalse]);

    const response = await listAvailable();
    const body = JSON.stringify(response.body);

    assert.equal(response.status, 200);
    assert.equal(response.body.count, 2);
    const [newest, older] = response.body.quizzes;
    assert.equal(newest.title, "Newer quiz");
    assert.equal(older.title, "Older quiz");
    assert.equal(newest.description, "Newer quiz description");
    assert.equal(newest.durationMinutes, 10);
    assert.equal(newest.passingScore, 50);
    assert.equal(newest.totalMarks, 2);
    assert.equal(newest.questionCount, 2);
    assert.deepEqual(newest.subjects, ["Computer Networks"]);
    assert.deepEqual(newest.topics, ["Application Layer", "Transport Layer"]);
    assert.equal(newest.attempt, null);
    assert.equal(newest.questions, undefined);
    assert.equal(body.includes("correctAnswer"), false);
    assert.equal(body.includes("SMTP"), false);
  });

  test("shows the student's own attempt status and score", async () => {
    const quiz = await createQuiz("Networks", [mcq, trueFalse]);
    const mcqId = quiz.questions[0]._id.toString();

    await request(app).post(`/api/quizzes/${quiz._id}/attempt/start`).set("Authorization", `Bearer ${studentToken}`);
    const inProgress = (await listAvailable()).body.quizzes[0].attempt;

    await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt`)
      .set("Authorization", `Bearer ${studentToken}`)
      .send({ answers: [{ questionId: mcqId, response: "SMTP" }] });
    const submitted = (await listAvailable()).body.quizzes[0].attempt;
    const otherStudent = (await listAvailable(otherStudentToken)).body.quizzes[0].attempt;

    assert.equal(inProgress.status, "in_progress");
    assert.ok(inProgress.expiresAt);
    assert.equal(inProgress.score, undefined);
    assert.equal(submitted.status, "submitted");
    assert.equal(submitted.score, 1);
    assert.equal(submitted.maxScore, 2);
    assert.equal(submitted.percentage, 50);
    assert.equal(submitted.passed, true);
    assert.equal(submitted.gradingStatus, "complete");
    assert.equal(otherStudent, null);
  });

  test("an attempt whose time ran out is auto-submitted when listed", async () => {
    const quiz = await createQuiz("Networks", [mcq]);
    await request(app).post(`/api/quizzes/${quiz._id}/attempt/start`).set("Authorization", `Bearer ${studentToken}`);
    await Attempt.updateOne({ student: studentId }, { expiresAt: new Date(Date.now() - 60 * 1000) });

    const { attempt } = (await listAvailable()).body.quizzes[0];

    assert.equal(attempt.status, "auto_submitted");
    assert.equal(attempt.score, 0);
  });

  test("subjects and topics still show after a bank question is deleted", async () => {
    const quiz = await createQuiz("Networks", [mcq]);
    await Question.updateOne({ _id: quiz.questions[0].sourceQuestion }, { isDeleted: true });

    const [listed] = (await listAvailable()).body.quizzes;

    assert.deepEqual(listed.subjects, ["Computer Networks"]);
  });

  test("returns an empty list when there are no quizzes", async () => {
    const response = await listAvailable();

    assert.equal(response.status, 200);
    assert.equal(response.body.count, 0);
    assert.deepEqual(response.body.quizzes, []);
  });

  test("only students can use it, and instructor quiz routes are unchanged", async () => {
    await createQuiz("Networks", [mcq]);

    const instructor = await listAvailable(instructorToken);
    const anonymous = await request(app).get("/api/quizzes/available");
    const instructorList = await request(app).get("/api/quizzes").set("Authorization", `Bearer ${instructorToken}`);
    const studentOnInstructorList = await request(app).get("/api/quizzes").set("Authorization", `Bearer ${studentToken}`);

    assert.equal(instructor.status, 403);
    assert.equal(anonymous.status, 401);
    assert.equal(instructorList.status, 200);
    assert.equal(instructorList.body.count, 1);
    assert.equal(studentOnInstructorList.status, 403);
  });
});
