'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const https = require('https');
const { PassThrough } = require('stream');

function createMockRequest(responseData, statusCode = 200, delay = 1) {
    return (options, cb) => {
        const req = new PassThrough();
        req.destroy = () => {};
        const res = new PassThrough();
        res.statusCode = statusCode;
        res.headers = { 'content-type': 'application/json' };
        
        let responseString = typeof responseData === 'string' ? responseData : JSON.stringify(responseData);
        res.headers['content-length'] = Buffer.byteLength(responseString).toString();
        
        setTimeout(() => {
            if (cb) cb(res);
            res.write(responseString);
            res.end();
        }, delay);

        return req;
    };
}

// 1. Pagination, batch limits, token expiration
test('Global Discovery & Token Expiration Recovery', async () => {
    // We will require modules locally to override env
    process.env.OSIS_GLOBAL_DISCOVERY_MODE = 'true';
    process.env.POLL_QUEUE_BATCH_SIZE = '2'; // Very small batch size to test batch limit
    process.env.OSIS_GLOBAL_BATCH_SIZE = '1'; // 1 global tile per poll

    // We must stub the database since poller touches it heavily
    const pool = require('../src/config/db');
    const originalQuery = pool.query;
    
    // We need to intercept requests
    const originalRequest = https.request;
    
    try {
        let queuedCount = 0;
        let tokenRequests = 0;
        let stacRequests = 0;

        pool.query = async (text, params) => {
            if (text.includes('SELECT last_polled_at')) {
                return { rows: [{ last_scene_at: null, regions_state: {} }] };
            }
            if (text.includes('COUNT(*)')) {
                return { rows: [{ count: 0 }] };
            }
            if (text.includes('INSERT INTO processed_scenes')) {
                queuedCount++;
                return { rowCount: 1 };
            }
            if (text.includes('INSERT INTO ingestion_state')) {
                return { rowCount: 1 };
            }
            return { rows: [] };
        };

        https.request = (opts, cb) => {
            if (opts.hostname === 'identity.dataspace.copernicus.eu') {
                tokenRequests++;
                return createMockRequest({ access_token: 'fake-token-' + tokenRequests, expires_in: 3600 })(opts, cb);
            }
            
            stacRequests++;
            if (stacRequests === 1) {
                // First STAC request: simulate a 401 Unauthorized
                return createMockRequest('Unauthorized', 401)(opts, cb);
            } else if (stacRequests === 2) {
                // Second request (retry): success with 2 items and a next link
                return createMockRequest({
                    features: [{ id: 'g1', bbox: [1,1,1.1,1.1] }, { id: 'g2', bbox: [2,2,2.1,2.1] }],
                    links: [{ rel: 'next', href: 'https://sh.dataspace.copernicus.eu/catalog/v1/search?page=2', method: 'GET' }]
                })(opts, cb);
            } else {
                // Should not reach here because batch size is 2, it should stop after queuing 2 scenes
                return createMockRequest({ features: [] })(opts, cb);
            }
        };

        const poller = require('../src/services/scene-poller.service');
        
        // Let's run a single poll
        await poller.pollOnce();
        
        // Assertions
        assert.equal(tokenRequests, 2, 'Token should be requested twice due to 401 recovery');
        assert.equal(stacRequests, 2, 'STAC should be queried twice (fail then succeed)');
        assert.equal(queuedCount, 2, 'Should have queued exactly 2 scenes before hitting batch limit');

        const state = poller.status();
        assert.equal(state.queuedTotal, 2);

    } finally {
        pool.query = originalQuery;
        https.request = originalRequest;
        process.env.OSIS_GLOBAL_DISCOVERY_MODE = 'false';
    }
});
