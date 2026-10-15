'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const pool = require('../src/config/db');
const retention = require('../src/services/retention.service');
const archiveService = require('../src/services/incident-archive.service');

const validId = id => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id);
const roots = {
    reports: path.resolve(process.env.OSIS_REPORT_DIR || path.resolve(__dirname, '../data/incidents')),
    archive: archiveService.archiveDirectory(),
    scenes: path.resolve(process.env.OSIS_SCENES_DIR || path.resolve(__dirname, '../data/scenes')),
    fixtures: path.resolve(__dirname, '../data/sentinel-test'),
    seeds: path.resolve(process.env.OSIS_SEED_DIR || path.resolve(__dirname, '../data/seed-incidents')),
};

async function inventory(directory) {
    const result = { files: 0, bytes: 0, json: 0, tiffs: 0, other: 0 };
    async function walk(current) {
        let entries;
        try {
            entries = await fs.readdir(current, { withFileTypes: true });
        } catch (error) {
            if (error.code === 'ENOENT') return;
            throw error;
        }
        for (const entry of entries) {
            const absolute = path.join(current, entry.name);
            if (entry.isDirectory()) {
                await walk(absolute);
                continue;
            }
            if (!entry.isFile()) continue;
            const stat = await fs.stat(absolute);
            result.files++;
            result.bytes += stat.size;
            if (entry.name.endsWith('.json')) result.json++;
            else if (/\.(tif|tiff)$/i.test(entry.name)) result.tiffs++;
            else result.other++;
        }
    }
    await walk(directory);
    return result;
}

async function reportFiles(directory) {
    let names = [];
    try {
        names = await fs.readdir(directory);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const records = [];
    for (const name of names.filter(file => file.endsWith('.json') && validId(file.slice(0, -5)))) {
        try {
            const report = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
            records.push({
                id: report.id,
                sceneId: report.scene?.id || null,
                mode: report.mode || 'unspecified',
                valid: report.id === name.slice(0, -5),
            });
        } catch {
            records.push({ id: name.slice(0, -5), sceneId: null, mode: 'unreadable', valid: false });
        }
    }
    return records;
}

async function verifiedManifest() {
    const directory = roots.archive;
    let manifest;
    try {
        manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') return new Set();
        throw new Error('Archive manifest cannot be safely classified');
    }
    if (manifest.version !== 1 || !manifest.records || typeof manifest.records !== 'object') {
        throw new Error('Archive manifest cannot be safely classified');
    }
    const verified = new Set();
    for (const [id, record] of Object.entries(manifest.records)) {
        if (!validId(id) || record.archiveStatus !== 'verified' ||
            path.basename(record.file || '') !== record.file) continue;
        const bytes = await fs.readFile(path.join(directory, record.file));
        const checksum = createHash('sha256').update(bytes).digest('hex');
        if (checksum === record.sha256) verified.add(id);
    }
    return verified;
}

async function main() {
    const results = {};
    for (const [name, directory] of Object.entries(roots)) {
        results[name] = { path: directory, ...(await inventory(directory)) };
    }

    const localReports = await reportFiles(roots.reports);
    const archivedReports = await reportFiles(roots.archive);
    const reports = [...localReports, ...archivedReports];
    const ids = [...new Set(reports.filter(r => validId(r.id)).map(r => r.id))];
    const sceneIds = [...new Set(reports.map(r => r.sceneId).filter(Boolean))];
    const manifestIds = await verifiedManifest();
    let database = { reachable: false, incidentReferences: 0, sceneArtifactReferences: 0, errorCode: null };
    const incidentRefs = new Set();
    const sceneArtifactRefs = new Set();

    try {
        const incidentResult = await pool.query(
            `SELECT id::text AS id, scene_id
               FROM osis_incidents
              WHERE id = ANY($1::uuid[]) OR scene_id = ANY($2::text[])`,
            [ids, sceneIds],
        );
        for (const row of incidentResult.rows) {
            incidentRefs.add(row.id);
            if (row.scene_id) sceneArtifactRefs.add(row.scene_id);
        }
        const sceneResult = await pool.query(
            `SELECT scene_id
               FROM processed_scenes
              WHERE scene_id = ANY($1::text[]) AND artifact_metadata IS NOT NULL`,
            [sceneIds],
        );
        for (const row of sceneResult.rows) sceneArtifactRefs.add(row.scene_id);
        database = {
            reachable: true,
            incidentReferences: incidentRefs.size,
            sceneArtifactReferences: sceneArtifactRefs.size,
            errorCode: null,
        };
    } catch (error) {
        database.errorCode = error.code || error.name || 'unavailable';
    }

    const reportClassification = {
        valid: 0,
        unreadable: 0,
        demoProtected: 0,
        databaseReferenced: 0,
        verifiedArchiveCopies: 0,
        notDatabaseReferenced: 0,
        noVerifiedArchiveCopy: 0,
        reclaimableFiles: 0,
        reclaimableBytes: 0,
    };
    for (const report of localReports) {
        if (!report.valid) {
            reportClassification.unreadable++;
            continue;
        }
        reportClassification.valid++;
        const isDemo = report.mode === 'DEMO';
        const dbReferenced = incidentRefs.has(report.id);
        const archived = manifestIds.has(report.id);
        if (isDemo) reportClassification.demoProtected++;
        if (dbReferenced) reportClassification.databaseReferenced++;
        else reportClassification.notDatabaseReferenced++;
        if (archived) reportClassification.verifiedArchiveCopies++;
        else reportClassification.noVerifiedArchiveCopy++;
    }

    let tempSweep;
    let tempReclaimableBytes = 0;
    try {
        tempSweep = await retention.cleanupStaleArtifacts(os.tmpdir(), 'osis-', { dryRun: true });
        for (const line of tempSweep.logs) {
            const candidate = line.match(/Would delete verified stale directory: (.*)$/)?.[1];
            if (candidate) tempReclaimableBytes += (await inventory(candidate)).bytes;
        }
    } catch (error) {
        tempSweep = { errors: 1, errorCode: error.code || error.name || 'unavailable' };
    }

    console.log(JSON.stringify({
        dryRun: true,
        destructiveActions: 0,
        roots: results,
        incidentReports: {
            localCount: localReports.length,
            archiveLegacyCount: archivedReports.length,
            classification: reportClassification,
            policy: 'No existing incident report is eligible for deletion by this dry-run.',
        },
        database,
        sceneEvidence: {
            processedSceneReferences: sceneArtifactRefs.size,
            policy: 'Scene rasters and detector evidence are protected; no object-storage archive is configured.',
            reclaimableBytes: 0,
        },
        temporaryArtifacts: {
            ...tempSweep,
            reclaimableBytes: tempReclaimableBytes,
        },
        totalEstimatedReclaimableBytes: tempReclaimableBytes,
    }, null, 2));
    await pool.end();
}

main().catch(async error => {
    console.error(`[retention-dry-run] blocked: ${error.code || error.name || 'error'}`);
    await pool.end();
    process.exitCode = 1;
});
