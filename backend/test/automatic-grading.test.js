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
const {
  gradeAttempt,
  isAutoGraded,
  isCorrectAnswer
} = require("../src/modules/grading/grading.service");

let mongoServer;

const instructorId = new mongoose.Types.ObjectId().toString();
const studentId = new mongoose.Types.ObjectId().toString();
const studentToken = jwt.sign(
  { sub: studentId, role: "student" },
  process.env.JWT_SECRET,
  { expiresIn: "1h" }
);

const mcq = {
  text: "Which protocol is used to send email?",
  type: "mcq",
  options: ["SMTP", "FTP", "HTTP", "SSH"],
  correctAnswer: "SMTP",
  marks: 4
};
const trueFalse = {
  text: "TCP is connection-oriented.",
  type: "true_false",
  correctAnswer: "true",
  marks: 2
};
const secondTrueFalse = {
  text: "UDP guarantees delivery.",
  type: "true_false",
  correctAnswer: "false",
  marks: 2
};
const shortAnswer = {
  text: "Explain the three-way handshake.",
  type: "short_answer",
  correctAnswer: "SYN, SYN-ACK, ACK",
  marks: 5
};

// An answer key for a test quiz: 4 + 2 + 2 = 8 objective marks
async function createQuiz(questions, passingScore = 50) {
  const sourceQuestion = new mongoose.Types.ObjectId();
  const withSource = questions.map((question) => ({ ...question, sourceQuestion }));

  return Quiz.create({
    title: "Networks Quiz 1",
    durationMinutes: 10,
    passingScore,
    totalMarks: withSource.reduce((sum, question) => sum + question.marks, 0),
    createdBy: instructorId,
    questions: withSource
  });
}

function ids(quiz) {
  return quiz.questions.map((question) => question._id.toString());
}

async function takeQuiz(quiz, answers) {
  await request(app)
    .post(`/api/quizzes/${quiz._id}/attempt/start`)
    .set("Authorization", `Bearer ${studentToken}`);

  return request(app)
    .post(`/api/quizzes/${quiz._id}/attempt`)
    .set("Authorization", `Bearer ${studentToken}`)
    .send({ answers });
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

describe("TC-Quiz-04: auto-graded score matches the answer key", () => {
  test("all correct answers get full marks and pass", async () => {
    const quiz = await createQuiz([mcq, trueFalse, secondTrueFalse]);
    const [mcqId, tfId, secondTfId] = ids(quiz);

    const response = await takeQuiz(quiz, [
      { questionId: mcqId, response: "SMTP" },
      { questionId: tfId, response: true },
      { questionId: secondTfId, response: "False" }
    ]);

    assert.equal(response.status, 200);
    const { attempt } = response.body;
    assert.equal(attempt.status, "submitted");
    assert.equal(attempt.score, 8);
    assert.equal(attempt.maxScore, 8);
    assert.equal(attempt.percentage, 100);
    assert.equal(attempt.passed, true);
    assert.equal(attempt.gradingStatus, "complete");
    assert.equal(attempt.pendingMarks, 0);
    assert.equal(attempt.totalQuestions, 3);
    assert.ok(attempt.gradedAt);
  });

  test("wrong and unanswered questions get zero marks", async () => {
    const quiz = await createQuiz([mcq, trueFalse, secondTrueFalse]);
    const [mcqId, tfId] = ids(quiz);

    const response = await takeQuiz(quiz, [
      { questionId: mcqId, response: "FTP" },
      { questionId: tfId, response: "true" }
    ]);

    const { attempt } = response.body;
    assert.equal(attempt.score, 2);
    assert.equal(attempt.percentage, 25);
    assert.equal(attempt.passed, false);

    const stored = await Attempt.findById(attempt._id);
    assert.deepEqual(
      stored.grading.results.map((result) => [result.answered, result.isCorrect, result.marksAwarded]),
      [[true, false, 0], [true, true, 2], [false, false, 0]]
    );
  });

  test("a score exactly at the passing percentage passes", async () => {
    const quiz = await createQuiz([mcq, trueFalse, secondTrueFalse], 75);
    const [mcqId, tfId] = ids(quiz);

    const response = await takeQuiz(quiz, [
      { questionId: mcqId, response: "SMTP" },
      { questionId: tfId, response: "true" }
    ]);

    assert.equal(response.body.attempt.percentage, 75);
    assert.equal(response.body.attempt.passed, true);
  });

  test("short answers wait for manual grading and the pass is not decided yet", async () => {
    const quiz = await createQuiz([mcq, shortAnswer], 40);
    const [mcqId, shortId] = ids(quiz);

    const response = await takeQuiz(quiz, [
      { questionId: mcqId, response: "SMTP" },
      { questionId: shortId, response: "SYN, SYN-ACK, ACK" }
    ]);

    const { attempt } = response.body;
    assert.equal(attempt.score, 4);
    assert.equal(attempt.maxScore, 9);
    assert.equal(attempt.pendingMarks, 5);
    assert.equal(attempt.gradingStatus, "pending_manual");
    assert.equal(attempt.passed, null);

    const stored = await Attempt.findById(attempt._id);
    const shortResult = stored.grading.results[1];
    assert.equal(shortResult.answered, true);
    assert.equal(shortResult.isCorrect, null);
    assert.equal(shortResult.marksAwarded, null);
    assert.equal(shortResult.maxMarks, 5);
  });

  test("the grading is saved with the attempt and shown when viewed again", async () => {
    const quiz = await createQuiz([mcq, trueFalse]);
    const [mcqId] = ids(quiz);
    await takeQuiz(quiz, [{ questionId: mcqId, response: "SMTP" }]);

    const response = await request(app)
      .get(`/api/quizzes/${quiz._id}/attempt`)
      .set("Authorization", `Bearer ${studentToken}`);
    const stored = await Attempt.findOne({ student: studentId });

    assert.equal(response.body.attempt.score, 4);
    assert.equal(response.body.attempt.percentage, 66.67);
    assert.equal(stored.grading.score, 4);
    assert.ok(stored.grading.gradedAt instanceof Date);
  });

  test("an attempt that times out is graded with its saved answers", async () => {
    const quiz = await createQuiz([mcq, trueFalse]);
    const [mcqId, tfId] = ids(quiz);

    await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/start`)
      .set("Authorization", `Bearer ${studentToken}`);
    await request(app)
      .put(`/api/quizzes/${quiz._id}/attempt/answers`)
      .set("Authorization", `Bearer ${studentToken}`)
      .send({
        answers: [
          { questionId: mcqId, response: "SMTP" },
          { questionId: tfId, response: "false" }
        ]
      });
    await Attempt.updateOne(
      { student: studentId },
      { expiresAt: new Date(Date.now() - 60 * 1000) }
    );

    const response = await request(app)
      .get(`/api/quizzes/${quiz._id}/attempt`)
      .set("Authorization", `Bearer ${studentToken}`);

    assert.equal(response.body.attempt.status, "auto_submitted");
    assert.equal(response.body.attempt.score, 4);
    assert.equal(response.body.attempt.gradingStatus, "complete");
  });

  test("an attempt in progress has no score yet", async () => {
    const quiz = await createQuiz([mcq]);

    const response = await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/start`)
      .set("Authorization", `Bearer ${studentToken}`);

    assert.equal(response.body.attempt.score, undefined);
    assert.equal(response.body.attempt.gradingStatus, undefined);
  });

  test("the submitted result does not reveal the answer key", async () => {
    const quiz = await createQuiz([mcq, trueFalse]);
    const [mcqId] = ids(quiz);

    const response = await takeQuiz(quiz, [{ questionId: mcqId, response: "FTP" }]);
    const body = JSON.stringify(response.body);

    assert.equal(response.body.attempt.results, undefined);
    assert.equal(body.includes("correctAnswer"), false);
    assert.equal(body.includes("isCorrect"), false);
  });
});

describe("TC-Quiz-04: grading rules", () => {
  test("only MCQ and True/False questions are auto-graded", () => {
    assert.equal(isAutoGraded(mcq), true);
    assert.equal(isAutoGraded(trueFalse), true);
    assert.equal(isAutoGraded(shortAnswer), false);
  });

  test("MCQ answers must match the option exactly; True/False ignores case", () => {
    assert.equal(isCorrectAnswer(mcq, "SMTP"), true);
    assert.equal(isCorrectAnswer(mcq, " SMTP "), true);
    assert.equal(isCorrectAnswer(mcq, "smtp"), false);
    assert.equal(isCorrectAnswer(trueFalse, "TRUE"), true);
    assert.equal(isCorrectAnswer(trueFalse, "false"), false);
    assert.equal(isCorrectAnswer(trueFalse, undefined), false);
  });

  test("a question without an answer key is never marked correct", () => {
    assert.equal(isCorrectAnswer({ ...mcq, correctAnswer: undefined }, "SMTP"), false);
    assert.equal(isCorrectAnswer({ ...mcq, correctAnswer: "" }, ""), false);
  });

  test("grades a quiz directly from its questions and answers", () => {
    const quiz = {
      passingScore: 50,
      questions: [
        { _id: "q1", ...mcq },
        { _id: "q2", ...trueFalse },
        { _id: "q3", ...shortAnswer }
      ]
    };

    const grading = gradeAttempt(quiz, [
      { questionId: "q1", response: "SMTP" },
      { questionId: "q2", response: "false" }
    ]);

    assert.equal(grading.score, 4);
    assert.equal(grading.maxScore, 11);
    assert.equal(grading.pendingMarks, 5);
    assert.equal(grading.percentage, 36.36);
    assert.equal(grading.gradingStatus, "pending_manual");
    assert.equal(grading.passed, null);
    assert.equal(grading.results.length, 3);
    assert.equal(grading.results[2].answered, false);
  });

  test("an empty quiz scores zero without dividing by zero", () => {
    const grading = gradeAttempt({ passingScore: 0, questions: [] }, []);

    assert.equal(grading.percentage, 0);
    assert.equal(grading.passed, true);
  });
});
