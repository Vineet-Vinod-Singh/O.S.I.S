'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { AISService } = require('../src/services/ais.service');

const regions = [
  { id: 'karnataka_coast_in', bbox: [74.70, 13.20, 74.78, 13.28] },
  { id: 'mumbai_high_in', bbox: [71.40, 19.30, 71.59, 19.49] },
  { id: 'chennai_port_in', bbox: [80.30, 13.00, 80.49, 13.19] },
  { id: 'colombo_anchorage_lk', bbox: [79.70, 6.90, 79.89, 7.09] },
  { id: 'hambantota_lk', bbox: [81.10, 6.00, 81.29, 6.19] },
  { id: 'fujairah_anchorage_ae', bbox: [56.30, 25.10, 56.49, 25.29] }
];

class MockWebSocket extends EventEmitter {
  static instance;

  constructor(url) {
    super();
    this.url = url;
    this.sent = [];
    MockWebSocket.instance = this;
  }

  send(data, callback) {
    this.sent.push(JSON.parse(data));
    if (callback) callback();
  }

  close() {
    this.emit('close');
  }

  terminate() {
    this.emit('close');
  }
}

const dbPool = {
  connect: async () => ({
    query: async () => ({ rowCount: 2 }),
    release() {}
  }),
  query: async () => {}
};
const aisService = new AISService({ WebSocketImpl: MockWebSocket, dbPool });

test('AIS Service - start/stop', async () => {
  const originalKey = process.env.AISSTREAM_API_KEY;
  delete process.env.AISSTREAM_API_KEY;

  assert.strictEqual(aisService.isActive, false);
  aisService.start();
  assert.strictEqual(aisService.isActive, false, 'Should not start without API key');

  process.env.AISSTREAM_API_KEY = 'mock-key';
  aisService.start();
  assert.strictEqual(aisService.isActive, true, 'Should start with API key');
  assert.ok(aisService.cleanupTimer);

  await aisService.stop();
  assert.strictEqual(aisService.isActive, false, 'Should be inactive after stop');
  assert.strictEqual(aisService.ws, null);
  assert.strictEqual(aisService.cleanupTimer, null);

  if (originalKey === undefined) delete process.env.AISSTREAM_API_KEY;
  else process.env.AISSTREAM_API_KEY = originalKey;
});

test('AIS Service - Timestamp Normalization', () => {
  assert.strictEqual(
    aisService.normalizeTimestamp('2026-10-07 17:37:09.016653628 +0000 UTC'),
    '2026-10-07T17:37:09.016Z'
  );
  assert.strictEqual(
    aisService.normalizeTimestamp('2026-10-07T17:37:09.016Z'),
    '2026-10-07T17:37:09.016Z'
  );
  assert.strictEqual(
    aisService.normalizeTimestamp('2026-10-07 17:37:09 +0000 UTC'),
    '2026-10-07T17:37:09.000Z'
  );
  assert.strictEqual(aisService.normalizeTimestamp('Not a real date'), null);
});

test('AIS Service - Mocked WebSocket subscription and position parsing', async () => {
  const previous = {
    apiKey: process.env.AISSTREAM_API_KEY,
    url: process.env.AISSTREAM_URL,
    areas: process.env.POLLER_PRIORITY_AREAS_JSON
  };
  process.env.AISSTREAM_API_KEY = 'mock-key';
  process.env.AISSTREAM_URL = 'ws://mock.invalid';
  process.env.POLLER_PRIORITY_AREAS_JSON = JSON.stringify(regions);

  try {
    aisService.start();
    const socket = MockWebSocket.instance;
    socket.emit('open');
    assert.strictEqual(typeof socket.sent[0].APIKey, 'string');
    assert.ok(socket.sent[0].APIKey.length > 0);
    assert.strictEqual(Object.hasOwn(socket.sent[0], 'Apikey'), false);
    assert.deepStrictEqual(
      socket.sent[0].BoundingBoxes,
      regions.map(({ bbox: [minLon, minLat, maxLon, maxLat] }) => [
        [maxLat, minLon],
        [minLat, maxLon]
      ])
    );
    assert.deepStrictEqual(socket.sent[0].FiltersShipMMSI, []);
    assert.deepStrictEqual(socket.sent[0].FilterMessageTypes, ['PositionReport']);

    socket.emit('message', Buffer.from(JSON.stringify({
      MessageType: 'PositionReport',
      MetaData: { MMSI: '123456789', time_utc: '2026-10-07 17:37:09.016653628 +0000 UTC' },
      Message: { PositionReport: { Latitude: 13.04, Longitude: 80.34 } }
    })));
    socket.emit('message', JSON.stringify({
      MessageType: 'PositionReport',
      MetaData: { MMSI: '987654321', time_utc: '2026-10-07 17:37:10 +0000 UTC' },
      Message: { PositionReport: { Latitude: 13.05, Longitude: 80.35, Sog: 15.2, Cog: 180.5 } }
    }));
    socket.emit('message', 'invalid json');

    assert.strictEqual(aisService.currentBatch.length, 2);
    assert.strictEqual(aisService.currentBatch[0].mmsi, '123456789');
    assert.strictEqual(aisService.currentBatch[0].speed, null);
    assert.strictEqual(aisService.currentBatch[0].course, null);
    assert.strictEqual(aisService.currentBatch[1].mmsi, '987654321');
    assert.strictEqual(aisService.currentBatch[1].speed, 15.2);
    assert.strictEqual(aisService.currentBatch[1].course, 180.5);
    assert.strictEqual(aisService.diagTotalMsgs, 3);
    assert.strictEqual(aisService.diagParsedMsgs, 2);
    assert.strictEqual(aisService.diagMalformedMsgs, 1);
    assert.strictEqual(aisService.diagRegionAccepted, 2);
  } finally {
    await aisService.stop();
    if (previous.apiKey === undefined) delete process.env.AISSTREAM_API_KEY;
    else process.env.AISSTREAM_API_KEY = previous.apiKey;
    if (previous.url === undefined) delete process.env.AISSTREAM_URL;
    else process.env.AISSTREAM_URL = previous.url;
    if (previous.areas === undefined) delete process.env.POLLER_PRIORITY_AREAS_JSON;
    else process.env.POLLER_PRIORITY_AREAS_JSON = previous.areas;
  }
});
