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
const {
  DUPLICATE_THRESHOLD,
  normalizeForComparison,
  similarity
} = require("../src/modules/questionBank/duplicateDetection");

let mongoServer;

const instructorId = new mongoose.Types.ObjectId().toString();
const otherInstructorId = new mongoose.Types.ObjectId().toString();
const instructorToken = jwt.sign({ sub: instructorId, role: "instructor" }, process.env.JWT_SECRET, { expiresIn: "1h" });
const otherToken = jwt.sign({ sub: otherInstructorId, role: "instructor" }, process.env.JWT_SECRET, { expiresIn: "1h" });
const studentToken = jwt.sign({ sub: new mongoose.Types.ObjectId().toString(), role: "student" }, process.env.JWT_SECRET, { expiresIn: "1h" });

function question(text, overrides = {}) {
  return {
    text,
    type: "true_false",
    correctAnswer: "true",
    subject: "Computer Networks",
    topic: "Transport Layer",
    difficulty: "easy",
    ...overrides
  };
}

function addQuestion(body, token = instructorToken) {
  return request(app).post("/api/questions").set("Authorization", `Bearer ${token}`).send(body);
}

function checkDuplicates(body, token = instructorToken) {
  return request(app).post("/api/questions/check-duplicates").set("Authorization", `Bearer ${token}`).send(body);
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

describe("TC-QB-04: adding a near-identical question surfaces a duplicate warning before saving", () => {
  test("the warning lists the similar question and nothing is saved", async () => {
    const original = await addQuestion(question("TCP is connection-oriented."));

    const response = await addQuestion(question("tcp is connection oriented"));

    assert.equal(response.status, 409);
    assert.equal(response.body.code, "DUPLICATE_QUESTION");
    assert.equal(response.body.message, "This question looks like a duplicate of one already in the bank");
    assert.equal(response.body.duplicates.length, 1);
    assert.equal(response.body.duplicates[0]._id, original.body.question._id);
    assert.equal(response.body.duplicates[0].text, "TCP is connection-oriented.");
    assert.equal(response.body.duplicates[0].similarity, 100);
    assert.equal(await Question.countDocuments(), 1);
  });

  test("a small wording change is still flagged", async () => {
    await addQuestion(question("Which protocol is used to send email?", { type: "short_answer", correctAnswer: undefined }));

    const response = await addQuestion(question("Which protocol is used to send an email?", { type: "short_answer", correctAnswer: undefined }));

    assert.equal(response.status, 409);
    assert.ok(response.body.duplicates[0].similarity >= 85);
  });

  test("questions by other instructors are checked too, since the bank is shared", async () => {
    await addQuestion(question("UDP guarantees delivery."), otherToken);

    const response = await addQuestion(question("UDP guarantees delivery!"));

    assert.equal(response.status, 409);
  });

  test("different questions are saved without a warning", async () => {
    await addQuestion(question("What is the capital of France?", { type: "short_answer", correctAnswer: undefined }));

    const similarTopic = await addQuestion(question("What is the capital of Spain?", { type: "short_answer", correctAnswer: undefined }));
    const unrelated = await addQuestion(question("UDP is connectionless."));

    assert.equal(similarTopic.status, 201);
    assert.equal(unrelated.status, 201);
    assert.equal(await Question.countDocuments(), 3);
  });

  test("the instructor can save anyway after seeing the warning", async () => {
    await addQuestion(question("TCP is connection-oriented."));

    const response = await addQuestion(question("TCP is connection-oriented.", { difficulty: "hard", allowDuplicate: true }));

    assert.equal(response.status, 201);
    assert.equal(await Question.countDocuments(), 2);
  });

  test("deleted questions are not counted as duplicates", async () => {
    const original = await addQuestion(question("TCP is connection-oriented."));
    await request(app).delete(`/api/questions/${original.body.question._id}`).set("Authorization", `Bearer ${instructorToken}`);

    const response = await addQuestion(question("TCP is connection-oriented."));

    assert.equal(response.status, 201);
  });

  test("lists up to five matches, most similar first", async () => {
    const texts = [
      "TCP is connection-oriented.",
      "TCP is connection-oriented!",
      "TCP is connection oriented?",
      "Tcp is connection-oriented",
      "TCP is connection-orientated.",
      "TCP is connection-oriented..",
      "TCP is  connection-oriented"
    ];
    for (const text of texts) {
      await addQuestion(question(text, { allowDuplicate: true }));
    }

    const response = await addQuestion(question("TCP is connection-oriented."));
    const scores = response.body.duplicates.map((item) => item.similarity);

    assert.equal(response.body.duplicates.length, 5);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  });
});

describe("TC-QB-04: editing a question's text is checked too", () => {
  test("changing the text to match another question is flagged; the question itself is ignored", async () => {
    await addQuestion(question("TCP is connection-oriented."));
    const second = await addQuestion(question("UDP is connectionless."));
    const id = second.body.question._id;
    const put = (body) => request(app).put(`/api/questions/${id}`).set("Authorization", `Bearer ${instructorToken}`).send(body);

    const clash = await put({ text: "TCP is connection oriented" });
    const textAfterClash = (await Question.findById(id)).text;
    const sameText = await put({ text: "UDP is connectionless.", difficulty: "hard" });
    const otherField = await put({ topic: "Network Layer" });
    const anyway = await put({ text: "TCP is connection oriented", allowDuplicate: true });

    assert.equal(clash.status, 409);
    assert.equal(textAfterClash, "UDP is connectionless.");
    assert.equal(sameText.status, 200);
    assert.equal(otherField.status, 200);
    assert.equal(anyway.status, 200);
  });
});

describe("TC-QB-04: checking for duplicates without saving", () => {
  test("reports matches, or none, and saves nothing", async () => {
    const original = await addQuestion(question("TCP is connection-oriented."));

    const match = await checkDuplicates({ text: "TCP is connection oriented" });
    const noMatch = await checkDuplicates({ text: "Name a routing protocol." });
    const excluded = await checkDuplicates({ text: "TCP is connection-oriented.", excludeId: original.body.question._id });

    assert.equal(match.status, 200);
    assert.equal(match.body.hasDuplicates, true);
    assert.equal(match.body.duplicates[0].similarity, 100);
    assert.equal(noMatch.body.hasDuplicates, false);
    assert.deepEqual(noMatch.body.duplicates, []);
    assert.equal(excluded.body.hasDuplicates, false);
    assert.equal(await Question.countDocuments(), 1);
  });

  test("rejects missing, too long, or badly formed input", async () => {
    const missing = await checkDuplicates({});
    const tooLong = await checkDuplicates({ text: "a".repeat(2001) });
    const badExclude = await checkDuplicates({ text: "TCP", excludeId: "nope" });

    assert.equal(missing.status, 400);
    assert.equal(missing.body.errors.text, "Question text is required");
    assert.equal(tooLong.body.errors.text, "Question text must be 2000 characters or fewer");
    assert.equal(badExclude.body.errors.excludeId, "excludeId must be a question ID");
  });

  test("students cannot check the question bank", async () => {
    const response = await checkDuplicates({ text: "TCP" }, studentToken);

    assert.equal(response.status, 403);
  });
});

describe("TC-QB-04: similarity rules", () => {
  test("ignores case, punctuation, accents and extra spaces", () => {
    assert.equal(normalizeForComparison("  TCP: is  Connection-oriented!? "), "tcp is connection oriented");
    assert.equal(normalizeForComparison("Café"), "cafe");
    assert.equal(similarity("TCP is connection-oriented.", "tcp IS connection oriented"), 1);
  });

  test("scores near-identical text above the threshold and different text below it", () => {
    assert.equal(DUPLICATE_THRESHOLD, 0.85);
    assert.ok(similarity("Which protocol is used to send email?", "Which protocol is used to send an email?") >= 0.85);
    assert.ok(similarity("What is the capital of France?", "What is the capital of Spain?") < 0.85);
    assert.ok(similarity("TCP is connection-oriented.", "UDP is connectionless.") < 0.85);
  });

  test("handles empty and one-letter text", () => {
    assert.equal(similarity("", "TCP"), 0);
    assert.equal(similarity("?!", "TCP"), 0);
    assert.equal(similarity("a", "b"), 0);
    assert.equal(similarity("a", "a"), 1);
  });
});
