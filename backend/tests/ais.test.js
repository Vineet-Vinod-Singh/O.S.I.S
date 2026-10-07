const test = require('node:test');
const assert = require('node:assert');
const aisService = require('../src/services/ais.service');
const pool = require('../src/config/db');
const { WebSocketServer } = require('ws');
const http = require('http');
const { randomUUID } = require('crypto');

test('AIS Service - start/stop', () => {
    assert.strictEqual(aisService.isActive, false);
    // start without API key
    aisService.start();
    assert.strictEqual(aisService.isActive, false, 'Should not start without API key');

    process.env.AISSTREAM_API_KEY = 'mock-key';
    aisService.start();
    assert.strictEqual(aisService.isActive, true, 'Should start with API key');
    assert.ok(aisService.cleanupTimer);

    aisService.stop();
    assert.strictEqual(aisService.isActive, false, 'Should be inactive after stop');
    assert.strictEqual(aisService.ws, null);
    assert.strictEqual(aisService.cleanupTimer, null);
});

test('AIS Service - Mocked WebSocket Reconnect & Parsing', async () => {
    // We mock the WebSocket server to test connect, parse and backoff
    const server = http.createServer();
    const wss = new WebSocketServer({ server });
    let clientConnected = false;
    let receivedSub = null;

    wss.on('connection', (ws) => {
        clientConnected = true;
        ws.on('message', (data) => {
            receivedSub = JSON.parse(data);
            // send a mock position report
            ws.send(JSON.stringify({
                MessageType: 'PositionReport',
                MetaData: { MMSI: '123456789', time_utc: new Date().toISOString() },
                Message: { PositionReport: { Latitude: 12.34, Longitude: 56.78 } }
            }));
            // send a malformed message
            ws.send('invalid json');
            
            // force close
            setTimeout(() => ws.close(), 100);
        });
    });

    await new Promise(resolve => {
        server.listen(0, () => {
            const port = server.address().port;
            resolve(port);
        });
    });
    const port = server.address().port;
    
    try {
        process.env.AISSTREAM_API_KEY = 'mock-key';
        process.env.AISSTREAM_URL = `ws://localhost:${port}`;
        aisService.start();

        await new Promise(resolve => setTimeout(resolve, 50));
        assert.strictEqual(clientConnected, true);
        assert.strictEqual(receivedSub.Apikey, 'mock-key');

        await new Promise(resolve => setTimeout(resolve, 100));
        assert.strictEqual(aisService.batch.length, 1);
        assert.strictEqual(aisService.batch[0].mmsi, '123456789');

        await new Promise(resolve => setTimeout(resolve, 150));
        // Client should have been disconnected and reconnected scheduled
        assert.ok(aisService.reconnectTimer);
        
        aisService.stop();
    } finally {
        server.close();
    }
});
