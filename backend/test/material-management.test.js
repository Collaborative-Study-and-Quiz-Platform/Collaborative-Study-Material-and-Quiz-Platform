const assert = require('node:assert/strict');
const { before, after, afterEach, test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const root = path.join(os.tmpdir(), `csqp-material-management-${process.pid}`);
const directory = path.join(root, 'uploads');
process.env.JWT_SECRET = 'material-management-test-only-secret';
process.env.MATERIAL_UPLOAD_DIR = directory;
const app = require('../src/app');
const Material = require('../src/models/Material');
let mongo;
const owner = new mongoose.Types.ObjectId().toString();
const other = new mongoose.Types.ObjectId().toString();
const token = (role = 'instructor', id = owner, options = {}) => jwt.sign({ sub: id, role }, process.env.JWT_SECRET, options);
const call = (method, id, auth = token()) => request(app)[method](`/api/materials/${id}`).set('Authorization', `Bearer ${auth}`);
async function seed(overrides = {}) {
  await fs.mkdir(directory, { recursive: true });
  const name = `${new mongoose.Types.ObjectId()}.pdf`;
  const location = path.join(directory, name);
  await fs.writeFile(location, '%PDF-test bytes');
  return Material.create({ originalFilename: 'notes.pdf', storedFilename: name, storageLocation: location,
    fileType: 'pdf', mimeType: 'application/pdf', fileSize: 15, downloadCount: 7,
    tags: { course: 'CS', subject: 'OS', topic: 'Threads' }, uploadedBy: owner, ...overrides });
}
before(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterEach(async () => {
  if (mongoose.connection.readyState === 1) await Material.deleteMany({});
  await fs.rm(root, { recursive: true, force: true });
});
after(async () => { await mongoose.disconnect(); await mongo?.stop(); });

test('TC-Mat-05 metadata edits preserve identity, ownership, file bytes and download counts', async () => {
  const material = await seed();
  const before = await Material.findById(material.id).lean();
  const result = await call('patch', material.id).send({ originalFilename: ' New notes.PDF ', course: ' IT ', topic: 'Processes' });
  assert.equal(result.status, 200);
  assert.equal(result.body.material.originalFilename, 'New notes.PDF');
  assert.deepEqual(result.body.material.tags, { course: 'IT', subject: 'OS', topic: 'Processes' });
  for (const field of ['storageLocation', 'storedFilename', '__v', 'deletedAt']) assert.equal(result.body.material[field], undefined);
  const updated = await Material.findById(material.id).lean();
  for (const field of ['_id', 'uploadedBy', 'storedFilename', 'storageLocation', 'fileType', 'mimeType', 'fileSize', 'downloadCount', 'createdAt']) {
    assert.deepEqual(updated[field], before[field], field);
  }
  assert.equal(await fs.readFile(material.storageLocation, 'utf8'), '%PDF-test bytes');
  assert.equal((await call('patch', material.id).send({ subject: 'Databases' })).status, 200);
  assert.equal((await Material.findById(material.id)).tags.topic, 'Processes');
});
test('PATCH and DELETE enforce authentication, instructor role and database ownership', async () => {
  const material = await seed();
  for (const method of ['patch', 'delete']) {
    const invoke = (auth) => method === 'patch' ? call(method, material.id, auth).send({ topic: 'Changed' }) : call(method, material.id, auth);
    assert.equal((await request(app)[method](`/api/materials/${material.id}`)).status, 401);
    for (const auth of ['invalid', token('instructor', owner, { expiresIn: -1 })]) assert.equal((await invoke(auth)).status, 401);
    for (const role of ['student', 'admin']) assert.equal((await invoke(token(role))).status, 403);
    assert.equal((await invoke(token('instructor', other))).status, 404);
    assert.equal((await invoke(token('instructor', 'bad-id'))).status, 401);
  }
  assert.equal((await Material.findById(material.id)).tags.topic, 'Threads');
  assert.equal(await fs.readFile(material.storageLocation, 'utf8'), '%PDF-test bytes');
});
test('rejects malformed IDs, missing records, extra query fields and unsupported media', async () => {
  for (const method of ['patch', 'delete']) {
    const body = method === 'patch' ? { topic: 'Changed' } : {};
    assert.equal((await call(method, 'invalid').send(body)).status, 400);
    assert.equal((await call(method, new mongoose.Types.ObjectId()).send(body)).status, 404);
  }
  const material = await seed();
  assert.equal((await call('patch', `${material.id}?uploadedBy=${other}`).send({ topic: 'Changed' })).status, 400);
  assert.equal((await call('patch', material.id).type('text').send('topic=Changed')).status, 415);
  assert.equal((await call('delete', material.id).send({ uploadedBy: other })).status, 400);
});
test('rejects unsafe filenames, invalid tags, protected fields and non-object patches', async () => {
  const material = await seed();
  const invalid = [{}, [], { topic: '' }, { course: 'x'.repeat(101) }, { subject: 42 }, { topic: null },
    { originalFilename: '' }, { originalFilename: 'notes.docx' }, { originalFilename: '../notes.pdf' },
    { originalFilename: '..\\notes.pdf' }, { originalFilename: 'bad\nname.pdf' }, { originalFilename: 'bad\0name.pdf' },
    { originalFilename: `${'x'.repeat(255)}.pdf` }, { topic: '<script>alert(1)</script>' },
    ...['uploadedBy', 'storedFilename', 'storageLocation', 'downloadCount', 'fileType', 'mimeType', 'fileSize', 'deletedAt', 'tags', 'unknown']
      .map((field) => ({ [field]: field === 'downloadCount' ? 0 : 'forbidden' }))];
  for (const body of invalid) assert.equal((await call('patch', material.id).send(body)).status, 400, JSON.stringify(body));
  assert.equal((await Material.findById(material.id)).originalFilename, 'notes.pdf');
});
test('concurrent disjoint edits and download increments preserve independent fields', async () => {
  const material = await seed();
  const results = await Promise.all([
    call('patch', material.id).send({ course: 'IT' }), call('patch', material.id).send({ topic: 'Processes' }),
    Material.updateOne({ _id: material.id }, { $inc: { downloadCount: 1 } })
  ]);
  assert.equal(results[0].status, 200); assert.equal(results[1].status, 200);
  const updated = await Material.findById(material.id);
  assert.equal(updated.tags.course, 'IT'); assert.equal(updated.tags.topic, 'Processes'); assert.equal(updated.downloadCount, 8);
});
test('a delete between PATCH ownership lookup and write cannot resurrect the material', async () => {
  const material = await seed();
  let release, lookedUp;
  const gate = new Promise((resolve) => { release = resolve; });
  const ready = new Promise((resolve) => { lookedUp = resolve; });
  const find = Material.findOne;
  Material.findOne = function (query) {
    const result = find.call(this, query);
    if (query.deletedAt === null) return result.then(async (doc) => { lookedUp(); await gate; return doc; });
    return result;
  };
  try {
    const editing = call('patch', material.id).send({ topic: 'Late edit' }).then((result) => result);
    await ready;
    assert.equal((await call('delete', material.id)).status, 200);
    release();
    assert.equal((await editing).status, 404);
    assert.equal(await Material.findById(material.id), null);
  } finally { release(); Material.findOne = find; }
});
test('successful, concurrent and repeated deletion is safe; an absent file permits cleanup', async () => {
  const material = await seed();
  const results = await Promise.all(Array.from({ length: 4 }, () => call('delete', material.id)));
  results.forEach((result) => assert.ok([200, 404].includes(result.status)));
  assert.equal(await Material.findById(material.id), null);
  await assert.rejects(fs.stat(material.storageLocation), { code: 'ENOENT' });
  assert.equal((await call('delete', material.id)).status, 404);
  const missing = await seed(); await fs.unlink(missing.storageLocation);
  assert.equal((await call('delete', missing.id)).status, 200);
});
test('unlink failure leaves a hidden marker; owner can retry without exposing storage paths', async () => {
  const material = await seed();
  const unlink = fs.unlink;
  fs.unlink = async () => { throw Object.assign(new Error(material.storageLocation), { code: 'EACCES' }); };
  try {
    const result = await call('delete', material.id);
    assert.equal(result.status, 500); assert.ok(!JSON.stringify(result.body).includes(root));
  } finally { fs.unlink = unlink; }
  assert.ok((await Material.findById(material.id)).deletedAt);
  for (const role of ['instructor', 'student']) {
    const response = await request(app).get('/api/materials').set('Authorization', `Bearer ${token(role)}`);
    assert.equal(response.body.count, 0);
    for (const action of ['view', 'download']) {
      const response = await request(app).get(`/api/materials/${material.id}/${action}`).set('Authorization', `Bearer ${token('student')}`);
      assert.equal(response.status, 404);
    }
  }
  assert.equal((await call('patch', material.id).send({ topic: 'Hidden' })).status, 404);
  assert.equal((await call('delete', material.id, token('instructor', other))).status, 404);
  assert.equal((await call('delete', material.id)).status, 200);
});
test('database failure before marking keeps the file; failure after unlink leaves retryable metadata', async () => {
  const material = await seed();
  const update = Material.updateOne;
  Material.updateOne = async () => { throw new Error('private database error'); };
  try { assert.equal((await call('delete', material.id)).status, 500); } finally { Material.updateOne = update; }
  assert.equal((await Material.findById(material.id)).deletedAt, null);
  assert.equal(await fs.readFile(material.storageLocation, 'utf8'), '%PDF-test bytes');
  const remove = Material.deleteOne;
  Material.deleteOne = async () => { throw new Error('private database error'); };
  try { assert.equal((await call('delete', material.id)).status, 500); } finally { Material.deleteOne = remove; }
  assert.ok((await Material.findById(material.id)).deletedAt);
  await assert.rejects(fs.stat(material.storageLocation), { code: 'ENOENT' });
  assert.equal((await call('delete', material.id)).status, 200);
});
test('deletion rejects stored traversal, never follows symlinks and never removes directories recursively', async () => {
  const material = await seed();
  const target = path.join(root, 'outside.pdf'); await fs.writeFile(target, 'outside');
  for (const filename of ['../outside.pdf', '..\\outside.pdf', '.', '..']) {
    await Material.updateOne({ _id: material.id }, { storedFilename: filename });
    const response = await call('delete', material.id);
    assert.equal(response.status, 500); assert.ok(!JSON.stringify(response.body).includes(root));
    assert.equal((await Material.findById(material.id)).deletedAt, null);
    assert.equal((await request(app).get(`/api/materials/${material.id}/view`).set('Authorization', `Bearer ${token('student')}`)).status, 404);
  }
  await fs.symlink(target, path.join(directory, 'link.pdf'));
  await Material.updateOne({ _id: material.id }, { storedFilename: 'link.pdf', storageLocation: target });
  assert.equal((await call('delete', material.id)).status, 200);
  assert.equal(await fs.readFile(target, 'utf8'), 'outside');
  const folder = await seed();
  await fs.mkdir(path.join(directory, 'folder.pdf')); await fs.writeFile(path.join(directory, 'folder.pdf', 'keep'), 'keep');
  await Material.updateOne({ _id: folder.id }, { storedFilename: 'folder.pdf' });
  assert.equal((await call('delete', folder.id)).status, 500);
  assert.equal(await fs.readFile(path.join(directory, 'folder.pdf', 'keep'), 'utf8'), 'keep');
});
test('edited names/tags propagate to listing and file headers; legacy active records still work', async () => {
  const material = await seed();
  await Material.collection.updateOne({ _id: material._id }, { $unset: { deletedAt: '' } });
  assert.equal((await call('patch', material.id).send({ originalFilename: 'updated.pdf', topic: 'Processes' })).status, 200);
  const list = await request(app).get('/api/materials?topic=Processes').set('Authorization', `Bearer ${token('student')}`);
  assert.equal(list.body.count, 1); assert.equal(list.body.materials[0].originalFilename, 'updated.pdf');
  assert.equal(list.body.materials[0].deletedAt, undefined);
  const view = await request(app).get(`/api/materials/${material.id}/view`).set('Authorization', `Bearer ${token()}`);
  assert.equal(view.status, 200); assert.match(view.headers['content-disposition'], /updated.pdf/);
  assert.equal((await Material.findById(material.id)).downloadCount, 7);
});
test('PATCH database failures return the generic error without touching files', async () => {
  const material = await seed(); const update = Material.findOneAndUpdate;
  Material.findOneAndUpdate = () => { throw new Error('private error'); };
  try {
    const result = await call('patch', material.id).send({ topic: 'Changed' });
    assert.equal(result.status, 500); assert.ok(!JSON.stringify(result.body).includes('private error'));
  } finally { Material.findOneAndUpdate = update; }
  assert.equal(await fs.readFile(material.storageLocation, 'utf8'), '%PDF-test bytes');
});
