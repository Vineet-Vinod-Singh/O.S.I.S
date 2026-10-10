const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../src/app');
const tinyfishService = require('../src/services/tinyfish.service');

// Store original environment variables
const originalEnv = process.env;

test.describe('QA API Integration Tests', () => {
  test.beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.QA_ADMIN_TOKEN = 'test-token';
    process.env.TINYFISH_API_KEY = 'test-tinyfish-key';
    process.env.TINYFISH_TARGET_URL = 'http://test.local';
    tinyfishService.runs.clear(); // Reset runs
  });

  test.afterEach(() => {
    process.env = originalEnv;
  });

  test.it('should reject requests without authorization token', async () => {
    const res = await request(app).get('/api/qa/suites');
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error, 'Unauthorized to access QA subsystem.');
  });

  test.it('should accept requests with valid authorization token', async () => {
    const res = await request(app)
      .get('/api/qa/suites')
      .set('Authorization', 'Bearer test-token');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.suites));
  });

  test.it('should validate input when triggering a new run', async () => {
    const res = await request(app)
      .post('/api/qa/runs')
      .set('Authorization', 'Bearer test-token')
      .send({}); // Missing task
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Task description is required');
  });

  test.it('should trigger a new run asynchronously', async () => {
    // Mock the actual API call
    const originalExecute = tinyfishService._executeRun;
    tinyfishService._executeRun = async (runId, suite) => {
      tinyfishService._updateRunStatus(runId, 'completed', { success: true });
    };

    const res = await request(app)
      .post('/api/qa/runs')
      .set('Authorization', 'Bearer test-token')
      .send({ suiteName: 'Demo Test', task: 'Check DEMO pipeline' });
    
    if (res.status === 500) console.error('500 Error:', res.body.error);
    
    assert.strictEqual(res.status, 202);
    assert.ok(res.body.runId);
    assert.strictEqual(res.body.status, 'pending');

    // Wait a brief moment to allow async execution to "complete"
    await new Promise(resolve => setTimeout(resolve, 50));
    
    const statusRes = await request(app)
      .get(`/api/qa/runs/${res.body.runId}`)
      .set('Authorization', 'Bearer test-token');
    
    assert.strictEqual(statusRes.status, 200);
    assert.strictEqual(statusRes.body.status, 'completed');
    assert.deepStrictEqual(statusRes.body.results, { success: true });

    // Restore original method
    tinyfishService._executeRun = originalExecute;
  });

  test.it('should handle missing TinyFish API key gracefully', async () => {
    delete process.env.TINYFISH_API_KEY;
    
    const res = await request(app)
      .post('/api/qa/runs')
      .set('Authorization', 'Bearer test-token')
      .send({ task: 'Some task' });
    
    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.error, 'TINYFISH_API_KEY is not configured');
  });

  test.it('should handle fetch errors gracefully within _executeRun', async () => {
    // Override global fetch
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error('fetch failed');
    };

    try {
      await tinyfishService._executeRun('test-run-id', { task: 'Mock test' });
    } catch (e) {
      // Expected to throw
    } finally {
      global.fetch = originalFetch;
    }

    const run = tinyfishService.getRunStatus('test-run-id');
    assert.strictEqual(run.status, 'failed');
    assert.strictEqual(run.error, 'fetch failed');
  });
});
