const fs = require('fs/promises');
const path = require('path');

const RETENTION_HOURS = Number(process.env.OSIS_ARTIFACT_RETENTION_HOURS);
const DEFAULT_HOURS = 72;
const hours = Number.isFinite(RETENTION_HOURS) && RETENTION_HOURS > 0 ? RETENTION_HOURS : DEFAULT_HOURS;
const RETENTION_MS = hours * 3600000;

const activeDirectories = new Set();
const registeredSweeps = new Map();
let sweepTimer = null;
let isSweeping = false;

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
async function markForRetention(directory, owner) {
    const expires = Date.now() + RETENTION_MS;
    await fs.writeFile(
        path.join(directory, 'osis-cache.json'),
        JSON.stringify({ owner, expires })
    );
}

/**
 * Scan a parent directory and safely purge subdirectories owned by this service
 * that have expired according to their marker file.
 * 
 * @param {string} parentDir - Absolute path to parent directory (e.g., os.tmpdir() or SCENES_DIR)
 * @param {string} filterPrefix - Prefix for subdirectories to check (e.g., 'osis-')
 * @param {object} options - { dryRun: boolean }
 * @returns {Promise<{ scanned: number, deleted: number, errors: number, logs: string[] }>}
 */
async function cleanupStaleArtifacts(parentDir, filterPrefix, options = {}) {
    const { dryRun = false } = options;
    const result = { scanned: 0, deleted: 0, errors: 0, logs: [] };

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
            continue;
        }

        // Active directories are strictly protected from deletion
        if (activeDirectories.has(resolved)) {
            continue;
        }

        try {
            const markerPath = path.join(dirPath, 'osis-cache.json');
            const markerData = await fs.readFile(markerPath, 'utf8');
            const marker = JSON.parse(markerData);
            
            // Only clean directories with valid, expired markers
            if (marker && marker.owner && typeof marker.expires === 'number') {
                if (Date.now() > marker.expires) {
                    if (dryRun) {
                        result.logs.push(`[retention] Would delete stale directory: ${dirPath}`);
                        result.deleted++;
                    } else {
                        try {
                            await fs.rm(dirPath, { recursive: true, force: true });
                            result.logs.push(`[retention] Deleted stale directory: ${dirPath}`);
                            result.deleted++;
                        } catch (rmErr) {
                            result.errors++;
                            result.logs.push(`[retention] Failed to delete ${dirPath}: ${rmErr.message}`);
                        }
                    }
                }
            }
        } catch (err) {
            // Missing marker, unparseable JSON, or read error -> safe to ignore
            // We never purge a directory if we can't confirm it's ours and expired.
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
    cleanupStaleArtifacts
};
