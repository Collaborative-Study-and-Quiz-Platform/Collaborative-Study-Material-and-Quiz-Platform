const assert = require("node:assert/strict");
const { after, afterEach, before, test } = require("node:test");
const fs = require("node:fs/promises");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const os = require("node:os");
const path = require("node:path");
const request = require("supertest");

process.env.JWT_SECRET = "test-only-jwt-secret";
const uploadDirectory = path.join(os.tmpdir(), `csqp-material-search-test-${process.pid}`);
process.env.MATERIAL_UPLOAD_DIR = uploadDirectory;

const app = require("../src/app");
const Material = require("../src/models/Material");

let mongoServer;
const studentId = new mongoose.Types.ObjectId().toString();
const instructorId = new mongoose.Types.ObjectId().toString();

function tokenFor(role, id) {
  return jwt.sign({ sub: id, role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

function browse(query = "", role = "student") {
  return request(app)
    .get(`/api/materials${query}`)
    .set("Authorization", `Bearer ${tokenFor(role, role === "student" ? studentId : instructorId)}`);
}

function materialData(overrides = {}) {
  return {
    originalFilename: "Operating Systems Processes.pdf",
    storedFilename: `${new mongoose.Types.ObjectId()}.pdf`,
    fileType: "pdf",
    mimeType: "application/pdf",
    fileSize: 128,
    tags: {
      course: "Computer Science",
      subject: "Operating Systems",
      topic: "Processes"
    },
    uploadedBy: instructorId,
    storageLocation: "/private/test-material.pdf",
    ...overrides
  };
}

before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

after(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
  await fs.rm(uploadDirectory, { recursive: true, force: true });
});

afterEach(async () => {
  await Material.deleteMany({});
  await fs.rm(uploadDirectory, { recursive: true, force: true });
});

test("returns materials and supports keyword, course, subject, topic, and combined filters", async () => {
  await Material.insertMany([
    materialData(),
    materialData({
      originalFilename: "Database Indexing.docx",
      storedFilename: `${new mongoose.Types.ObjectId()}.docx`,
      fileType: "docx",
      tags: { course: "Computer Science", subject: "Databases", topic: "Indexing" }
    }),
    materialData({
      originalFilename: "Physics Waves.ppt",
      storedFilename: `${new mongoose.Types.ObjectId()}.ppt`,
      fileType: "ppt",
      tags: { course: "Physics", subject: "Mechanics", topic: "Waves" }
    })
  ]);

  const all = await browse();
  const keyword = await browse("?keyword=database");
  const course = await browse("?course=physics");
  const subject = await browse("?subject=databases");
  const topic = await browse("?topic=processes");
  const combined = await browse("?keyword=operating&course=computer%20science&subject=operating%20systems&topic=processes");
  const empty = await browse("?keyword=calculus");

  assert.equal(all.status, 200);
  assert.equal(all.body.count, 3);
  assert.equal(keyword.body.count, 1);
  assert.equal(course.body.materials[0].tags.course, "Physics");
  assert.equal(subject.body.materials[0].tags.subject, "Databases");
  assert.equal(topic.body.materials[0].tags.topic, "Processes");
  assert.equal(combined.body.count, 1);
  assert.equal(empty.body.count, 0);
  assert.equal(empty.body.materials.length, 0);
  assert.equal(all.body.materials[0].storageLocation, undefined);
});

test("allows students and instructors to browse while preserving other authorization checks", async () => {
  const metadataMissing = materialData();
  delete metadataMissing.tags;
  await Material.collection.insertOne(metadataMissing);

  const empty = await browse("?keyword=&course=&subject=&topic=");
  const missing = await browse("?keyword=missing");
  const unauthenticated = await request(app).get("/api/materials");
  const instructor = await browse("", "instructor");
  const admin = await browse("", "admin");

  assert.equal(empty.status, 200);
  assert.equal(empty.body.materials.length, 1);
  assert.equal(empty.body.materials[0].tags, undefined);
  assert.equal(missing.status, 200);
  assert.equal(unauthenticated.status, 401);
  assert.equal(instructor.status, 200);
  assert.equal(instructor.body.count, 1);
  assert.equal(instructor.body.materials[0].originalFilename, "Operating Systems Processes.pdf");
  assert.equal(admin.status, 403);
});

test("rejects invalid query parameter types and oversized values", async () => {
  const arrayValue = await browse("?course[]=Computer%20Science");
  const oversized = await browse(`?keyword=${"x".repeat(101)}`);

  assert.equal(arrayValue.status, 400);
  assert.equal(oversized.status, 400);
});

test("materials created by the upload flow are retrievable by students", async () => {
  const uploadResponse = await request(app)
    .post("/api/materials")
    .set("Authorization", `Bearer ${tokenFor("instructor", instructorId)}`)
    .field("course", "Computer Science")
    .field("subject", "Operating Systems")
    .field("topic", "Scheduling")
    .attach("file", Buffer.from("%PDF-1.7\nuploaded material"), {
      filename: "Scheduling Notes.pdf",
      contentType: "application/pdf"
    });

  assert.equal(uploadResponse.status, 201);
  const result = await browse("?keyword=scheduling");
  assert.equal(result.status, 200);
  assert.equal(result.body.count, 1);
  assert.equal(result.body.materials[0].originalFilename, "Scheduling Notes.pdf");
});

test("search meets the two-second target on a repeatable seeded dataset", async () => {
  const materials = Array.from({ length: 1000 }, (_, index) => materialData({
    originalFilename: `Seeded ${index} Operating Systems Notes.pdf`,
    storedFilename: `${new mongoose.Types.ObjectId()}.pdf`,
    tags: {
      course: index % 2 ? "Computer Science" : "Information Systems",
      subject: "Operating Systems",
      topic: index % 3 ? "Processes" : "Scheduling"
    }
  }));
  await Material.insertMany(materials);

  const startedAt = process.hrtime.bigint();
  const response = await browse("?keyword=operating&course=computer%20science&topic=processes");
  const elapsedMilliseconds = Number(process.hrtime.bigint() - startedAt) / 1e6;

  console.log(`TC-Mat-02 seeded search: 1000 records in ${elapsedMilliseconds.toFixed(2)} ms`);
  assert.equal(response.status, 200);
  assert.ok(response.body.count > 0);
  assert.ok(elapsedMilliseconds < 2000, `search took ${elapsedMilliseconds.toFixed(2)} ms`);
});
