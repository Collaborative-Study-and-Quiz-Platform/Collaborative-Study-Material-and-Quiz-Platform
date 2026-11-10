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
const studentId = new mongoose.Types.ObjectId().toString();
const instructorToken = jwt.sign({ sub: instructorId, role: "instructor" }, process.env.JWT_SECRET, { expiresIn: "1h" });
const studentToken = jwt.sign({ sub: studentId, role: "student" }, process.env.JWT_SECRET, { expiresIn: "1h" });

function question(overrides = {}) {
  return {
    text: "TCP is connection-oriented.",
    type: "true_false",
    correctAnswer: "true",
    subject: "Computer Networks",
    topic: "Transport Layer",
    difficulty: "easy",
    ...overrides
  };
}

function addQuestion(body) {
  return request(app).post("/api/questions").set("Authorization", `Bearer ${instructorToken}`).send(body);
}

function search(query, token = instructorToken) {
  return request(app).get("/api/questions").query(query).set("Authorization", `Bearer ${token}`);
}

function texts(response) {
  return response.body.questions.map((item) => item.text).sort();
}

// A small bank where each filter narrows the results differently
async function seedBank() {
  await addQuestion(question({ text: "TCP is connection-oriented.", tags: ["tcp", "protocols"] }));
  await addQuestion(question({ text: "UDP guarantees delivery.", correctAnswer: "false", difficulty: "medium", tags: ["udp", "protocols"] }));
  await addQuestion(question({
    text: "Explain the TCP three-way handshake.",
    type: "short_answer",
    correctAnswer: "SYN, SYN-ACK, ACK",
    difficulty: "hard",
    tags: ["tcp", "handshake"]
  }));
  await addQuestion(question({
    text: "Which protocol is used to send email?",
    type: "mcq",
    options: ["SMTP", "FTP", "HTTP"],
    correctAnswer: "SMTP",
    topic: "Application Layer",
    tags: ["email", "protocols"]
  }));
  await addQuestion(question({
    text: "What does a CPU scheduler do?",
    type: "short_answer",
    subject: "Operating Systems",
    topic: "Scheduling",
    difficulty: "medium",
    tags: ["cpu"]
  }));
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

describe("TC-QB-02: questions can be tagged", () => {
  test("tags are saved trimmed, lower case and without repeats", async () => {
    const response = await addQuestion(question({ tags: [" TCP ", "Transport  Layer", "tcp"] }));

    assert.equal(response.status, 201);
    assert.deepEqual(response.body.question.tags, ["tcp", "transport layer"]);
  });

  test("tags can be sent as comma-separated text, or left out", async () => {
    const fromText = await addQuestion(question({ tags: "tcp, reliability; exam" }));
    const none = await addQuestion(question());

    assert.deepEqual(fromText.body.question.tags, ["tcp", "reliability", "exam"]);
    assert.deepEqual(none.body.question.tags, []);
  });

  test("rejects too many, too long, or badly formed tags", async () => {
    const tooMany = await addQuestion(question({ tags: Array.from({ length: 11 }, (_, i) => `tag${i}`) }));
    const tooLong = await addQuestion(question({ tags: ["t".repeat(31)] }));
    const notWords = await addQuestion(question({ tags: [42] }));
    const notList = await addQuestion(question({ tags: { tcp: true } }));

    assert.equal(tooMany.status, 400);
    assert.equal(tooMany.body.errors.tags, "A question can have at most 10 tags");
    assert.equal(tooLong.body.errors.tags, "Each tag must be 30 characters or fewer");
    assert.equal(notWords.body.errors.tags, "Tags must be a list of words");
    assert.equal(notList.body.errors.tags, "Tags must be a list of words");
  });

  test("tags can be changed when editing, and kept when not sent", async () => {
    const created = await addQuestion(question({ tags: ["tcp"] }));
    const id = created.body.question._id;
    const put = (body) => request(app).put(`/api/questions/${id}`).set("Authorization", `Bearer ${instructorToken}`).send(body);

    const kept = await put({ difficulty: "hard" });
    const changed = await put({ tags: ["reliability"] });
    const cleared = await put({ tags: [] });

    assert.deepEqual(kept.body.question.tags, ["tcp"]);
    assert.deepEqual(changed.body.question.tags, ["reliability"]);
    assert.deepEqual(cleared.body.question.tags, []);
  });

  test("lists the tags in use, most used first", async () => {
    await seedBank();

    const response = await request(app).get("/api/questions/tags").set("Authorization", `Bearer ${instructorToken}`);

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.tags.slice(0, 2), [
      { tag: "protocols", count: 3 },
      { tag: "tcp", count: 2 }
    ]);
    assert.equal(response.body.tags.length, 6);
  });

  test("tags from deleted questions are not suggested", async () => {
    const created = await addQuestion(question({ tags: ["gone"] }));
    await request(app).delete(`/api/questions/${created.body.question._id}`).set("Authorization", `Bearer ${instructorToken}`);

    const response = await request(app).get("/api/questions/tags").set("Authorization", `Bearer ${instructorToken}`);

    assert.deepEqual(response.body.tags, []);
  });
});

describe("TC-QB-02: filtered results match all applied filter criteria", () => {
  test("filters by a single tag", async () => {
    await seedBank();

    const response = await search({ tag: "TCP" });

    assert.equal(response.status, 200);
    assert.deepEqual(texts(response), ["Explain the TCP three-way handshake.", "TCP is connection-oriented."]);
  });

  test("several tags must all be present", async () => {
    await seedBank();

    const response = await search({ tag: "tcp, protocols" });

    assert.deepEqual(texts(response), ["TCP is connection-oriented."]);
  });

  test("searches the question text by keyword, ignoring case and word order", async () => {
    await seedBank();

    const single = await search({ q: "handshake" });
    const words = await search({ q: "oriented TCP" });
    const none = await search({ q: "routing" });

    assert.deepEqual(texts(single), ["Explain the TCP three-way handshake."]);
    assert.deepEqual(texts(words), ["TCP is connection-oriented."]);
    assert.equal(none.body.count, 0);
  });

  test("keyword search treats special characters as plain text", async () => {
    await addQuestion(question({ text: "Is 3.5 (a+b)? a valid [expression]?" }));
    await addQuestion(question({ text: "Is 3x5 ab a valid expression?" }));

    const response = await search({ q: "3.5 (a+b)?" });

    assert.deepEqual(texts(response), ["Is 3.5 (a+b)? a valid [expression]?"]);
  });

  test("combines tag, keyword, subject, topic, difficulty and type", async () => {
    await seedBank();

    const all = await search({
      q: "tcp",
      tag: "tcp",
      subject: "computer networks",
      topic: "transport layer",
      difficulty: "hard",
      type: "short_answer"
    });
    const oneFilterOff = await search({ q: "tcp", tag: "tcp", difficulty: "medium" });

    assert.deepEqual(texts(all), ["Explain the TCP three-way handshake."]);
    assert.equal(oneFilterOff.body.count, 0);
  });

  test("every result matches every applied filter", async () => {
    await seedBank();

    const response = await search({ tag: "protocols", subject: "Computer Networks", difficulty: "easy" });

    assert.ok(response.body.count > 0);
    response.body.questions.forEach((item) => {
      assert.ok(item.tags.includes("protocols"));
      assert.equal(item.subject, "Computer Networks");
      assert.equal(item.difficulty, "easy");
    });
    assert.deepEqual(texts(response), ["TCP is connection-oriented.", "Which protocol is used to send email?"]);
  });

  test("blank search and tag values are ignored", async () => {
    await seedBank();

    const response = await search({ q: "   ", tag: " , " });

    assert.equal(response.body.count, 5);
  });

  test("rejects search text that is too long or repeated", async () => {
    const tooLong = await search({ q: "a".repeat(101) });
    const repeated = await request(app)
      .get("/api/questions?q=tcp&q=udp&tag=a&tag=b")
      .set("Authorization", `Bearer ${instructorToken}`);

    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.body.errors.q, "Search text must be 100 characters or fewer");
    assert.equal(repeated.status, 400);
    assert.equal(repeated.body.errors.tag, "Tag filter must be text");
  });

  test("deleted questions never appear in search results", async () => {
    const created = await addQuestion(question({ tags: ["tcp"] }));
    await request(app).delete(`/api/questions/${created.body.question._id}`).set("Authorization", `Bearer ${instructorToken}`);

    const response = await search({ tag: "tcp" });

    assert.equal(response.body.count, 0);
  });

  test("students cannot search the question bank or list tags", async () => {
    const searchResponse = await search({ q: "tcp" }, studentToken);
    const tagsResponse = await request(app).get("/api/questions/tags").set("Authorization", `Bearer ${studentToken}`);

    assert.equal(searchResponse.status, 403);
    assert.equal(tagsResponse.status, 403);
  });
});

describe("TC-QB-02: imported questions can carry tags", () => {
  test("a tags column in a CSV import is saved and searchable", async () => {
    const csv = [
      "text,type,subject,topic,difficulty,options,correctAnswer,tags",
      "TCP is reliable.,true_false,Computer Networks,Transport Layer,easy,,true,\"tcp, reliability\""
    ].join("\n");

    const imported = await request(app)
      .post("/api/questions/import")
      .set("Authorization", `Bearer ${instructorToken}`)
      .attach("file", Buffer.from(csv), { filename: "questions.csv" });
    const response = await search({ tag: "reliability" });

    assert.ok([200, 201].includes(imported.status), JSON.stringify(imported.body));
    assert.equal(response.body.count, 1);
    assert.deepEqual(response.body.questions[0].tags, ["tcp", "reliability"]);
  });
});
