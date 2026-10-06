'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const https = require('https');
const { PassThrough } = require('stream');
const boundedFetch = require('../src/services/bounded-fetch');
const sentinel = require('../src/services/sentinel.service');

function createMockRequest(responseData, statusCode = 200, headers = {}, triggerError = null) {
    return (options, cb) => {
        const req = new PassThrough();
        req.destroy = () => {};
        
        if (triggerError) {
            setTimeout(() => req.emit('error', triggerError), 1);
            return req;
        }

        const res = new PassThrough();
        res.statusCode = statusCode;
        res.headers = headers;
        if (typeof responseData === 'string') {
            res.headers['content-length'] = Buffer.byteLength(responseData).toString();
        }
        
        setTimeout(() => {
            if (cb) cb(res);
            if (responseData instanceof Error) {
                res.emit('error', responseData);
            } else if (responseData) {
                res.write(responseData);
                res.end();
            }
        }, 1);

        return req;
    };
}

test('bounded streaming body, provider errors and AOI/scene guards', async () => {
    const originalRequest = https.request;
    let calls = 0;
    try {
        https.request = (opts, cb) => {
            calls++;
            return createMockRequest('123456789')(opts, cb);
        };
        await assert.rejects(
            boundedFetch('https://example.invalid', {}, 8),
            /size limit/,
        );
        https.request = (opts, cb) => {
            calls++;
            return createMockRequest('secret upstream details', 401)(opts, cb);
        };
        await assert.rejects(
            boundedFetch('https://example.invalid'),
            /HTTP 401/,
        );
        const before = calls;
        for (const options of [
            {
                bbox: [-180, -80, 180, 80],
                datetime: '2024-06-19T00:00:00Z/2024-06-19T01:00:00Z',
            },
            {
                bbox: [74.7, 13.2, 74.78, 13.28],
                datetime: '2024-01-01/2025-01-01',
            },
            {
                bbox: [74.7, 13.2, 74.78, 13.28],
                datetime: '2024-06-19T00:00:00Z/2024-06-19T01:00:00Z',
                limit: 100,
            },
        ])
            await assert.rejects(sentinel.searchCatalog(options));
        await assert.rejects(
            sentinel.getSentinel1GrdImage({
                bbox: [74.7, 13.2, 74.78, 13.28],
                from: '2024-06-19T00:00:00Z',
                to: '2024-06-19T01:00:00Z',
                width: 100000,
            }),
        );
        assert.equal(
            calls,
            before,
            'invalid limits must reject before any request',
        );
    } finally {
        https.request = originalRequest;
    }
});

test('download concurrency is bounded and aborted/error reads release capacity', async () => {
    const originalRequest = https.request;
    const releases = [];
    try {
        https.request = (opts, cb) => {
            const req = new PassThrough();
            req.destroy = () => {};
            const res = new PassThrough();
            res.statusCode = 200;
            res.headers = { 'content-length': '10' };
            setTimeout(() => {
                cb(res);
                releases.push(() => { res.write('1'); res.end(); });
            }, 1);
            return req;
        };

        const first = boundedFetch('https://example.invalid');
        const second = boundedFetch('https://example.invalid');
        await new Promise((resolve) => setTimeout(resolve, 50));
        await assert.rejects(
            boundedFetch('https://example.invalid'),
            /capacity/,
        );
        releases.forEach((release) => release());
        await Promise.all([first, second]);

        https.request = (opts, cb) => createMockRequest(null, 200, {}, new Error('socket hang up'))(opts, cb);
        // Wait, the test expects a timeout/abort error to map to 'timed out'.
        // boundedFetch maps TimeoutError or AbortError explicitly:
        // Since we emit 'error', it rejects with the error directly. Let's make it emit an error with name 'TimeoutError'.
        https.request = (opts, cb) => {
            const err = new Error('test timeout');
            err.name = 'TimeoutError';
            return createMockRequest(null, 200, {}, err)(opts, cb);
        };
        await assert.rejects(
            boundedFetch('https://example.invalid'),
            /timed out/,
        );

        https.request = (opts, cb) => createMockRequest('ok')(opts, cb);
        assert.equal(
            (await boundedFetch('https://example.invalid')).status,
            200,
        );
    } finally {
        https.request = originalRequest;
    }
});
