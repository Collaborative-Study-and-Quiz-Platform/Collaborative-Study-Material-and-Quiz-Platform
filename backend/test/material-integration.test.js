const assert = require('node:assert/strict');
const { before, after, afterEach, test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const directory = path.join(os.tmpdir(), `csqp-integration-${process.pid}`);
process.env.JWT_SECRET = 'integration-test-secret';
process.env.MATERIAL_UPLOAD_DIR = directory;
const app = require('../src/app');
const Material = require('../src/models/Material');
const Bookmark = require('../src/models/Bookmark');
const Rating = require('../src/models/MaterialRating');
const Comment = require('../src/models/MaterialComment');
const User = require('../src/models/User');
const student = new mongoose.Types.ObjectId();
const other = new mongoose.Types.ObjectId();
const owner = new mongoose.Types.ObjectId();
const auth = (role = 'student', id = student) => jwt.sign({ sub: String(id), role }, process.env.JWT_SECRET);
const call = (method, suffix, token = auth()) => request(app)[method](`/api/materials${suffix}`).set('Authorization', `Bearer ${token}`);
let mongo;
async function seed() {
  await fs.mkdir(directory, { recursive: true });
  const storedFilename = `${new mongoose.Types.ObjectId()}.pdf`;
  await fs.writeFile(path.join(directory, storedFilename), '%PDF-integration');
  return Material.create({ originalFilename: 'notes.pdf', storedFilename, storageLocation: path.join(directory, storedFilename),
    fileType: 'pdf', mimeType: 'application/pdf', fileSize: 16, uploadedBy: owner,
    tags: { course: 'CS', subject: 'OS', topic: 'Threads' } });
}
before(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  await Promise.all([Bookmark.init(), Rating.init(), Comment.init()]);
  await User.collection.insertMany([student, other, owner].map((_id, i) => ({ _id, name: `User ${i}`, email: `user${i}@test.com`, role: i === 2 ? 'instructor' : 'student' })));
});
afterEach(async () => { await Promise.all([Material.deleteMany({}), Bookmark.deleteMany({}), Rating.deleteMany({}), Comment.deleteMany({})]); await fs.rm(directory, { recursive: true, force: true }); });
after(async () => { await mongoose.disconnect(); await mongo?.stop(); });

test('bookmark, comment, rate, edit, view/download and delete coexist with ownership and RBAC', async () => {
  const material = await seed(); const id = material.id;
  assert.equal((await call('put', `/${id}/bookmark`)).status, 200);
  assert.equal((await call('post', `/${id}/comments`).send({ content: 'Helpful notes' })).status, 201);
  assert.equal((await call('put', `/${id}/rating`).send({ rating: 5 })).status, 200);
  assert.equal((await call('put', `/${id}/rating`, auth('student', other)).send({ rating: 1 })).status, 200);
  assert.equal((await call('patch', `/${id}`, auth('instructor', owner)).send({ originalFilename: 'renamed.pdf', topic: 'Processes' })).status, 200);
  for (const endpoint of ['', '/bookmarks']) {
    const result = await call('get', endpoint); assert.equal(result.status, 200);
    const row = result.body.materials[0]; assert.equal(row.originalFilename, 'renamed.pdf'); assert.equal(row.tags.topic, 'Processes');
    assert.deepEqual(row.ratingSummary, { averageRating: 3, ratingCount: 2, myRating: 5 });
    for (const field of ['storageLocation', '__v', 'deletedAt']) assert.equal(row[field], undefined);
  }
  assert.equal((await call('get', '/bookmarks', auth('student', other))).body.count, 0);
  assert.equal((await call('get', `/${id}/comments`)).body.comments.length, 1);
  assert.equal((await call('get', `/${id}/view`)).status, 200);
  const download = await call('get', `/${id}/download`); assert.equal(download.status, 200); assert.match(download.headers['content-disposition'], /renamed.pdf/);
  for (const [method, suffix, token, body, expected] of [
    ['patch', '', auth(), { topic: 'No' }, 403], ['delete', '', auth(), null, 403],
    ['delete', '', auth('instructor', other), null, 404], ['put', '/bookmark', auth('instructor', owner), null, 403],
    ['put', '/rating', auth('instructor', owner), { rating: 4 }, 403], ['get', '/download', auth('instructor', owner), null, 403]
  ]) {
    const req = call(method, `/${id}${suffix}`, token); if (body) req.send(body); assert.equal((await req).status, expected);
  }
  assert.equal((await call('delete', `/${id}`, auth('instructor', owner))).status, 200);
  assert.equal((await call('get', '/bookmarks')).body.count, 0);
  for (const suffix of ['/view', '/comments', '/rating']) assert.equal((await call('get', `/${id}${suffix}`)).status, 404);
  assert.equal((await call('put', `/${id}/bookmark`)).status, 404);
});

test('deletion-marked and missing materials are hidden; inactive bookmarks cannot be saved', async () => {
  const material = await seed();
  await call('put', `/${material.id}/bookmark`);
  await Material.updateOne({ _id: material.id }, { $set: { deletedAt: new Date() } });
  assert.equal((await call('get', '')).body.count, 0);
  assert.equal((await call('get', '/bookmarks')).body.count, 0);
  assert.equal((await call('put', `/${material.id}/bookmark`)).status, 404);
  assert.equal((await call('put', `/${material.id}/bookmark`, auth('student', other))).status, 404);
  assert.equal(await Bookmark.countDocuments({ student: other }), 0);
  assert.equal((await call('delete', `/${material.id}/bookmark`)).status, 200);
});

test('bookmark summaries degrade gracefully during rating database failures', async () => {
  const material = await seed(); await call('put', `/${material.id}/bookmark`);
  const aggregate = Rating.aggregate;
  try {
    Rating.aggregate = async () => { throw new Error('ratings offline'); };
    const result = await call('get', '/bookmarks'); assert.equal(result.status, 200);
    assert.equal(result.body.count, 1); assert.equal(result.body.materials[0].ratingSummary, null);
  } finally { Rating.aggregate = aggregate; }
});

test('bookmark save detects a concurrent material deletion', async () => {
  const material = await seed(); const update = Bookmark.updateOne;
  try {
    Bookmark.updateOne = async (...args) => {
      const result = await update.apply(Bookmark, args);
      await Material.updateOne({ _id: material.id }, { $set: { deletedAt: new Date() } });
      return result;
    };
    assert.equal((await call('put', `/${material.id}/bookmark`)).status, 404);
    assert.equal(await Bookmark.countDocuments(), 0);
  } finally { Bookmark.updateOne = update; }
});
