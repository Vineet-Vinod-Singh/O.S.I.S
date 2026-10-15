const fs = require('fs/promises');
const path = require('path');

const DEFAULT_HOURS = 72;
function retentionHours() {
    const value = Number(process.env.OSIS_ARTIFACT_RETENTION_HOURS);
    return Number.isFinite(value) && value >= 1 ? value : DEFAULT_HOURS;
}
const RETENTION_MS = retentionHours() * 3600000;

const activeDirectories = new Set();
const registeredSweeps = new Map();
let sweepTimer = null;
let isSweeping = false;

function createMarker(directory, owner, values = {}) {
    const diagnosticHours = Number(values.retentionHours);
    const lifetime = Number.isFinite(diagnosticHours) && diagnosticHours >= 1
        ? diagnosticHours * 3600000
        : RETENTION_MS;
    return {
        owner,
        state: values.state || 'pending',
        createdAt: values.createdAt || new Date().toISOString(),
        expires: Date.now() + lifetime,
        persistenceSucceeded: values.persistenceSucceeded === true,
        evidenceRequired: values.evidenceRequired !== false,
        evidenceArchived: values.evidenceArchived === true,
        directory: path.resolve(directory),
    };
}

async function writeMarker(directory, marker) {
    const target = path.join(directory, 'osis-cache.json');
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    try {
        await fs.writeFile(temporary, JSON.stringify(marker), { flag: 'wx' });
        await fs.rename(temporary, target);
    } finally {
        await fs.rm(temporary, { force: true });
    }
}

function registerActiveDirectory(directory) {
    activeDirectories.add(path.resolve(directory));
}

function unregisterActiveDirectory(directory) {
    activeDirectories.delete(path.resolve(directory));
}

function scheduleCleanup(parentDir, filterPrefix) {
    const key = `${parentDir}::${filterPrefix}`;
    if (!registeredSweeps.has(key)) {
        registeredSweeps.set(key, { parentDir, filterPrefix });
    }
    
    if (!sweepTimer) {
        // Run every 1 hour (3600000 ms)
        sweepTimer = setInterval(async () => {
            if (isSweeping) return; // Ensure only one sweep runs at a time
            isSweeping = true;
            try {
                for (const { parentDir, filterPrefix } of registeredSweeps.values()) {
                    await cleanupStaleArtifacts(parentDir, filterPrefix);
                }
            } finally {
                isSweeping = false;
            }
        }, 3600000);
        if (sweepTimer.unref) sweepTimer.unref();
    }
}

function stopCleanupSchedule() {
    if (sweepTimer) {
        clearInterval(sweepTimer);
        sweepTimer = null;
    }
    registeredSweeps.clear();
}

/**
 * Write a retention marker in the artifact directory.
 * @param {string} directory - Absolute path to the directory.
 * @param {string} owner - Ownership string (e.g. 'osis-cdse-v1').
 */
async function markForRetention(directory, owner, values = {}) {
    await writeMarker(directory, createMarker(directory, owner, values));
}

async function updateArtifactState(directory, values = {}) {
    const markerPath = path.join(directory, 'osis-cache.json');
    let marker;
    try {
        marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error('Cannot update retention state without an ownership marker');
        }
        throw error;
    }
    if (!marker || typeof marker.owner !== 'string' ||
        path.resolve(marker.directory || directory) !== path.resolve(directory)) {
        throw new Error('Retention ownership marker is invalid');
    }
    const diagnosticHours = Number(values.retentionHours);
    const next = {
        ...marker,
        ...values,
        state: values.state || marker.state,
        expires: Number.isFinite(diagnosticHours) && diagnosticHours >= 1
            ? Date.now() + diagnosticHours * 3600000
            : marker.expires,
        persistenceSucceeded: values.persistenceSucceeded === true ||
            marker.persistenceSucceeded === true,
        evidenceArchived: values.evidenceArchived === true ||
            marker.evidenceArchived === true,
    };
    delete next.retentionHours;
    await writeMarker(directory, next);
    return next;
}

/**
 * Scan a parent directory and safely purge subdirectories owned by this service
 * that have expired according to their marker file.
 * 
 * @param {string} parentDir - Absolute path to parent directory (e.g., os.tmpdir() or SCENES_DIR)
 * @param {string} filterPrefix - Prefix for subdirectories to check (e.g., 'osis-')
 * @param {object} options - { dryRun: boolean }
 * @returns {Promise<{ scanned: number, deleted: number, wouldDelete: number, skipped: number, errors: number, logs: string[] }>}
 */
async function cleanupStaleArtifacts(parentDir, filterPrefix, options = {}) {
    const { dryRun = false } = options;
    const result = { scanned: 0, deleted: 0, wouldDelete: 0, skipped: 0, errors: 0, logs: [] };

    let entries;
    try {
        entries = await fs.readdir(parentDir, { withFileTypes: true });
    } catch (err) {
        if (err.code === 'ENOENT') return result; // missing directory is safe
        result.errors++;
        result.logs.push(`[retention] Error reading ${parentDir}: ${err.message}`);
        return result;
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (filterPrefix && !entry.name.startsWith(filterPrefix)) continue;
        
        result.scanned++;
        const dirPath = path.join(parentDir, entry.name);
        
        // Guard against path traversal logic just in case
        const resolved = path.resolve(dirPath);
        if (!resolved.startsWith(path.resolve(parentDir) + path.sep)) {
            result.skipped++;
            continue;
        }

        // Active directories are strictly protected from deletion
        if (activeDirectories.has(resolved)) {
            result.skipped++;
            continue;
        }

        try {
            const markerPath = path.join(dirPath, 'osis-cache.json');
            const markerData = await fs.readFile(markerPath, 'utf8');
            const marker = JSON.parse(markerData);
            
            const safeToDelete = marker &&
                marker.directory === resolved &&
                typeof marker.owner === 'string' &&
                marker.owner.startsWith('osis-') &&
                typeof marker.expires === 'number' &&
                marker.expires < Date.now() &&
                ['completed', 'failed'].includes(marker.state) &&
                (marker.evidenceRequired === false || marker.evidenceArchived === true) &&
                (marker.state === 'failed' || marker.persistenceSucceeded === true);
            if (!safeToDelete) {
                result.skipped++;
                continue;
            }
            if (dryRun) {
                result.logs.push(`[retention] Would delete verified stale directory: ${dirPath}`);
                result.wouldDelete++;
                continue;
            }
            await fs.rm(dirPath, { recursive: true, force: false });
            result.logs.push(`[retention] Deleted verified stale directory: ${dirPath}`);
            result.deleted++;
        } catch (err) {
            if (err.code === 'ENOENT') {
                result.skipped++;
                continue;
            }
            result.errors++;
            result.logs.push(`[retention] Could not verify or remove ${dirPath}: ${err.code || 'error'}`);
        }
    }

    return result;
}

module.exports = {
    RETENTION_MS,
    registerActiveDirectory,
    unregisterActiveDirectory,
    scheduleCleanup,
    stopCleanupSchedule,
    markForRetention,
    updateArtifactState,
    cleanupStaleArtifacts
};
