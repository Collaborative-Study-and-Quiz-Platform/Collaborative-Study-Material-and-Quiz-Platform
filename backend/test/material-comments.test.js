const assert = require('node:assert/strict');
const { before, beforeEach, after, afterEach, test } = require('node:test');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
process.env.JWT_SECRET = 'comments-test-only-secret';
process.env.MATERIAL_COMMENT_RATE_LIMIT_MAX = '1000';
const app = require('../src/app');
const Material = require('../src/models/Material');
const MaterialComment = require('../src/models/MaterialComment');
const User = require('../src/models/User');
let mongo;
const student = new mongoose.Types.ObjectId();
const viewer = new mongoose.Types.ObjectId();
const owner = new mongoose.Types.ObjectId();
const other = new mongoose.Types.ObjectId();
const token = (role = 'student', id = student, options = {}) => jwt.sign({ sub: String(id), role }, process.env.JWT_SECRET, options);
const call = (method, id, auth = token(), query = '') => request(app)[method](`/api/materials/${id}/comments${query}`).set('Authorization', `Bearer ${auth}`);
async function seed(overrides = {}) {
  return Material.create({ originalFilename: 'notes.pdf', storedFilename: `${new mongoose.Types.ObjectId()}.pdf`,
    storageLocation: '/private/not-read-by-comments.pdf', fileType: 'pdf', mimeType: 'application/pdf', fileSize: 15,
    downloadCount: 8, tags: { course: 'CS', subject: 'OS', topic: 'Threads' }, uploadedBy: owner, ...overrides });
}
const post = (id, content = 'Useful notes', auth) => call('post', id, auth).send({ content });
before(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); await MaterialComment.init(); });
beforeEach(async () => {
  await User.collection.insertMany([student, viewer, owner, other].map((_id, index) => ({ _id, name: `User ${index}`,
    email: `private-${index}@example.com`, password: 'private-password', role: index < 2 ? 'student' : 'instructor' })));
});
afterEach(async () => {
  if (mongoose.connection.readyState === 1) await Promise.all([Material.deleteMany({}), MaterialComment.deleteMany({}), User.deleteMany({})]);
});
after(async () => { await mongoose.disconnect(); await mongo?.stop(); });

test('TC-Collab-01 students and the owning instructor post; another viewer sees comments on next GET', async () => {
  const material = await seed();
  const studentPost = await post(material.id, '  Helpful\nnotes!  ');
  assert.equal(studentPost.status, 201); assert.equal(studentPost.body.comment.content, 'Helpful\nnotes!');
  assert.equal(studentPost.body.comment.author._id, String(student));
  assert.equal((await post(material.id, 'Instructor explanation', token('instructor', owner))).status, 201);
  const result = await call('get', material.id, token('student', viewer));
  assert.equal(result.status, 200); assert.equal(result.body.comments.length, 2);
  assert.ok(result.body.comments.some((comment) => comment._id === studentPost.body.comment._id));
  assert.equal((await call('get', material.id, token('instructor', owner))).status, 200);
});
test('GET and POST reject unauthenticated/admin callers and other instructors without expanding visibility', async () => {
  const material = await seed();
  for (const method of ['get', 'post']) {
    const send = (auth) => method === 'post' ? post(material.id, 'Hello', auth) : call('get', material.id, auth);
    assert.equal((await request(app)[method](`/api/materials/${material.id}/comments`)).status, 401);
    for (const auth of ['invalid', token('student', student, { expiresIn: -1 })]) assert.equal((await send(auth)).status, 401);
    assert.equal((await send(token('admin', owner))).status, 403);
    assert.equal((await send(token('instructor', other))).status, 404);
    assert.equal((await send(token('student', 'bad-subject'))).status, 401);
  }
  assert.equal(await MaterialComment.countDocuments(), 0);
});
test('GET and POST reject malformed, missing and deletion-marked material IDs', async () => {
  const material = await seed();
  await Material.collection.updateOne({ _id: material._id }, { $set: { deletedAt: new Date() } });
  for (const [id, status] of [['invalid', 400], [String(new mongoose.Types.ObjectId()), 404], [material.id, 404]]) {
    assert.equal((await call('get', id)).status, status);
    assert.equal((await post(id)).status, status);
  }
});
test('author identity is JWT-derived and projections expose only public comment/author fields', async () => {
  const material = await seed();
  for (const field of ['author', 'authorId', 'material', 'role', 'createdAt', 'updatedAt', 'unknown']) {
    assert.equal((await call('post', material.id).send({ content: 'Hello', [field]: String(other) })).status, 400);
  }
  const saved = await post(material.id);
  for (const comment of [saved.body.comment, (await call('get', material.id)).body.comments[0]]) {
    assert.deepEqual(Object.keys(comment).sort(), ['_id', 'author', 'content', 'createdAt', 'material', 'updatedAt']);
    assert.deepEqual(Object.keys(comment.author).sort(), ['_id', 'name']);
    assert.equal(comment.author._id, String(student));
    assert.ok(!JSON.stringify(comment).includes('private-'));
    assert.ok(!JSON.stringify(comment).includes('storageLocation'));
  }
});
test('content validation enforces strings, trim, length, control characters and safe input', async () => {
  const material = await seed();
  for (const content of ['', ' \n\t ', null, 17, {}, [], 'x'.repeat(2001), 'bad\0text', '<script>alert(1)</script>', 'javascript:alert(1)']) {
    assert.equal((await post(material.id, content)).status, 400, JSON.stringify(content));
  }
  for (const body of [{}, [], { content: 'Hello', author: String(other) }]) assert.equal((await call('post', material.id).send(body)).status, 400);
  assert.equal((await post(material.id, `  ${'x'.repeat(2000)}  `)).status, 201);
  assert.equal((await post(material.id, '<b>Literal markup</b> & class discussion')).status, 201);
  assert.equal((await call('post', material.id).type('text').send('Hello')).status, 415);
  assert.equal((await call('post', material.id, token(), '?author=someone').send({ content: 'Hello' })).status, 400);
});
test('basic whole-word profanity filter rejects listed words without matching substrings', async () => {
  const material = await seed();
  assert.equal((await post(material.id, 'SHIT!')).status, 400);
  assert.equal((await post(material.id, 'Classical classification is helpful')).status, 201);
});
test('missing authors are safe to display and cannot create new comments', async () => {
  const material = await seed(); await post(material.id);
  await User.deleteOne({ _id: student });
  const result = await call('get', material.id, token('student', viewer));
  assert.deepEqual(result.body.comments[0].author, { _id: null, name: 'Former user' });
  assert.equal((await post(material.id)).status, 401);
  assert.equal(await MaterialComment.countDocuments(), 1);
});
test('cursor pagination is bounded and deterministic across equal timestamps', async () => {
  const material = await seed(); const unrelated = await seed();
  const date = new Date('2026-01-01T00:00:00.000Z');
  const records = await MaterialComment.insertMany(Array.from({ length: 55 }, (_, i) => ({ material: material._id, author: student,
    content: `Comment ${i}`, createdAt: date })));
  await MaterialComment.create({ material: unrelated._id, author: student, content: 'Other material' });
  const defaultPage = await call('get', material.id);
  assert.equal(defaultPage.body.comments.length, 20); assert.equal(defaultPage.body.hasMore, true);
  assert.equal((await call('get', material.id, token(), '?limit=50')).body.comments.length, 50);
  const received = []; let cursor;
  do {
    const page = await call('get', material.id, token(), `?limit=7${cursor ? `&cursor=${cursor}` : ''}`);
    assert.equal(page.status, 200); assert.ok(page.body.comments.length <= 7);
    received.push(...page.body.comments.map((comment) => comment._id)); cursor = page.body.nextCursor;
    assert.equal(page.body.hasMore, Boolean(cursor));
  } while (cursor);
  assert.deepEqual(received, records.map((comment) => String(comment._id)).sort().reverse());
  assert.equal(new Set(received).size, 55);
  const index = (await MaterialComment.collection.indexes()).find((entry) => entry.key.material === 1);
  assert.deepEqual(index.key, { material: 1, createdAt: -1, _id: -1 });
});
test('new posts do not shift older cursor pages and refresh sees the new comment', async () => {
  const material = await seed();
  await MaterialComment.insertMany(Array.from({ length: 3 }, (_, i) => ({ material: material._id, author: student,
    content: `Older ${i}`, createdAt: new Date('2026-01-01') })));
  const first = await call('get', material.id, token(), '?limit=2');
  const saved = await post(material.id, 'New comment');
  const older = await call('get', material.id, token(), `?limit=2&cursor=${first.body.nextCursor}`);
  assert.equal(older.body.comments.length, 1);
  assert.ok(!older.body.comments.some((comment) => first.body.comments.some((item) => item._id === comment._id)));
  assert.equal((await call('get', material.id)).body.comments[0]._id, saved.body.comment._id);
});
test('malformed pagination and cursor input is rejected', async () => {
  const material = await seed();
  const encoded = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const invalid = ['?limit=0', '?limit=51', '?limit=-1', '?limit=1.5', '?limit=2&limit=3', '?author=someone',
    '?cursor=', '?cursor=!!!', `?cursor=${'a'.repeat(257)}`, `?cursor=${encoded({ id: 'bad', createdAt: new Date().toISOString() })}`,
    `?cursor=${encoded({ id: String(student), createdAt: 'bad' })}`, `?cursor=${encoded({ id: String(student), createdAt: new Date().toISOString(), author: String(other) })}`];
  for (const query of invalid) assert.equal((await call('get', material.id, token(), query)).status, 400, query);
});
test('concurrent posts leave the parent material and its download count unchanged', async () => {
  const material = await seed(); const before = await Material.findById(material.id).lean();
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => post(material.id, `Concurrent ${i}`)));
  results.forEach((result) => { assert.equal(result.status, 201); assert.equal(result.headers['ratelimit-limit'], '1000'); });
  assert.equal(await MaterialComment.countDocuments(), 12);
  assert.deepEqual(await Material.findById(material.id).lean(), before);
});
test('successful and rejected comment responses use private no-store headers', async () => {
  const material = await seed();
  for (const result of [await post(material.id), await call('get', material.id), await call('get', 'bad'), await call('get', material.id, token('admin'))]) {
    assert.equal(result.headers['cache-control'], 'private, no-store');
  }
});
test('database failures return generic errors without leaking private details', async () => {
  const material = await seed();
  for (const [method, model, operation] of [['get', Material, 'exists'], ['get', MaterialComment, 'find'], ['post', User, 'findById'], ['post', MaterialComment, 'create']]) {
    const original = model[operation];
    model[operation] = () => { throw new Error('/private/database/details'); };
    try {
      const result = method === 'get' ? await call('get', material.id) : await post(material.id);
      assert.equal(result.status, 500); assert.ok(!JSON.stringify(result.body).includes('/private/'));
    } finally { model[operation] = original; }
  }
});
