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
const Notification = require("../src/models/Notification");
const Quiz = require("../src/models/Quiz");
const User = require("../src/models/User");
const { summarizeResults } = require("../src/modules/grading/grading.service");

let mongoServer;
let instructor;
let otherInstructor;
let student;
let secondStudent;

const tokenFor = (user, role) => jwt.sign({ sub: user._id.toString(), role }, process.env.JWT_SECRET, { expiresIn: "1h" });
const HOUR = 60 * 60 * 1000;

// 4 marks of objective questions and 6 of short answers, pass at 60%
async function createQuiz() {
  const sourceQuestion = new mongoose.Types.ObjectId();
  return Quiz.create({
    title: "Networks Quiz",
    durationMinutes: 10,
    passingScore: 60,
    totalMarks: 10,
    createdBy: instructor._id,
    availableFrom: new Date(Date.now() - HOUR),
    availableUntil: new Date(Date.now() + 24 * HOUR),
    questions: [
      { sourceQuestion, text: "Which protocol sends email?", type: "mcq", options: ["SMTP", "FTP"], correctAnswer: "SMTP", marks: 2 },
      { sourceQuestion, text: "TCP is connection-oriented.", type: "true_false", correctAnswer: "true", marks: 2 },
      { sourceQuestion, text: "Explain the three-way handshake.", type: "short_answer", correctAnswer: "SYN, SYN-ACK, ACK", marks: 4 },
      { sourceQuestion, text: "Name one use of UDP.", type: "short_answer", marks: 2 }
    ]
  });
}

function ids(quiz) {
  return quiz.questions.map((question) => question._id.toString());
}

async function submit(quiz, user, answers) {
  const token = tokenFor(user, "student");
  await request(app).post(`/api/quizzes/${quiz._id}/attempt/start`).set("Authorization", `Bearer ${token}`);
  const response = await request(app)
    .post(`/api/quizzes/${quiz._id}/attempt`)
    .set("Authorization", `Bearer ${token}`)
    .send({ answers });
  return response.body.attempt;
}

// Student 1: MCQ right, T/F right, both short answers written
function fullAnswers(quiz) {
  const [mcqId, tfId, shortId, udpId] = ids(quiz);
  return [
    { questionId: mcqId, response: "SMTP" },
    { questionId: tfId, response: "true" },
    { questionId: shortId, response: "Client sends SYN, server replies SYN-ACK, client sends ACK." },
    { questionId: udpId, response: "Video streaming" }
  ];
}

function grade(quiz, attemptId, grades, user = instructor, role = "instructor") {
  return request(app)
    .put(`/api/quizzes/${quiz._id}/submissions/${attemptId}/grades`)
    .set("Authorization", `Bearer ${tokenFor(user, role)}`)
    .send({ grades });
}

function studentResult(quiz, user = student) {
  return request(app)
    .get(`/api/quizzes/${quiz._id}/attempt/result`)
    .set("Authorization", `Bearer ${tokenFor(user, "student")}`);
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
  await Promise.all([Attempt.deleteMany({}), Quiz.deleteMany({}), User.deleteMany({}), Notification.deleteMany({})]);
});

async function seedUsers() {
  [instructor, otherInstructor, student, secondStudent] = await User.create([
    { name: "Asha Rao", email: "asha@csqp.com", password: "hashed-password-placeholder", role: "instructor" },
    { name: "Ravi Kumar", email: "ravi@csqp.com", password: "hashed-password-placeholder", role: "instructor" },
    { name: "Sahana", email: "sahana@csqp.com", password: "hashed-password-placeholder", role: "student" },
    { name: "Meera", email: "meera@csqp.com", password: "hashed-password-placeholder", role: "student" }
  ]);
}

describe("TC-Quiz-05: instructor reviews submissions", () => {
  test("lists submissions with student details and what still needs grading", async () => {
    await seedUsers();
    const quiz = await createQuiz();
    const [mcqId] = ids(quiz);
    await submit(quiz, student, fullAnswers(quiz));
    await submit(quiz, secondStudent, [{ questionId: mcqId, response: "FTP" }]);

    const response = await request(app)
      .get(`/api/quizzes/${quiz._id}/submissions`)
      .set("Authorization", `Bearer ${tokenFor(instructor, "instructor")}`);

    assert.equal(response.status, 200);
    assert.equal(response.body.count, 2);
    assert.equal(response.body.awaitingGrading, 2);
    const sahana = response.body.submissions.find((item) => item.student.name === "Sahana");
    assert.equal(sahana.student.email, "sahana@csqp.com");
    assert.equal(sahana.status, "submitted");
    assert.equal(sahana.score, 4);
    assert.equal(sahana.pendingMarks, 6);
    assert.equal(sahana.pendingQuestions, 2);
    assert.equal(sahana.gradingStatus, "pending_manual");
  });

  test("shows one submission with every answer, the answer key and marks", async () => {
    await seedUsers();
    const quiz = await createQuiz();
    const attempt = await submit(quiz, student, fullAnswers(quiz));

    const response = await request(app)
      .get(`/api/quizzes/${quiz._id}/submissions/${attempt._id}`)
      .set("Authorization", `Bearer ${tokenFor(instructor, "instructor")}`);

    assert.equal(response.status, 200);
    const { submission } = response.body;
    assert.equal(submission.student.name, "Sahana");
    assert.equal(submission.questions.length, 4);
    assert.equal(submission.questions[0].marksAwarded, 2);
    assert.equal(submission.questions[2].type, "short_answer");
    assert.equal(submission.questions[2].response, "Client sends SYN, server replies SYN-ACK, client sends ACK.");
    assert.equal(submission.questions[2].correctAnswer, "SYN, SYN-ACK, ACK");
    assert.equal(submission.questions[2].marksAwarded, null);
  });

  test("an attempt that ran out of time is auto-submitted before it is listed", async () => {
    await seedUsers();
    const quiz = await createQuiz();
    await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/start`)
      .set("Authorization", `Bearer ${tokenFor(student, "student")}`);
    await Attempt.updateOne({ student: student._id }, { expiresAt: new Date(Date.now() - 60 * 1000) });

    const response = await request(app)
      .get(`/api/quizzes/${quiz._id}/submissions`)
      .set("Authorization", `Bearer ${tokenFor(instructor, "instructor")}`);

    assert.equal(response.body.submissions[0].status, "auto_submitted");
    assert.equal(response.body.submissions[0].pendingQuestions, 2);
  });
});

describe("TC-Quiz-05: manual marks are added to the auto-graded score (AC-024)", () => {
  test("grading all short answers completes the score, percentage and pass", async () => {
    await seedUsers();
    const quiz = await createQuiz();
    const [, , shortId, udpId] = ids(quiz);
    const attempt = await submit(quiz, student, fullAnswers(quiz));

    const response = await grade(quiz, attempt._id, [
      { questionId: shortId, marks: 3.5, feedback: "Good, but name the flags." },
      { questionId: udpId, marks: 2 }
    ]);

    assert.equal(response.status, 200);
    assert.equal(response.body.message, "Grading complete");
    const { submission } = response.body;
    assert.equal(submission.score, 9.5);
    assert.equal(submission.maxScore, 10);
    assert.equal(submission.percentage, 95);
    assert.equal(submission.passed, true);
    assert.equal(submission.gradingStatus, "complete");
    assert.equal(submission.pendingMarks, 0);
    assert.equal(submission.questions[2].manuallyGraded, true);
    assert.equal(submission.questions[2].feedback, "Good, but name the flags.");
    assert.ok(submission.manuallyGradedAt);
  });

  test("the student's result shows the new score and the marks and feedback", async () => {
    await seedUsers();
    const quiz = await createQuiz();
    quiz.showAnswers = true;
    await quiz.save();
    const [, , shortId, udpId] = ids(quiz);
    const attempt = await submit(quiz, student, fullAnswers(quiz));
    const before = (await studentResult(quiz)).body.result;

    await grade(quiz, attempt._id, [
      { questionId: shortId, marks: 1, feedback: "Missing the ACK step." },
      { questionId: udpId, marks: 0 }
    ]);
    const afterGrading = (await studentResult(quiz)).body.result;

    assert.equal(before.score, 4);
    assert.equal(before.gradingStatus, "pending_manual");
    assert.equal(afterGrading.score, 5);
    assert.equal(afterGrading.percentage, 50);
    assert.equal(afterGrading.passed, false);
    assert.equal(afterGrading.gradingStatus, "complete");
    assert.equal(afterGrading.review[2].marksAwarded, 1);
    assert.equal(afterGrading.review[2].manuallyGraded, true);
    assert.equal(afterGrading.review[2].feedback, "Missing the ACK step.");
    assert.equal(afterGrading.review[3].isCorrect, false);
  });

  test("grading one of two short answers saves it and keeps the rest pending", async () => {
    await seedUsers();
    const quiz = await createQuiz();
    const [, , shortId] = ids(quiz);
    const attempt = await submit(quiz, student, fullAnswers(quiz));

    const response = await grade(quiz, attempt._id, [{ questionId: shortId, marks: 4 }]);

    assert.equal(response.body.message, "Grades saved");
    assert.equal(response.body.submission.score, 8);
    assert.equal(response.body.submission.pendingMarks, 2);
    assert.equal(response.body.submission.passed, null);
    assert.equal(response.body.submission.questions[2].isCorrect, true);
  });

  test("marks can be changed later and the score follows", async () => {
    await seedUsers();
    const quiz = await createQuiz();
    const [, , shortId, udpId] = ids(quiz);
    const attempt = await submit(quiz, student, fullAnswers(quiz));
    await grade(quiz, attempt._id, [{ questionId: shortId, marks: 4 }, { questionId: udpId, marks: 2 }]);

    const regraded = await grade(quiz, attempt._id, [{ questionId: udpId, marks: 0.5 }]);

    assert.equal(regraded.body.submission.score, 8.5);
    assert.equal(regraded.body.submission.questions[3].marksAwarded, 0.5);
    assert.equal(regraded.body.submission.questions[2].marksAwarded, 4);
  });

  test("unanswered short answers can be given zero to finish grading", async () => {
    await seedUsers();
    const quiz = await createQuiz();
    const [mcqId, , shortId, udpId] = ids(quiz);
    const attempt = await submit(quiz, student, [{ questionId: mcqId, response: "SMTP" }]);

    const response = await grade(quiz, attempt._id, [{ questionId: shortId, marks: 0 }, { questionId: udpId, marks: 0 }]);

    assert.equal(response.body.submission.score, 2);
    assert.equal(response.body.submission.gradingStatus, "complete");
    assert.equal(response.body.submission.passed, false);
  });

  test("the student is notified once grading is complete, and only once", async () => {
    await seedUsers();
    const quiz = await createQuiz();
    const [, , shortId, udpId] = ids(quiz);
    const attempt = await submit(quiz, student, fullAnswers(quiz));
    const submittedNotifications = await Notification.countDocuments({ userId: student._id });

    await grade(quiz, attempt._id, [{ questionId: shortId, marks: 4 }]);
    const afterPartial = await Notification.countDocuments({ userId: student._id });
    await grade(quiz, attempt._id, [{ questionId: udpId, marks: 2 }]);
    await grade(quiz, attempt._id, [{ questionId: udpId, marks: 1 }]);
    const notifications = await Notification.find({ userId: student._id, title: /graded/ });

    assert.equal(afterPartial, submittedNotifications);
    assert.equal(notifications.length, 1);
    assert.match(notifications[0].message, /Final score: 10\/10/);
  });
});

describe("TC-Quiz-05: invalid grades and access", () => {
  test("rejects invalid grades with 422 and changes nothing", async () => {
    await seedUsers();
    const quiz = await createQuiz();
    const [mcqId, , shortId, udpId] = ids(quiz);
    const attempt = await submit(quiz, student, fullAnswers(quiz));

    const empty = await grade(quiz, attempt._id, []);
    const response = await grade(quiz, attempt._id, [
      "not an object",
      { questionId: new mongoose.Types.ObjectId().toString(), marks: 1 },
      { questionId: mcqId, marks: 2 },
      { questionId: shortId, marks: 5 },
      { questionId: shortId, marks: 1 },
      { questionId: udpId, marks: 1.25, feedback: 42 }
    ]);
    const tooLong = await grade(quiz, attempt._id, [{ questionId: udpId, marks: 1, feedback: "x".repeat(1001) }]);
    const stored = await Attempt.findById(attempt._id);

    assert.equal(empty.status, 422);
    assert.equal(empty.body.errors.grades, "Send at least one grade");
    assert.equal(response.status, 422);
    const { errors } = response.body;
    assert.equal(errors["grades.0"], "Each grade must be an object");
    assert.equal(errors["grades.1.questionId"], "Question is not part of this quiz");
    assert.equal(errors["grades.2.questionId"], "Only short-answer questions are graded by hand");
    assert.equal(errors["grades.3.marks"], "Marks must be a number from 0 to 4");
    assert.equal(errors["grades.4.questionId"], "The same question is graded more than once");
    assert.equal(errors["grades.5.marks"], "Marks can only be given in steps of 0.5");
    assert.equal(errors["grades.5.feedback"], "Feedback must be text");
    assert.equal(tooLong.body.errors["grades.0.feedback"], "Feedback must be 1000 characters or fewer");
    assert.equal(stored.grading.score, 4);
  });

  test("an attempt still in progress cannot be graded", async () => {
    await seedUsers();
    const quiz = await createQuiz();
    const started = await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt/start`)
      .set("Authorization", `Bearer ${tokenFor(student, "student")}`);

    const response = await grade(quiz, started.body.attempt._id, [{ questionId: ids(quiz)[2], marks: 1 }]);

    assert.equal(response.status, 409);
    assert.equal(response.body.message, "This attempt has not been submitted yet");
  });

  test("only the quiz owner or an admin can see and grade submissions", async () => {
    await seedUsers();
    const quiz = await createQuiz();
    const attempt = await submit(quiz, student, fullAnswers(quiz));
    const list = (user, role) => request(app)
      .get(`/api/quizzes/${quiz._id}/submissions`)
      .set("Authorization", `Bearer ${tokenFor(user, role)}`);

    const other = await list(otherInstructor, "instructor");
    const asStudent = await list(student, "student");
    const admin = await grade(quiz, attempt._id, [{ questionId: ids(quiz)[3], marks: 1 }], otherInstructor, "admin");
    const otherGrade = await grade(quiz, attempt._id, [{ questionId: ids(quiz)[3], marks: 1 }], otherInstructor);

    assert.equal(other.status, 403);
    assert.equal(other.body.message, "You can only grade quizzes you created");
    assert.equal(asStudent.status, 403);
    assert.equal(admin.status, 200);
    assert.equal(otherGrade.status, 403);
  });

  test("returns 404 for unknown quizzes and submissions", async () => {
    await seedUsers();
    const quiz = await createQuiz();
    const token = tokenFor(instructor, "instructor");

    const unknownQuiz = await request(app).get(`/api/quizzes/${new mongoose.Types.ObjectId()}/submissions`).set("Authorization", `Bearer ${token}`);
    const badQuiz = await request(app).get("/api/quizzes/not-an-id/submissions").set("Authorization", `Bearer ${token}`);
    const unknownAttempt = await request(app).get(`/api/quizzes/${quiz._id}/submissions/${new mongoose.Types.ObjectId()}`).set("Authorization", `Bearer ${token}`);
    const badAttempt = await request(app).get(`/api/quizzes/${quiz._id}/submissions/not-an-id`).set("Authorization", `Bearer ${token}`);

    assert.equal(unknownQuiz.status, 404);
    assert.equal(badQuiz.status, 404);
    assert.equal(unknownAttempt.status, 404);
    assert.equal(unknownAttempt.body.message, "Submission not found");
    assert.equal(badAttempt.status, 404);
  });

  test("a submission from before automatic grading is graded when opened", async () => {
    await seedUsers();
    const quiz = await createQuiz();
    const attempt = await Attempt.create({
      quiz: quiz._id,
      student: student._id,
      status: "submitted",
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 1000),
      submittedAt: new Date(),
      answers: [{ questionId: quiz.questions[0]._id, response: "SMTP" }]
    });

    const response = await request(app)
      .get(`/api/quizzes/${quiz._id}/submissions/${attempt._id}`)
      .set("Authorization", `Bearer ${tokenFor(instructor, "instructor")}`);

    assert.equal(response.status, 200);
    assert.equal(response.body.submission.score, 2);
  });

  test("a deleted student account is shown as unknown", async () => {
    await seedUsers();
    const quiz = await createQuiz();
    await submit(quiz, student, fullAnswers(quiz));
    await User.deleteOne({ _id: student._id });

    const response = await request(app)
      .get(`/api/quizzes/${quiz._id}/submissions`)
      .set("Authorization", `Bearer ${tokenFor(instructor, "instructor")}`);

    assert.equal(response.body.submissions[0].student.name, "Unknown student");
  });
});

describe("TC-Quiz-05: score recalculation", () => {
  test("adds awarded marks and counts ungraded ones as pending", () => {
    const summary = summarizeResults([
      { maxMarks: 2, marksAwarded: 2 },
      { maxMarks: 4, marksAwarded: 1.5 },
      { maxMarks: 2, marksAwarded: null }
    ], 50);

    assert.deepEqual(summary, {
      score: 3.5,
      maxScore: 8,
      pendingMarks: 2,
      percentage: 43.75,
      gradingStatus: "pending_manual",
      passed: null
    });
    assert.equal(summarizeResults([], 0).percentage, 0);
  });
});
