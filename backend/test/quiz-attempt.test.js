const assert = require("node:assert/strict");
const { after, afterEach, before, beforeEach, describe, test } = require("node:test");
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
let quiz;

const instructorId = new mongoose.Types.ObjectId().toString();
const studentId = new mongoose.Types.ObjectId().toString();
const otherStudentId = new mongoose.Types.ObjectId().toString();

function tokenFor(id, role) {
  return jwt.sign({ sub: id, role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

const instructorToken = tokenFor(instructorId, "instructor");
const studentToken = tokenFor(studentId, "student");
const otherStudentToken = tokenFor(otherStudentId, "student");

function questionIds() {
  return quiz.questions.map((question) => question._id.toString());
}

function attemptUrl(path = "", quizId = quiz._id.toString()) {
  return `/api/quizzes/${quizId}/attempt${path}`;
}

function startAttempt(token = studentToken, quizId) {
  return request(app)
    .post(attemptUrl("/start", quizId))
    .set("Authorization", `Bearer ${token}`);
}

function getAttempt(token = studentToken, quizId) {
  return request(app)
    .get(attemptUrl("", quizId))
    .set("Authorization", `Bearer ${token}`);
}

function saveAnswers(answers, token = studentToken) {
  return request(app)
    .put(attemptUrl("/answers"))
    .set("Authorization", `Bearer ${token}`)
    .send({ answers });
}

function submitAttempt(body, token = studentToken) {
  return request(app)
    .post(attemptUrl())
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

// Moves the attempt's deadline into the past, as if the timer ran out
async function expireAttempt(secondsAgo) {
  await Attempt.updateOne(
    { quiz: quiz._id, student: studentId },
    { expiresAt: new Date(Date.now() - secondsAgo * 1000) }
  );
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

beforeEach(async () => {
  const sourceQuestion = new mongoose.Types.ObjectId();

  quiz = await Quiz.create({
    title: "Networks Quiz 1",
    durationMinutes: 10,
    passingScore: 50,
    totalMarks: 4,
    createdBy: instructorId,
    questions: [
      {
        sourceQuestion,
        text: "Which protocol is used to send email?",
        type: "mcq",
        options: ["SMTP", "FTP", "HTTP", "SSH"],
        correctAnswer: "SMTP",
        marks: 2
      },
      {
        sourceQuestion,
        text: "TCP is connection-oriented.",
        type: "true_false",
        correctAnswer: "true",
        marks: 1
      },
      {
        sourceQuestion,
        text: "Explain the three-way handshake.",
        type: "short_answer",
        correctAnswer: "SYN, SYN-ACK, ACK",
        marks: 1
      }
    ]
  });
});

afterEach(async () => {
  await Promise.all([Attempt.deleteMany({}), Quiz.deleteMany({})]);
});

describe("TC-Quiz-03: start a timed attempt", () => {
  test("student starts the quiz and gets the timer and questions without answers", async () => {
    const before = Date.now();
    const response = await startAttempt();

    assert.equal(response.status, 201);
    const { attempt } = response.body;
    assert.equal(attempt.status, "in_progress");
    assert.equal(attempt.quizTitle, "Networks Quiz 1");
    assert.equal(attempt.totalQuestions, 3);
    assert.equal(attempt.answeredCount, 0);
    assert.ok(attempt.remainingSeconds > 590 && attempt.remainingSeconds <= 600);

    const expiresIn = new Date(attempt.expiresAt).getTime() - before;
    assert.ok(expiresIn >= 599 * 1000 && expiresIn <= 601 * 1000);

    assert.equal(attempt.questions.length, 3);
    attempt.questions.forEach((question) => {
      assert.equal(question.correctAnswer, undefined);
      assert.equal(question.sourceQuestion, undefined);
    });
    assert.deepEqual(attempt.questions[0].options, ["SMTP", "FTP", "HTTP", "SSH"]);
  });

  test("starting again resumes the same attempt with the same deadline", async () => {
    const first = await startAttempt();
    const second = await startAttempt();

    assert.equal(second.status, 200);
    assert.equal(second.body.message, "Quiz attempt resumed");
    assert.equal(second.body.attempt._id, first.body.attempt._id);
    assert.equal(second.body.attempt.expiresAt, first.body.attempt.expiresAt);
    assert.equal(await Attempt.countDocuments(), 1);
  });

  test("two start requests at the same moment create only one attempt", async () => {
    const responses = await Promise.all([startAttempt(), startAttempt(), startAttempt()]);

    responses.forEach((response) => assert.ok([200, 201].includes(response.status)));
    assert.equal(new Set(responses.map((response) => response.body.attempt._id)).size, 1);
    assert.equal(await Attempt.countDocuments(), 1);
  });

  test("each student gets their own attempt", async () => {
    await startAttempt();
    const other = await startAttempt(otherStudentToken);

    assert.equal(other.status, 201);
    assert.equal(await Attempt.countDocuments(), 2);
  });

  test("returns 404 for an unknown or malformed quiz", async () => {
    const unknown = await startAttempt(studentToken, new mongoose.Types.ObjectId().toString());
    const malformed = await startAttempt(studentToken, "not-an-id");

    assert.equal(unknown.status, 404);
    assert.equal(malformed.status, 404);
    assert.equal(malformed.body.message, "Quiz not found");
  });

  test("returns 404 when viewing an attempt that was never started", async () => {
    const response = await getAttempt();

    assert.equal(response.status, 404);
    assert.equal(response.body.message, "You have not started this quiz");
  });
});

describe("TC-Quiz-03: answer and submit within the time", () => {
  test("saves answers as the student goes, and can change or clear them", async () => {
    await startAttempt();
    const [mcqId, trueFalseId, shortId] = questionIds();

    const first = await saveAnswers([
      { questionId: mcqId, response: "FTP" },
      { questionId: trueFalseId, response: true }
    ]);
    const second = await saveAnswers([
      { questionId: mcqId, response: " SMTP " },
      { questionId: trueFalseId, response: null },
      { questionId: shortId, response: "SYN then SYN-ACK then ACK" }
    ]);
    const cleared = await saveAnswers([{ questionId: shortId, response: "   " }]);

    assert.equal(first.status, 200);
    assert.equal(first.body.message, "Answers saved");
    assert.equal(first.body.attempt.answeredCount, 2);
    assert.equal(second.body.attempt.answeredCount, 2);
    assert.deepEqual(second.body.attempt.answers, [
      { questionId: mcqId, response: "SMTP" },
      { questionId: shortId, response: "SYN then SYN-ACK then ACK" }
    ]);
    assert.equal(cleared.body.attempt.answeredCount, 1);
  });

  test("submits with the final answers and keeps earlier saved ones", async () => {
    await startAttempt();
    const [mcqId, trueFalseId] = questionIds();
    await saveAnswers([{ questionId: mcqId, response: "SMTP" }]);

    const response = await submitAttempt({
      answers: [{ questionId: trueFalseId, response: "FALSE" }]
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.message, "Quiz submitted");
    assert.equal(response.body.attempt.status, "submitted");
    assert.ok(response.body.attempt.submittedAt);
    assert.equal(response.body.attempt.questions, undefined);
    assert.deepEqual(response.body.attempt.answers, [
      { questionId: mcqId, response: "SMTP" },
      { questionId: trueFalseId, response: "false" }
    ]);
  });

  test("submitting without an answers list uses the saved answers", async () => {
    await startAttempt();
    const [mcqId] = questionIds();
    await saveAnswers([{ questionId: mcqId, response: "HTTP" }]);

    const response = await submitAttempt({});

    assert.equal(response.status, 200);
    assert.equal(response.body.attempt.answeredCount, 1);
  });

  test("a submit sent just after the timer ends is still accepted", async () => {
    await startAttempt();
    await expireAttempt(10);

    const response = await submitAttempt({ answers: [] });

    assert.equal(response.status, 200);
    assert.equal(response.body.attempt.status, "submitted");
  });

  test("a submitted attempt cannot be changed, submitted or started again", async () => {
    await startAttempt();
    await submitAttempt({});

    const save = await saveAnswers([]);
    const resubmit = await submitAttempt({});
    const restart = await startAttempt();

    [save, resubmit, restart].forEach((response) => {
      assert.equal(response.status, 409);
      assert.equal(response.body.message, "This attempt has already been submitted");
    });
  });

  test("rejects invalid answer payloads with 422", async () => {
    await startAttempt();
    const [mcqId, trueFalseId, shortId] = questionIds();

    const notList = await saveAnswers("SMTP");
    const missing = await request(app)
      .put(attemptUrl("/answers"))
      .set("Authorization", `Bearer ${studentToken}`)
      .send({});
    const response = await saveAnswers([
      "not an object",
      { questionId: new mongoose.Types.ObjectId().toString(), response: "x" },
      { questionId: mcqId, response: "POP3" },
      { questionId: mcqId, response: "SMTP" },
      { questionId: trueFalseId, response: "maybe" },
      { questionId: shortId, response: 42 }
    ]);
    const tooLong = await saveAnswers([{ questionId: shortId, response: "a".repeat(5001) }]);

    assert.equal(notList.status, 422);
    assert.equal(notList.body.errors.answers, "answers must be a list");
    assert.equal(missing.status, 422);
    assert.equal(response.status, 422);
    const { errors } = response.body;
    assert.equal(errors["answers.0"], "Each answer must be an object");
    assert.equal(errors["answers.1.questionId"], "Question is not part of this quiz");
    assert.equal(errors["answers.2.response"], "Answer must be one of the options");
    assert.equal(errors["answers.3.questionId"], "The same question is answered more than once");
    assert.equal(errors["answers.4.response"], "Answer must be true or false");
    assert.equal(errors["answers.5.response"], "Answer must be text");
    assert.equal(tooLong.body.errors["answers.0.response"], "Answer must be 5000 characters or fewer");

    const stored = await Attempt.findOne({ student: studentId });
    assert.equal(stored.answers.length, 0);
  });

  test("an empty true/false answer clears it", async () => {
    await startAttempt();
    const [, trueFalseId] = questionIds();
    await saveAnswers([{ questionId: trueFalseId, response: "true" }]);

    const response = await saveAnswers([{ questionId: trueFalseId, response: "" }]);

    assert.equal(response.body.attempt.answeredCount, 0);
  });

  test("saving or submitting before starting returns 404", async () => {
    const save = await saveAnswers([]);
    const submit = await submitAttempt({});

    assert.equal(save.status, 404);
    assert.equal(submit.status, 404);
  });
});

describe("TC-Quiz-03: timer expires without submitting", () => {
  test("the quiz auto-submits and keeps every answer saved before time-out", async () => {
    await startAttempt();
    const [mcqId, trueFalseId] = questionIds();
    await saveAnswers([
      { questionId: mcqId, response: "SMTP" },
      { questionId: trueFalseId, response: "true" }
    ]);
    await expireAttempt(60);

    const response = await getAttempt();
    const stored = await Attempt.findOne({ student: studentId });

    assert.equal(response.status, 200);
    assert.equal(response.body.attempt.status, "auto_submitted");
    assert.equal(response.body.attempt.answeredCount, 2);
    assert.equal(response.body.attempt.submittedAt, stored.expiresAt.toISOString());
    assert.equal(response.body.attempt.questions, undefined);
    assert.equal(stored.status, "auto_submitted");
    assert.deepEqual(
      stored.answers.map((answer) => answer.response),
      ["SMTP", "true"]
    );
  });

  test("answers sent after time-out are refused and the saved answers are submitted", async () => {
    await startAttempt();
    const [mcqId, trueFalseId] = questionIds();
    await saveAnswers([{ questionId: mcqId, response: "SMTP" }]);
    await expireAttempt(60);

    const lateSave = await saveAnswers([{ questionId: trueFalseId, response: "true" }]);
    const lateSubmit = await submitAttempt({
      answers: [{ questionId: trueFalseId, response: "true" }]
    });

    assert.equal(lateSave.status, 409);
    assert.equal(lateSave.body.message, "Time is up. Your saved answers were submitted automatically");
    assert.equal(lateSave.body.attempt.status, "auto_submitted");
    assert.equal(lateSave.body.attempt.answeredCount, 1);
    assert.equal(lateSubmit.status, 409);
    assert.equal(lateSubmit.body.attempt.answeredCount, 1);
  });

  test("starting again after time-out reports the automatic submission", async () => {
    await startAttempt();
    await expireAttempt(60);

    const response = await startAttempt();

    assert.equal(response.status, 409);
    assert.equal(response.body.attempt.status, "auto_submitted");
  });

  test("an in-progress attempt shows the time left", async () => {
    await startAttempt();
    await Attempt.updateOne(
      { student: studentId },
      { expiresAt: new Date(Date.now() + 90 * 1000) }
    );

    const response = await getAttempt();

    assert.equal(response.body.attempt.status, "in_progress");
    assert.ok(response.body.attempt.remainingSeconds > 85 && response.body.attempt.remainingSeconds <= 90);
  });
});

describe("TC-Auth-03: only students can attempt quizzes", () => {
  test("instructors cannot start, view, save or submit attempts", async () => {
    const responses = await Promise.all([
      startAttempt(instructorToken),
      getAttempt(instructorToken),
      saveAnswers([], instructorToken),
      submitAttempt({}, instructorToken)
    ]);

    responses.forEach((response) => assert.equal(response.status, 403));
  });

  test("requests without a token are rejected", async () => {
    const response = await request(app).post(attemptUrl("/start"));

    assert.equal(response.status, 401);
  });

  test("instructors can still create and view quizzes", async () => {
    const response = await request(app)
      .get(`/api/quizzes/${quiz._id}`)
      .set("Authorization", `Bearer ${instructorToken}`);

    assert.equal(response.status, 200);
  });
});
