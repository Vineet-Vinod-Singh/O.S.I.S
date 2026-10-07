'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Mock bounded-fetch BEFORE requiring any services to intercept CDSE calls
const fetchPath = path.resolve(__dirname, '../src/services/bounded-fetch.js');
require.cache[fetchPath] = {
    id: fetchPath,
    filename: fetchPath,
    loaded: true,
    exports: async function(url, options) {
        if (url.includes('token')) {
            return { json: async () => ({ access_token: 'fake-token', expires_in: 3600 }) };
        }
        if (url.includes('search')) {
            return { json: async () => ({ features: [] }) };
        }
    }
};

const pool = require('../src/config/db');
const poller = require('../src/services/scene-poller.service');

test('poller saveState creates singleton row if empty and updates on subsequent calls', async (t) => {
    // 0. Backup existing state to avoid modifying shared DB
    const { rows: originalState } = await pool.query('SELECT * FROM ingestion_state WHERE singleton = TRUE LIMIT 1');
    
    t.after(async () => {
        await pool.query('TRUNCATE TABLE ingestion_state');
        if (originalState.length > 0) {
            const os = originalState[0];
            await pool.query(
                `INSERT INTO ingestion_state (singleton, last_polled_at, last_scene_at, poll_count, scenes_queued)
                 VALUES ($1, $2, $3, $4, $5)`,
                [os.singleton, os.last_polled_at, os.last_scene_at, os.poll_count, os.scenes_queued]
            );
        }
    });

    // 1. Clear the table
    
    // Check it's empty
    let res = await pool.query('SELECT * FROM ingestion_state');
    assert.equal(res.rowCount, 0, 'Table should be empty');

    // 2. Call pollOnce()
    // It will hit CDSE and then call saveState() using the UPSERT fix
    await poller.pollOnce();

    // 3. Verify row was created
    res = await pool.query('SELECT * FROM ingestion_state');
    assert.equal(res.rowCount, 1, 'Singleton row should be created by UPSERT');
    assert.equal(res.rows[0].singleton, true, 'Singleton flag must be true');
    assert.ok(res.rows[0].last_polled_at instanceof Date, 'last_polled_at should be a Date');
    
    const firstPoll = res.rows[0].last_polled_at;
    const firstCount = res.rows[0].poll_count;

    // 4. Wait a bit, then call pollOnce() again
    await new Promise(r => setTimeout(r, 100));
    await poller.pollOnce();

    // 5. Verify row was updated, not duplicated
    res = await pool.query('SELECT * FROM ingestion_state');
    assert.equal(res.rowCount, 1, 'Still only exactly one row');
    
    const secondPoll = res.rows[0].last_polled_at;
    const secondCount = res.rows[0].poll_count;

    assert.ok(secondPoll.getTime() > firstPoll.getTime(), 'last_polled_at should be updated');
    assert.equal(secondCount, firstCount + 1, 'poll_count should be incremented');
});

after(async () => {
    await pool.end();
});
