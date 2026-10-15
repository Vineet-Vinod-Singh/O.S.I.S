'use strict';

const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/config/db');
const archive = require('../src/services/incident-archive.service');
const poller = require('../src/services/scene-poller.service');
const worker = require('../src/services/scene-worker.service');
const sentinel = require('../src/services/sentinel.service');

const ready = {
    accepting: true,
    status: 'ready',
    reason: null,
    reportCount: 100,
    maxReports: 100,
    freeBytes: 8 * 1024 * 1024 * 1024,
    minimumFreeBytes: 1024 * 1024 * 1024,
    databaseRequired: true,
    databaseAvailable: true,
    archiveAvailable: true,
};
const paused = { ...ready, accepting: false, status: 'paused', reason: 'report_capacity' };

test('worker retains queued scenes while storage is full and resumes after capacity recovery', async () => {
    const originalConnect = pool.connect;
    const connectCalls = [];
    let current = paused;
    mock.method(archive, 'capacityStatus', async () => current);
    pool.connect = async () => {
        connectCalls.push(true);
        return {
            query: async sql => {
                if (sql.includes('SELECT id, scene_id')) return { rows: [] };
                return { rows: [], rowCount: 0 };
            },
            release() {},
        };
    };
    try {
        const held = await worker.processNextScene();
        assert.equal(held.status, 'paused_storage');
        assert.equal(held.reason, 'report_capacity');
        assert.equal(connectCalls.length, 0);

        current = ready;
        const resumed = await worker.processNextScene();
        assert.equal(resumed.status, 'empty_queue');
        assert.equal(connectCalls.length, 1);
    } finally {
        pool.connect = originalConnect;
        mock.restoreAll();
    }
});

test('storage failure returns a claimed scene to the durable queued state', async () => {
    const originalQuery = pool.query;
    let update;
    pool.query = async (sql, params) => {
        update = { sql, params };
        return { rowCount: 1, rows: [] };
    };
    try {
        const result = await worker.requeueForStorage(
            { id: 19, scene_id: 'queue-recovery-test' },
            Object.assign(new Error('disk full'), {
                code: 'OSIS_STORAGE_CAPACITY',
                storageReason: 'low_free_space',
            }),
        );
        assert.equal(result.status, 'queued_storage');
        assert.match(update.sql, /SET status = 'queued'/);
        assert.match(update.sql, /processing_at = NULL/);
        assert.match(update.params[0], /\[storage_capacity:low_free_space\]/);
        assert.equal(update.params[1], 19);
    } finally {
        pool.query = originalQuery;
    }
});

test('poller does not query CDSE or persist a checkpoint while storage is paused, then resumes', async () => {
    const originalQuery = pool.query;
    let current = paused;
    let searchCalls = 0;
    let checkpointWrites = 0;
    mock.method(archive, 'capacityStatus', async () => current);
    mock.method(sentinel, 'searchCatalog', async () => {
        searchCalls++;
        return { features: [], nextRequest: null };
    });
    pool.query = async sql => {
        if (sql.includes('COUNT(*)::int AS count')) return { rows: [{ count: 0 }] };
        if (sql.includes('SELECT last_polled_at')) return { rows: [] };
        if (sql.includes('INSERT INTO ingestion_state')) {
            checkpointWrites++;
            return { rowCount: 1, rows: [] };
        }
        throw new Error('Unexpected database operation in isolated backpressure test');
    };
    try {
        await poller.pollOnce();
        assert.equal(searchCalls, 0);
        assert.equal(checkpointWrites, 0);
        assert.equal(poller.status().storage.reason, 'report_capacity');

        current = ready;
        await poller.pollOnce();
        assert.ok(searchCalls > 0);
        assert.equal(checkpointWrites, 1);
        assert.equal(poller.status().storage.accepting, true);
    } finally {
        pool.query = originalQuery;
        mock.restoreAll();
    }
});
