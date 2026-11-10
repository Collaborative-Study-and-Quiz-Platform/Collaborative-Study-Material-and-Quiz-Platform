const assert = require('node:assert/strict');
const { before, beforeEach, after, afterEach, test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const directory = path.join(os.tmpdir(), `csqp-ratings-${process.pid}`);
process.env.JWT_SECRET = 'rating-test-only-secret';
process.env.MATERIAL_UPLOAD_DIR = directory;
const app = require('../src/app');
const Material = require('../src/models/Material');
const MaterialRating = require('../src/models/MaterialRating');
const User = require('../src/models/User');
let mongo;
const student = new mongoose.Types.ObjectId();
const second = new mongoose.Types.ObjectId();
const third = new mongoose.Types.ObjectId();
const owner = new mongoose.Types.ObjectId();
const other = new mongoose.Types.ObjectId();
const token = (role = 'student', id = student, options = {}) => jwt.sign({ sub: String(id), role }, process.env.JWT_SECRET, options);
const call = (method, id, auth = token()) => request(app)[method](`/api/materials/${id}/rating`).set('Authorization', `Bearer ${auth}`);
const put = (id, rating, auth) => call('put', id, auth).send({ rating });
async function seed(overrides = {}) {
  await fs.mkdir(directory, { recursive: true });
  const storedFilename = `${new mongoose.Types.ObjectId()}.pdf`;
  const storageLocation = path.join(directory, storedFilename);
  const bytes = Buffer.from('%PDF-test material bytes');
  await fs.writeFile(storageLocation, bytes);
  return Material.create({ originalFilename: 'notes.pdf', storedFilename, storageLocation,
    fileType: 'pdf', mimeType: 'application/pdf', fileSize: bytes.length, downloadCount: 8,
    tags: { course: 'CS', subject: 'OS', topic: 'Threads' }, uploadedBy: owner, ...overrides });
}
const summary = (response) => ({ averageRating: response.body.averageRating, ratingCount: response.body.ratingCount, myRating: response.body.myRating });
before(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); await MaterialRating.init(); });
beforeEach(async () => {
  await User.collection.insertMany([student, second, third, owner, other].map((_id, index) => ({ _id, name: `User ${index}`,
    email: `private-${index}@example.com`, password: 'private', role: index < 3 ? 'student' : 'instructor' })));
});
afterEach(async () => {
  if (mongoose.connection.readyState === 1) await Promise.all([Material.deleteMany({}), MaterialRating.deleteMany({}), User.deleteMany({})]);
  await fs.rm(directory, { recursive: true, force: true });
});
after(async () => { await mongoose.disconnect(); await mongo?.stop(); });

test('TC-Collab-03 acceptance: 5 and 1 average 3; updating 5 to 3 gives 2 with count still 2', async () => {
  const material = await seed();
  const empty = await call('get', material.id);
  assert.equal(empty.status, 200); assert.deepEqual(summary(empty), { averageRating: null, ratingCount: 0, myRating: null });
  const first = await put(material.id, 5);
  assert.equal(first.status, 200); assert.deepEqual(summary(first), { averageRating: 5, ratingCount: 1, myRating: 5 });
  const secondVote = await put(material.id, 1, token('student', second));
  assert.deepEqual(summary(secondVote), { averageRating: 3, ratingCount: 2, myRating: 1 });
  const update = await put(material.id, 3);
  assert.deepEqual(summary(update), { averageRating: 2, ratingCount: 2, myRating: 3 });
  assert.deepEqual(summary(await put(material.id, 3)), summary(update));
  const persisted = await call('get', material.id, token('student', student, { jwtid: 'new-session' }));
  assert.deepEqual(summary(persisted), summary(update));
  assert.deepEqual(summary(await call('get', material.id, token('instructor', owner))), { averageRating: 2, ratingCount: 2, myRating: null });
});
test('fractional averages retain precision and summaries isolate the current student', async () => {
  const material = await seed();
  await put(material.id, 1); await put(material.id, 2, token('student', second));
  await put(material.id, 2, token('student', third));
  const result = await call('get', material.id);
  assert.equal(result.body.averageRating, 5 / 3); assert.equal(result.body.ratingCount, 3); assert.equal(result.body.myRating, 1);
  assert.deepEqual(Object.keys(result.body).sort(), ['averageRating', 'materialId', 'myRating', 'ratingCount', 'status']);
});
test('student-only writes, instructor ownership reads, admin and unauthenticated rejection', async () => {
  const material = await seed();
  for (const method of ['get', 'put']) {
    assert.equal((await request(app)[method](`/api/materials/${material.id}/rating`)).status, 401);
    const invoke = (auth) => method === 'put' ? put(material.id, 4, auth) : call('get', material.id, auth);
    for (const auth of ['bad-token', token('student', student, { expiresIn: -1 })]) assert.equal((await invoke(auth)).status, 401);
    assert.equal((await invoke(token('admin', owner))).status, 403);
    assert.equal((await invoke(token('instructor', other))).status, method === 'get' ? 404 : 403);
    assert.equal((await invoke(token('instructor', owner))).status, method === 'get' ? 200 : 403);
    assert.equal((await invoke(token('student', 'invalid-sub'))).status, 401);
  }
  assert.equal(await MaterialRating.countDocuments(), 0);
});
test('invalid ratings, protected fields, bodies, query parameters and media types are rejected', async () => {
  const material = await seed();
  for (const rating of [0, 6, -1, 1.5, '5', true, null, {}, []]) assert.equal((await put(material.id, rating)).status, 400);
  for (const field of ['student', 'studentId', 'material', 'averageRating', 'ratingCount', 'myRating', 'createdAt', 'updatedAt', 'unknown']) {
    assert.equal((await call('put', material.id).send({ rating: 4, [field]: 'forbidden' })).status, 400);
  }
  for (const body of [{}, [], { rating: { $gt: 0 } }]) assert.equal((await call('put', material.id).send(body)).status, 400);
  assert.equal((await call('put', material.id).type('text').send('rating=4')).status, 415);
  assert.equal((await call('get', material.id).send({ student: String(second) })).status, 400);
  assert.equal((await call('get', material.id).query({ student: String(second) })).status, 400);
  assert.equal((await call('put', material.id).query({ averageRating: 5 }).send({ rating: 4 })).status, 400);
  assert.equal(await MaterialRating.countDocuments(), 0);
});
test('malformed, nonexistent and deletion-marked materials reject reads and writes', async () => {
  const material = await seed(); await put(material.id, 5);
  await Material.collection.updateOne({ _id: material._id }, { $set: { deletedAt: new Date() } });
  for (const [id, status] of [['bad-id', 400], [String(new mongoose.Types.ObjectId()), 404], [material.id, 404]]) {
    assert.equal((await call('get', id)).status, status); assert.equal((await put(id, 2)).status, status);
  }
  assert.equal((await request(app).get('/api/materials').set('Authorization', `Bearer ${token()}`)).body.count, 0);
});
test('a missing student account cannot create a rating', async () => {
  const material = await seed(); await User.deleteOne({ _id: student });
  assert.equal((await put(material.id, 4)).status, 401); assert.equal(await MaterialRating.countDocuments(), 0);
});
test('concurrent initial writes and updates retain exactly one ballot per student/material', async () => {
  const material = await seed();
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => put(material.id, i % 5 + 1)));
  results.forEach((result) => assert.equal(result.status, 200));
  assert.equal(await MaterialRating.countDocuments(), 1);
  const saved = await MaterialRating.findOne({ material: material._id, student });
  const current = await call('get', material.id);
  assert.equal(current.body.averageRating, saved.rating); assert.equal(current.body.myRating, saved.rating); assert.equal(current.body.ratingCount, 1);
  await assert.rejects(MaterialRating.create({ material: material._id, student, rating: 3 }), { code: 11000 });
});
test('duplicate-key retry applies the requested value instead of accepting the competing value', async () => {
  const material = await seed(); const update = MaterialRating.updateOne; let calls = 0;
  MaterialRating.updateOne = async function (filter, changes, options) {
    if (++calls === 1) {
      await update.call(this, filter, { $set: { rating: 1 } }, options);
      throw Object.assign(new Error('concurrent insert'), { code: 11000, keyPattern: { material: 1, student: 1 } });
    }
    assert.equal(options.upsert, undefined); assert.equal(filter.student, String(student));
    return update.call(this, filter, changes, options);
  };
  try {
    const result = await put(material.id, 5);
    assert.equal(result.status, 200); assert.deepEqual(summary(result), { averageRating: 5, ratingCount: 1, myRating: 5 });
    assert.equal(calls, 2);
  } finally { MaterialRating.updateOne = update; }
});
test('bulk listing uses one aggregation and includes only visible summaries and the caller own rating', async () => {
  const material = await seed(); const ownedOther = await seed({ uploadedBy: other });
  await put(material.id, 5); await put(material.id, 1, token('student', second)); await put(ownedOther.id, 2);
  const aggregate = MaterialRating.aggregate; let calls = 0;
  MaterialRating.aggregate = function (...args) { ++calls; return aggregate.apply(this, args); };
  try {
    const response = await request(app).get('/api/materials').set('Authorization', `Bearer ${token()}`);
    assert.equal(response.status, 200); assert.equal(calls, 1); assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.deepEqual(response.body.materials.find((item) => item._id === material.id).ratingSummary, { averageRating: 3, ratingCount: 2, myRating: 5 });
    const instructor = await request(app).get('/api/materials').set('Authorization', `Bearer ${token('instructor', owner)}`);
    assert.equal(instructor.body.count, 1); assert.equal(instructor.body.materials[0].ratingSummary.myRating, null);
    assert.ok(!JSON.stringify(instructor.body.materials[0].ratingSummary).includes(String(student)));
  } finally { MaterialRating.aggregate = aggregate; }
});
test('rating aggregation failure degrades listing to unavailable, not a false zero or unavailable material list', async () => {
  await seed(); const aggregate = MaterialRating.aggregate;
  MaterialRating.aggregate = () => { throw new Error('private aggregation error'); };
  try {
    const list = await request(app).get('/api/materials').set('Authorization', `Bearer ${token()}`);
    assert.equal(list.status, 200); assert.equal(list.body.count, 1); assert.equal(list.body.materials[0].ratingSummary, null);
    assert.ok(!JSON.stringify(list.body).includes('private aggregation error'));
  } finally { MaterialRating.aggregate = aggregate; }
});
test('database failures are generic; retry after a committed write keeps the count unchanged', async () => {
  const material = await seed();
  for (const [model, method] of [[Material, 'exists'], [User, 'exists'], [MaterialRating, 'init'], [MaterialRating, 'updateOne'], [MaterialRating, 'aggregate']]) {
    const original = model[method]; model[method] = () => { throw new Error('/private/database'); };
    try { const result = await put(material.id, 4); assert.equal(result.status, 500); assert.ok(!JSON.stringify(result.body).includes('/private/')); }
    finally { model[method] = original; }
  }
  const retry = await put(material.id, 4);
  assert.equal(retry.status, 200); assert.equal(retry.body.ratingCount, 1);
  const aggregate = MaterialRating.aggregate; MaterialRating.aggregate = () => { throw new Error('private'); };
  try { assert.equal((await call('get', material.id)).status, 500); } finally { MaterialRating.aggregate = aggregate; }
});
test('unrelated duplicate-key errors do not report a successful rating', async () => {
  const material = await seed(); const update = MaterialRating.updateOne;
  MaterialRating.updateOne = () => { throw Object.assign(new Error('private key'), { code: 11000, keyPattern: { _id: 1 } }); };
  try { assert.equal((await put(material.id, 4)).status, 500); } finally { MaterialRating.updateOne = update; }
});
test('deletion racing an upsert is detected and an orphan ballot remains inaccessible', async () => {
  const material = await seed(); const update = MaterialRating.updateOne;
  MaterialRating.updateOne = async function (...args) {
    const result = await update.apply(this, args);
    await Material.collection.updateOne({ _id: material._id }, { $set: { deletedAt: new Date() } });
    return result;
  };
  try { assert.equal((await put(material.id, 4)).status, 404); } finally { MaterialRating.updateOne = update; }
  assert.equal(await MaterialRating.countDocuments(), 1);
  assert.equal((await call('get', material.id)).status, 404);
  await Material.deleteOne({ _id: material.id });
  assert.equal((await call('get', material.id)).status, 404);
});
test('rating writes leave parent metadata, counter, uploader, timestamps and physical file bytes unchanged', async () => {
  const material = await seed(); const before = await Material.findById(material.id).lean();
  const bytes = await fs.readFile(material.storageLocation);
  await put(material.id, 5); await put(material.id, 2); await call('get', material.id);
  assert.deepEqual(await Material.findById(material.id).lean(), before);
  assert.deepEqual(await fs.readFile(material.storageLocation), bytes);
  for (const result of [await call('get', material.id), await put(material.id, 3), await call('get', 'bad-id'), await call('get', material.id, token('admin'))]) {
    assert.equal(result.headers['cache-control'], 'private, no-store');
  }
});

for (const id of ['ABCDEFABCDEFABCDEFABCDEF', 'aBcDeFaBcDeFaBcDeFaBcDeF', 'abcdefabcdefabcdefabcdef']) {
  test(`GET/PUT canonicalize ${id} and preserve one vote and material-list summaries`, async () => {
    const material = await seed({ _id: new mongoose.Types.ObjectId(id) });
    const created = await put(id, 5);
    assert.equal(created.status, 200);
    assert.deepEqual(summary(created), { averageRating: 5, ratingCount: 1, myRating: 5 });
    const read = await call('get', id);
    assert.equal(read.status, 200); assert.deepEqual(summary(read), summary(created));
    const updated = await put(id, 3);
    assert.equal(updated.status, 200);
    assert.deepEqual(summary(updated), { averageRating: 3, ratingCount: 1, myRating: 3 });
    for (const variant of [id, material.id]) {
      const result = await call('get', variant);
      assert.equal(result.status, 200); assert.deepEqual(summary(result), summary(updated));
    }
    assert.equal(await MaterialRating.countDocuments({ material: material._id, student }), 1);
    const list = await request(app).get('/api/materials').set('Authorization', `Bearer ${token()}`);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.materials.find((item) => item._id === material.id).ratingSummary, summary(updated));
    for (const malformed of ['not-an-id', 'GBCDEFABCDEFABCDEFABCDEF']) {
      assert.equal((await call('get', malformed)).status, 400);
      assert.equal((await put(malformed, 5)).status, 400);
    }
    assert.equal(await MaterialRating.countDocuments(), 1);
  });
}
