'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { test, after, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const pool = require('../src/config/db');

// Set a very small queue size to simulate saturation quickly
process.env.POLL_QUEUE_BATCH_SIZE = '2';

let fetchCallCount = 0;
let fetchUrls = [];

let isCycle2 = false;

const fetchPath = path.resolve(__dirname, '../src/services/bounded-fetch.js');
require.cache[fetchPath] = {
    id: fetchPath,
    filename: fetchPath,
    loaded: true,
    exports: async function(url, options) {
        fetchCallCount++;
        fetchUrls.push(url);
        
        if (url.includes('token')) {
            return { json: async () => ({ access_token: 'fake-token', expires_in: 3600 }) };
        }
        
        // Simulating the STAC catalog
        if (url.includes('search')) {
            const body = options.body;
            
            if (isCycle2) {
                if (body.includes('56.3')) {
                    // In cycle 2, Fujairah recovers and returns 0 scenes to stay under the queue batch limit of 2
                    return { json: async () => ({ features: [] }) };
                }
                
                if (body.includes('74.7')) {
                if (body.includes('karnataka-page2')) {
                        return { json: async () => ({ features: [
                            { id: 'karnataka-3', bbox: [74.71, 13.21, 74.77, 13.27], properties: { datetime: '2026-10-09T08:00:00Z' } }
                        ] }) }; // finishes
                    } else {
                        throw new Error('Karnataka queried without cursor but should have used nextRequest!');
                    }
                }
                
                return { json: async () => ({ features: [] }) };
            }
            
            // CYCLE 1
            if (body.includes('79.7')) {
                // Completed region: 1 scene, no nextRequest
                return {
                    json: async () => ({
                        features: [
                            { id: 'colombo-1', bbox: [79.71, 6.91, 79.77, 6.97], properties: { datetime: '2026-10-09T10:00:00Z' } }
                        ]
                    })
                };
            }
            
            if (body.includes('56.3')) {
                // Failed region: simulate HTTP 500
                throw new Error('HTTP 500 Internal Server Error');
            }
            
            if (body.includes('74.7')) {
                if (body.includes('karnataka-page2')) {
                     // In cycle 1, if it asks for page 2, return empty so it doesn't loop infinitely if queue batch size wasn't hit
                     return { json: async () => ({ features: [] }) };
                }
                // Queue-saturated region: 2 scenes, nextRequest present
                return {
                    json: async () => ({
                        features: [
                            { id: 'karnataka-1', bbox: [74.71, 13.21, 74.77, 13.27], properties: { datetime: '2026-10-09T10:00:00Z' } },
                            { id: 'karnataka-2', bbox: [74.71, 13.21, 74.77, 13.27], properties: { datetime: '2026-10-09T09:00:00Z' } }
                        ],
                        links: [{ rel: 'next', href: 'https://sh.dataspace.copernicus.eu/catalog/v1/search?page=2', method: 'POST', body: { cursor: 'karnataka-page2' } }]
                    })
                };
            }
            
            return { json: async () => ({ features: [] }) };
        }
        
        return { json: async () => ({ features: [] }) };
    }
};

const poller = require('../src/services/scene-poller.service');

let originalState = [];

before(async () => {
    const { rows } = await pool.query('SELECT * FROM ingestion_state WHERE singleton = TRUE LIMIT 1');
    originalState = rows;
});

after(async () => {
    await pool.query('TRUNCATE TABLE ingestion_state');
    if (originalState.length > 0) {
        const os = originalState[0];
        await pool.query(
            `INSERT INTO ingestion_state (singleton, last_polled_at, last_scene_at, poll_count, scenes_queued, regions_state)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [os.singleton, os.last_polled_at, os.last_scene_at, os.poll_count, os.scenes_queued, JSON.stringify(os.regions_state || {})]
        );
    }
    await pool.end();
});

test('Independent region state: completed, failed, and queue-saturated in one cycle', async (t) => {
    // Clear DB state
    await pool.query('TRUNCATE TABLE ingestion_state');
    await pool.query('DELETE FROM processed_scenes');

    // CYCLE 1
    await poller.pollOnce();
    
    let { rows: stateRows } = await pool.query('SELECT * FROM ingestion_state');
    assert.equal(stateRows.length, 1);
    
    let regionsState = stateRows[0].regions_state;
    
    // Check Region 1 (Colombo): Completed
    let colombo = regionsState['colombo_anchorage_lk'];
    assert.ok(colombo, 'Colombo state should exist');
    assert.ok(colombo.fromTime, 'Colombo should have advanced fromTime');
    assert.equal(colombo.toTime, null, 'Colombo toTime should be null (completed)');
    assert.equal(colombo.nextRequest, null, 'Colombo nextRequest should be null');

    // Check Region 2 (Fujairah): Failed
    let fujairah = regionsState['fujairah_anchorage_ae'];
    assert.ok(fujairah, 'Fujairah state should exist');
    assert.ok(fujairah.toTime, 'Fujairah should have frozen toTime (partial/failed)');
    assert.equal(fujairah.nextRequest, null, 'Fujairah nextRequest should be null after failure');

    // Check Region 3 (Karnataka): Queue-saturated
    let karnataka = regionsState['karnataka_coast_in'];
    assert.ok(karnataka, 'Karnataka state should exist');
    assert.ok(karnataka.toTime, 'Karnataka should have frozen toTime (partial)');
    assert.ok(karnataka.nextRequest, 'Karnataka should have saved nextRequest');
    assert.ok(karnataka.nextRequest.body.includes('karnataka-page2'), 'Karnataka nextRequest should point to page 2');
    
    // Check global checkpoint
    let globalLastSceneAt = stateRows[0].last_scene_at;
    // Since cycle was partial, global checkpoint shouldn't advance past its starting point (it remains null or old value)
    assert.equal(globalLastSceneAt, null, 'Global checkpoint should not advance on partial cycle');
    
    // CYCLE 2
    // Simulate day 2 worker
    await pool.query("UPDATE processed_scenes SET status = 'completed'");
    process.env.POLL_QUEUE_BATCH_SIZE = '10'; // raise limit for cycle 2
    
    // We will change the mock for cycle 2 to verify correct resume behavior
    isCycle2 = true;
    
    await poller.pollOnce();
    
    stateRows = (await pool.query('SELECT * FROM ingestion_state')).rows;
    regionsState = stateRows[0].regions_state;
    
    // After cycle 2 (which should complete all regions)
    assert.equal(regionsState['fujairah_anchorage_ae'].toTime, null, 'Fujairah should now be completed');
    assert.equal(regionsState['karnataka_coast_in'].toTime, null, 'Karnataka should now be completed');
    
    let globalLastSceneAtAfter = stateRows[0].last_scene_at;
    assert.ok(globalLastSceneAtAfter, 'Global checkpoint should finally advance once all regions complete');
});
