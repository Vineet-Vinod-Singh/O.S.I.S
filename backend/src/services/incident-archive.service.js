'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { constants: fsConstants } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const pool = require('../config/db');
const limits = require('./resource-limits');

const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5000;
const validId = id => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id);

function reportDirectory() {
  return path.resolve(process.env.OSIS_REPORT_DIR || path.resolve(__dirname, '../../data/incidents'));
}

function archiveDirectory() {
  return path.resolve(
    process.env.OSIS_REPORT_ARCHIVE_DIR ||
    path.resolve(__dirname, '../../data/incidents_archive')
  );
}

function manifestPath(directory = archiveDirectory()) {
  return path.join(directory, 'manifest.json');
}

function directoriesOverlap(first, second) {
  const relative = (from, to) => path.relative(from, to);
  const isInside = value => value === '' || (!path.isAbsolute(value) &&
    value !== '..' && !value.startsWith(`..${path.sep}`));
  return isInside(relative(first, second)) || isInside(relative(second, first));
}

function capacityError(message, reason) {
  return Object.assign(new Error(message), {
    status: 507,
    code: 'OSIS_STORAGE_CAPACITY',
    storageReason: reason,
  });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function countLocalReports(directory = reportDirectory()) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  return entries.filter(entry =>
    entry.isFile() && entry.name.endsWith('.json') && validId(entry.name.slice(0, -5))
  ).length;
}

async function readManifest(directory = archiveDirectory()) {
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath(directory), 'utf8'));
    if (manifest?.version !== 1 || !manifest.records || typeof manifest.records !== 'object' ||
        Array.isArray(manifest.records)) {
      throw new Error('Invalid incident archive manifest format');
    }
    return manifest;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, records: {} };
    throw Object.assign(new Error('Incident archive manifest is unreadable'), {
      status: 503,
      code: 'OSIS_ARCHIVE_UNAVAILABLE',
    });
  }
}

async function acquireManifestLock(directory) {
  await fs.mkdir(directory, { recursive: true });
  const lock = path.join(directory, '.manifest.lock');
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      return { handle: await fs.open(lock, 'wx'), lock };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) {
        throw Object.assign(new Error('Incident archive is busy; retry shortly'), {
          status: 503,
          code: 'OSIS_ARCHIVE_BUSY',
        });
      }
      await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
}

async function withManifestLock(directory, operation) {
  const { handle, lock } = await acquireManifestLock(directory);
  try {
    return await operation();
  } finally {
    await handle.close();
    await fs.rm(lock, { force: true });
  }
}

async function commitManifest(directory, manifest) {
  const target = manifestPath(directory);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx');
  try {
    await handle.writeFile(JSON.stringify(manifest, null, 2));
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function hashEvidenceReferences(evidencePaths = {}) {
  const references = [];
  for (const [kind, value] of Object.entries(evidencePaths)) {
    if (typeof value !== 'string' || !value) continue;
    const reference = { kind, path: path.resolve(value), archiveStatus: 'local_only' };
    try {
      const bytes = await fs.readFile(value);
      reference.bytes = bytes.length;
      reference.sha256 = sha256(bytes);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      reference.archiveStatus = 'missing';
    }
    references.push(reference);
  }
  return references;
}

async function archiveReport(report, options = {}) {
  if (!options.databasePersisted) {
    throw capacityError(
      'PostgreSQL persistence is required before archiving an incident report',
      'database_not_persisted'
    );
  }
  if (!report || !validId(report.id)) {
    throw Object.assign(new Error('Incident archive requires a valid report ID'), {
      status: 400,
      code: 'OSIS_ARCHIVE_INVALID_REPORT',
    });
  }

  const directory = path.resolve(options.archiveDirectory || archiveDirectory());
  const activeDirectory = path.resolve(options.reportDirectory || reportDirectory());
  if (directoriesOverlap(directory, activeDirectory)) {
    throw Object.assign(new Error('Incident archive must be separate from the active report directory'), {
      status: 500,
      code: 'OSIS_ARCHIVE_CONFIGURATION',
    });
  }

  const serialized = Buffer.from(JSON.stringify(report));
  const digest = sha256(serialized);
  const filename = `${report.id}-${digest}.json`;
  const destination = path.join(directory, filename);
  const evidenceReferences = await hashEvidenceReferences(options.evidencePaths);
  const durableEvidence = report.persistence?.objectStorage?.evidence || [];
  for (const reference of evidenceReferences) {
    const durable = durableEvidence.find(item => item.role === reference.kind);
    if (durable) {
      reference.objectStorage = durable;
      reference.archiveStatus = 'verified';
    }
  }
  let sourceStatus = 'not_provided';
  if (options.sourceReportPath) {
    try {
      await fs.access(options.sourceReportPath);
      sourceStatus = 'retained';
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      sourceStatus = 'not_created';
    }
  }

  try {
    return await withManifestLock(directory, async () => {
      const manifest = await readManifest(directory);
      const existing = manifest.records[report.id];
      if (existing?.sha256 === digest && existing.file === filename) {
        const archived = await fs.readFile(destination);
        if (sha256(archived) === digest) return existing;
        throw Object.assign(new Error('Archived incident checksum verification failed'), {
          status: 503,
          code: 'OSIS_ARCHIVE_CHECKSUM_MISMATCH',
        });
      }

      let archived;
      try {
        archived = await fs.readFile(destination);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (!archived) {
        const temporary = path.join(directory, `.${filename}.${randomUUID()}.tmp`);
        const handle = await fs.open(temporary, 'wx');
        try {
          await handle.writeFile(serialized);
          await handle.sync();
        } finally {
          await handle.close();
        }
        try {
          await fs.rename(temporary, destination);
        } finally {
          await fs.rm(temporary, { force: true });
        }
        archived = await fs.readFile(destination);
      }
      if (sha256(archived) !== digest) {
        throw Object.assign(new Error('Archived incident checksum verification failed'), {
          status: 503,
          code: 'OSIS_ARCHIVE_CHECKSUM_MISMATCH',
        });
      }

      const entry = {
        incidentId: report.id,
        sceneId: report.scene?.id || null,
        file: filename,
        sha256: digest,
        bytes: serialized.length,
        archiveStatus: 'verified',
        databaseStatus: 'persisted',
        sourceReport: options.sourceReportPath ? path.resolve(options.sourceReportPath) : null,
        sourceStatus,
        demoProtected: report.mode === 'DEMO' || report.scene?.source === 'synthetic_demo',
        objectStorage: report.persistence?.objectStorage || null,
        objectStorageStatus: report.persistence?.objectStorage ? 'verified' : 'not_configured',
        evidenceReferences,
        evidenceArchiveStatus: evidenceReferences.length
          ? (evidenceReferences.every(reference => reference.objectStorage) ? 'verified' : 'local_only')
          : 'not_provided',
        archivedAt: new Date().toISOString(),
      };
      manifest.records[report.id] = entry;
      await commitManifest(directory, manifest);
      return entry;
    });
  } catch (error) {
    if (error.code === 'OSIS_ARCHIVE_BUSY') {
      throw capacityError('Incident archive is busy; no source report or evidence was removed', 'archive_busy');
    }
    if (error.code === 'OSIS_ARCHIVE_UNAVAILABLE') {
      throw capacityError('Incident archive is unavailable; no source report or evidence was removed', 'archive_unavailable');
    }
    if (['ENOSPC', 'EDQUOT', 'EACCES', 'EROFS', 'ENOTDIR'].includes(error.code)) {
      throw capacityError(
        'Verified incident archive is unavailable; no source report or evidence was removed',
        `archive_${String(error.code).toLowerCase()}`
      );
    }
    throw error;
  }
}

async function readVerifiedArchiveReport(id, directory = archiveDirectory()) {
  if (!validId(id)) return null;
  const manifest = await readManifest(directory);
  const entry = manifest.records[id];
  if (!entry) return null;
  if (entry.archiveStatus !== 'verified' || entry.incidentId !== id ||
      typeof entry.file !== 'string' || path.basename(entry.file) !== entry.file ||
      !/^[0-9a-f-]{36}-[0-9a-f]{64}\.json$/i.test(entry.file)) {
    throw Object.assign(new Error('Incident archive manifest entry is invalid'), {
      status: 503,
      code: 'OSIS_ARCHIVE_MANIFEST_INVALID',
    });
  }
  const bytes = await fs.readFile(path.join(directory, entry.file));
  if (sha256(bytes) !== entry.sha256) {
    throw Object.assign(new Error('Archived incident checksum verification failed'), {
      status: 503,
      code: 'OSIS_ARCHIVE_CHECKSUM_MISMATCH',
    });
  }
  const report = JSON.parse(bytes.toString('utf8'));
  if (report.id !== id) {
    throw Object.assign(new Error('Archived incident ID does not match its manifest'), {
      status: 503,
      code: 'OSIS_ARCHIVE_MANIFEST_INVALID',
    });
  }
  return report;
}

async function listVerifiedArchiveReports(directory = archiveDirectory()) {
  const manifest = await readManifest(directory);
  const reports = [];
  for (const id of Object.keys(manifest.records)) {
    const report = await readVerifiedArchiveReport(id, directory);
    if (report) reports.push(report);
  }

  let entries = [];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const manifestedFiles = new Set(
    Object.values(manifest.records).map(record => record.file)
  );
  for (const entry of entries) {
    if (!entry.isFile() || !validId(entry.name.slice(0, -5)) ||
        !entry.name.endsWith('.json') || manifestedFiles.has(entry.name)) continue;
    const id = entry.name.slice(0, -5);
    const report = JSON.parse(await fs.readFile(path.join(directory, entry.name), 'utf8'));
    if (report.id === id) reports.push(report);
  }
  return reports;
}

async function capacityStatus(options = {}) {
  const reportDir = path.resolve(options.reportDirectory || reportDirectory());
  const archiveDir = path.resolve(options.archiveDirectory || archiveDirectory());
  const maxReports = options.maxReports || limits.maxReports;
  const reportCount = await countLocalReports(reportDir);
  let freeBytes = null;
  let storageError = null;
  try {
    const volume = await fs.statfs(reportDir);
    freeBytes = Number(volume.bavail) * Number(volume.bsize);
  } catch (error) {
    if (error.code !== 'ENOENT') storageError = 'free_space_unavailable';
    else {
      try {
        await fs.access(path.dirname(reportDir));
        const volume = await fs.statfs(path.dirname(reportDir));
        freeBytes = Number(volume.bavail) * Number(volume.bsize);
      } catch {
        storageError = 'free_space_unavailable';
      }
    }
  }

  const objectStorageService = require('./object-storage.service');
  const objectStorage = objectStorageService.configurationStatus();
  const databaseRequired = process.env.OSIS_PERSIST_POSTGRES === 'true';
  const databaseChecked = !databaseRequired || options.checkDatabase ||
    reportCount >= maxReports || objectStorage.provider === 'supabase';
  let databaseAvailable = !databaseRequired;
  if (databaseRequired && databaseChecked) {
    try {
      await pool.query('SELECT 1');
      databaseAvailable = true;
    } catch {
      databaseAvailable = false;
    }
  } else if (databaseRequired) {
    databaseAvailable = true;
  }

  let objectStorageAvailable = objectStorage.configured;
  if (objectStorageAvailable && objectStorage.provider === 'supabase') {
    try {
      await objectStorageService.configuredAdapter().check();
    } catch {
      objectStorageAvailable = false;
    }
  }
  let archiveAvailable = false;
  if (databaseRequired && reportCount >= maxReports && databaseAvailable) {
    try {
      if (directoriesOverlap(archiveDir, reportDir)) throw new Error('Archive and report directories overlap');
      await fs.access(archiveDir, fsConstants.W_OK);
      await readManifest(archiveDir);
      archiveAvailable = true;
    } catch {
      archiveAvailable = false;
    }
  }
  const minimumFreeBytes = limits.minFreeStorageBytes;
  const lowSpace = freeBytes === null || freeBytes < minimumFreeBytes;
  let reason = null;
  if (storageError) reason = storageError;
  else if (lowSpace) reason = 'low_free_space';
  else if (databaseRequired && !databaseAvailable) reason = 'database_unavailable';
  else if (!objectStorage.configured) reason = objectStorage.reason;
  else if (!objectStorageAvailable) reason = 'object_storage_unavailable';
  else if (reportCount >= maxReports && !archiveAvailable) reason = 'report_capacity';

  const recoveryByReason = {
    free_space_unavailable: 'Restore access to the report volume so free space can be measured.',
    low_free_space: 'Free or add disk space until free space exceeds OSIS_MIN_FREE_SPACE_MIB.',
    database_unavailable: 'Restore PostgreSQL connectivity and verify OSIS_PERSIST_POSTGRES=true.',
    report_capacity: 'Enable and verify PostgreSQL persistence and a writable OSIS_REPORT_ARCHIVE_DIR, or explicitly reduce the queued workload.',
    object_storage_configuration: objectStorage.message || 'Complete the selected object-storage configuration before admitting new work.',
    object_storage_unavailable: 'Restore access to the configured Supabase Storage bucket and verify its private bucket permissions.',
  };
  const localReportCapacityAvailable = reportCount < maxReports;
  return {
    accepting: reason === null,
    status: reason ? 'paused' : 'ready',
    reason,
    reportCount,
    maxReports,
    localReportCapacityAvailable,
    overflowArchiveRequired: !localReportCapacityAvailable,
    admissionMode: reason ? null : (localReportCapacityAvailable ? 'local_report' : 'verified_archive'),
    freeBytes,
    minimumFreeBytes,
    databaseRequired,
    databaseAvailable,
    databaseChecked,
    archiveAvailable,
    objectStorageProvider: objectStorage.provider,
    objectStorageConfigured: objectStorage.configured,
    objectStorageAvailable,
    archiveDirectory: archiveDir,
    rawEvidenceDeletionEnabled: false,
    recovery: reason ? recoveryByReason[reason] : null,
  };
}

async function readLegacyArchiveReport(id, directory = archiveDirectory()) {
  if (!validId(id)) return null;
  try {
    const report = JSON.parse(await fs.readFile(path.join(directory, `${id}.json`), 'utf8'));
    return report.id === id ? report : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

module.exports = {
  archiveReport,
  capacityStatus,
  countLocalReports,
  listVerifiedArchiveReports,
  readLegacyArchiveReport,
  readVerifiedArchiveReport,
  reportDirectory,
  archiveDirectory,
  validId,
};
