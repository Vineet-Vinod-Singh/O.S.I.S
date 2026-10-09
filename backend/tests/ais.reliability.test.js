'use strict';

const test = require('node:test');
const assert = require('node:assert');
const aisService = require('../src/services/ais.service');
const pool = require('../src/config/db');

// Mock pool.connect
const originalConnect = pool.connect;

test.describe('AIS Service Database Reliability', () => {
  test.beforeEach(() => {
    aisService.pendingBatches = [];
    aisService.currentBatch = [];
    aisService.diagDbAttempted = 0;
    aisService.diagDbSuccess = 0;
    aisService.diagDbSkipped = 0;
    aisService.diagMemSkipped = 0;
    aisService.diagDbFail = 0;
    aisService.diagDropped = 0;
    aisService.isActive = true;
    aisService.flushPromise = null;
    if (aisService.batchTimer) {
      clearTimeout(aisService.batchTimer);
      aisService.batchTimer = null;
    }
  });

  test.afterEach(async () => {
    pool.connect = originalConnect;
    aisService.isActive = false;
    await aisService.stop();
  });

  test.it('should return early if batch is truly empty', async () => {
    let connectCalled = false;
    pool.connect = async () => { connectCalled = true; return {}; };
    
    aisService.currentBatch = [];
    await aisService.flushBatch();
    assert.strictEqual(connectCalled, false);
  });

  test.it('should handle duplicate input that deduplicates to one row', async () => {
    let connectCalled = false;
    const mockClient = {
      query: async () => ({ rowCount: 1 }),
      release: () => {}
    };
    pool.connect = async () => { connectCalled = true; return mockClient; };

    const msg = { mmsi: '123', time: '2026-10-09T00:00:00Z', lat: 13.0, lon: 80.3, speed: 0, course: 0 };
    aisService.currentBatch.push(msg, msg);

    await aisService.flushBatch();

    assert.strictEqual(connectCalled, true);
    assert.strictEqual(aisService.diagDbSuccess, 1);
    assert.strictEqual(aisService.diagMemSkipped, 1);
    assert.strictEqual(aisService.pendingBatches.length, 0);
  });

  test.it('should prevent overlapping flush promise lifecycle (scheduler race)', async () => {
    let connectCalled = 0;
    const mockClient = {
      query: async () => {
        await new Promise(r => setTimeout(r, 50));
        return { rowCount: 1 };
      },
      release: () => {}
    };
    pool.connect = async () => { connectCalled++; return mockClient; };

    aisService.currentBatch.push({ mmsi: '1', time: '2026-10-09T00:00:00Z', lat: 13.0, lon: 80.3, speed: 0, course: 0 });

    const p1 = aisService.flushBatch();
    const p2 = aisService.flushBatch();

    assert.strictEqual(p1, p2);
    await p1;
    assert.strictEqual(connectCalled, 1);
  });

  test.it('should increment retryCount and backoff on transient failure', async () => {
    const mockClient = {
      query: async () => { throw new Error('Transient connection error'); },
      release: () => {}
    };
    pool.connect = async () => mockClient;

    aisService.currentBatch.push({ mmsi: '1', time: '2026-10-09T00:00:00Z', lat: 13.0, lon: 80.3, speed: 0, course: 0 });

    await aisService.flushBatch();

    assert.strictEqual(aisService.diagDbFail, 1);
    assert.strictEqual(aisService.pendingBatches.length, 1);
    assert.strictEqual(aisService.pendingBatches[0].retryCount, 1);
    assert.ok(aisService.batchTimer);
  });

  test.it('should handle rollback failure gracefully', async () => {
    let queryCallCount = 0;
    const mockClient = {
      query: async () => {
        queryCallCount++;
        if (queryCallCount === 1) return; // BEGIN
        if (queryCallCount === 2) return; // LOCK
        if (queryCallCount === 3) throw new Error('Insert failed');
        if (queryCallCount === 4) throw new Error('Rollback failed');
      },
      release: () => {}
    };
    pool.connect = async () => mockClient;

    aisService.currentBatch.push({ mmsi: '1', time: '2026-10-09T00:00:00Z', lat: 13.0, lon: 80.3, speed: 0, course: 0 });

    await aisService.flushBatch();

    assert.strictEqual(aisService.diagDbFail, 1);
    assert.strictEqual(aisService.pendingBatches[0].retryCount, 1);
  });

  test.it('should bound queue overflow and drop oldest failing records', async () => {
    const mockClient = {
      query: async () => { throw new Error('DB Down'); },
      release: () => {}
    };
    pool.connect = async () => mockClient;

    process.env.AIS_MAX_QUEUE_SIZE = '2';
    
    aisService.currentBatch.push({ mmsi: '1', time: '2026-10-09T00:00:00Z', lat: 13.0, lon: 80.3, speed: 0, course: 0 });
    await aisService.flushBatch();
    
    aisService.currentBatch.push({ mmsi: '2', time: '2026-10-09T00:00:01Z', lat: 13.0, lon: 80.3, speed: 0, course: 0 });
    await aisService.flushBatch();
    
    aisService.currentBatch.push({ mmsi: '3', time: '2026-10-09T00:00:02Z', lat: 13.0, lon: 80.3, speed: 0, course: 0 });
    await aisService.flushBatch();

    assert.strictEqual(aisService.pendingBatches.length, 2);
    assert.strictEqual(aisService.pendingBatches[0].items[0].mmsi, '2');
    assert.strictEqual(aisService.pendingBatches[1].items[0].mmsi, '3');
    assert.strictEqual(aisService.diagDropped, 1);
    
    delete process.env.AIS_MAX_QUEUE_SIZE;
  });

  test.it('should successfully replay an ambiguous commit without duplicates', async () => {
    let connectCallCount = 0;
    
    const mockClientFail = {
      query: async (text) => {
        if (text === 'COMMIT') throw new Error('Connection terminated unexpectedly');
        return { rowCount: 1 };
      },
      release: () => {}
    };
    
    const mockClientSuccess = {
      query: async () => ({ rowCount: 0 }),
      release: () => {}
    };
    
    pool.connect = async () => {
      connectCallCount++;
      return connectCallCount === 1 ? mockClientFail : mockClientSuccess;
    };

    aisService.currentBatch.push({ mmsi: '1', time: '2026-10-09T00:00:00Z', lat: 13.0, lon: 80.3, speed: 0, course: 0 });

    await aisService.flushBatch();
    assert.strictEqual(aisService.pendingBatches.length, 1);
    assert.strictEqual(aisService.pendingBatches[0].retryCount, 1);
    assert.strictEqual(aisService.diagDbFail, 1);

    await aisService.flushBatch();
    assert.strictEqual(aisService.pendingBatches.length, 0);
    assert.strictEqual(aisService.diagDbSuccess, 0);
    assert.strictEqual(aisService.diagDbSkipped, 1);
  });

  test.it('should enforce shutdown deadline gracefully', async () => {
    pool.connect = async () => {
      throw new Error('DB down forever');
    };
    
    aisService.currentBatch.push({ mmsi: '1', time: '2026-10-09T00:00:00Z', lat: 13.0, lon: 80.3, speed: 0, course: 0 });
    
    const startTime = Date.now();
    await aisService.stop();
    const duration = Date.now() - startTime;
    
    // It should exit early before 9s because it hits MAX_RETRIES (10) and drops the batch.
    assert.ok(duration < 9000);
    assert.strictEqual(aisService.pendingBatches.length, 0);
    assert.strictEqual(aisService.diagDropped, 1);
  });
  test.it('should chunk large batches to respect SQL limits', async () => {
    let connectCalled = false;
    pool.connect = async () => { connectCalled = true; return { query: async () => ({ rowCount: 5000 }), release: () => {} }; };
    
    for (let i = 0; i < 5005; i++) {
      aisService.currentBatch.push({ mmsi: `M_${i}`, time: '2026-10-09T00:00:00Z', lat: 13.0, lon: 80.3, speed: 0, course: 0 });
    }
    
    await aisService.flushBatch();
    
    assert.strictEqual(connectCalled, true);
    assert.strictEqual(aisService.diagDbSuccess, 5000);
    assert.strictEqual(aisService.pendingBatches.length, 1);
    assert.strictEqual(aisService.pendingBatches[0].items.length, 5);
  });

  test.it('should return null for invalid timestamps', () => {
    assert.strictEqual(aisService.normalizeTimestamp(null), null);
    assert.strictEqual(aisService.normalizeTimestamp('invalid date string'), null);
    assert.strictEqual(aisService.normalizeTimestamp('2026-10-09T00:00:00Z'), '2026-10-09T00:00:00.000Z');
  });

  test.it('should filter out observations outside configured regions', () => {
    const origLength = aisService.currentBatch.length;
    
    // Process an out-of-region message
    const msg = {
        MessageType: 'PositionReport',
        MetaData: { MMSI: 999999, time_utc: '2026-10-09 12:00:00 UTC' },
        Message: { PositionReport: { Latitude: 0, Longitude: 0, Cog: 0, Sog: 0 } }
    };
    
    aisService.processMessage(msg);
    
    assert.strictEqual(aisService.currentBatch.length, origLength);
  });
});
