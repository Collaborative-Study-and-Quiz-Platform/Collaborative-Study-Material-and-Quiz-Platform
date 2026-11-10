const assert = require('node:assert/strict');
const { before, after, afterEach, test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { Readable } = require('node:stream');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');
process.env.JWT_SECRET = 'test-only-jwt-secret';
const directory = path.join(os.tmpdir(), `csqp-material-file-${process.pid}`);
process.env.MATERIAL_UPLOAD_DIR = directory;
const app = require('../src/app');
const Material = require('../src/models/Material');
let mongo;
const token = (role = 'student', id = new mongoose.Types.ObjectId().toString()) => jwt.sign({ sub: id, role }, process.env.JWT_SECRET);
const get = (id, action = 'download', role = 'student') => request(app).get(`/api/materials/${id}/${action}`).set('Authorization', `Bearer ${token(role)}`);
async function seed(overrides = {}, bytes = Buffer.from('%PDF-1.7\nmaterial')) {
  await fs.mkdir(directory, { recursive: true });
  const filename = `${new mongoose.Types.ObjectId()}.pdf`;
  await fs.writeFile(path.join(directory, filename), bytes);
  return Material.create({ originalFilename: 'Lecture "one" résumé.pdf', storedFilename: filename,
    fileType: 'pdf', mimeType: 'application/pdf', fileSize: bytes.length,
    tags: { course: 'CS', subject: 'OS', topic: 'Processes' },
    uploadedBy: new mongoose.Types.ObjectId(), storageLocation: path.join(directory, filename), ...overrides });
}
async function waitForCount(id, expected) {
  for (let i = 0; i < 100; i++) {
    if ((await Material.findById(id)).downloadCount === expected) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal((await Material.findById(id)).downloadCount, expected);
}
before(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterEach(async () => { await Material.deleteMany({}); await fs.rm(directory, { recursive: true, force: true }); });
after(async () => { await mongoose.disconnect(); await mongo.stop(); });

test('Students retain view/download; instructors retain upload and cannot preview unowned materials', async () => {
  const material = await seed();
  for (const action of ['view', 'download']) {
    assert.equal((await request(app).get(`/api/materials/${material.id}/${action}`)).status, 401);
    assert.equal((await request(app).get(`/api/materials/${material.id}/${action}`).set('Authorization', 'Bearer invalid')).status, 401);
    assert.equal((await get(material.id, action, 'admin')).status, 403);
    assert.equal((await get(material.id, action, 'instructor')).status, action === 'view' ? 404 : 403);
  }
  assert.equal((await Material.findById(material.id)).downloadCount, 0);
  assert.equal((await request(app).get('/api/materials').set('Authorization', `Bearer ${token('instructor')}`)).status, 200);
  const uploaded = await request(app).post('/api/materials').set('Authorization', `Bearer ${token('instructor')}`)
    .field('course', 'CS').field('subject', 'OS').field('topic', 'Notes')
    .attach('file', Buffer.from('%PDF-1.7\nnotes'), { filename: 'notes.pdf', contentType: 'application/pdf' });
  assert.equal(uploaded.status, 201);
});
test('PDF preview does not count; TC-Mat-03 download increments exactly once', async () => {
  const material = await seed();
  const preview = await get(material.id, 'view');
  assert.equal(preview.status, 200);
  assert.match(preview.headers['content-type'], /^application\/pdf/);
  assert.match(preview.headers['content-disposition'], /^inline;/);
  assert.equal(preview.headers['cache-control'], 'private, no-store');
  assert.equal((await Material.findById(material.id)).downloadCount, 0);
  const download = await get(material.id);
  assert.equal(download.status, 200);
  assert.match(download.headers['content-disposition'], /^attachment;/);
  assert.match(download.headers['content-disposition'], /filename\*=UTF-8''/);
  assert.deepEqual(download.body, Buffer.from('%PDF-1.7\nmaterial'));
  assert.ok(!JSON.stringify(download.headers).includes(directory));
  await waitForCount(material.id, 1);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal((await Material.findById(material.id)).downloadCount, 1);
});
test('concurrent downloads increment atomically; HEAD does not count', async () => {
  const material = await seed();
  assert.equal((await request(app).head(`/api/materials/${material.id}/download`).set('Authorization', `Bearer ${token()}`)).status, 200);
  await Promise.all(Array.from({ length: 6 }, async () => assert.equal((await get(material.id)).status, 200)));
  await waitForCount(material.id, 6);
  assert.equal((await get(material.id)).status, 200);
  await waitForCount(material.id, 7);
});
test('invalid IDs, missing records/files, traversal, symlinks and directories are rejected without path leakage', async () => {
  assert.equal((await get('invalid')).status, 400);
  assert.equal((await get(new mongoose.Types.ObjectId())).status, 404);
  const material = await seed();
  await fs.unlink(material.storageLocation);
  assert.equal((await get(material.id)).status, 404);
  for (const filename of ['../outside.pdf', '..\\outside.pdf']) {
    await Material.updateOne({ _id: material.id }, { storedFilename: filename });
    const response = await get(material.id);
    assert.equal(response.status, 404);
    assert.ok(!JSON.stringify(response.body).includes(directory));
  }
  await Material.updateOne({ _id: material.id }, { storedFilename: 'link.pdf' });
  await fs.symlink('/etc/passwd', path.join(directory, 'link.pdf'));
  assert.equal((await get(material.id)).status, 404);
  await Material.updateOne({ _id: material.id }, { storedFilename: 'folder.pdf' });
  await fs.mkdir(path.join(directory, 'folder.pdf'));
  assert.equal((await get(material.id)).status, 404);
  assert.equal((await Material.findById(material.id)).downloadCount, 0);
});
test('legacy records list zero and initialize missing count using $inc', async () => {
  const material = await seed();
  await Material.collection.updateOne({ _id: material._id }, { $unset: { downloadCount: '' } });
  const listing = await request(app).get('/api/materials').set('Authorization', `Bearer ${token()}`);
  assert.equal(listing.body.materials[0].downloadCount, 0);
  assert.ok(!JSON.stringify(listing.body).includes(directory));
  assert.equal((await get(material.id)).status, 200);
  await waitForCount(material.id, 1);
});
test('DOCX and legacy PPT downloads use canonical MIME and filename', async () => {
  for (const [fileType, mimeType, bytes] of [
    ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', await fs.readFile(path.join(__dirname, 'fixtures/valid.docx'))],
    ['ppt', 'application/vnd.ms-powerpoint', Buffer.from('d0cf11e0a1b11ae1', 'hex')]
  ]) {
    const material = await seed({ fileType, mimeType, originalFilename: `notes.${fileType}` }, bytes);
    const preview = await get(material.id, 'view');
    assert.equal(preview.status, 200);
    assert.equal((await Material.findById(material.id)).downloadCount, 0);
    const response = await get(material.id);
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], mimeType);
    assert.match(response.headers['content-disposition'], new RegExp(`notes\\.${fileType}`));
    await waitForCount(material.id, 1);
  }
});
test('interrupted transfer never increments', async () => {
  const material = await seed({}, Buffer.alloc(32 * 1024 * 1024, 65));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    await new Promise((resolve, reject) => {
      const req = http.get({ hostname: '127.0.0.1', port: server.address().port,
        path: `/api/materials/${material.id}/download`, headers: { Authorization: `Bearer ${token()}` } }, res => {
        res.once('data', () => { res.destroy(); req.destroy(); resolve(); });
        res.on('error', () => {});
      });
      req.on('error', reject);
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal((await Material.findById(material.id)).downloadCount, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('stream failures do not increment', async () => {
  const material = await seed();
  const originalOpen = fs.open;
  fs.open = async () => ({ stat: async () => ({ isFile: () => true, size: 100 }),
    createReadStream: () => new Readable({ read() { this.destroy(new Error('private stream failure')); } }) });
  try {
    await assert.rejects(async () => get(material.id));
    assert.equal((await Material.findById(material.id)).downloadCount, 0);
  } finally { fs.open = originalOpen; }
});

test('storage access errors return a generic response without counting', async () => {
  const material = await seed();
  const originalOpen = fs.open;
  fs.open = async () => { throw Object.assign(new Error(directory), { code: 'EACCES' }); };
  try {
    const response = await get(material.id);
    assert.equal(response.status, 500);
    assert.equal(response.body.message, 'Unable to retrieve material');
    assert.ok(!JSON.stringify(response.body).includes(directory));
    assert.equal((await Material.findById(material.id)).downloadCount, 0);
  } finally { fs.open = originalOpen; }
});

test('My Uploads is scoped by JWT owner across searches and rejects client ownership overrides', async () => {
  const owner = new mongoose.Types.ObjectId();
  const other = new mongoose.Types.ObjectId();
  const owned = await seed({ uploadedBy: owner, originalFilename: 'Owned notes.pdf' });
  await seed({ uploadedBy: other, originalFilename: 'Other notes.pdf' });
  const list = query => request(app).get(`/api/materials${query}`).set('Authorization', `Bearer ${token('instructor', owner.toString())}`);
  for (const query of ['', '?keyword=notes', '?course=CS&subject=OS&topic=Processes']) {
    const response = await list(query);
    assert.equal(response.status, 200);
    assert.equal(response.body.count, 1);
    assert.equal(response.body.materials[0]._id, owned.id);
    assert.equal(response.body.materials[0].storageLocation, undefined);
  }
  assert.equal((await list('?keyword=Other')).body.count, 0);
  assert.equal((await list(`?uploadedBy=${other}`)).status, 400);
  assert.equal((await request(app).get('/api/materials').set('Authorization', `Bearer ${token('instructor', other.toString())}`)).body.count, 1);
  assert.equal((await request(app).get('/api/materials').set('Authorization', `Bearer ${token()}`)).body.count, 2);
});

test('instructors preview only owned PDF/DOCX/PPT and never download or increment counters', async () => {
  const owner = new mongoose.Types.ObjectId();
  const other = new mongoose.Types.ObjectId();
  for (const fileType of ['pdf', 'docx', 'ppt']) {
    const material = await seed({ uploadedBy: owner, fileType, originalFilename: `notes.${fileType}` });
    const access = (action, id) => request(app).get(`/api/materials/${material.id}/${action}`)
      .set('Authorization', `Bearer ${token('instructor', id.toString())}`);
    const preview = await access('view', owner);
    assert.equal(preview.status, 200);
    assert.match(preview.headers['content-disposition'], /^inline;/);
    const denied = await access('view', other);
    assert.equal(denied.status, 404);
    assert.equal(denied.body.message, 'Material not found');
    for (const id of [owner, other]) assert.equal((await access('download', id)).status, 403);
    assert.equal((await Material.findById(material.id)).downloadCount, 0);
  }
});
