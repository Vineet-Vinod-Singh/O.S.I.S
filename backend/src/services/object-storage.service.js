'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const PROVIDER_ENV = 'OSIS_OBJECT_STORAGE_PROVIDER';
const PROVIDERS = new Set(['local', 'supabase']);
const RETRIES = 3;
const REQUEST_TIMEOUT_MS = 15000;

function configurationError(message) {
  return Object.assign(new Error(message), {
    code: 'OSIS_OBJECT_STORAGE_CONFIGURATION',
    status: 503,
    storageReason: 'object_storage_configuration',
  });
}

function configuration() {
  const provider = process.env[PROVIDER_ENV] || 'local';
  if (!PROVIDERS.has(provider)) {
    throw configurationError(`${PROVIDER_ENV} must be local or supabase`);
  }
  if (provider === 'local') {
    return {
      provider,
      directory: path.resolve(
        process.env.OSIS_OBJECT_STORAGE_LOCAL_DIR ||
          path.resolve(__dirname, '../../data/object_storage'),
      ),
    };
  }

  const missing = [
    ['OSIS_SUPABASE_URL', process.env.OSIS_SUPABASE_URL],
    ['OSIS_SUPABASE_STORAGE_BUCKET', process.env.OSIS_SUPABASE_STORAGE_BUCKET],
    ['OSIS_SUPABASE_SERVICE_ROLE_KEY', process.env.OSIS_SUPABASE_SERVICE_ROLE_KEY],
  ].filter(([, value]) => !value || !value.trim()).map(([name]) => name);
  if (missing.length) {
    throw configurationError(`Supabase object storage is missing: ${missing.join(', ')}`);
  }
  let url;
  try {
    url = new URL(process.env.OSIS_SUPABASE_URL);
  } catch {
    throw configurationError('OSIS_SUPABASE_URL must be a valid HTTPS URL');
  }
  if (url.protocol !== 'https:') {
    throw configurationError('OSIS_SUPABASE_URL must use HTTPS');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw configurationError('OSIS_SUPABASE_URL must not contain credentials or query parameters');
  }
  if (process.env.OSIS_PERSIST_POSTGRES !== 'true') {
    throw configurationError('Supabase object storage requires OSIS_PERSIST_POSTGRES=true');
  }
  return {
    provider,
    url: url.toString().replace(/\/+$/, ''),
    bucket: process.env.OSIS_SUPABASE_STORAGE_BUCKET.trim(),
    serviceRoleKey: process.env.OSIS_SUPABASE_SERVICE_ROLE_KEY.trim(),
  };
}

function configurationStatus() {
  try {
    const config = configuration();
    return { configured: true, provider: config.provider, reason: null };
  } catch (error) {
    if (error.code !== 'OSIS_OBJECT_STORAGE_CONFIGURATION') throw error;
    return {
      configured: false,
      provider: process.env[PROVIDER_ENV] || 'local',
      reason: error.storageReason,
      message: error.message,
    };
  }
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function objectNotFound() {
  return Object.assign(new Error('Object does not exist'), {
    code: 'OSIS_OBJECT_NOT_FOUND',
    status: 404,
  });
}

function validateKey(key) {
  if (typeof key !== 'string' || !key || key.startsWith('/') ||
      key.split('/').some(part => !part || part === '.' || part === '..')) {
    throw Object.assign(new Error('Object key is invalid'), {
      code: 'OSIS_OBJECT_KEY_INVALID',
      status: 400,
    });
  }
  return key;
}

function objectMetadata(bytes, key, contentType = 'application/octet-stream') {
  return {
    key,
    sizeBytes: bytes.length,
    sha256: digest(bytes),
    contentType,
  };
}

function retryable(error) {
  return error.retryable === true ||
    error.code === 'OSIS_OBJECT_NOT_FOUND' ||
    ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error.code) ||
    (Number.isInteger(error.status) && error.status >= 500) ||
    error.name === 'TypeError';
}

function pause(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function createLocalAdapter(directory) {
  const root = path.resolve(directory);
  function filePath(key) {
    const destination = path.resolve(root, ...validateKey(key).split('/'));
    if (!destination.startsWith(`${root}${path.sep}`)) {
      throw Object.assign(new Error('Object key escapes local storage'), {
        code: 'OSIS_OBJECT_KEY_INVALID',
        status: 400,
      });
    }
    return destination;
  }

  async function read(key) {
    try {
      return await fs.readFile(filePath(key));
    } catch (error) {
      if (error.code === 'ENOENT') throw objectNotFound();
      throw error;
    }
  }

  async function upload(key, bytes) {
    const destination = filePath(key);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, bytes, { flag: 'wx' });
      try {
        await fs.link(temporary, destination);
        return { created: true };
      } catch (error) {
        if (error.code === 'EEXIST') return { created: false };
        throw error;
      }
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }

  return withVerifiedOperations({
    provider: 'local',
    bucket: null,
    read,
    upload,
  });
}

function createSupabaseAdapter({ url, bucket, serviceRoleKey, fetchImpl = fetch }) {
  const base = new URL(url);
  if (base.protocol !== 'https:') {
    throw configurationError('OSIS_SUPABASE_URL must use HTTPS');
  }
  if (!bucket || !serviceRoleKey) {
    throw configurationError('Supabase object storage bucket and service key are required');
  }

  function objectUrl(key) {
    const encodedKey = validateKey(key).split('/').map(encodeURIComponent).join('/');
    return `${base.toString().replace(/\/+$/, '')}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedKey}`;
  }

  async function request(method, key, body, contentType) {
    let response;
    try {
      response = await fetchImpl(objectUrl(key), {
        method,
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          ...(contentType ? { 'Content-Type': contentType } : {}),
          ...(method === 'POST' ? { 'x-upsert': 'false' } : {}),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...(body ? { body } : {}),
      });
    } catch (error) {
      throw Object.assign(new Error('Supabase object storage request failed'), {
        code: error.code || 'OSIS_OBJECT_STORAGE_NETWORK',
        retryable: true,
      });
    }

    if (method === 'POST' && [400, 409].includes(response.status)) {
      const responseText = await response.text().catch(() => '');
      if (response.status === 409 || /already exists|duplicate/i.test(responseText)) {
        return { created: false };
      }
    }
    if (method === 'GET' && response.status === 404) throw objectNotFound();
    if (!response.ok) {
      throw Object.assign(
        new Error(`Supabase object storage returned HTTP ${response.status}`),
        { status: response.status, retryable: response.status >= 500 },
      );
    }
    return method === 'GET'
      ? Buffer.from(await response.arrayBuffer())
      : { created: true };
  }

  async function check() {
    let response;
    try {
      response = await fetchImpl(
        `${base.toString().replace(/\/+$/, '')}/storage/v1/bucket/${encodeURIComponent(bucket)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            apikey: serviceRoleKey,
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch (error) {
      throw Object.assign(new Error('Supabase object storage health check failed'), {
        code: error.code || 'OSIS_OBJECT_STORAGE_NETWORK',
        retryable: true,
      });
    }
    if (!response.ok) {
      throw Object.assign(
        new Error(`Supabase object storage bucket check returned HTTP ${response.status}`),
        {
          code: 'OSIS_OBJECT_STORAGE_UNAVAILABLE',
          status: response.status,
        },
      );
    }
    let bucketInfo;
    try {
      bucketInfo = await response.json();
    } catch {
      throw Object.assign(new Error('Supabase bucket privacy could not be verified'), {
        code: 'OSIS_OBJECT_STORAGE_UNAVAILABLE',
        status: 503,
      });
    }
    if (bucketInfo.public !== false) {
      throw Object.assign(new Error('Supabase evidence bucket must be private'), {
        code: 'OSIS_OBJECT_STORAGE_UNAVAILABLE',
        status: 503,
      });
    }
    return true;
  }

  return withVerifiedOperations({
    provider: 'supabase',
    bucket,
    check,
    read: key => request('GET', key),
    upload: (key, bytes, contentType) => request('POST', key, bytes, contentType),
  });
}

function withVerifiedOperations(provider) {
  async function metadata(key) {
    const bytes = await provider.read(key);
    return objectMetadata(bytes, key);
  }

  async function verify(key, expected) {
    const bytes = await provider.read(key);
    const actual = objectMetadata(bytes, key);
    if (actual.sizeBytes !== expected.sizeBytes || actual.sha256 !== expected.sha256) {
      throw Object.assign(new Error('Stored object size or SHA-256 does not match the source'), {
        code: 'OSIS_OBJECT_CHECKSUM_MISMATCH',
        status: 503,
      });
    }
    return actual;
  }

  async function exists(key) {
    try {
      await provider.read(key);
      return true;
    } catch (error) {
      if (error.code === 'OSIS_OBJECT_NOT_FOUND') return false;
      throw error;
    }
  }

  async function uploadVerified(key, value, options = {}) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const expected = objectMetadata(bytes, key, options.contentType);
    let lastError;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      try {
        await provider.upload(key, bytes, options.contentType || 'application/octet-stream');
        const verified = await verify(key, expected);
        return {
          provider: provider.provider,
          bucket: provider.bucket,
          ...verified,
          contentType: options.contentType || 'application/octet-stream',
          verifiedAt: new Date().toISOString(),
        };
      } catch (error) {
        lastError = error;
        if (!retryable(error) || attempt === RETRIES) throw error;
        await pause(40 * (2 ** attempt));
      }
    }
    throw lastError;
  }

  return {
    provider: provider.provider,
    bucket: provider.bucket,
    upload: provider.upload,
    metadata,
    verify,
    read: provider.read,
    exists,
    uploadVerified,
    check: provider.check || (async () => true),
  };
}

function configuredAdapter(options = {}) {
  const config = configuration();
  if (config.provider === 'local') {
    return createLocalAdapter(options.localDirectory || config.directory);
  }
  return createSupabaseAdapter({ ...config, fetchImpl: options.fetchImpl || fetch });
}

function isCloudMode() {
  return (process.env[PROVIDER_ENV] || 'local') === 'supabase';
}

function stableIdentity(value) {
  return digest(Buffer.from(String(value)));
}

function reportObjectKey(reportId) {
  return `reports/${stableIdentity(reportId)}/report.json`;
}

function evidenceObjectKey(sceneId, bbox, role) {
  if (typeof sceneId !== 'string' || !sceneId) {
    throw Object.assign(new Error('SAR evidence requires a scene identity'), {
      code: 'OSIS_OBJECT_KEY_INVALID',
      status: 400,
    });
  }
  if (!['vv', 'vh'].includes(role)) {
    throw Object.assign(new Error('Unsupported SAR evidence role'), {
      code: 'OSIS_OBJECT_KEY_INVALID',
      status: 400,
    });
  }
  const identity = stableIdentity(`${sceneId}\n${JSON.stringify(bbox || null)}`);
  return `scenes/${stableIdentity(sceneId)}/tiles/${identity}/${role}.tif`;
}

async function persistReportArtifactsUnsafe(report, evidencePaths = {}, sceneInfo = {}, options = {}) {
  const adapter = options.adapter || configuredAdapter();
  if (adapter.provider !== 'supabase') {
    throw configurationError('Durable database references are only required for cloud storage');
  }
  const reportBytes = Buffer.from(JSON.stringify(report));
  const reportReference = await adapter.uploadVerified(
    reportObjectKey(report.id),
    reportBytes,
    { contentType: 'application/json' },
  );

  const evidenceReferences = [];
  for (const role of ['vv', 'vh']) {
    const source = evidencePaths[role];
    if (typeof source !== 'string' || !source) continue;
    const bytes = await fs.readFile(source);
    evidenceReferences.push({
      role,
      ...await adapter.uploadVerified(
        evidenceObjectKey(report.scene?.id, report.scene?.bbox, role),
        bytes,
        { contentType: 'image/tiff' },
      ),
    });
  }

  const references = { report: reportReference, evidence: evidenceReferences };
  const updatedReport = {
    ...report,
    persistence: { ...report.persistence, objectStorage: references },
  };
  const database = options.database || require('../config/db');
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const reportUpdate = await client.query(
      'UPDATE osis_incidents SET report = $2::jsonb WHERE id = $1',
      [report.id, JSON.stringify(updatedReport)],
    );
    if (reportUpdate.rowCount !== 1) {
      throw new Error('Incident object-storage reference could not be persisted');
    }
    if (sceneInfo.processedSceneId && evidenceReferences.length) {
      const sceneReferences = JSON.stringify({
        [report.id]: Object.fromEntries(evidenceReferences.map(reference => [
          reference.role,
          reference,
        ])),
      });
      const sceneUpdate = await client.query(
        `UPDATE processed_scenes
            SET artifact_metadata = jsonb_set(
              COALESCE(artifact_metadata, '{}'::jsonb),
              '{object_storage}',
              COALESCE(artifact_metadata->'object_storage', '{}'::jsonb) || $1::jsonb,
              true
            )
          WHERE id = $2`,
        [sceneReferences, sceneInfo.processedSceneId],
      );
      if (sceneUpdate.rowCount !== 1) {
        throw new Error('Scene evidence reference could not be persisted');
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Rollback failure must not mask the storage backpressure error.
    }
    throw Object.assign(
      new Error('Verified object references could not be persisted; local sources are retained.'),
      {
        code: 'OSIS_STORAGE_CAPACITY',
        status: 503,
        storageReason: 'object_reference_persistence',
      },
    );
  } finally {
    client.release();
  }
  Object.assign(report, updatedReport);
  return references;
}

async function persistReportArtifacts(report, evidencePaths = {}, sceneInfo = {}, options = {}) {
  try {
    return await persistReportArtifactsUnsafe(report, evidencePaths, sceneInfo, options);
  } catch (error) {
    if (error.code === 'OSIS_STORAGE_CAPACITY') throw error;
    const storageReason = error.code === 'OSIS_OBJECT_CHECKSUM_MISMATCH'
      ? 'object_checksum_mismatch'
      : error.code === 'OSIS_OBJECT_STORAGE_CONFIGURATION'
        ? 'object_storage_configuration'
        : 'object_storage_upload';
    throw Object.assign(
      new Error('Cloud report/evidence storage failed; the local source is retained.'),
      {
        code: 'OSIS_STORAGE_CAPACITY',
        status: 503,
        storageReason,
      },
    );
  }
}

module.exports = {
  configuration,
  configurationStatus,
  configuredAdapter,
  createLocalAdapter,
  createSupabaseAdapter,
  isCloudMode,
  persistReportArtifacts,
  reportObjectKey,
  evidenceObjectKey,
};
