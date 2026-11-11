const assert = require('node:assert/strict');
const { before, after, afterEach, test } = require('node:test');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
process.env.JWT_SECRET = 'bookmark-test-only-secret';
const app = require('../src/app');
const Bookmark = require('../src/models/Bookmark');
const Material = require('../src/models/Material');
let mongo;
const student = new mongoose.Types.ObjectId().toString();
const other = new mongoose.Types.ObjectId().toString();
const token = (id = student, role = 'student', options = {}) => jwt.sign({ sub: id, role }, process.env.JWT_SECRET, options);
const call = (method, path, auth = token()) => request(app)[method](`/api/materials${path}`).set('Authorization', `Bearer ${auth}`);
async function seed() {
  return Material.create({ originalFilename: 'notes.pdf', storedFilename: `${new mongoose.Types.ObjectId()}.pdf`,
    fileType: 'pdf', mimeType: 'application/pdf', fileSize: 10, tags: { course: 'CS', subject: 'OS', topic: 'Threads' },
    uploadedBy: new mongoose.Types.ObjectId(), storageLocation: '/private/notes.pdf' });
}
before(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); await Bookmark.init(); });
afterEach(async () => { if (mongoose.connection.readyState === 1) { await Bookmark.deleteMany({}); await Material.deleteMany({}); } });
after(async () => { await mongoose.disconnect(); await mongo?.stop(); });

test('TC-Mat-04 save/remove are idempotent and persist across authenticated sessions', async () => {
  const material = await seed();
  for (let i = 0; i < 2; i++) {
    const result = await call('put', `/${material.id}/bookmark`);
    assert.equal(result.status, 200); assert.equal(result.body.bookmarked, true);
  }
  assert.equal(await Bookmark.countDocuments(), 1);
  const result = await call('get', '/bookmarks', token(student, 'student', { jwtid: 'new-session' }));
  assert.equal(result.body.count, 1); assert.equal(result.body.materials[0]._id, material.id);
  assert.equal(result.headers['cache-control'], 'private, no-store');
  for (const field of ['storageLocation', 'storedFilename', '__v']) assert.equal(result.body.materials[0][field], undefined);
  assert.equal(result.body.materials[0].downloadCount, 0);
  for (let i = 0; i < 2; i++) {
    const removed = await call('delete', `/${material.id}/bookmark`);
    assert.equal(removed.status, 200); assert.equal(removed.body.bookmarked, false);
  }
  assert.equal((await call('get', '/bookmarks')).body.count, 0);
  assert.equal((await Material.findById(material.id)).downloadCount, 0);
});
test('concurrent saves are protected by the compound unique index', async () => {
  const material = await seed();
  const results = await Promise.all(Array.from({ length: 20 }, () => call('put', `/${material.id}/bookmark`)));
  results.forEach((result) => assert.equal(result.status, 200));
  assert.equal(await Bookmark.countDocuments(), 1);
  await assert.rejects(Bookmark.create({ student, material: material.id }), { code: 11000 });
});
test('student accounts are isolated and cannot supply ownership', async () => {
  const material = await seed();
  await call('put', `/${material.id}/bookmark`);
  assert.equal((await call('get', '/bookmarks', token(other))).body.count, 0);
  await call('delete', `/${material.id}/bookmark`, token(other));
  assert.equal(await Bookmark.countDocuments({ student }), 1);
  assert.equal((await call('put', `/${material.id}/bookmark`, token(other)).send({ student })).status, 400);
  assert.equal((await call('get', `/bookmarks?student=${student}`, token(other))).status, 400);
  await call('put', `/${material.id}/bookmark`, token(other));
  assert.equal(await Bookmark.countDocuments(), 2);
});
test('all bookmark routes enforce authentication and student RBAC', async () => {
  const material = await seed();
  for (const [method, path] of [['get', '/bookmarks'], ['put', `/${material.id}/bookmark`], ['delete', `/${material.id}/bookmark`]]) {
    assert.equal((await request(app)[method](`/api/materials${path}`)).status, 401);
    for (const auth of ['invalid', token(student, 'student', { expiresIn: -1 })]) assert.equal((await call(method, path, auth)).status, 401);
    for (const role of ['instructor', 'admin']) assert.equal((await call(method, path, token(student, role))).status, 403);
    assert.equal((await call(method, path, token('bad-subject'))).status, 401);
  }
});
test('invalid IDs, missing materials and stale references have defined behavior', async () => {
  for (const method of ['put', 'delete']) assert.equal((await call(method, '/invalid/bookmark')).status, 400);
  const missing = new mongoose.Types.ObjectId();
  assert.equal((await call('put', `/${missing}/bookmark`)).status, 404);
  const material = await seed();
  await call('put', `/${material.id}/bookmark`);
  await Bookmark.create({ student, material: missing });
  assert.equal((await call('get', '/bookmarks')).body.count, 1);
  await Material.deleteOne({ _id: material.id });
  const result = await call('get', '/bookmarks');
  assert.equal(result.body.count, 0); assert.deepEqual(result.body.materials, []);
  assert.equal((await call('delete', `/${material.id}/bookmark`)).status, 200);
  assert.equal((await call('delete', `/${missing}/bookmark`)).status, 200);
  assert.equal(await Bookmark.countDocuments(), 0);
});
test('database failures use the existing generic error response', async () => {
  const material = await seed();
  for (const [method, path, model, operation] of [
    ['get', '/bookmarks', Bookmark, 'find'], ['put', `/${material.id}/bookmark`, Bookmark, 'updateOne'],
    ['delete', `/${material.id}/bookmark`, Bookmark, 'deleteOne']
  ]) {
    const original = model[operation];
    model[operation] = () => { throw new Error('private database failure'); };
    try {
      const result = await call(method, path);
      assert.equal(result.status, 500);
      assert.ok(!JSON.stringify(result.body).includes('private database failure'));
    } finally { model[operation] = original; }
  }
});
