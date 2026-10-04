'use strict';
/**
 * scene-poller.service.js
 * ========================
 * DAY 1 — Autonomous Sentinel-1 scene discovery & persistent deduplication.
 *
 * Responsibilities:
 *   1. Poll CDSE STAC catalog on a configurable interval for Sentinel-1 GRD scenes
 *      over a configured Area of Interest (AOI).
 *   2. Deduplicate against the `processed_scenes` table (by scene_id + collection).
 *   3. Insert new scenes with status = 'queued' — ready for the Day 2 worker.
 *   4. Persist poller checkpoint in `ingestion_state` so restarts resume from
 *      the last seen acquisition time instead of re-scanning from scratch.
 *
 * Does NOT:
 *   - Run SAR detection, drift, AIS, or incident analysis (those are Day 2–4).
 *   - Download scene rasters (that happens in the Day 2 worker).
 *   - Modify any existing service or route.
 */

const pool = require('../config/db');
const { searchCatalog } = require('./sentinel.service');

// ---------------------------------------------------------------------------
// Configuration — all values read from environment at module load time
// ---------------------------------------------------------------------------

/** AOI bbox for the Indian Ocean / Bay of Bengal watch zone [minLon,minLat,maxLon,maxLat] */
const AOI_BBOX = (() => {
  const raw = process.env.POLLER_AOI_BBOX;
  if (raw) {
    const parsed = raw.split(',').map(Number);
    if (
      parsed.length === 4 &&
      parsed.every(Number.isFinite) &&
      parsed[2] > parsed[0] && parsed[3] > parsed[1] &&          // valid box
      (parsed[2] - parsed[0]) <= 0.2 && (parsed[3] - parsed[1]) <= 0.2  // sentinel.service limit
    ) return parsed;
    console.warn(
      '[poller] POLLER_AOI_BBOX is invalid or exceeds 0.2° per side — using default Bay of Bengal AOI'
    );
  }
  // Default: 0.19°x0.19° box in the Bay of Bengal.
  // Must be <=0.2 degrees per side to pass sentinel.service.js validateSubset.
  return [80.0, 9.0, 80.19, 9.19];
})();

/** How often to poll CDSE, in milliseconds (default: 15 minutes) */
const POLL_INTERVAL_MS = (() => {
  const v = parseInt(process.env.POLLER_INTERVAL_MS, 10);
  return Number.isFinite(v) && v >= 60000 ? v : 15 * 60 * 1000;
})();

/** Look-back window for the very first poll (hours). Default: 24 h */
const INITIAL_LOOKBACK_HOURS = (() => {
  const v = parseInt(process.env.POLLER_INITIAL_LOOKBACK_HOURS, 10);
  return Number.isFinite(v) && v > 0 && v <= 72 ? v : 24;
})();

/** Max scenes to request per CDSE call (hard-capped at 5 by sentinel.service) */
const BATCH_LIMIT = 5;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _timer = null;
let _running = false;
let _pollCount = 0;
let _queuedTotal = 0;
let _lastPollAt = null;
let _lastError = null;

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

/**
 * Load the persisted ingestion checkpoint from the DB.
 * Returns { last_polled_at, last_scene_at, poll_count, scenes_queued }
 * or null if DB is unavailable (graceful degradation).
 */
async function loadState() {
  try {
    const { rows } = await pool.query(
      'SELECT last_polled_at, last_scene_at, poll_count, scenes_queued FROM ingestion_state WHERE singleton = TRUE LIMIT 1'
    );
    return rows[0] || null;
  } catch (err) {
    console.warn('[poller] Could not load ingestion_state:', err.message);
    return null;
  }
}

/**
 * Persist poller checkpoint to DB after each poll cycle.
 * Fire-and-forget — failures are logged but do not abort the poll.
 */
async function saveState({ lastPollAt, lastSceneAt, pollCount, scenesQueued }) {
  try {
    await pool.query(
      `UPDATE ingestion_state
         SET last_polled_at = $1,
             last_scene_at  = GREATEST(last_scene_at, $2),
             poll_count     = $3,
             scenes_queued  = $4
       WHERE singleton = TRUE`,
      [lastPollAt, lastSceneAt, pollCount, scenesQueued]
    );
  } catch (err) {
    console.warn('[poller] Could not save ingestion_state:', err.message);
  }
}

/**
 * Check if a given CDSE scene_id already exists in the deduplication table.
 * @param {string} sceneId
 * @param {string} collection
 * @returns {Promise<boolean>}
 */
async function isDuplicate(sceneId, collection) {
  const { rows } = await pool.query(
    'SELECT 1 FROM processed_scenes WHERE scene_id = $1 AND collection = $2 LIMIT 1',
    [sceneId, collection]
  );
  return rows.length > 0;
}

/**
 * Insert a new scene into `processed_scenes` with status = 'queued'.
 * On conflict (race or restart), silently skips.
 * @param {Object} feature — raw STAC GeoJSON feature from CDSE
 * @returns {Promise<boolean>} true if inserted, false if duplicate
 */
async function enqueueScene(feature) {
  const sceneId     = feature.id;
  const collection  = feature.collection || 'sentinel-1-grd';
  const props       = feature.properties || {};
  const acquiredAt  = props.datetime || props.start_datetime || null;
  const platform    = props.platform || props['eo:platform'] || null;
  const orbitDir    = props.sat_orbit_state || props['sat:orbit_state'] || null;
  const polar       = props['sar:polarizations']
    ? props['sar:polarizations'].join(' ')
    : null;

  // Extract bbox: STAC feature bbox is [minLon, minLat, maxLon, maxLat]
  const bboxArr = feature.bbox || null;
  const bboxJson = bboxArr ? JSON.stringify(bboxArr) : null;

  try {
    const result = await pool.query(
      `INSERT INTO processed_scenes
         (scene_id, collection, bbox, acquired_at, platform, orbit_direction, polarization, stac_feature, status)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8::jsonb, 'queued')
       ON CONFLICT ON CONSTRAINT processed_scenes_unique_scene DO NOTHING
       RETURNING id`,
      [sceneId, collection, bboxJson, acquiredAt, platform, orbitDir, polar, JSON.stringify(feature)]
    );
    return result.rowCount > 0;
  } catch (err) {
    console.error(`[poller] Failed to enqueue scene ${sceneId}:`, err.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Core poll cycle
// ---------------------------------------------------------------------------

/**
 * Execute one poll cycle:
 *   1. Determine search window (from: lastSceneAt | initialLookback, to: now)
 *   2. Call CDSE STAC catalog
 *   3. Deduplicate and enqueue new scenes
 *   4. Persist checkpoint
 */
async function pollOnce() {
  _lastPollAt = new Date();
  const now = _lastPollAt;

  // --- Determine search window ---
  let state = null;
  try {
    state = await loadState();
  } catch (_) {}

  let fromTime;
  if (state && state.last_scene_at) {
    // Resume from last seen scene (+ 1 second to avoid re-fetching boundary)
    fromTime = new Date(new Date(state.last_scene_at).getTime() + 1000);
  } else {
    // First run: look back INITIAL_LOOKBACK_HOURS
    fromTime = new Date(now.getTime() - INITIAL_LOOKBACK_HOURS * 3600 * 1000);
  }

  // Sentinel Hub catalog accepts at most 24-hour windows per request
  const windowMs = Math.min(now - fromTime, 23 * 3600 * 1000);
  const toTime   = new Date(fromTime.getTime() + windowMs);

  const datetime = `${fromTime.toISOString()}/${toTime.toISOString()}`;

  console.log(`[poller] Poll #${_pollCount + 1} | window: ${fromTime.toISOString()} → ${toTime.toISOString()} | AOI: ${AOI_BBOX}`);

  let features = [];
  try {
    const catalog = await searchCatalog({
      bbox: AOI_BBOX,
      datetime,
      limit: BATCH_LIMIT,
      collections: ['sentinel-1-grd'],
    });
    features = catalog.features || [];
    console.log(`[poller] CDSE returned ${features.length} scene(s)`);
  } catch (err) {
    _lastError = err.message;
    console.error('[poller] CDSE catalog error:', err.message);
    return; // Skip this cycle — will retry on next interval
  }

  // --- Deduplicate & enqueue ---
  let newScenes = 0;
  let latestAcquiredAt = state?.last_scene_at ? new Date(state.last_scene_at) : null;

  for (const feature of features) {
    const inserted = await enqueueScene(feature);
    if (inserted) {
      newScenes++;
      // Track the latest acquisition time across all inserted scenes
      const acq = feature.properties?.datetime || feature.properties?.start_datetime;
      if (acq) {
        const d = new Date(acq);
        if (!latestAcquiredAt || d > latestAcquiredAt) latestAcquiredAt = d;
      }
      console.log(`[poller] Queued scene: ${feature.id}`);
    }
  }

  if (newScenes === 0) {
    console.log('[poller] No new scenes this cycle');
  } else {
    console.log(`[poller] ${newScenes} new scene(s) queued`);
    _queuedTotal += newScenes;
  }

  _pollCount++;
  _lastError = null;

  // Persist checkpoint
  await saveState({
    lastPollAt: now,
    lastSceneAt: latestAcquiredAt || now,
    pollCount: (state?.poll_count || 0) + 1,
    scenesQueued: (state?.scenes_queued || 0) + newScenes,
  });
}

// ---------------------------------------------------------------------------
// Poller lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the autonomous polling loop.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
async function start() {
  if (_running) {
    console.log('[poller] Already running');
    return;
  }
  _running = true;
  console.log(`[poller] Starting — AOI=${AOI_BBOX} interval=${POLL_INTERVAL_MS}ms`);

  // Run immediately, then schedule repeating interval
  try {
    await pollOnce();
  } catch (err) {
    console.error('[poller] First poll failed:', err.message);
  }

  _timer = setInterval(async () => {
    try {
      await pollOnce();
    } catch (err) {
      _lastError = err.message;
      console.error('[poller] Poll cycle error:', err.message);
    }
  }, POLL_INTERVAL_MS);

  // Prevent the interval from keeping the process alive if main server exits
  if (_timer.unref) _timer.unref();
}

/**
 * Stop the polling loop gracefully.
 */
function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _running = false;
  console.log('[poller] Stopped');
}

/**
 * Return current in-process status snapshot (used by the ingestion API).
 */
function status() {
  return {
    running: _running,
    pollCount: _pollCount,
    queuedTotal: _queuedTotal,
    lastPollAt: _lastPollAt,
    lastError: _lastError,
    config: {
      aoi: AOI_BBOX,
      intervalMs: POLL_INTERVAL_MS,
      initialLookbackHours: INITIAL_LOOKBACK_HOURS,
      batchLimit: BATCH_LIMIT,
    },
  };
}

module.exports = { start, stop, status, pollOnce };
