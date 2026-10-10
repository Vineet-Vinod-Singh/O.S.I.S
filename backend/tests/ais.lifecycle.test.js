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
  static instances = [];

  constructor(url) {
    super();
    this.url = url;
    this.sent = [];
    MockWebSocket.instances.push(this);
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

function createHarness({ random = () => 0.5 } = {}) {
  MockWebSocket.instances = [];
  const timers = new Map();
  let nextTimerId = 0;
  const dbCalls = [];
  const dbPool = {
    connect: async () => ({
      query: async (query) => {
        dbCalls.push(query);
        return { rowCount: 1 };
      },
      release() {}
    }),
    query: async () => {}
  };
  const service = new AISService({
    WebSocketImpl: MockWebSocket,
    dbPool,
    random,
    setTimeoutFn: (callback, delay) => {
      const id = ++nextTimerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeoutFn: (id) => timers.delete(id)
  });

  process.env.AISSTREAM_API_KEY = 'test-only-key';
  process.env.AISSTREAM_URL = 'ws://mock.invalid';
  process.env.POLLER_PRIORITY_AREAS_JSON = JSON.stringify(regions);
  service.isActive = true;
  service.diagRegions = regions;

  return {
    service,
    timers,
    dbCalls,
    runTimer(id) {
      const timer = timers.get(id);
      assert.ok(timer, `timer ${id} should exist`);
      timers.delete(id);
      timer.callback();
    }
  };
}

test('AIS lifecycle honors Retry-After on HTTP 429', async () => {
  const { service, timers } = createHarness();
  const originalWarn = console.warn;
  const entries = [];
  console.warn = (...args) => entries.push(args.join(' '));
  try {
    service.connect();
    const socket = MockWebSocket.instances[0];
    let responseResumed = false;
    socket.emit('unexpected-response', {}, {
      statusCode: 429,
      headers: { 'retry-after': '45' },
      resume() { responseResumed = true; }
    });

    const reconnect = [...timers.values()].find(({ delay }) => delay !== 30000);
    assert.equal(responseResumed, true);
    assert.equal(reconnect.delay, 45000);
    assert.equal(timers.size, 1);
    assert.ok(entries.some((line) =>
      line.includes('attempt 1 (generation 0) handshake failed with HTTP 429') &&
      line.includes('Retry-After parsed=yes') &&
      line.includes('calculated delay=45000ms')
    ));
    assert.equal(entries.join('\n').includes('test-only-key'), false);
  } finally {
    console.warn = originalWarn;
    await service.stop();
  }
});

test('AIS lifecycle parses HTTP-date and falls back for invalid Retry-After', async () => {
  const { service, timers } = createHarness({ random: () => 0 });
  assert.equal(service.parseRetryAfter('-1'), null);
  assert.equal(service.parseRetryAfter('Mon, 31 Feb 2026 00:00:00 GMT'), null);
  try {
    service.connect();
    const dateSocket = MockWebSocket.instances[0];
    const retryAt = new Date(Date.now() + 60000);
    dateSocket.emit('unexpected-response', {}, {
      statusCode: 429,
      headers: { 'retry-after': retryAt.toUTCString() },
      resume() {}
    });
    assert.ok([...timers.values()].some(({ delay }) => delay >= 59000 && delay <= 60000));

    await service.stop();

    const next = createHarness({ random: () => 0 });
    next.service.connect();
    MockWebSocket.instances[0].emit('unexpected-response', {}, {
      statusCode: 429,
      headers: { 'retry-after': '-1' },
      resume() {}
    });
    assert.equal([...next.timers.values()][0].delay, 500);
    await next.service.stop();
  } finally {
    await service.stop();
  }
});

test('AIS lifecycle exponentially backs off after 429 without Retry-After', async () => {
  const { service, timers } = createHarness({ random: () => 0 });
  try {
    service.connect();
    const socket = MockWebSocket.instances[0];
    socket.emit('unexpected-response', {}, {
      statusCode: 429,
      headers: {},
      resume() {}
    });
    const reconnect = [...timers.values()][0];
    assert.equal(reconnect.delay, 500);
    assert.equal(service.reconnectAttempts, 1);
  } finally {
    await service.stop();
  }
});

test('AIS lifecycle chunks very long Retry-After without timer overflow or early retry', async () => {
  const { service, timers, runTimer } = createHarness();
  try {
    service.connect();
    MockWebSocket.instances[0].emit('unexpected-response', {}, {
      statusCode: 429,
      headers: { 'retry-after': '2147484' },
      resume() {}
    });

    assert.equal(MockWebSocket.instances.length, 1);
    const [firstTimerId, firstTimer] = [...timers.entries()][0];
    assert.equal(firstTimer.delay, 2147483647);
    runTimer(firstTimerId);
    assert.equal(MockWebSocket.instances.length, 1);
    const [lastTimerId, lastTimer] = [...timers.entries()][0];
    assert.equal(lastTimer.delay, 353);
    runTimer(lastTimerId);
    assert.equal(MockWebSocket.instances.length, 2);
  } finally {
    await service.stop();
  }
});

test('AIS lifecycle exponentially backs off ordinary closes and caps the delay', async () => {
  const { service, timers, runTimer } = createHarness();
  const delays = [];
  try {
    service.connect();
    for (let attempt = 1; attempt <= 12; attempt++) {
      MockWebSocket.instances[attempt - 1].emit('close');
      const [timerId, timer] = [...timers.entries()][0];
      delays.push(timer.delay);
      runTimer(timerId);
    }

    assert.deepEqual(delays.slice(0, 4), [1000, 2000, 4000, 8000]);
    assert.ok(delays.every((delay) => delay <= 300000));
    assert.equal(delays[delays.length - 1], 300000);
  } finally {
    await service.stop();
  }
});

test('AIS lifecycle coalesces repeated close and error events', async () => {
  const { service, timers } = createHarness();
  try {
    service.connect();
    const socket = MockWebSocket.instances[0];
    socket.emit('close');
    socket.emit('close');
    socket.emit('error', Object.assign(new Error('mock failure'), { code: 'MOCK' }));

    assert.equal(timers.size, 1);
    assert.equal(service.reconnectAttempts, 1);
    assert.equal(service.ws, null);
  } finally {
    await service.stop();
  }
});

test('AIS lifecycle prevents duplicate sockets and subscriptions', async () => {
  const { service } = createHarness();
  try {
    service.connect();
    const socket = MockWebSocket.instances[0];
    service.connect();
    assert.equal(MockWebSocket.instances.length, 1);

    socket.emit('open');
    socket.emit('open');
    assert.equal(socket.sent.length, 1);
    assert.equal(typeof socket.sent[0].APIKey, 'string');
    assert.ok(socket.sent[0].APIKey.length > 0);
    assert.equal(Object.hasOwn(socket.sent[0], 'Apikey'), false);
    assert.deepEqual(
      socket.sent[0].BoundingBoxes,
      regions.map(({ bbox: [minLon, minLat, maxLon, maxLat] }) => [
        [maxLat, minLon],
        [minLat, maxLon]
      ])
    );
    assert.deepEqual(socket.sent[0].FiltersShipMMSI, []);
    assert.deepEqual(socket.sent[0].FilterMessageTypes, ['PositionReport']);
  } finally {
    await service.stop();
  }
});

test('AIS lifecycle logs attempt-scoped subscription confirmation and close diagnostics safely', async () => {
  const { service } = createHarness();
  const originalLog = console.log;
  const originalWarn = console.warn;
  const entries = [];
  console.log = (...args) => entries.push(args.join(' '));
  console.warn = (...args) => entries.push(args.join(' '));
  try {
    service.connect();
    const socket = MockWebSocket.instances[0];
    socket.emit('open');
    assert.ok(entries.some((line) => line.includes('attempt 1 subscription send initiated')));
    assert.equal(entries.some((line) => line.includes('subscription confirmed by server')), false);
    socket.emit('message', JSON.stringify({
      MessageType: 'SubscriptionConfirmation',
      Message: { CompressionEnabled: true }
    }));
    socket.emit('close', 1000, Buffer.from('token=test-only-key'));

    assert.ok(entries.some((line) => line.includes('attempt 1 (generation 0) socket opened')));
    assert.ok(entries.some((line) => line.includes('attempt 1') && line.includes('subscription send initiated')));
    assert.ok(entries.some((line) => line.includes('attempt 1 subscription confirmed by server')));
    assert.ok(entries.some((line) => line.includes('compressionEnabled=true')));
    assert.ok(entries.some((line) => line.includes('closed; code=1000')));
    assert.ok(entries.some((line) => line.includes('reason="token=[redacted]"')));
    assert.ok(entries.some((line) => line.includes('attempt 1 (generation 0) scheduling reconnect')));
    assert.equal(entries.join('\n').includes('test-only-key'), false);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    await service.stop();
  }
});

test('AIS lifecycle shutdown cancels reconnect and stable timers', async () => {
  const { service, timers } = createHarness();
  service.connect();
  const socket = MockWebSocket.instances[0];
  socket.emit('open');
  socket.emit('close');

  await service.stop();
  assert.equal(service.isActive, false);
  assert.equal(service.ws, null);
  assert.equal(service.reconnectTimer, null);
  assert.equal(service.stableTimer, null);
  assert.equal(timers.size, 0);
});

test('AIS lifecycle fences old close/error events and stable timers after replacement', async () => {
  const { service, timers, runTimer } = createHarness();
  try {
    service.connect();
    const oldSocket = MockWebSocket.instances[0];
    oldSocket.emit('open');
    const oldStableTimer = service.stableTimer;
    const oldStableCallback = timers.get(oldStableTimer).callback;
    oldSocket.emit('close');

    const reconnectId = [...timers.entries()].find(([, timer]) => timer.delay !== 30000)[0];
    runTimer(reconnectId);
    const replacement = MockWebSocket.instances[1];
    replacement.emit('open');
    const replacementStableTimer = service.stableTimer;
    assert.equal(service.activeConnection.attemptId, 2);
    assert.equal(service.activeConnection.generation, 0);
    assert.notEqual(replacementStableTimer, oldStableTimer);

    oldSocket.emit('close');
    oldSocket.emit('error', Object.assign(new Error('stale socket'), { code: 'STALE' }));
    oldStableCallback();
    assert.equal(service.ws, replacement);
    assert.equal(service.stableTimer, replacementStableTimer);
    assert.equal(service.reconnectTimer, null);
  } finally {
    await service.stop();
  }
});

test('AIS lifecycle prevents immediate stop/start from sharing an active socket timer', async () => {
  const { service, timers } = createHarness();
  service.isActive = false;
  try {
    service.start();
    const oldSocket = MockWebSocket.instances[0];
    oldSocket.emit('open');
    const oldStableCallback = timers.get(service.stableTimer).callback;
    const stopPromise = service.stop();
    service.start();

    const newSocket = MockWebSocket.instances[1];
    assert.ok(newSocket);
    newSocket.emit('open');
    const newStableTimer = service.stableTimer;

    oldSocket.emit('close');
    oldSocket.emit('error', Object.assign(new Error('stale after restart'), { code: 'STALE' }));
    oldStableCallback();
    assert.equal(service.ws, newSocket);
    assert.equal(service.stableTimer, newStableTimer);
    assert.equal(service.reconnectTimer, null);

    await stopPromise;
  } finally {
    await service.stop();
  }
});

test('AIS diagnostics count malformed, invalid-position, and region-rejected reports', async () => {
  const { service } = createHarness();
  try {
    service.processMessage('{ malformed json');
    service.processMessage(JSON.stringify({
      MessageType: 'PositionReport',
      MetaData: { MMSI: '1', time_utc: 'invalid timestamp' },
      Message: { PositionReport: { Latitude: 13.24, Longitude: 74.74 } }
    }));
    service.processMessage(JSON.stringify({
      MessageType: 'PositionReport',
      MetaData: { MMSI: '2', time_utc: '2026-10-07T17:37:09Z' },
      Message: { PositionReport: { Latitude: 0, Longitude: 0 } }
    }));
    service.processMessage(JSON.stringify({
      MessageType: 'PositionReport',
      MetaData: { MMSI: '3', time_utc: '2026-10-07T17:37:09Z' }
    }));

    assert.equal(service.diagParsedMsgs, 3);
    assert.equal(service.diagMalformedMsgs, 2);
    assert.equal(service.diagInvalidPos, 1);
    assert.equal(service.diagInvalidPositionReasons['invalid timestamp'], 1);
    assert.equal(service.diagRegionRejected, 1);
    assert.equal(service.diagRegionRejectReasons['outside configured regions'], 1);
    assert.equal(service.diagRegionAccepted, 0);
  } finally {
    await service.stop();
  }
});

test('AIS lifecycle recovers and inserts a region-matched report after stable open', async () => {
  const { service, timers, dbCalls, runTimer } = createHarness();
  try {
    service.connect();
    const firstSocket = MockWebSocket.instances[0];
    firstSocket.emit('open');
    firstSocket.emit('close');
    assert.equal(service.reconnectAttempts, 1);

    const reconnectTimer = [...timers.entries()][0][0];
    runTimer(reconnectTimer);
    assert.equal(MockWebSocket.instances.length, 2);
    const recoveredSocket = MockWebSocket.instances[1];
    recoveredSocket.emit('open');
    const stableTimer = [...timers.entries()].find(([, timer]) => timer.delay === 30000)[0];
    runTimer(stableTimer);
    assert.equal(service.reconnectAttempts, 0);

    recoveredSocket.emit('message', JSON.stringify({
      MessageType: 'PositionReport',
      MetaData: { MMSI: '123456789', time_utc: '2026-10-07 17:37:09.016653628 +0000 UTC' },
      Message: { PositionReport: { Latitude: 13.24, Longitude: 74.74 } }
    }));
    assert.equal(service.diagRegionAccepted, 1);
    assert.equal(service.currentBatch.length, 1);

    await service.flushBatch();
    assert.equal(service.diagDbAttempted, 1);
    assert.equal(service.diagDbSuccess, 1);
    assert.ok(dbCalls.some((query) => typeof query === 'string' && query.includes('INSERT INTO live_ais')));
  } finally {
    await service.stop();
  }
});
