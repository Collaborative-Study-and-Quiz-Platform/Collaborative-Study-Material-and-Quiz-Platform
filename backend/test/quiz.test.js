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
const Quiz = require("../src/models/Quiz");

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

const newShortAnswer = {
  text: "Explain the three-way handshake.",
  type: "short_answer",
  correctAnswer: "SYN, SYN-ACK, ACK",
  subject: "Computer Networks",
  topic: "Transport Layer",
  difficulty: "hard"
};

async function addBankQuestions() {
  const [mcq, trueFalse] = await Question.create([
    {
      text: "Which protocol is used to send email?",
      type: "mcq",
      options: ["SMTP", "FTP", "HTTP", "SSH"],
      correctAnswer: "SMTP",
      subject: "Computer Networks",
      topic: "Application Layer",
      difficulty: "easy",
      createdBy: otherInstructorId
    },
    {
      text: "TCP is connection-oriented.",
      type: "true_false",
      correctAnswer: "true",
      subject: "Computer Networks",
      topic: "Transport Layer",
      difficulty: "easy",
      createdBy: instructorId
    }
  ]);

  return { mcq, trueFalse };
}

function quizBody(questions, overrides = {}) {
  return {
    title: "Networks Quiz 1",
    description: "Covers the application and transport layers.",
    durationMinutes: 30,
    passingScore: 60,
    showAnswers: true,
    questions,
    ...overrides
  };
}

function createQuiz(body, token = instructorToken) {
  return request(app)
    .post("/api/quizzes")
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

function listQuizzes(token = instructorToken) {
  return request(app)
    .get("/api/quizzes")
    .set("Authorization", `Bearer ${token}`);
}

function getQuiz(id, token = instructorToken) {
  return request(app)
    .get(`/api/quizzes/${id}`)
    .set("Authorization", `Bearer ${token}`);
}

before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([Question.init(), Quiz.init()]);
});

after(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await Promise.all([Question.deleteMany({}), Quiz.deleteMany({})]);
});

describe("TC-Quiz-01: create a quiz", () => {
  test("instructor creates a quiz with MCQ, True/False and short-answer questions", async () => {
    const { mcq, trueFalse } = await addBankQuestions();

    const response = await createQuiz(quizBody([
      { questionId: mcq._id.toString(), marks: 2 },
      { questionId: trueFalse._id.toString() },
      { question: newShortAnswer, marks: 5 }
    ]));

    assert.equal(response.status, 201);
    const { quiz } = response.body;
    assert.equal(quiz.title, "Networks Quiz 1");
    assert.equal(quiz.description, "Covers the application and transport layers.");
    assert.equal(quiz.durationMinutes, 30);
    assert.equal(quiz.passingScore, 60);
    assert.equal(quiz.showAnswers, true);
    assert.equal(quiz.createdBy, instructorId);
    assert.equal(quiz.totalMarks, 8);
    assert.deepEqual(quiz.questions.map((question) => question.type), [
      "mcq",
      "true_false",
      "short_answer"
    ]);
    assert.deepEqual(quiz.questions.map((question) => question.marks), [2, 1, 5]);
    assert.deepEqual(quiz.questions[0].options, ["SMTP", "FTP", "HTTP", "SSH"]);
    assert.equal(quiz.questions[0].correctAnswer, "SMTP");
    assert.equal(quiz.questions[0].sourceQuestion, mcq._id.toString());
  });

  test("the saved quiz is retrievable with all its questions and settings", async () => {
    const { mcq } = await addBankQuestions();
    const created = await createQuiz(quizBody([{ questionId: mcq._id.toString() }]));

    const response = await getQuiz(created.body.quiz._id);

    assert.equal(response.status, 200);
    assert.equal(response.body.quiz.durationMinutes, 30);
    assert.equal(response.body.quiz.passingScore, 60);
    assert.equal(response.body.quiz.questions.length, 1);
    assert.equal(response.body.quiz.questions[0].text, "Which protocol is used to send email?");
  });

  test("new questions are also added to the question bank", async () => {
    const response = await createQuiz(quizBody([{ question: newShortAnswer }]));
    const bankQuestion = await Question.findById(response.body.quiz.questions[0].sourceQuestion);

    assert.equal(response.status, 201);
    assert.equal(bankQuestion.text, "Explain the three-way handshake.");
    assert.equal(bankQuestion.topic, "Transport Layer");
    assert.equal(bankQuestion.createdBy.toString(), instructorId);
  });

  test("editing or deleting a bank question later does not change the quiz", async () => {
    const { mcq } = await addBankQuestions();
    const created = await createQuiz(quizBody([{ questionId: mcq._id.toString() }]));

    await Question.updateOne({ _id: mcq._id }, { text: "Edited text", correctAnswer: "FTP" });
    await Question.updateOne({ _id: mcq._id }, { isDeleted: true });
    const response = await getQuiz(created.body.quiz._id);

    assert.equal(response.body.quiz.questions[0].text, "Which protocol is used to send email?");
    assert.equal(response.body.quiz.questions[0].correctAnswer, "SMTP");
  });

  test("uses defaults for description, showAnswers and marks", async () => {
    const { trueFalse } = await addBankQuestions();
    const response = await createQuiz({
      title: "  Quick check  ",
      durationMinutes: 5,
      passingScore: 0,
      questions: [{ questionId: trueFalse._id.toString() }]
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.quiz.title, "Quick check");
    assert.equal(response.body.quiz.description, "");
    assert.equal(response.body.quiz.showAnswers, false);
    assert.equal(response.body.quiz.passingScore, 0);
    assert.equal(response.body.quiz.totalMarks, 1);
  });

  test("admin can create a quiz", async () => {
    const response = await createQuiz(quizBody([{ question: newShortAnswer }]), adminToken);

    assert.equal(response.status, 201);
    assert.equal(response.body.quiz.createdBy, adminId);
  });
});

describe("TC-Quiz-01: reject invalid quizzes", () => {
  test("rejects missing or invalid settings", async () => {
    const response = await createQuiz({});

    assert.equal(response.status, 400);
    assert.equal(response.body.errors.title, "Quiz title is required");
    assert.equal(response.body.errors.durationMinutes, "Duration must be a whole number of minutes from 1 to 600");
    assert.equal(response.body.errors.passingScore, "Passing score must be a percentage from 0 to 100");
    assert.equal(response.body.errors.questions, "A quiz needs at least one question");
    assert.equal(await Quiz.countDocuments(), 0);
  });

  test("rejects out-of-range values and wrong types", async () => {
    const response = await createQuiz(quizBody([{ question: newShortAnswer }], {
      title: "t".repeat(201),
      description: 42,
      durationMinutes: 2.5,
      passingScore: 101,
      showAnswers: "yes"
    }));
    const longDescription = await createQuiz(quizBody([{ question: newShortAnswer }], {
      description: "d".repeat(2001),
      durationMinutes: 601,
      passingScore: -1
    }));

    assert.equal(response.status, 400);
    assert.equal(response.body.errors.title, "Quiz title must be 200 characters or fewer");
    assert.equal(response.body.errors.description, "Description must be text");
    assert.ok(response.body.errors.durationMinutes);
    assert.ok(response.body.errors.passingScore);
    assert.equal(response.body.errors.showAnswers, "showAnswers must be true or false");
    assert.equal(longDescription.body.errors.description, "Description must be 2000 characters or fewer");
    assert.ok(longDescription.body.errors.durationMinutes);
    assert.ok(longDescription.body.errors.passingScore);
  });

  test("rejects a questions list that is not an array or too long", async () => {
    const notArray = await createQuiz(quizBody("all of them"));
    const tooMany = await createQuiz(quizBody(
      Array.from({ length: 101 }, () => ({ question: newShortAnswer }))
    ));

    assert.equal(notArray.body.errors.questions, "A quiz needs at least one question");
    assert.equal(tooMany.body.errors.questions, "A quiz can have at most 100 questions");
  });

  test("rejects badly formed question entries", async () => {
    const { mcq } = await addBankQuestions();
    const response = await createQuiz(quizBody([
      "not an object",
      {},
      { questionId: mcq._id.toString(), question: newShortAnswer },
      { questionId: "not-an-id" },
      { questionId: mcq._id.toString(), marks: 0 },
      { questionId: mcq._id.toString() }
    ]));

    assert.equal(response.status, 400);
    const { errors } = response.body;
    assert.equal(errors["questions.0"], "Each question entry must be an object");
    assert.equal(errors["questions.1"], "Give either questionId for a bank question or question for a new one");
    assert.equal(errors["questions.2"], "Give either questionId for a bank question or question for a new one");
    assert.equal(errors["questions.3.questionId"], "Question ID is invalid");
    assert.equal(errors["questions.4.marks"], "Marks must be a whole number from 1 to 100");
    assert.equal(errors["questions.5.questionId"], "The same bank question is used more than once");
  });

  test("rejects bank questions that do not exist or were deleted", async () => {
    const { mcq, trueFalse } = await addBankQuestions();
    await Question.updateOne({ _id: trueFalse._id }, { isDeleted: true });

    const response = await createQuiz(quizBody([
      { questionId: mcq._id.toString() },
      { questionId: trueFalse._id.toString() },
      { questionId: new mongoose.Types.ObjectId().toString() }
    ]));

    assert.equal(response.status, 400);
    assert.equal(response.body.errors["questions.0.questionId"], undefined);
    assert.equal(response.body.errors["questions.1.questionId"], "Question not found in the question bank");
    assert.equal(response.body.errors["questions.2.questionId"], "Question not found in the question bank");
  });

  test("rejects invalid new questions and adds nothing to the bank", async () => {
    const response = await createQuiz(quizBody([
      { question: newShortAnswer },
      { question: { ...newShortAnswer, type: "mcq", options: ["Only one"] } },
      { question: "not an object" }
    ]));

    assert.equal(response.status, 400);
    assert.equal(response.body.errors["questions.1.question.options"], "MCQ questions need 2 to 6 options");
    assert.equal(response.body.errors["questions.2.question.text"], "Question text is required");
    assert.equal(await Question.countDocuments(), 0);
    assert.equal(await Quiz.countDocuments(), 0);
  });
});

describe("TC-Quiz-01: view quizzes", () => {
  test("instructors list only their own quizzes; admins list all", async () => {
    await createQuiz(quizBody([{ question: newShortAnswer }]));
    await createQuiz(quizBody([{ question: newShortAnswer }], { title: "Other" }), otherInstructorToken);

    const own = await listQuizzes();
    const all = await listQuizzes(adminToken);

    assert.equal(own.status, 200);
    assert.equal(own.body.count, 1);
    assert.equal(own.body.quizzes[0].title, "Networks Quiz 1");
    assert.equal(all.body.count, 2);
  });

  test("another instructor cannot view the quiz but an admin can", async () => {
    const created = await createQuiz(quizBody([{ question: newShortAnswer }]));
    const id = created.body.quiz._id;

    const forbidden = await getQuiz(id, otherInstructorToken);
    const allowed = await getQuiz(id, adminToken);

    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.message, "You can only view quizzes you created");
    assert.equal(allowed.status, 200);
  });

  test("returns 404 for unknown or malformed quiz IDs", async () => {
    const unknown = await getQuiz(new mongoose.Types.ObjectId().toString());
    const malformed = await getQuiz("not-an-id");

    assert.equal(unknown.status, 404);
    assert.equal(malformed.status, 404);
    assert.equal(malformed.body.message, "Quiz not found");
  });
});

describe("TC-Auth-03: only instructors and admins can manage quizzes", () => {
  test("students cannot create, list or view quizzes", async () => {
    const created = await createQuiz(quizBody([{ question: newShortAnswer }]));

    const responses = await Promise.all([
      createQuiz(quizBody([{ question: newShortAnswer }]), studentToken),
      listQuizzes(studentToken),
      getQuiz(created.body.quiz._id, studentToken)
    ]);

    responses.forEach((response) => assert.equal(response.status, 403));
    assert.equal(await Quiz.countDocuments(), 1);
  });

  test("requests without a token are rejected", async () => {
    const response = await request(app).post("/api/quizzes").send({});

    assert.equal(response.status, 401);
  });
});
