'use strict';

const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const archivedScenes = require('../../data/real-scenes.json');
const limits = require('./resource-limits');
const sarInput = require('./sar-input.service');
const incidentArchive = require('./incident-archive.service');
const objectStorage = require('./object-storage.service');

const directory = () =>
    process.env.OSIS_REPORT_DIR ||
    path.resolve(__dirname, '../../data/incidents');
const seedDirectory = () =>
    process.env.OSIS_SEED_DIR ||
    path.resolve(__dirname, '../../data/seed-incidents');
const validId = (id) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id);
let active = 0;
let admissionWindow = Date.now(),
    admissions = 0,
    saves = 0;

function runPipeline(input) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.env.PYTHON_PATH || 'python',
            [
                path.resolve(
                    __dirname,
                    input.mode !== 'DEMO'
                        ? '../../scripts/real_incident_pipeline.py'
                        : '../../scripts/incident_pipeline.py',
                ),
            ],
            {
                windowsHide: true,
                shell: false,
                env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
            },
        );
        let output = '',
            bytes = 0,
            settled = false;
        const terminate = () => {
            if (process.platform === 'win32' && child.pid) {
                const killer = spawn(
                    'taskkill',
                    ['/PID', String(child.pid), '/T', '/F'],
                    { windowsHide: true, stdio: 'ignore' },
                );
                killer.on('error', () => child.kill());
            } else child.kill();
        };
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            error ? reject(error) : resolve(value);
        };
        const timer = setTimeout(() => {
            terminate();
            finish(
                Object.assign(
                    new Error(
                        `Analysis exceeded the ${limits.requestMs / 1000} second processing limit`,
                    ),
                    { status: 504 },
                ),
            );
        }, limits.requestMs);
        child.on('error', () =>
            finish(
                Object.assign(
                    new Error(
                        'Python unavailable. Install Python 3.10+ or set PYTHON_PATH.',
                    ),
                    { status: 503 },
                ),
            ),
        );
        child.stdout.on('data', (data) => {
            bytes += data.length;
            if (bytes > 8 * 1024 * 1024) {
                terminate();
                finish(new Error('Pipeline output exceeded safety limit'));
            } else output += data.toString();
        });
        // Do not echo arbitrary process output or credentials to API clients/logs.
        child.stderr.on('data', (data) => console.error('[PYTHON STDERR]', data.toString()));
        child.stdin.on('error', () => {});
        child.on('close', (code) => {
            if (code !== 0)
                return finish(
                    Object.assign(
                        new Error(
                            'Scientific pipeline failed validation or processing',
                        ),
                        { status: 422 },
                    ),
                );
            try {
                const result = JSON.parse(output);
                if (
                    !['completed', 'no_candidates', 'partial'].includes(
                        result.status,
                    ) ||
                    ![
                        'SPILL_DETECTED',
                        'NO_SPILL_DETECTED',
                        'ANALYSIS_INCONCLUSIVE',
                    ].includes(result.outcome)
                )
                    throw new Error('Invalid pipeline output');
                finish(null, result);
            } catch {
                finish(new Error('Scientific pipeline returned invalid JSON'));
            }
        });
        child.stdin.end(JSON.stringify(input));
    });
}

async function save(report, evidencePaths = {}) {
    saves++;
    let temporary;
    try {
        await fs.mkdir(directory(), { recursive: true });
        const destination = path.join(directory(), `${report.id}.json`);
        const existingPath = await fs.access(destination).then(() => true).catch(error => {
            if (error.code === 'ENOENT') return false;
            throw error;
        });
        if (existingPath) {
            const existing = await fs.readFile(destination);
            const current = Buffer.from(JSON.stringify(report));
            if (existing.equals(current)) return 'local_json';
            if (report.persistence?.database === 'mirrored') {
                await incidentArchive.archiveReport(report, {
                    databasePersisted: true,
                    reportDirectory: directory(),
                    sourceReportPath: destination,
                    evidencePaths,
                });
                return 'verified_archive';
            }
            throw Object.assign(new Error('Incident ID already exists with different report content'), {
                status: 409,
                code: 'OSIS_REPORT_ID_CONFLICT',
            });
        }
        const files = (await fs.readdir(directory())).filter(
            (f) => f.endsWith('.json') && validId(f.slice(0, -5)),
        );
        if (files.length + saves > limits.maxReports) {
            const existingCount = files.length;
            if (process.env.OSIS_PERSIST_POSTGRES === 'true') {
                await incidentArchive.archiveReport(report, {
                    databasePersisted: report.persistence?.database === 'mirrored',
                    reportDirectory: directory(),
                    sourceReportPath: path.join(directory(), `${report.id}.json`),
                    evidencePaths,
                });
                return 'verified_archive';
            }
            throw Object.assign(
                new Error(
                    `Local report capacity reached (${existingCount}/${limits.maxReports}); archive and PostgreSQL persistence are required before processing can resume.`,
                ),
                {
                    status: 507,
                    code: 'OSIS_STORAGE_CAPACITY',
                    storageReason: 'report_capacity',
                },
            );
        }
        temporary = `${destination}.tmp`;
        await fs.writeFile(temporary, JSON.stringify(report), { flag: 'wx' });
        await fs.rename(temporary, destination);
        return 'local_json';
    } finally {
        saves--;
        if (temporary) await fs.rm(temporary, { force: true });
    }
}

async function analyze(input = {}, trusted = null) {
    if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).some(
            (k) =>
                ![
                    'mode',
                    'sceneId',
                    'forecastHours',
                    'hindcastHours',
                    'detector',
                    'onDemand',
                ].includes(k),
        )
    ) {
        throw Object.assign(new Error('Unsupported analysis options'), {
            status: 400,
        });
    }
    const mode = input.mode ?? 'DEMO';
    if (!['DEMO', 'REAL'].includes(mode) && !(mode === 'UPLOAD' && trusted))
        throw Object.assign(
            new Error('Use DEMO, REAL or the UPLOAD endpoint'),
            { status: 400 },
        );
    const sceneId = input.sceneId ?? 'demo-arabian-sea';
    const forecastHours = input.forecastHours ?? 24;
    if (
        mode === 'REAL'
            ? !trusted && !archivedScenes.some((s) => s.id === sceneId)
            : mode === 'DEMO' &&
              ![
                  'demo-arabian-sea',
                  'demo-no-spill',
                  'demo-inconclusive',
              ].includes(sceneId)
    ) {
        throw Object.assign(new Error('Unknown scene for selected mode'), {
            status: 400,
        });
    }
    const hindcastHours = input.hindcastHours ?? 6;
    const detector = input.detector ?? 'hybrid';
    if (mode === 'DEMO' && ('hindcastHours' in input || 'detector' in input)) {
        throw Object.assign(
            new Error('Detector/scenario selection is REAL-only'),
            { status: 400 },
        );
    }
    if (
        mode === 'REAL' &&
        (!['hybrid', 'classical'].includes(detector) ||
            typeof hindcastHours !== 'number' ||
            !Number.isFinite(hindcastHours) ||
            hindcastHours < 1 ||
            hindcastHours > 48)
    ) {
        throw Object.assign(
            new Error(
                'REAL requires hybrid/classical detector and 1–48 hindcast hours',
            ),
            { status: 400 },
        );
    }
    if (![24, 48, 72].includes(forecastHours)) {
        throw Object.assign(
            new Error('forecastHours must be the number 24, 48 or 72'),
            { status: 400 },
        );
    }
    if (
        input.onDemand !== undefined &&
        (mode !== 'REAL' || typeof input.onDemand !== 'boolean')
    )
        throw Object.assign(new Error('onDemand is a REAL boolean option'), {
            status: 400,
        });
    const admission = await incidentArchive.capacityStatus({
        checkDatabase: mode === 'REAL' && trusted !== null,
    });
    if (!admission.accepting) {
        throw Object.assign(
            new Error(
                `Processing paused for storage capacity (${admission.reason}); preserve the durable queue and follow the storage recovery procedure.`,
            ),
            {
                status: 507,
                code: 'OSIS_STORAGE_CAPACITY',
                storageReason: admission.reason,
            },
        );
    }
    if (active >= limits.analyses)
        throw Object.assign(
            new Error('Analysis capacity reached; retry shortly'),
            { status: 429 },
        );
    if (Date.now() - admissionWindow >= 60000) {
        admissionWindow = Date.now();
        admissions = 0;
    }
    if (admissions >= limits.analysesPerMinute)
        throw Object.assign(
            new Error('Analysis request budget reached; retry in one minute'),
            { status: 429 },
        );
    admissions++;
    active++;
    const id = randomUUID();
    console.info(
        `[incident ${id}] analysis started (${forecastHours}h, ${mode})`,
    );
    try {
        if (mode === 'REAL' && input.onDemand)
            trusted = await sarInput.onDemand(
                archivedScenes.find((s) => s.id === sceneId),
            );
        const pipelineInput = {
            mode,
            sceneId,
            forecastHours,
            detector,
            hindcastHours,
            ...(trusted
                ? {
                      _scene: trusted._scene,
                      _paths: trusted._paths,
                      _unavailable: trusted._unavailable,
                  }
                : {}),
        };

        if (mode === 'REAL') {
            const isOfflineReplay = !trusted && archivedScenes.some((s) => s.id === sceneId);
            pipelineInput.ais_mode = isOfflineReplay ? 'OFFLINE_REPLAY' : 'LIVE';

            if (pipelineInput.ais_mode === 'LIVE') {
                if (process.env.AIS_AUTOSTART === 'true') {
                    try {
                        const pool = require('../config/db');
                        const sceneMeta = trusted ? trusted._scene : archivedScenes.find((s) => s.id === sceneId);
                        if (sceneMeta && sceneMeta.acquiredAt && sceneMeta.bbox) {
                            const end = new Date(sceneMeta.acquiredAt);
                            const windowHalfWidthHours = 1;
                            const start = new Date(end.getTime() - ((hindcastHours + windowHalfWidthHours) * 3600000));
                            const [west, south, east, north] = sceneMeta.bbox;
                            const res = await pool.query(
                                `SELECT mmsi, timestamp, ST_Y(geom) as latitude, ST_X(geom) as longitude, speed, course 
                                 FROM live_ais 
                                 WHERE timestamp >= $1 AND timestamp <= $2 
                                 AND geom && ST_MakeEnvelope($3, $4, $5, $6, 4326)`,
                                [start.toISOString(), end.toISOString(), west - 0.5, south - 0.5, east + 0.5, north + 0.5]
                            );
                            pipelineInput.live_ais_records = res.rows.map(r => ({
                                mmsi: r.mmsi,
                                timestamp: r.timestamp.toISOString(),
                                latitude: r.latitude,
                                longitude: r.longitude,
                                speed: r.speed !== undefined ? r.speed : null,
                                course: r.course !== undefined ? r.course : null
                            }));
                        } else {
                            pipelineInput.live_ais_records = [];
                        }
                    } catch (err) {
                        console.error(`[incident ${id}] Live AIS query failed:`, err.message);
                        pipelineInput.live_ais_records = null;
                    }
                } else {
                    pipelineInput.live_ais_records = null;
                }
            }
        }

        const result = await runPipeline(pipelineInput);
        const report = {
            ...result,
            mode,
            id,
            detectedAt: new Date().toISOString(),
            processedAt: new Date().toISOString(),
            persistence: { local: 'durable_json', database: 'disabled' },
        };
        const evidencePaths = trusted?._paths || {};
        if (process.env.OSIS_PERSIST_POSTGRES === 'true') {
            try {
                const pool = require('../config/db');
                report.persistence.database = 'mirrored';
                const pgResult = await pool.query(
                    `INSERT INTO osis_incidents(id, scene_id, detected_at, image_at, spill_geom, origin_geom, report)
           VALUES ($1,$2,$3,$4,ST_SetSRID(ST_GeomFromGeoJSON($5),4326),
                   ST_SetSRID(ST_GeomFromGeoJSON($6),4326),$7::jsonb)
           ON CONFLICT (scene_id) DO UPDATE SET 
               detected_at = EXCLUDED.detected_at, 
               image_at = EXCLUDED.image_at, 
               spill_geom = EXCLUDED.spill_geom, 
               origin_geom = EXCLUDED.origin_geom, 
               report = EXCLUDED.report
           RETURNING id`,
                    [
                        id,
                        sceneId,
                        report.detectedAt,
                        report.scene.acquiredAt || null,
                        report.spill
                            ? JSON.stringify(report.spill.geometry)
                            : null,
                        report.origin
                            ? JSON.stringify(report.origin.geometry)
                            : null,
                        JSON.stringify(report),
                    ],
                );
                if (pgResult.rows.length > 0) {
                    report.id = pgResult.rows[0].id;
                    await pool.query(
                        'UPDATE osis_incidents SET report = $2::jsonb WHERE id = $1',
                        [report.id, JSON.stringify(report)],
                    );
                }
            } catch (err) {
                if ((mode === 'REAL' && trusted) || objectStorage.isCloudMode()) {
                    throw Object.assign(
                        new Error('PostgreSQL persistence failed; scene remains queued for retry.'),
                        {
                            status: 503,
                            code: 'OSIS_STORAGE_CAPACITY',
                            storageReason: 'database_unavailable',
                        },
                    );
                }
                console.error(
                    `[incident ${id}] Database persistence error:`,
                    String(err.code || err.name || 'database error'),
                );
                report.persistence.database = 'unavailable_local_fallback';
                console.warn(
                    `[incident ${id}] database mirror unavailable; retaining local report`,
                );
            }
        }
        if (objectStorage.isCloudMode()) {
            try {
                await objectStorage.persistReportArtifacts(
                    report,
                    evidencePaths,
                    { processedSceneId: trusted?._processedSceneId },
                );
            } catch (storageError) {
                try {
                    await save(report, evidencePaths);
                } catch (localError) {
                    const failure = new AggregateError(
                        [storageError, localError],
                        'Cloud storage failed and the local report could not be saved',
                        { cause: storageError },
                    );
                    Object.assign(failure, {
                        code: 'OSIS_STORAGE_CAPACITY',
                        status: 503,
                        storageReason: storageError.storageReason || 'object_storage_upload',
                    });
                    throw failure;
                }
                throw storageError;
            }
        }
        await save(report, evidencePaths);
        console.info(
            `[incident ${id}] ${report.status}; ${report.stages?.length || 0} stages`,
        );
        return report;
    } finally {
        active--;
    }
}

async function get(id) {
    if (!validId(id))
        throw Object.assign(new Error('Invalid incident ID'), { status: 400 });
    const archived = await incidentArchive.readVerifiedArchiveReport(id);
    if (archived) return archived;
    try {
        return JSON.parse(
            await fs.readFile(path.join(directory(), `${id}.json`), 'utf8'),
        );
    } catch (error) {
        if (error.code === 'ENOENT') {
            const legacyArchived = await incidentArchive.readLegacyArchiveReport(id);
            if (legacyArchived) return legacyArchived;
            try {
                return JSON.parse(
                    await fs.readFile(
                        path.join(seedDirectory(), `${id}.json`),
                        'utf8',
                    ),
                );
            } catch (seedError) {
                if (seedError.code === 'ENOENT')
                    throw Object.assign(new Error('Incident not found'), {
                        status: 404,
                    });
                throw seedError;
            }
        }
        throw error;
    }
}

async function list() {
    let files = [];
    try {
        files = await fs.readdir(directory());
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const reports = [];
    const seenIds = new Set();
    const seenSceneIds = new Set();

    for (const file of files
        .filter((f) => f.endsWith('.json') && validId(f.slice(0, -5)))) {
        let r;
        try {
            r = await get(file.slice(0, -5));
        } catch {
            continue;
        } // One corrupt archive must not blank history.
        seenIds.add(r.id);
        if (r.scene?.id) seenSceneIds.add(r.scene.id);
        reports.push({
            id: r.id,
            detectedAt: r.detectedAt,
            sceneId: r.scene.id,
            acquiredAt: r.scene.acquiredAt,
            status: r.status,
            outcome: r.outcome,
            forecastHours: r.forecastHours,
            leadingCandidate: r.leadingCandidate || null,
            source: r.scene.source,
            mode: r.mode || 'DEMO',
        });
    }

    const archivedReports = await incidentArchive.listVerifiedArchiveReports();
    for (const r of archivedReports) {
        if (seenIds.has(r.id) || (r.scene?.id && seenSceneIds.has(r.scene.id))) continue;
        seenIds.add(r.id);
        if (r.scene?.id) seenSceneIds.add(r.scene.id);
        reports.push({
            id: r.id,
            detectedAt: r.detectedAt,
            sceneId: r.scene.id,
            acquiredAt: r.scene.acquiredAt,
            status: r.status,
            outcome: r.outcome,
            forecastHours: r.forecastHours,
            leadingCandidate: r.leadingCandidate || null,
            source: r.scene.source,
            mode: r.mode || 'DEMO',
        });
    }

    let legacyArchiveFiles = [];
    try {
        legacyArchiveFiles = await fs.readdir(incidentArchive.archiveDirectory());
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    for (const file of legacyArchiveFiles.filter(
        f => f.endsWith('.json') && validId(f.slice(0, -5)),
    )) {
        const id = file.slice(0, -5);
        if (seenIds.has(id)) continue;
        const r = await incidentArchive.readLegacyArchiveReport(id);
        if (!r || (r.scene?.id && seenSceneIds.has(r.scene.id))) continue;
        seenIds.add(r.id);
        if (r.scene?.id) seenSceneIds.add(r.scene.id);
        reports.push({
            id: r.id,
            detectedAt: r.detectedAt,
            sceneId: r.scene.id,
            acquiredAt: r.scene.acquiredAt,
            status: r.status,
            outcome: r.outcome,
            forecastHours: r.forecastHours,
            leadingCandidate: r.leadingCandidate || null,
            source: r.scene.source,
            mode: r.mode || 'DEMO',
        });
    }

    // Baseline fallback: if any core scenario is missing from runtime reports,
    // supplement from seed fixtures without permanently writing to runtime storage.
    let seedFiles = [];
    try {
        seedFiles = await fs.readdir(seedDirectory());
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }

    for (const file of seedFiles.filter(
        (f) => f.endsWith('.json') && validId(f.slice(0, -5)),
    )) {
        const id = file.slice(0, -5);
        if (seenIds.has(id)) continue;
        let r;
        try {
            r = JSON.parse(
                await fs.readFile(path.join(seedDirectory(), file), 'utf8'),
            );
        } catch {
            continue;
        }
        if (r.scene?.id && seenSceneIds.has(r.scene.id)) continue;

        seenIds.add(r.id);
        if (r.scene?.id) seenSceneIds.add(r.scene.id);
        reports.push({
            id: r.id,
            detectedAt: r.detectedAt,
            sceneId: r.scene.id,
            acquiredAt: r.scene.acquiredAt,
            status: r.status,
            outcome: r.outcome,
            forecastHours: r.forecastHours,
            leadingCandidate: r.leadingCandidate || null,
            source: r.scene.source,
            mode: r.mode || 'DEMO',
        });
    }

    return reports.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
}

const scenes = () => [
    {
        id: 'demo-arabian-sea',
        name: 'Arabian Sea synthetic SAR exercise',
        mode: 'DEMO',
        source: 'synthetic_demo',
        description:
            'Deterministic synthetic SAR, environment and fictional AIS.',
    },
    ...['no-spill', 'inconclusive'].map((outcome) => ({
        id: `demo-${outcome}`,
        name: `Synthetic ${outcome} exercise`,
        mode: 'DEMO',
        source: 'synthetic_demo',
    })),
    ...archivedScenes.map(({ vv, vh, ...scene }) => scene),
];

async function analyzeUpload(body, metadata) {
    const prepared = await sarInput.upload(body, metadata);
    let success = false;
    try {
        const report = await analyze(
            {
                mode: 'UPLOAD',
                detector: 'hybrid',
                forecastHours: prepared.forecastHours ?? 24,
                hindcastHours: prepared.hindcastHours ?? 6,
            },
            prepared,
        );
        success = true;
        return report;
    } finally {
        await prepared.cleanup({ success });
    }
}

module.exports = {
    analyze,
    analyzeUpload,
    get,
    list,
    scenes,
    storageStatus: options => incidentArchive.capacityStatus(options),
};
