'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const storage = require('../src/services/object-storage.service');
const archive = require('../src/services/incident-archive.service');

function response(status, bytes = Buffer.alloc(0), message = '') {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => message,
    json: async () => ({ public: false }),
    arrayBuffer: async () => bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ),
  };
}

test('local object adapter uploads atomically and supports metadata, read and existence checks', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'osis-local-objects-'));
  const adapter = storage.createLocalAdapter(directory);
  const source = Buffer.from('local SAR evidence');
  try {
    const first = await adapter.uploadVerified('scenes/scene-1/vv.tif', source, {
      contentType: 'image/tiff',
    });
    const second = await adapter.uploadVerified('scenes/scene-1/vv.tif', source, {
      contentType: 'image/tiff',
    });
    assert.equal(first.sha256, second.sha256);
    assert.equal(first.provider, 'local');
    assert.equal(first.contentType, 'image/tiff');
    assert.deepEqual(await adapter.read(first.key), source);
    assert.equal((await adapter.metadata(first.key)).sizeBytes, source.length);
    assert.equal(await adapter.exists(first.key), true);
    assert.equal(await adapter.exists('scenes/missing/vv.tif'), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('Supabase upload retries a partial failure and accepts the already-written matching object', async () => {
  const objects = new Map();
  let posts = 0;
  const adapter = storage.createSupabaseAdapter({
    url: 'https://example.supabase.co',
    bucket: 'private-evidence',
    serviceRoleKey: 'test-secret',
    fetchImpl: async (_url, options) => {
      if (options.method === 'POST') {
        posts++;
        if (posts === 1) {
          objects.set('reports/hash/report.json', Buffer.from(options.body));
          return response(500, Buffer.alloc(0), 'temporary failure');
        }
        return response(409, Buffer.alloc(0), 'already exists');
      }
      return response(
        objects.has('reports/hash/report.json') ? 200 : 404,
        objects.get('reports/hash/report.json') || Buffer.alloc(0),
      );
    },
  });
  const body = Buffer.from('report bytes');
  const stored = await adapter.uploadVerified('reports/hash/report.json', body, {
    contentType: 'application/json',
  });
  assert.equal(posts, 2);
  assert.equal(stored.sha256, require('node:crypto').createHash('sha256').update(body).digest('hex'));
  assert.equal(stored.sizeBytes, body.length);
  assert.equal(stored.contentType, 'application/json');
  assert.deepEqual(await adapter.read(stored.key), body);
});

test('repeat upload is idempotent and a different object at the same key is rejected without overwrite', async () => {
  const objects = new Map();
  let posts = 0;
  const adapter = storage.createSupabaseAdapter({
    url: 'https://example.supabase.co',
    bucket: 'private-evidence',
    serviceRoleKey: 'test-secret',
    fetchImpl: async (_url, options) => {
      if (options.method === 'POST') {
        posts++;
        const key = 'scenes/hash/vv.tif';
        if (objects.has(key)) return response(409, Buffer.alloc(0), 'already exists');
        objects.set(key, Buffer.from(options.body));
        return response(200);
      }
      const value = objects.get('scenes/hash/vv.tif');
      return value ? response(200, value) : response(404);
    },
  });
  const first = await adapter.uploadVerified('scenes/hash/vv.tif', Buffer.from('same'));
  const repeated = await adapter.uploadVerified('scenes/hash/vv.tif', Buffer.from('same'));
  assert.equal(first.sha256, repeated.sha256);
  assert.equal(posts, 2);

  await assert.rejects(
    adapter.uploadVerified('scenes/hash/vv.tif', Buffer.from('different')),
    { code: 'OSIS_OBJECT_CHECKSUM_MISMATCH' },
  );
  assert.deepEqual(objects.get('scenes/hash/vv.tif'), Buffer.from('same'));
});

test('verified uploads persist incident and scene references only after read-back verification', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'osis-object-reference-'));
  const source = path.join(directory, 'vv.tif');
  await fs.writeFile(source, 'SAR bytes');
  const events = [];
  const adapter = {
    provider: 'supabase',
    uploadVerified: async (key, bytes, options) => {
      events.push(`verified:${key}`);
      return {
        provider: 'supabase',
        bucket: 'private-evidence',
        key,
        sizeBytes: bytes.length,
        sha256: require('node:crypto').createHash('sha256').update(bytes).digest('hex'),
        contentType: options.contentType,
        verifiedAt: '2026-10-15T00:00:00.000Z',
      };
    },
  };
  const database = {
    connect: async () => ({
      query: async (sql, params) => {
        events.push(sql.trim().split(/\s+/)[0]);
        if (sql.includes('UPDATE osis_incidents')) {
          const persistedReport = JSON.parse(params[1]);
          assert.ok(persistedReport.persistence.objectStorage.report.sha256);
          assert.ok(persistedReport.persistence.objectStorage.evidence[0].sha256);
        }
        return { rowCount: 1, rows: [] };
      },
      release() {},
    }),
  };
  const report = {
    id: '11111111-1111-4111-8111-111111111111',
    scene: { id: 'scene-safe-id', bbox: [1, 2, 3, 4] },
    persistence: { database: 'mirrored' },
  };
  try {
    const refs = await storage.persistReportArtifacts(
      report,
      { vv: source },
      { processedSceneId: 42 },
      { adapter, database },
    );
    assert.equal(refs.evidence[0].role, 'vv');
    assert.equal(report.persistence.objectStorage.report.key, storage.reportObjectKey(report.id));
    assert.ok(report.persistence.objectStorage.evidence[0].key.includes('/vv.tif'));
    assert.ok(events.indexOf('BEGIN') > events.findIndex(event => event.startsWith('verified:')));
    assert.ok(events.includes('COMMIT'));
    assert.ok(events.includes('UPDATE'));
    assert.equal(await fs.readFile(source, 'utf8'), 'SAR bytes');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('failed database reference persistence leaves local evidence and report metadata intact', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'osis-object-reference-failure-'));
  const source = path.join(directory, 'vh.tif');
  await fs.writeFile(source, 'retained evidence');
  const adapter = {
    provider: 'supabase',
    uploadVerified: async (key, bytes, options) => ({
      provider: 'supabase',
      bucket: 'private-evidence',
      key,
      sizeBytes: bytes.length,
      sha256: require('node:crypto').createHash('sha256').update(bytes).digest('hex'),
      contentType: options.contentType,
      verifiedAt: new Date().toISOString(),
    }),
  };
  const database = {
    connect: async () => ({
      query: async sql => sql === 'BEGIN' || sql === 'ROLLBACK'
        ? { rowCount: 0, rows: [] }
        : { rowCount: 0, rows: [] },
      release() {},
    }),
  };
  const report = {
    id: '22222222-2222-4222-8222-222222222222',
    scene: { id: 'scene-safe-id', bbox: [1, 2, 3, 4] },
    persistence: { database: 'mirrored' },
  };
  try {
    await assert.rejects(
      storage.persistReportArtifacts(report, { vh: source }, {}, { adapter, database }),
      { code: 'OSIS_STORAGE_CAPACITY', storageReason: 'object_reference_persistence' },
    );
    assert.equal(await fs.readFile(source, 'utf8'), 'retained evidence');
    assert.equal(report.persistence.objectStorage, undefined);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('failed cloud upload never removes the local SAR source', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'osis-object-upload-failure-'));
  const source = path.join(directory, 'vv.tif');
  await fs.writeFile(source, 'local source survives');
  const adapter = {
    provider: 'supabase',
    uploadVerified: async () => {
      throw Object.assign(new Error('temporary failure'), {
        code: 'OSIS_OBJECT_STORAGE_NETWORK',
        retryable: true,
      });
    },
  };
  try {
    await assert.rejects(
      storage.persistReportArtifacts(
        {
          id: '33333333-3333-4333-8333-333333333333',
          scene: { id: 'scene-safe-id', bbox: [1, 2, 3, 4] },
          persistence: { database: 'mirrored' },
        },
        { vv: source },
        {},
        { adapter },
      ),
      { code: 'OSIS_STORAGE_CAPACITY', storageReason: 'object_storage_upload' },
    );
    assert.equal(await fs.readFile(source, 'utf8'), 'local source survives');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('Supabase cloud mode fails closed when required configuration is incomplete', () => {
  const original = {
    provider: process.env.OSIS_OBJECT_STORAGE_PROVIDER,
    url: process.env.OSIS_SUPABASE_URL,
    bucket: process.env.OSIS_SUPABASE_STORAGE_BUCKET,
    key: process.env.OSIS_SUPABASE_SERVICE_ROLE_KEY,
    postgres: process.env.OSIS_PERSIST_POSTGRES,
  };
  try {
    process.env.OSIS_OBJECT_STORAGE_PROVIDER = 'supabase';
    process.env.OSIS_PERSIST_POSTGRES = 'false';
    delete process.env.OSIS_SUPABASE_URL;
    delete process.env.OSIS_SUPABASE_STORAGE_BUCKET;
    delete process.env.OSIS_SUPABASE_SERVICE_ROLE_KEY;
    const status = storage.configurationStatus();
    assert.equal(status.configured, false);
    assert.equal(status.reason, 'object_storage_configuration');
    assert.match(status.message, /OSIS_SUPABASE_URL/);
    assert.throws(storage.configuration, { code: 'OSIS_OBJECT_STORAGE_CONFIGURATION' });
  } finally {
    for (const [name, value] of [
      ['OSIS_OBJECT_STORAGE_PROVIDER', original.provider],
      ['OSIS_SUPABASE_URL', original.url],
      ['OSIS_SUPABASE_STORAGE_BUCKET', original.bucket],
      ['OSIS_SUPABASE_SERVICE_ROLE_KEY', original.key],
      ['OSIS_PERSIST_POSTGRES', original.postgres],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('capacity status pauses cloud admissions when Supabase configuration is incomplete', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'osis-cloud-capacity-'));
  const original = {
    provider: process.env.OSIS_OBJECT_STORAGE_PROVIDER,
    postgres: process.env.OSIS_PERSIST_POSTGRES,
    minSpace: process.env.OSIS_MIN_FREE_SPACE_MIB,
    url: process.env.OSIS_SUPABASE_URL,
    bucket: process.env.OSIS_SUPABASE_STORAGE_BUCKET,
    key: process.env.OSIS_SUPABASE_SERVICE_ROLE_KEY,
  };
  try {
    process.env.OSIS_OBJECT_STORAGE_PROVIDER = 'supabase';
    process.env.OSIS_PERSIST_POSTGRES = 'false';
    process.env.OSIS_MIN_FREE_SPACE_MIB = '1';
    delete process.env.OSIS_SUPABASE_URL;
    delete process.env.OSIS_SUPABASE_STORAGE_BUCKET;
    delete process.env.OSIS_SUPABASE_SERVICE_ROLE_KEY;
    const status = await archive.capacityStatus({
      reportDirectory: directory,
      archiveDirectory: path.join(directory, 'archive'),
      maxReports: 100,
    });
    assert.equal(status.accepting, false);
    assert.equal(status.reason, 'object_storage_configuration');
    assert.equal(status.objectStorageConfigured, false);
  } finally {
    for (const [name, value] of [
      ['OSIS_OBJECT_STORAGE_PROVIDER', original.provider],
      ['OSIS_PERSIST_POSTGRES', original.postgres],
      ['OSIS_MIN_FREE_SPACE_MIB', original.minSpace],
      ['OSIS_SUPABASE_URL', original.url],
      ['OSIS_SUPABASE_STORAGE_BUCKET', original.bucket],
      ['OSIS_SUPABASE_SERVICE_ROLE_KEY', original.key],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('Supabase bucket health check fails closed on provider authorization errors', async () => {
  const adapter = storage.createSupabaseAdapter({
    url: 'https://example.supabase.co',
    bucket: 'private-evidence',
    serviceRoleKey: 'test-secret',
    fetchImpl: async () => response(403),
  });
  await assert.rejects(adapter.check(), {
    code: 'OSIS_OBJECT_STORAGE_UNAVAILABLE',
    status: 403,
  });
});

test('Supabase bucket health check rejects public evidence buckets', async () => {
  const adapter = storage.createSupabaseAdapter({
    url: 'https://example.supabase.co',
    bucket: 'private-evidence',
    serviceRoleKey: 'test-secret',
    fetchImpl: async () => ({
      ...response(200),
      json: async () => ({ public: true }),
    }),
  });
  await assert.rejects(adapter.check(), {
    code: 'OSIS_OBJECT_STORAGE_UNAVAILABLE',
  });
});
