'use strict';

const WebSocket = require('ws');
const pool = require('../config/db');

class AISService {
  constructor() {
    this.ws = null;
    this.isActive = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.cleanupTimer = null;
    
    this.pendingBatches = [];
    this.currentBatch = [];
    this.batchTimer = null;
    this.flushPromise = null;

    // Temporary diagnostics counters
    this.diagTimer = null;
    this.diagTotalMsgs = 0;
    this.diagPosReports = 0;
    this.diagInvalidPos = 0;
    this.diagQueued = 0;
    
    // Strict DB metrics
    this.diagDbAttempted = 0;
    this.diagDbSuccess = 0;
    this.diagDbSkipped = 0;
    this.diagDbFail = 0;
    this.diagMemSkipped = 0;
    this.diagDropped = 0;

    this.diagRegionCounts = {};
    this.diagRegions = []; // Parsed regions
  }

  start() {
    if (this.isActive) return;
    const apiKey = process.env.AISSTREAM_API_KEY;
    if (!apiKey) {
      console.warn('[ais] AISSTREAM_API_KEY not set. Live AIS ingestion disabled.');
      return;
    }

    try {
      this.diagRegions = JSON.parse(process.env.POLLER_PRIORITY_AREAS_JSON || '[]');
      for (const r of this.diagRegions) {
        if (r.id) this.diagRegionCounts[r.id] = 0;
      }
    } catch (e) {
      console.error('[ais] Failed to parse POLLER_PRIORITY_AREAS_JSON for diagnostics.');
    }

    console.log('[ais] Starting live AIS ingestion...');
    this.isActive = true;
    this.connect();
    
    // Cleanup every 30 minutes (3 days retention)
    this.cleanupTimer = setInterval(() => this.cleanup(), 30 * 60 * 1000);
    // Log diagnostics every 60 seconds
    this.diagTimer = setInterval(() => this.logDiagnostics(), 60000);
  }

  async stop() {
    this.isActive = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    if (this.diagTimer) {
      clearInterval(this.diagTimer);
      this.diagTimer = null;
    }
    
    const deadline = Date.now() + 10000;
    while ((this.currentBatch.length > 0 || this.pendingBatches.length > 0) && Date.now() < deadline) {
      await Promise.race([
        this.flushBatch(),
        new Promise(r => setTimeout(r, Math.max(1, deadline - Date.now())))
      ]);
      // If we are out of time, break
      if (Date.now() >= deadline) break;
      // Sleep briefly if no progress to avoid busy-spinning
      await new Promise(r => setTimeout(r, 500));
    }
    
    const remaining = this.currentBatch.length + this.pendingBatches.reduce((sum, b) => sum + b.items.length, 0);
    if (remaining > 0) {
      console.warn(`[ais] Stopped, but failed to persist ${remaining} queued records before deadline.`);
    } else {
      console.log('[ais] Live AIS ingestion stopped cleanly.');
    }
  }

  logDiagnostics() {
    console.log(`[ais-diag] 60s summary | Msgs: ${this.diagTotalMsgs} | Queued: ${this.diagQueued} | MemSkipped: ${this.diagMemSkipped} | DB Attempted: ${this.diagDbAttempted} | Inserted: ${this.diagDbSuccess} | DB Skipped: ${this.diagDbSkipped} | Failed: ${this.diagDbFail} | Dropped: ${this.diagDropped}`);
    if (this.diagQueued > 0) {
      console.log(`[ais-diag] Regional counts: ${JSON.stringify(this.diagRegionCounts)}`);
    }

    // Reset counters for next window
    this.diagTotalMsgs = 0;
    this.diagPosReports = 0;
    this.diagInvalidPos = 0;
    this.diagQueued = 0;
    
    this.diagDbAttempted = 0;
    this.diagDbSuccess = 0;
    this.diagDbSkipped = 0;
    this.diagMemSkipped = 0;
    this.diagDbFail = 0;
    this.diagDropped = 0;
    
    for (const key in this.diagRegionCounts) {
      this.diagRegionCounts[key] = 0;
    }
  }

  normalizeTimestamp(timeStr) {
    if (!timeStr) return null;
    let clean = timeStr;
    if (clean.includes(' +0000 UTC')) {
      clean = clean.replace(' +0000 UTC', 'Z');
      clean = clean.replace(' ', 'T');
      clean = clean.replace(/(\.\d{3})\d+Z$/, '$1Z');
    }
    const d = new Date(clean);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  connect() {
    if (!this.isActive) return;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    const apiKey = process.env.AISSTREAM_API_KEY;
    const url = process.env.AISSTREAM_URL || 'wss://stream.aisstream.io/v0/stream';
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log('[ais] Connected to AISStream.');
      this.reconnectAttempts = 0;
      
      let areas = [];
      try {
        areas = JSON.parse(process.env.POLLER_PRIORITY_AREAS_JSON || '[]');
      } catch (e) {
        console.error('[ais] ERROR: Failed to parse POLLER_PRIORITY_AREAS_JSON. Aborting subscription.');
        return;
      }
      
      let boundingBoxes = [];
      const regionNames = [];
      for (const area of areas) {
        if (area.bbox && area.bbox.length === 4) {
          const minLon = area.bbox[0];
          const minLat = area.bbox[1];
          const maxLon = area.bbox[2];
          const maxLat = area.bbox[3];
          
          if (minLat >= -90 && maxLat <= 90 && minLon >= -180 && maxLon <= 180) {
             // AISStream expects [[NW_lat, NW_lon], [SE_lat, SE_lon]]
             boundingBoxes.push([ [maxLat, minLon], [minLat, maxLon] ]);
             regionNames.push(area.id);
          }
        }
      }
      
      if (boundingBoxes.length === 0) {
         console.error('[ais] ERROR: No valid bounding boxes configured. Aborting AISStream subscription.');
         return;
      }
      
      console.log(`[ais] Subscribing to regions: ${regionNames.join(', ')}`);
      
      const subscriptionMessage = {
        Apikey: apiKey,
        BoundingBoxes: boundingBoxes,
        FiltersShipMMSI: [],
        FilterMessageTypes: ["PositionReport"]
      };
      this.ws.send(JSON.stringify(subscriptionMessage));
    });

    this.ws.on('message', (data) => {
      this.processMessage(data);
    });

    this.ws.on('close', () => {
      this.ws = null;
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[ais] WebSocket error:', err.message);
      // error will trigger close
    });
  }

  processMessage(data) {
    this.diagTotalMsgs++;
    try {
      const message = typeof data === 'string' ? JSON.parse(data) : data;
      if (message.MessageType === 'PositionReport') {
        this.diagPosReports++;
        const report = message.Message.PositionReport || {};
        const meta = message.MetaData || {};
        const mmsi = meta.MMSI;
        const lat = report.Latitude;
        const lon = report.Longitude;
        const rawTime = meta.time_utc;
        const time = this.normalizeTimestamp(rawTime);
        
        if (!time || lat == null || lon == null || !mmsi) {
          this.diagInvalidPos++;
          return;
        }
        
        let speed = null;
        if (typeof report.Sog === 'number' && !isNaN(report.Sog) && report.Sog !== 102.3) {
          speed = report.Sog;
        }
        let course = null;
        if (typeof report.Cog === 'number' && !isNaN(report.Cog) && report.Cog !== 360) {
          course = report.Cog;
        }
        
        this.diagQueued++;

        // Update regional counters and filter
        let matchedRegion = false;
        for (const r of this.diagRegions) {
          if (r.id && r.bbox && r.bbox.length === 4) {
            if (lon >= r.bbox[0] && lat >= r.bbox[1] && lon <= r.bbox[2] && lat <= r.bbox[3]) {
              if (typeof this.diagRegionCounts[r.id] !== 'undefined') {
                this.diagRegionCounts[r.id]++;
              }
              matchedRegion = true;
            }
          }
        }

        if (matchedRegion) {
          this.currentBatch.push({ mmsi, time, lat, lon, speed, course });
          this.scheduleFlush();
        }
      }
    } catch (err) {
      // Ignore malformed messages silently
    }
  }

  scheduleReconnect() {
    if (!this.isActive) return;
    if (this.reconnectTimer) return;

    // Backoff: 5, 10, 20, 40, 60
    let delay = 5000 * Math.pow(2, this.reconnectAttempts);
    if (delay > 60000) delay = 60000;
    
    console.log(`[ais] Reconnecting in ${delay}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  scheduleFlush() {
    if (this.batchTimer) return;
    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      this.flushBatch();
    }, 2000);
  }

  flushBatch() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    if (this.flushPromise) return this.flushPromise;

    this.flushPromise = (async () => {
      if (this.currentBatch.length > 0) {
        const BATCH_LIMIT = 5000;
        for (let i = 0; i < this.currentBatch.length; i += BATCH_LIMIT) {
          this.pendingBatches.push({ items: this.currentBatch.slice(i, i + BATCH_LIMIT), retryCount: 0 });
        }
        this.currentBatch = [];
      }
      if (this.pendingBatches.length === 0) return;

      const batchObj = this.pendingBatches[0];
      const batchItems = batchObj.items;
      this.diagDbAttempted += batchItems.length;

      const uniqueMap = new Map();
      for (const row of batchItems) {
        const isoTime = new Date(row.time).toISOString();
        uniqueMap.set(`${row.mmsi}_${isoTime}`, row);
      }
      const deduplicatedItems = Array.from(uniqueMap.values());
      const memSkipped = batchItems.length - deduplicatedItems.length;
      this.diagMemSkipped += memSkipped;

      if (deduplicatedItems.length === 0) {
        this.pendingBatches.shift();
        return;
      }

      let client;
      try {
        const values = [];
        let queryParams = [];
        let i = 1;
        
        for (const row of deduplicatedItems) {
          values.push(`($${i++}::varchar, $${i++}::timestamptz, ST_SetSRID(ST_MakePoint($${i++}::float, $${i++}::float), 4326), $${i++}::float, $${i++}::float)`);
          queryParams.push(row.mmsi, row.time, row.lon, row.lat, row.speed, row.course);
        }

        client = await pool.connect();
        await client.query('BEGIN');
        
        // Inter-process serialization lock. Note: This lock only protects against cooperating writers.
        // Writers bypassing this advisory lock might still induce concurrency violations.
        await client.query("SELECT pg_advisory_xact_lock(hashtext('live_ais_flush'))");
        
        const query = `
          INSERT INTO live_ais (mmsi, timestamp, geom, speed, course)
          SELECT v.mmsi, v.timestamp, v.geom, v.speed, v.course
          FROM (VALUES ${values.join(', ')}) AS v(mmsi, timestamp, geom, speed, course)
          WHERE NOT EXISTS (
            SELECT 1 FROM live_ais la 
            WHERE la.mmsi = v.mmsi AND la.timestamp = v.timestamp
          )
        `;
        
        const result = await client.query(query, queryParams);
        await client.query('COMMIT');

        const inserted = result.rowCount;
        const skipped = deduplicatedItems.length - inserted;
        this.diagDbSuccess += inserted;
        this.diagDbSkipped += skipped;

        this.pendingBatches.shift();
      } catch (insertError) {
        this.diagDbFail += batchItems.length;
        if (client) {
          try { 
            await client.query('ROLLBACK'); 
          } catch (rollbackErr) { 
            console.error('[ais] Transaction rollback failed:', String(rollbackErr.message).slice(0, 200)); 
          }
        }
        console.error('[ais] Database flush error:', String(insertError.message).slice(0, 500));

        batchObj.retryCount++;
        const MAX_RETRIES = 10;
        if (batchObj.retryCount > MAX_RETRIES) {
          this.diagDropped += batchItems.length;
          this.pendingBatches.shift();
          console.warn(`[ais] Max retries (${MAX_RETRIES}) exceeded. Dropped batch of ${batchItems.length}.`);
        }
      } finally {
        if (client) client.release();
        
        // Queue overflow results in data loss of oldest failing batches to prioritize fresh real-time observations.
        let totalItems = this.currentBatch.length + this.pendingBatches.reduce((sum, b) => sum + b.items.length, 0);
        const MAX_TOTAL_ITEMS = parseInt(process.env.AIS_MAX_QUEUE_SIZE, 10) || 10000;
        
        while (totalItems > MAX_TOTAL_ITEMS && this.pendingBatches.length > 0) {
           const dropped = this.pendingBatches.shift();
           this.diagDropped += dropped.items.length;
           totalItems -= dropped.items.length;
           console.warn(`[ais] Queue overflow > ${MAX_TOTAL_ITEMS}. Dropped oldest failing batch of ${dropped.items.length} to prioritize fresh data.`);
        }
      }
    })().finally(() => {
      this.flushPromise = null;
      if (this.pendingBatches.length > 0 && this.isActive && !this.batchTimer) {
        const headRetry = this.pendingBatches[0].retryCount;
        const delay = headRetry > 0 ? Math.min(2000 * Math.pow(2, headRetry), 30000) : 2000;
        this.batchTimer = setTimeout(() => {
          this.batchTimer = null;
          this.flushBatch();
        }, delay);
      }
    });

    return this.flushPromise;
  }

  async cleanup() {
    try {
      await pool.query(`DELETE FROM live_ais WHERE timestamp < NOW() - INTERVAL '3 days'`);
    } catch (err) {
      console.error('[ais] Cleanup error:', err.message);
    }
  }
}

module.exports = new AISService();
