const { readFile } = require("node:fs/promises");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { after, afterEach, before, test } = require("node:test");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const uploadDirectory = path.join(os.tmpdir(), `csqp-material-test-${process.pid}`);
process.env.JWT_SECRET = "test-only-jwt-secret";
process.env.MATERIAL_MAX_FILE_SIZE_BYTES = "1024";
process.env.MATERIAL_UPLOAD_DIR = uploadDirectory;

const app = require("../src/app");
const Material = require("../src/models/Material");

let mongoServer;
const instructorId = new mongoose.Types.ObjectId().toString();

function tokenFor(role, id = new mongoose.Types.ObjectId().toString()) {
  return jwt.sign(
    { sub: id, role },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

function upload(filename, contentType, buffer, role = "instructor") {
  return request(app)
    .post("/api/materials")
    .set("Authorization", `Bearer ${tokenFor(role, role === "instructor" ? instructorId : undefined)}`)
    .field("course", "Computer Science")
    .field("subject", "Operating Systems")
    .field("topic", "Processes")
    .attach("file", buffer, { filename, contentType });
}

before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Material.init();
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

test("TC-Mat-01 accepts valid PDF, DOCX, and PPT uploads for instructors", async () => {
  const files = [
    ["notes.pdf", "application/pdf", Buffer.from("%PDF-1.7\nmaterial")],
    [
  	"notes.docx",
  	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  	await fs.readFile(
   	 path.join(__dirname, "fixtures", "valid.docx")
  	)
	],
    ["notes.ppt", "application/vnd.ms-powerpoint", Buffer.from("d0cf11e0a1b11ae1", "hex")]
  ];

  for (const [filename, contentType, buffer] of files) {
    const response = await upload(filename, contentType, buffer);

    assert.equal(response.status, 201);
    assert.equal(response.body.material.fileType, path.extname(filename).slice(1));
    assert.deepEqual(response.body.material.tags, {
      course: "Computer Science",
      subject: "Operating Systems",
      topic: "Processes"
    });
    assert.equal(response.body.material.uploadedBy, instructorId, "uploader is derived from JWT");
    assert.equal(response.body.material.storageLocation, undefined);
  }
});

test("rejects unsupported, invalid, oversized, and missing files", async () => {
  const unsupported = await upload("notes.txt", "text/plain", Buffer.from("text"));
  const invalidSignature = await upload("notes.pdf", "application/pdf", Buffer.from("not pdf"));
  const oversized = await upload("large.pdf", "application/pdf", Buffer.concat([
    Buffer.from("%PDF-1.7\n"),
    Buffer.alloc(1024)
  ]));
  const missing = await request(app)
    .post("/api/materials")
    .set("Authorization", `Bearer ${tokenFor("instructor", instructorId)}`)
    .field("course", "Computer Science")
    .field("subject", "Operating Systems")
    .field("topic", "Processes");

  assert.equal(unsupported.status, 400);
  assert.equal(invalidSignature.status, 400);
  assert.equal(oversized.status, 400);
  assert.equal(missing.status, 400);
  assert.equal(await Material.countDocuments(), 0);
});

test("rejects multipart requests beyond the configured field limits", async () => {
  const extraFieldResponse = await upload(
    "notes.pdf",
    "application/pdf",
    Buffer.from("%PDF-1.7")
  ).field("unexpected", "not allowed");
  const oversizedFieldResponse = await upload(
    "notes.pdf",
    "application/pdf",
    Buffer.from("%PDF-1.7")
  ).field("oversized", "c".repeat(101));

  assert.equal(extraFieldResponse.status, 400);
  assert.equal(oversizedFieldResponse.status, 400);
  assert.equal(await Material.countDocuments(), 0);
});

test("requires authentication and the instructor role", async () => {
  const unauthenticated = await request(app).post("/api/materials");
  const student = await upload("notes.pdf", "application/pdf", Buffer.from("%PDF-1.7"), "student");
  const admin = await upload("notes.pdf", "application/pdf", Buffer.from("%PDF-1.7"), "admin");

  assert.equal(unauthenticated.status, 401);
  assert.equal(student.status, 403);
  assert.equal(admin.status, 403);
});

test("rejects invalid tags without persisting a file", async () => {
  const response = await request(app)
    .post("/api/materials")
    .set("Authorization", `Bearer ${tokenFor("instructor", instructorId)}`)
    .field("course", "")
    .field("subject", "Operating Systems")
    .field("topic", "Processes")
    .attach("file", Buffer.from("%PDF-1.7"), {
      filename: "notes.pdf",
      contentType: "application/pdf"
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.errors.course, "Course is required");
  assert.equal(await Material.countDocuments(), 0);
});

test("cleans up the stored file when persistence fails", async () => {
  const originalCreate = Material.create;
  Material.create = async () => {
    throw new Error("simulated persistence failure");
  };

  try {
    const response = await upload("notes.pdf", "application/pdf", Buffer.from("%PDF-1.7"));
    assert.equal(response.status, 500);
    assert.deepEqual(await fs.readdir(uploadDirectory), []);
  } finally {
    Material.create = originalCreate;
  }
});
