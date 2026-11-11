const assert = require('node:assert/strict');
const { test } = require('node:test');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
process.env.JWT_SECRET = 'comment-rate-test-only-secret';
delete process.env.MATERIAL_COMMENT_RATE_LIMIT_MAX;
delete process.env.MATERIAL_COMMENT_RATE_LIMIT_WINDOW_MS;
const app = require('../src/app');
const Material = require('../src/models/Material');
const User = require('../src/models/User');

test('default comment limit permits ten posts/minute/IP, rejects the eleventh, and does not limit GET', async () => {
  const mongo = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongo.getUri());
    const id = new mongoose.Types.ObjectId();
    await User.collection.insertOne({ _id: id, name: 'Student', email: 'private@example.com', password: 'private', role: 'student' });
    const material = await Material.create({ originalFilename: 'notes.pdf', storedFilename: 'rate.pdf', storageLocation: '/not-read',
      fileType: 'pdf', mimeType: 'application/pdf', fileSize: 10, tags: { course: 'CS', subject: 'OS', topic: 'Threads' }, uploadedBy: id });
    const token = jwt.sign({ sub: String(id), role: 'student' }, process.env.JWT_SECRET);
    for (let i = 0; i < 11; i++) {
      const result = await request(app).post(`/api/materials/${material.id}/comments`).set('Authorization', `Bearer ${token}`).send({ content: `Post ${i}` });
      assert.equal(result.status, i < 10 ? 201 : 429);
      assert.equal(result.headers['ratelimit-limit'], '10');
      assert.equal(result.headers['cache-control'], 'private, no-store');
      if (i === 10) assert.ok(Number(result.headers['retry-after']) > 0);
    }
    const list = await request(app).get(`/api/materials/${material.id}/comments`).set('Authorization', `Bearer ${token}`);
    assert.equal(list.status, 200); assert.equal(list.body.comments.length, 10);
  } finally { await mongoose.disconnect(); await mongo.stop(); }
});
