'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const pool = require('../src/config/db');
const archive = require('../src/services/incident-archive.service');

const id = '11111111-1111-4111-8111-111111111111';
const report = (overrides = {}) => ({
    id,
    mode: 'DEMO',
    status: 'completed',
    outcome: 'NO_SPILL_DETECTED',
    scene: { id: 'demo-no-spill', source: 'synthetic_demo' },
    ...overrides,
});

test('verified report archive is checksummed, idempotent and preserves its source', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'osis-report-archive-'));
    const sourceDir = path.join(root, 'incidents');
    const archiveDir = path.join(root, 'archive');
    await fs.mkdir(sourceDir);
    const sourcePath = path.join(sourceDir, `${id}.json`);
    const evidencePath = path.join(sourceDir, 'vv.tif');
    await fs.writeFile(sourcePath, JSON.stringify(report()));
    await fs.writeFile(evidencePath, 'verified source evidence');
    try {
        await assert.rejects(
            archive.archiveReport(report(), {
                archiveDirectory: archiveDir,
                reportDirectory: sourceDir,
                sourceReportPath: sourcePath,
                evidencePaths: { vv: evidencePath },
                databasePersisted: false,
            }),
            { code: 'OSIS_STORAGE_CAPACITY' },
        );
        const first = await archive.archiveReport(report(), {
            archiveDirectory: archiveDir,
            reportDirectory: sourceDir,
            sourceReportPath: sourcePath,
            evidencePaths: { vv: evidencePath },
            databasePersisted: true,
        });
        const second = await archive.archiveReport(report(), {
            archiveDirectory: archiveDir,
            reportDirectory: sourceDir,
            sourceReportPath: sourcePath,
            evidencePaths: { vv: evidencePath },
            databasePersisted: true,
        });
        assert.equal(first.sha256, second.sha256);
        assert.equal(first.archiveStatus, 'verified');
        assert.equal(first.demoProtected, true);
        assert.equal(first.sourceStatus, 'retained');
        assert.equal(first.sceneId, 'demo-no-spill');
        assert.equal(first.databaseStatus, 'persisted');
        assert.equal(first.evidenceReferences[0].archiveStatus, 'local_only');
        assert.ok(first.evidenceReferences[0].sha256);
        assert.deepEqual(await archive.readVerifiedArchiveReport(id, archiveDir), report());
        await fs.access(sourcePath);
        assert.equal(await fs.readFile(evidencePath, 'utf8'), 'verified source evidence');

        const entries = await fs.readdir(archiveDir);
        assert.equal(entries.filter(name => name !== 'manifest.json' && name.endsWith('.json')).length, 1);
        const manifest = JSON.parse(await fs.readFile(path.join(archiveDir, 'manifest.json'), 'utf8'));
        assert.deepEqual(Object.keys(manifest.records), [id]);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('partial archive failure preserves source and succeeds on retry', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'osis-report-archive-retry-'));
    const sourceDir = path.join(root, 'incidents');
    const brokenArchive = path.join(root, 'not-a-directory');
    await fs.mkdir(sourceDir);
    const sourcePath = path.join(sourceDir, `${id}.json`);
    await fs.writeFile(sourcePath, JSON.stringify(report()));
    await fs.writeFile(brokenArchive, 'operator data');
    try {
        await assert.rejects(
            archive.archiveReport(report(), {
                archiveDirectory: brokenArchive,
                reportDirectory: sourceDir,
                sourceReportPath: sourcePath,
                databasePersisted: true,
            }),
        );
        assert.deepEqual(JSON.parse(await fs.readFile(sourcePath, 'utf8')), report());
        assert.equal(await fs.readFile(brokenArchive, 'utf8'), 'operator data');

        const archiveDir = path.join(root, 'archive');
        const saved = await archive.archiveReport(report(), {
            archiveDirectory: archiveDir,
            reportDirectory: sourceDir,
            sourceReportPath: sourcePath,
            databasePersisted: true,
        });
        assert.equal(saved.archiveStatus, 'verified');
        assert.deepEqual(await archive.readVerifiedArchiveReport(id, archiveDir), report());
        await fs.access(sourcePath);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('concurrent archive attempts produce one manifest record and valid report bytes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'osis-report-archive-concurrent-'));
    const archiveDir = path.join(root, 'archive');
    try {
        const results = await Promise.all(Array.from({ length: 4 }, () =>
            archive.archiveReport(report(), {
                archiveDirectory: archiveDir,
                reportDirectory: path.join(root, 'incidents'),
                databasePersisted: true,
            })
        ));
        assert.equal(new Set(results.map(entry => entry.sha256)).size, 1);
        assert.deepEqual(await archive.readVerifiedArchiveReport(id, archiveDir), report());
        const manifest = JSON.parse(await fs.readFile(path.join(archiveDir, 'manifest.json'), 'utf8'));
        assert.deepEqual(Object.keys(manifest.records), [id]);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('report capacity pauses without database-backed verified archive and resumes when available', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'osis-report-capacity-'));
    const reportDir = path.join(root, 'incidents');
    const archiveDir = path.join(root, 'archive');
    await fs.mkdir(reportDir);
    await fs.mkdir(archiveDir);
    await fs.writeFile(path.join(reportDir, `${id}.json`), JSON.stringify(report()));
    const originalPersistence = process.env.OSIS_PERSIST_POSTGRES;
    const originalQuery = pool.query;
    try {
        process.env.OSIS_PERSIST_POSTGRES = 'false';
        const paused = await archive.capacityStatus({
            reportDirectory: reportDir,
            archiveDirectory: archiveDir,
            maxReports: 1,
        });
        assert.equal(paused.accepting, false);
        assert.equal(paused.reason, 'report_capacity');

        process.env.OSIS_PERSIST_POSTGRES = 'true';
        pool.query = async () => ({ rows: [{ '?column?': 1 }] });
        const resumed = await archive.capacityStatus({
            reportDirectory: reportDir,
            archiveDirectory: archiveDir,
            maxReports: 1,
            checkDatabase: true,
        });
        assert.equal(resumed.accepting, true);
        assert.equal(resumed.archiveAvailable, true);
        assert.equal(resumed.admissionMode, 'verified_archive');
        assert.equal(resumed.localReportCapacityAvailable, false);
    } finally {
        pool.query = originalQuery;
        if (originalPersistence === undefined) delete process.env.OSIS_PERSIST_POSTGRES;
        else process.env.OSIS_PERSIST_POSTGRES = originalPersistence;
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('102 existing reports stay protected and new admission is explicitly routed through verified archive', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'osis-report-capacity-overflow-'));
    const reportDir = path.join(root, 'incidents');
    const archiveDir = path.join(root, 'archive');
    await fs.mkdir(reportDir);
    await fs.mkdir(archiveDir);
    for (let index = 0; index < 102; index++) {
        const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
        await fs.writeFile(path.join(reportDir, `${id}.json`), '{}');
    }
    const originalPersistence = process.env.OSIS_PERSIST_POSTGRES;
    const originalProvider = process.env.OSIS_OBJECT_STORAGE_PROVIDER;
    const originalQuery = pool.query;
    try {
        process.env.OSIS_PERSIST_POSTGRES = 'true';
        process.env.OSIS_OBJECT_STORAGE_PROVIDER = 'local';
        pool.query = async () => ({ rows: [{ '?column?': 1 }] });
        const status = await archive.capacityStatus({
            reportDirectory: reportDir,
            archiveDirectory: archiveDir,
            maxReports: 100,
        });
        assert.equal(status.reportCount, 102);
        assert.equal(status.maxReports, 100);
        assert.equal(status.localReportCapacityAvailable, false);
        assert.equal(status.overflowArchiveRequired, true);
        assert.equal(status.archiveAvailable, true);
        assert.equal(status.admissionMode, 'verified_archive');
        assert.equal(status.accepting, true);

        const blocked = await archive.capacityStatus({
            reportDirectory: reportDir,
            archiveDirectory: path.join(root, 'missing-archive'),
            maxReports: 100,
        });
        assert.equal(blocked.accepting, false);
        assert.equal(blocked.reason, 'report_capacity');
        assert.equal(blocked.admissionMode, null);
    } finally {
        pool.query = originalQuery;
        if (originalPersistence === undefined) delete process.env.OSIS_PERSIST_POSTGRES;
        else process.env.OSIS_PERSIST_POSTGRES = originalPersistence;
        if (originalProvider === undefined) delete process.env.OSIS_OBJECT_STORAGE_PROVIDER;
        else process.env.OSIS_OBJECT_STORAGE_PROVIDER = originalProvider;
        await fs.rm(root, { recursive: true, force: true });
    }
});
