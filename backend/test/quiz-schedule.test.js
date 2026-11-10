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
  attemptDeadline,
  scheduleStatus,
  validateSchedule
} = require("../src/modules/quiz/quizSchedule");

let mongoServer;

const instructorId = new mongoose.Types.ObjectId().toString();
const otherInstructorId = new mongoose.Types.ObjectId().toString();
const adminId = new mongoose.Types.ObjectId().toString();
const studentId = new mongoose.Types.ObjectId().toString();

function tokenFor(id, role) {
  return jwt.sign({ sub: id, role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

const instructorToken = tokenFor(instructorId, "instructor");
const otherInstructorToken = tokenFor(otherInstructorId, "instructor");
const adminToken = tokenFor(adminId, "admin");
const studentToken = tokenFor(studentId, "student");

const HOUR = 60 * 60 * 1000;
const inHours = (hours) => new Date(Date.now() + hours * HOUR);

const newQuestion = {
  question: {
    text: "TCP is connection-oriented.",
    type: "true_false",
    correctAnswer: "true",
    subject: "Computer Networks",
    topic: "Transport Layer",
    difficulty: "easy"
  }
};

function quizBody(overrides = {}) {
  return {
    title: "Networks Quiz",
    durationMinutes: 30,
    passingScore: 50,
    questions: [newQuestion],
    ...overrides
  };
}

function createQuiz(body, token = instructorToken) {
  return request(app).post("/api/quizzes").set("Authorization", `Bearer ${token}`).send(body);
}

function schedule(id, body, token = instructorToken) {
  return request(app).put(`/api/quizzes/${id}/schedule`).set("Authorization", `Bearer ${token}`).send(body);
}

function startAttempt(id, token = studentToken) {
  return request(app).post(`/api/quizzes/${id}/attempt/start`).set("Authorization", `Bearer ${token}`);
}

function listAvailable(token = studentToken) {
  return request(app).get("/api/quizzes/available").set("Authorization", `Bearer ${token}`);
}

// Creates a quiz directly with any window, including ones in the past
async function quizWithWindow(title, availableFrom, availableUntil) {
  return Quiz.create({
    title,
    durationMinutes: 30,
    passingScore: 50,
    totalMarks: 1,
    createdBy: instructorId,
    availableFrom,
    availableUntil,
    questions: [{
      sourceQuestion: new mongoose.Types.ObjectId(),
      text: "TCP is connection-oriented.",
      type: "true_false",
      correctAnswer: "true",
      marks: 1
    }]
  });
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

describe("TC-Quiz-02: instructor schedules a quiz", () => {
  test("a quiz can be scheduled when it is created", async () => {
    const from = inHours(1);
    const until = inHours(3);

    const response = await createQuiz(quizBody({
      availableFrom: from.toISOString(),
      availableUntil: until.toISOString()
    }));

    assert.equal(response.status, 201);
    assert.equal(response.body.quiz.availableFrom, from.toISOString());
    assert.equal(response.body.quiz.availableUntil, until.toISOString());
    assert.equal(response.body.quiz.scheduleStatus, "upcoming");
  });

  test("a quiz created without a schedule is unscheduled", async () => {
    const response = await createQuiz(quizBody());

    assert.equal(response.status, 201);
    assert.equal(response.body.quiz.availableFrom, null);
    assert.equal(response.body.quiz.availableUntil, null);
    assert.equal(response.body.quiz.scheduleStatus, "unscheduled");
  });

  test("rejects invalid schedules when creating a quiz", async () => {
    const onlyStart = await createQuiz(quizBody({ availableFrom: inHours(1).toISOString() }));
    const onlyEnd = await createQuiz(quizBody({ availableUntil: inHours(1).toISOString() }));
    const notDates = await createQuiz(quizBody({ availableFrom: "tomorrow", availableUntil: 42 }));
    const backwards = await createQuiz(quizBody({
      availableFrom: inHours(3).toISOString(),
      availableUntil: inHours(1).toISOString()
    }));
    const past = await createQuiz(quizBody({
      availableFrom: inHours(-3).toISOString(),
      availableUntil: inHours(-1).toISOString()
    }));
    const tooShort = await createQuiz(quizBody({
      availableFrom: inHours(1).toISOString(),
      availableUntil: new Date(inHours(1).getTime() + 10 * 60 * 1000).toISOString()
    }));

    assert.equal(onlyStart.status, 400);
    assert.equal(onlyStart.body.errors.availableUntil, "Give both a start and an end time, or neither");
    assert.equal(onlyEnd.body.errors.availableFrom, "Give both a start and an end time, or neither");
    assert.equal(notDates.body.errors.availableFrom, "Start time must be a valid date and time");
    assert.equal(notDates.body.errors.availableUntil, "End time must be a valid date and time");
    assert.equal(backwards.body.errors.availableUntil, "End time must be after the start time");
    assert.equal(past.body.errors.availableUntil, "End time must be in the future");
    assert.equal(tooShort.body.errors.availableUntil, "The window must be at least as long as the quiz duration");
    assert.equal(await Quiz.countDocuments(), 0);
  });

  test("the owner can schedule, reschedule, and unschedule a quiz", async () => {
    const created = await createQuiz(quizBody());
    const id = created.body.quiz._id;

    const scheduled = await schedule(id, {
      availableFrom: inHours(-1).toISOString(),
      availableUntil: inHours(2).toISOString()
    });
    const rescheduled = await schedule(id, {
      availableFrom: inHours(5).toISOString(),
      availableUntil: inHours(8).toISOString()
    });
    const cleared = await schedule(id, { availableFrom: null, availableUntil: null });

    assert.equal(scheduled.status, 200);
    assert.equal(scheduled.body.message, "Quiz scheduled");
    assert.equal(scheduled.body.quiz.scheduleStatus, "open");
    assert.equal(rescheduled.body.quiz.scheduleStatus, "upcoming");
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.message, "Quiz schedule removed");
    assert.equal(cleared.body.quiz.scheduleStatus, "unscheduled");
  });

  test("rejects an invalid schedule update and keeps the old one", async () => {
    const created = await createQuiz(quizBody({
      availableFrom: inHours(1).toISOString(),
      availableUntil: inHours(3).toISOString()
    }));
    const id = created.body.quiz._id;

    const response = await schedule(id, {
      availableFrom: inHours(4).toISOString(),
      availableUntil: inHours(2).toISOString()
    });
    const stored = await Quiz.findById(id);

    assert.equal(response.status, 400);
    assert.equal(response.body.message, "Schedule is invalid");
    assert.equal(stored.availableFrom.toISOString(), created.body.quiz.availableFrom);
  });

  test("only the owner or an admin can schedule; students cannot", async () => {
    const created = await createQuiz(quizBody());
    const id = created.body.quiz._id;
    const window = { availableFrom: inHours(1).toISOString(), availableUntil: inHours(3).toISOString() };

    const other = await schedule(id, window, otherInstructorToken);
    const admin = await schedule(id, window, adminToken);
    const student = await schedule(id, window, studentToken);

    assert.equal(other.status, 403);
    assert.equal(other.body.message, "You can only schedule quizzes you created");
    assert.equal(admin.status, 200);
    assert.equal(student.status, 403);
  });

  test("returns 404 when scheduling an unknown or malformed quiz", async () => {
    const window = { availableFrom: inHours(1).toISOString(), availableUntil: inHours(3).toISOString() };

    const unknown = await schedule(new mongoose.Types.ObjectId().toString(), window);
    const malformed = await schedule("not-an-id", window);

    assert.equal(unknown.status, 404);
    assert.equal(malformed.status, 404);
  });

  test("instructor quiz list shows each quiz's schedule status", async () => {
    await quizWithWindow("Open quiz", inHours(-1), inHours(1));
    await quizWithWindow("Closed quiz", inHours(-3), inHours(-1));

    const response = await request(app).get("/api/quizzes").set("Authorization", `Bearer ${instructorToken}`);
    const statuses = Object.fromEntries(response.body.quizzes.map((quiz) => [quiz.title, quiz.scheduleStatus]));

    assert.deepEqual(statuses, { "Open quiz": "open", "Closed quiz": "closed" });
  });
});

describe("TC-Quiz-02: quiz is inaccessible outside its window (AC-021)", () => {
  test("students cannot start a quiz before its start time", async () => {
    const quiz = await quizWithWindow("Upcoming", inHours(1), inHours(3));

    const response = await startAttempt(quiz._id);

    assert.equal(response.status, 409);
    assert.match(response.body.message, /^This quiz opens at /);
    assert.equal(response.body.availableFrom, quiz.availableFrom.toISOString());
    assert.equal(await Attempt.countDocuments(), 0);
  });

  test("students cannot start a quiz after its end time", async () => {
    const quiz = await quizWithWindow("Closed", inHours(-3), inHours(-1));

    const response = await startAttempt(quiz._id);

    assert.equal(response.status, 409);
    assert.match(response.body.message, /^This quiz closed at /);
    assert.equal(await Attempt.countDocuments(), 0);
  });

  test("students cannot start a quiz that is not scheduled", async () => {
    const quiz = await quizWithWindow("Draft", null, null);

    const response = await startAttempt(quiz._id);

    assert.equal(response.status, 409);
    assert.equal(response.body.message, "This quiz has not been scheduled yet");
  });

  test("students can start a quiz inside its window", async () => {
    const quiz = await quizWithWindow("Open", inHours(-1), inHours(2));

    const response = await startAttempt(quiz._id);

    assert.equal(response.status, 201);
    assert.equal(response.body.attempt.status, "in_progress");
  });

  test("an attempt never runs past the end of the window", async () => {
    const closesSoon = new Date(Date.now() + 10 * 60 * 1000);
    const quiz = await quizWithWindow("Closing soon", inHours(-1), closesSoon);

    const response = await startAttempt(quiz._id);

    assert.equal(response.status, 201);
    assert.equal(response.body.attempt.expiresAt, closesSoon.toISOString());
    assert.ok(response.body.attempt.remainingSeconds <= 600);
  });

  test("an attempt started in time can still be resumed and its result viewed after the window", async () => {
    const quiz = await quizWithWindow("Open", inHours(-1), inHours(2));
    await startAttempt(quiz._id);
    await request(app)
      .post(`/api/quizzes/${quiz._id}/attempt`)
      .set("Authorization", `Bearer ${studentToken}`)
      .send({ answers: [{ questionId: quiz.questions[0]._id.toString(), response: "true" }] });
    await Quiz.updateOne({ _id: quiz._id }, { availableFrom: inHours(-5), availableUntil: inHours(-4) });

    const result = await request(app)
      .get(`/api/quizzes/${quiz._id}/attempt/result`)
      .set("Authorization", `Bearer ${studentToken}`);

    assert.equal(result.status, 200);
    assert.equal(result.body.result.score, 1);
  });
});

describe("TC-Quiz-02: students only see quizzes according to the schedule", () => {
  test("open and upcoming quizzes are listed; drafts and unattempted closed quizzes are hidden", async () => {
    await quizWithWindow("Open", inHours(-1), inHours(2));
    await quizWithWindow("Upcoming", inHours(1), inHours(3));
    await quizWithWindow("Closed", inHours(-3), inHours(-1));
    await quizWithWindow("Draft", null, null);

    const response = await listAvailable();
    const statuses = Object.fromEntries(response.body.quizzes.map((quiz) => [quiz.title, quiz.scheduleStatus]));

    assert.equal(response.status, 200);
    assert.deepEqual(statuses, { Open: "open", Upcoming: "upcoming" });
    const upcoming = response.body.quizzes.find((quiz) => quiz.title === "Upcoming");
    assert.ok(upcoming.availableFrom);
    assert.ok(upcoming.availableUntil);
  });

  test("a closed quiz the student attempted stays listed so its result is reachable", async () => {
    const quiz = await quizWithWindow("Taken", inHours(-1), inHours(2));
    await startAttempt(quiz._id);
    await Quiz.updateOne({ _id: quiz._id }, { availableFrom: inHours(-5), availableUntil: inHours(-4) });

    const response = await listAvailable();

    assert.equal(response.body.count, 1);
    assert.equal(response.body.quizzes[0].scheduleStatus, "closed");
    assert.ok(response.body.quizzes[0].attempt);
  });
});

describe("TC-Quiz-02: schedule rules", () => {
  test("works out the schedule status from the current time", () => {
    const now = new Date("2026-11-10T10:00:00Z");
    const window = { availableFrom: new Date("2026-11-10T09:00:00Z"), availableUntil: new Date("2026-11-10T11:00:00Z") };

    assert.equal(scheduleStatus({}, now), "unscheduled");
    assert.equal(scheduleStatus(window, new Date("2026-11-10T08:59:59Z")), "upcoming");
    assert.equal(scheduleStatus(window, now), "open");
    assert.equal(scheduleStatus(window, new Date("2026-11-10T11:00:00Z")), "closed");
  });

  test("the attempt deadline is the earlier of the timer and the window end", () => {
    const started = new Date("2026-11-10T10:00:00Z");
    const quiz = { durationMinutes: 30, availableUntil: new Date("2026-11-10T11:00:00Z") };

    assert.equal(attemptDeadline(quiz, started).toISOString(), "2026-11-10T10:30:00.000Z");
    assert.equal(
      attemptDeadline({ ...quiz, availableUntil: new Date("2026-11-10T10:10:00Z") }, started).toISOString(),
      "2026-11-10T10:10:00.000Z"
    );
    assert.equal(attemptDeadline({ durationMinutes: 30 }, started).toISOString(), "2026-11-10T10:30:00.000Z");
  });

  test("blank values mean no schedule", () => {
    const result = validateSchedule({ availableFrom: "", availableUntil: "" });

    assert.deepEqual(result.errors, {});
    assert.deepEqual(result.schedule, { availableFrom: null, availableUntil: null });
  });
});
