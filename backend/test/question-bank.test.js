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

function mcqQuestion(overrides = {}) {
  return {
    text: "Which protocol is used to send email?",
    type: "mcq",
    options: ["SMTP", "FTP", "HTTP", "SSH"],
    correctAnswer: "SMTP",
    subject: "Computer Networks",
    topic: "Application Layer",
    difficulty: "easy",
    ...overrides
  };
}

function createQuestion(body = mcqQuestion(), token = instructorToken) {
  return request(app)
    .post("/api/questions")
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

function listQuestions(query = {}, token = instructorToken) {
  return request(app)
    .get("/api/questions")
    .query(query)
    .set("Authorization", `Bearer ${token}`);
}

function getQuestion(id, token = instructorToken) {
  return request(app)
    .get(`/api/questions/${id}`)
    .set("Authorization", `Bearer ${token}`);
}

function updateQuestion(id, body, token = instructorToken) {
  return request(app)
    .put(`/api/questions/${id}`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

function deleteQuestion(id, token = instructorToken) {
  return request(app)
    .delete(`/api/questions/${id}`)
    .set("Authorization", `Bearer ${token}`);
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

describe("TC-QB-01: add a question", () => {
  test("instructor adds an MCQ question with metadata", async () => {
    const response = await createQuestion();

    assert.equal(response.status, 201);
    assert.equal(response.body.question.type, "mcq");
    assert.equal(response.body.question.subject, "Computer Networks");
    assert.equal(response.body.question.topic, "Application Layer");
    assert.equal(response.body.question.difficulty, "easy");
    assert.equal(response.body.question.createdBy, instructorId);
    assert.deepEqual(response.body.question.options, ["SMTP", "FTP", "HTTP", "SSH"]);
    assert.equal(response.body.question.isDeleted, undefined);
  });

  test("normalizes type, difficulty, and a boolean true/false answer", async () => {
    const response = await createQuestion({
      text: "  TCP is connection-oriented.  ",
      type: " TRUE_FALSE ",
      correctAnswer: true,
      subject: " Computer Networks ",
      topic: "Transport Layer",
      difficulty: "Medium"
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.question.text, "TCP is connection-oriented.");
    assert.equal(response.body.question.type, "true_false");
    assert.equal(response.body.question.correctAnswer, "true");
    assert.equal(response.body.question.subject, "Computer Networks");
    assert.equal(response.body.question.difficulty, "medium");
    assert.deepEqual(response.body.question.options, []);
  });

  test("accepts a short-answer question with or without a model answer", async () => {
    const withAnswer = await createQuestion({
      text: "Explain the three-way handshake.",
      type: "short_answer",
      correctAnswer: "SYN, SYN-ACK, ACK",
      subject: "Computer Networks",
      topic: "Transport Layer",
      difficulty: "hard"
    });
    const withoutAnswer = await createQuestion({
      text: "Describe congestion control.",
      type: "short_answer",
      subject: "Computer Networks",
      topic: "Transport Layer",
      difficulty: "hard"
    });

    assert.equal(withAnswer.status, 201);
    assert.equal(withAnswer.body.question.correctAnswer, "SYN, SYN-ACK, ACK");
    assert.equal(withoutAnswer.status, 201);
    assert.equal(withoutAnswer.body.question.correctAnswer, undefined);
  });

  test("admin can add a question", async () => {
    const response = await createQuestion(mcqQuestion(), adminToken);

    assert.equal(response.status, 201);
    assert.equal(response.body.question.createdBy, adminId);
  });

  test("rejects missing fields with clear errors", async () => {
    const response = await createQuestion({});

    assert.equal(response.status, 400);
    assert.equal(response.body.errors.text, "Question text is required");
    assert.equal(response.body.errors.type, "Type must be mcq, true_false, or short_answer");
    assert.equal(response.body.errors.subject, "Subject is required");
    assert.equal(response.body.errors.topic, "Topic is required");
    assert.equal(response.body.errors.difficulty, "Difficulty must be easy, medium, or hard");
    assert.equal(await Question.countDocuments(), 0);
  });

  test("rejects metadata and text that are too long", async () => {
    const response = await createQuestion(mcqQuestion({
      text: "q".repeat(2001),
      subject: "s".repeat(101),
      topic: "t".repeat(101)
    }));

    assert.equal(response.status, 400);
    assert.equal(response.body.errors.text, "Question text must be 2000 characters or fewer");
    assert.equal(response.body.errors.subject, "Subject must be 100 characters or fewer");
    assert.equal(response.body.errors.topic, "Topic must be 100 characters or fewer");
  });

  test("rejects invalid MCQ options and answers", async () => {
    const tooFew = await createQuestion(mcqQuestion({ options: ["SMTP"] }));
    const notArray = await createQuestion(mcqQuestion({ options: "SMTP" }));
    const blank = await createQuestion(mcqQuestion({ options: ["SMTP", " "] }));
    const duplicate = await createQuestion(mcqQuestion({ options: ["SMTP", "smtp"] }));
    const wrongAnswer = await createQuestion(mcqQuestion({ correctAnswer: "POP3" }));
    const noAnswer = await createQuestion(mcqQuestion({ correctAnswer: undefined }));

    assert.equal(tooFew.status, 400);
    assert.equal(tooFew.body.errors.options, "MCQ questions need 2 to 6 options");
    assert.equal(notArray.body.errors.options, "MCQ questions need 2 to 6 options");
    assert.equal(blank.body.errors.options, "Every option must be non-empty text");
    assert.equal(duplicate.body.errors.options, "Options must be unique");
    assert.equal(wrongAnswer.body.errors.correctAnswer, "Correct answer must match one of the options");
    assert.equal(noAnswer.body.errors.correctAnswer, "Correct answer is required");
  });

  test("rejects invalid true/false and short-answer input", async () => {
    const badTrueFalse = await createQuestion(mcqQuestion({
      type: "true_false",
      options: [],
      correctAnswer: "maybe"
    }));
    const optionsOnTrueFalse = await createQuestion(mcqQuestion({
      type: "true_false",
      correctAnswer: "false"
    }));
    const badModelAnswer = await createQuestion(mcqQuestion({
      type: "short_answer",
      options: undefined,
      correctAnswer: 42
    }));

    assert.equal(badTrueFalse.body.errors.correctAnswer, "Correct answer must be true or false");
    assert.equal(optionsOnTrueFalse.body.errors.options, "Options are only allowed for MCQ questions");
    assert.equal(badModelAnswer.body.errors.correctAnswer, "Model answer must be text");
  });
});

describe("TC-QB-01: retrieve questions by metadata", () => {
  test("filters by subject, topic, difficulty, and type", async () => {
    await createQuestion();
    await createQuestion(mcqQuestion({ topic: "Network Layer", difficulty: "hard" }));
    await createQuestion(mcqQuestion({ subject: "Operating Systems", topic: "Scheduling" }));

    const bySubject = await listQuestions({ subject: "computer networks" });
    const byTopicAndDifficulty = await listQuestions({
      subject: "Computer Networks",
      topic: "Network Layer",
      difficulty: "HARD"
    });
    const byType = await listQuestions({ type: "mcq" });
    const noMatch = await listQuestions({ type: "short_answer" });

    assert.equal(bySubject.status, 200);
    assert.equal(bySubject.body.count, 2);
    assert.equal(byTopicAndDifficulty.body.count, 1);
    assert.equal(byTopicAndDifficulty.body.questions[0].topic, "Network Layer");
    assert.equal(byType.body.count, 3);
    assert.equal(noMatch.body.count, 0);
  });

  test("rejects invalid filter values", async () => {
    const response = await listQuestions({ difficulty: "extreme", type: "essay" });

    assert.equal(response.status, 400);
    assert.equal(response.body.errors.difficulty, "Difficulty must be easy, medium, or hard");
    assert.equal(response.body.errors.type, "Type must be mcq, true_false, or short_answer");
  });

  test("gets one question by its ID", async () => {
    const created = await createQuestion();
    const response = await getQuestion(created.body.question._id, otherInstructorToken);

    assert.equal(response.status, 200);
    assert.equal(response.body.question.text, "Which protocol is used to send email?");
  });

  test("returns 404 for unknown or malformed IDs", async () => {
    const unknown = await getQuestion(new mongoose.Types.ObjectId().toString());
    const malformed = await getQuestion("not-an-id");

    assert.equal(unknown.status, 404);
    assert.equal(malformed.status, 404);
    assert.equal(malformed.body.message, "Question not found");
  });
});

describe("TC-QB-01: edit a question", () => {
  test("owner edits a question and it is retrievable by its new metadata", async () => {
    const created = await createQuestion();
    const id = created.body.question._id;

    const response = await updateQuestion(id, { topic: "Email Protocols", difficulty: "medium" });
    const found = await listQuestions({ topic: "Email Protocols", difficulty: "medium" });
    const oldTopic = await listQuestions({ topic: "Application Layer" });

    assert.equal(response.status, 200);
    assert.equal(response.body.question.topic, "Email Protocols");
    assert.equal(response.body.question.text, "Which protocol is used to send email?");
    assert.equal(found.body.count, 1);
    assert.equal(found.body.questions[0]._id, id);
    assert.equal(oldTopic.body.count, 0);
  });

  test("changing an MCQ to true/false clears its options", async () => {
    const created = await createQuestion();
    const response = await updateQuestion(created.body.question._id, {
      type: "true_false",
      correctAnswer: "False"
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.question.type, "true_false");
    assert.equal(response.body.question.correctAnswer, "false");
    assert.deepEqual(response.body.question.options, []);
  });

  test("clearing a short-answer model answer removes it", async () => {
    const created = await createQuestion({
      text: "Explain the three-way handshake.",
      type: "short_answer",
      correctAnswer: "SYN, SYN-ACK, ACK",
      subject: "Computer Networks",
      topic: "Transport Layer",
      difficulty: "hard"
    });
    const response = await updateQuestion(created.body.question._id, { correctAnswer: "" });

    assert.equal(response.status, 200);
    assert.equal(response.body.question.correctAnswer, undefined);
  });

  test("rejects invalid edits and keeps the original", async () => {
    const created = await createQuestion();
    const id = created.body.question._id;

    const response = await updateQuestion(id, { difficulty: "impossible" });
    const unchanged = await getQuestion(id);

    assert.equal(response.status, 400);
    assert.equal(response.body.errors.difficulty, "Difficulty must be easy, medium, or hard");
    assert.equal(unchanged.body.question.difficulty, "easy");
  });

  test("another instructor cannot edit the question but an admin can", async () => {
    const created = await createQuestion();
    const id = created.body.question._id;

    const forbidden = await updateQuestion(id, { difficulty: "hard" }, otherInstructorToken);
    const allowed = await updateQuestion(id, { difficulty: "hard" }, adminToken);

    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.message, "You can only edit questions you created");
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.question.difficulty, "hard");
  });

  test("returns 404 when editing an unknown question", async () => {
    const response = await updateQuestion(new mongoose.Types.ObjectId().toString(), {
      difficulty: "hard"
    });

    assert.equal(response.status, 404);
  });
});

describe("TC-QB-01: delete a question", () => {
  test("owner soft-deletes a question so it no longer appears in the bank", async () => {
    const created = await createQuestion();
    const id = created.body.question._id;

    const response = await deleteQuestion(id);
    const list = await listQuestions();
    const single = await getQuestion(id);
    const stored = await Question.findById(id).select("+isDeleted +deletedAt");

    assert.equal(response.status, 200);
    assert.equal(response.body.message, "Question deleted");
    assert.equal(list.body.count, 0);
    assert.equal(single.status, 404);
    assert.equal(stored.isDeleted, true);
    assert.ok(stored.deletedAt instanceof Date);
  });

  test("a deleted question cannot be edited or deleted again", async () => {
    const created = await createQuestion();
    const id = created.body.question._id;
    await deleteQuestion(id);

    const edit = await updateQuestion(id, { difficulty: "hard" });
    const deleteAgain = await deleteQuestion(id);

    assert.equal(edit.status, 404);
    assert.equal(deleteAgain.status, 404);
  });

  test("another instructor cannot delete the question but an admin can", async () => {
    const created = await createQuestion();
    const id = created.body.question._id;

    const forbidden = await deleteQuestion(id, otherInstructorToken);
    const allowed = await deleteQuestion(id, adminToken);

    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.message, "You can only delete questions you created");
    assert.equal(allowed.status, 200);
  });
});

describe("TC-QB-01: access control", () => {
  test("students cannot use the question bank", async () => {
    const created = await createQuestion();
    const id = created.body.question._id;

    const responses = await Promise.all([
      createQuestion(mcqQuestion(), studentToken),
      listQuestions({}, studentToken),
      getQuestion(id, studentToken),
      updateQuestion(id, { difficulty: "hard" }, studentToken),
      deleteQuestion(id, studentToken)
    ]);

    responses.forEach((response) => assert.equal(response.status, 403));
  });

  test("requests without a token are rejected", async () => {
    const response = await request(app).get("/api/questions");

    assert.equal(response.status, 401);
  });
});
