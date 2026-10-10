'use strict';

const WebSocket = require('ws');
const pool = require('../config/db');

const MAX_NODE_TIMEOUT_MS = 2147483647;
const MAX_NODE_TIMEOUT_BIGINT = BigInt(MAX_NODE_TIMEOUT_MS);

class AISService {
  constructor({
    WebSocketImpl = WebSocket,
    dbPool = pool,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    random = Math.random
  } = {}) {
    this.WebSocketImpl = WebSocketImpl;
    this.pool = dbPool;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.random = random;

    this.ws = null;
    this.activeConnection = null;
    this.lifecycleGeneration = 0;
    this.connectionAttemptCounter = 0;
    this.isActive = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.reconnectRemainingMs = null;
    this.reconnectGeneration = null;
    this.stableTimer = null;
    this.cleanupTimer = null;
    
    this.pendingBatches = [];
    this.currentBatch = [];
    this.batchTimer = null;
    this.flushPromise = null;

    // Temporary diagnostics counters
    this.diagTimer = null;
    this.diagTotalMsgs = 0;
    this.diagParsedMsgs = 0;
    this.diagMalformedMsgs = 0;
    this.diagPosReports = 0;
    this.diagInvalidPos = 0;
    this.diagQueued = 0;
    this.diagRegionAccepted = 0;
    this.diagRegionRejected = 0;
    this.diagRegionRejectReasons = {};
    this.diagInvalidPositionReasons = {};
    this.diagBatchQueued = 0;
    
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
    this.lifecycleGeneration++;
    const connection = this.activeConnection;
    this.activeConnection = null;
    const socket = connection ? connection.socket : this.ws;
    this.ws = null;
    if (connection) {
      connection.ended = true;
      this.clearConnectionStableTimer(connection);
    }
    if (this.reconnectTimer) {
      this.clearTimeoutFn(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectRemainingMs = null;
    this.reconnectGeneration = null;
    if (socket) socket.terminate();
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
    console.log(`[ais-diag] 60s summary | Received: ${this.diagTotalMsgs} | Parsed: ${this.diagParsedMsgs} | Malformed: ${this.diagMalformedMsgs} | PositionReports: ${this.diagPosReports} | InvalidPositions: ${this.diagInvalidPos} | RegionAccepted: ${this.diagRegionAccepted} | RegionRejected: ${this.diagRegionRejected} | BatchQueued: ${this.diagBatchQueued} | DB Attempted: ${this.diagDbAttempted} | InsertSucceeded: ${this.diagDbSuccess} | DB Skipped: ${this.diagDbSkipped} | Failed: ${this.diagDbFail} | Dropped: ${this.diagDropped} | MemSkipped: ${this.diagMemSkipped}`);
    if (this.diagRegionRejected > 0) {
      console.log(`[ais-diag] Region rejection reasons: ${JSON.stringify(this.diagRegionRejectReasons)}`);
    }
    if (this.diagInvalidPos > 0) {
      console.log(`[ais-diag] Invalid position reasons: ${JSON.stringify(this.diagInvalidPositionReasons)}`);
    }
    if (this.diagQueued > 0) {
      console.log(`[ais-diag] Regional counts: ${JSON.stringify(this.diagRegionCounts)}`);
    }

    // Reset counters for next window
    this.diagTotalMsgs = 0;
    this.diagParsedMsgs = 0;
    this.diagMalformedMsgs = 0;
    this.diagPosReports = 0;
    this.diagInvalidPos = 0;
    this.diagQueued = 0;
    this.diagRegionAccepted = 0;
    this.diagRegionRejected = 0;
    this.diagRegionRejectReasons = {};
    this.diagInvalidPositionReasons = {};
    this.diagBatchQueued = 0;
    
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
    if (!this.isActive || this.ws || this.reconnectTimer) return;

    const apiKey = process.env.AISSTREAM_API_KEY;
    const url = process.env.AISSTREAM_URL || 'wss://stream.aisstream.io/v0/stream';
    const socket = new this.WebSocketImpl(url);
    const connection = {
      socket,
      attemptId: ++this.connectionAttemptCounter,
      generation: this.lifecycleGeneration,
      ended: false,
      opened: false,
      stableTimer: null,
      retryAfterMs: null,
      handshakeStatus: null
    };
    this.activeConnection = connection;
    this.ws = socket;

    const finishConnection = (reason) => {
      if (connection.ended) return;
      connection.ended = true;
      this.clearConnectionStableTimer(connection);
      if (this.activeConnection !== connection || connection.generation !== this.lifecycleGeneration) return;
      this.activeConnection = null;
      if (this.ws === socket) this.ws = null;
      this.scheduleReconnect({
        reason: connection.handshakeStatus
          ? `HTTP ${connection.handshakeStatus} handshake; ${reason}`
          : reason,
        retryAfterMs: connection.retryAfterMs,
        generation: connection.generation,
        attemptId: connection.attemptId
      });
    };

    socket.on('open', () => {
      if (!this.isCurrentConnection(connection) || connection.ended || connection.opened) return;
      connection.opened = true;
      console.log(`[ais-diag] Connection attempt ${connection.attemptId} (generation ${connection.generation}) socket opened.`);
      connection.stableTimer = this.setTimeoutFn(() => {
        if (this.stableTimer === connection.stableTimer) this.stableTimer = null;
        connection.stableTimer = null;
        if (this.isCurrentConnection(connection) && !connection.ended) {
          this.reconnectAttempts = 0;
          console.log('[ais] Connection stable; reconnect backoff reset.');
        }
      }, 30000);
      this.stableTimer = connection.stableTimer;
      
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
        APIKey: apiKey,
        BoundingBoxes: boundingBoxes,
        FiltersShipMMSI: [],
        FilterMessageTypes: ["PositionReport"]
      };
      socket.send(JSON.stringify(subscriptionMessage), (err) => {
        if (!this.isCurrentConnection(connection) || connection.ended) return;
        if (err) {
          console.error(`[ais] Connection attempt ${connection.attemptId} subscription send failed (${err.code || 'unclassified'}).`);
          finishConnection('socket error');
          socket.terminate();
        }
      });
      console.log(`[ais-diag] Connection attempt ${connection.attemptId} subscription send initiated for ${regionNames.length} regions; awaiting server confirmation.`);
    });

    socket.on('message', (data) => {
      if (!this.isCurrentConnection(connection) || connection.ended) return;
      this.diagTotalMsgs++;
      this.processMessage(data, connection);
    });

    socket.on('unexpected-response', (_request, response) => {
      if (!this.isCurrentConnection(connection) || connection.ended) return;
      connection.handshakeStatus = response.statusCode;
      connection.retryAfterMs = this.parseRetryAfter(response.headers && response.headers['retry-after']);
      const retryAfterParsed = connection.retryAfterMs !== null;
      const retryDelay = retryAfterParsed
        ? `calculated delay=${connection.retryAfterMs}ms`
        : 'calculated delay will use exponential backoff';
      console.warn(`[ais] Connection attempt ${connection.attemptId} (generation ${connection.generation}) handshake failed with HTTP ${response.statusCode}; Retry-After parsed=${retryAfterParsed ? 'yes' : 'no'}; ${retryDelay}.`);
      response.resume();
      socket.terminate();
    });

    socket.on('close', (code, reason) => {
      const closeReason = this.sanitizeDiagnosticText(reason, process.env.AISSTREAM_API_KEY);
      console.warn(`[ais] Connection attempt ${connection.attemptId} (generation ${connection.generation}) closed; code=${code}; reason="${closeReason || 'none'}".`);
      finishConnection('socket close');
    });

    socket.on('error', (err) => {
      if (!this.isCurrentConnection(connection) || connection.ended) return;
      console.error(`[ais] Connection attempt ${connection.attemptId} (generation ${connection.generation}) WebSocket error (${err.code || 'unclassified'}).`);
      finishConnection('socket error');
      socket.terminate();
    });
  }

  isCurrentConnection(connection) {
    return this.isActive &&
      connection.generation === this.lifecycleGeneration &&
      this.activeConnection === connection &&
      this.ws === connection.socket;
  }

  clearConnectionStableTimer(connection) {
    if (!connection.stableTimer) return;
    this.clearTimeoutFn(connection.stableTimer);
    if (this.stableTimer === connection.stableTimer) this.stableTimer = null;
    connection.stableTimer = null;
  }

  sanitizeDiagnosticText(value, secret) {
    let text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value || '');
    text = text.replace(/[\u0000-\u001f\u007f]/g, ' ');
    if (secret) text = text.split(secret).join('[redacted]');
    text = text.replace(/\b(api[\s_-]?key|token|authorization)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
    return text.trim().slice(0, 120);
  }

  processMessage(data, connection = null) {
    try {
      let message = data;
      if (Buffer.isBuffer(data)) {
        message = JSON.parse(data.toString('utf8'));
      } else if (Array.isArray(data) && data.every(Buffer.isBuffer)) {
        message = JSON.parse(Buffer.concat(data).toString('utf8'));
      } else if (typeof data === 'string') {
        message = JSON.parse(data);
      } else if (data instanceof ArrayBuffer) {
        message = JSON.parse(Buffer.from(data).toString('utf8'));
      }
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        this.diagMalformedMsgs++;
        return;
      }
      this.diagParsedMsgs++;
      if (message.MessageType === 'SubscriptionConfirmation') {
        const compressionEnabled = message.Message &&
          typeof message.Message.CompressionEnabled === 'boolean'
          ? message.Message.CompressionEnabled
          : 'unknown';
        const attemptId = connection ? connection.attemptId : 'unknown';
        console.log(`[ais-diag] Connection attempt ${attemptId} subscription confirmed by server; compressionEnabled=${compressionEnabled}.`);
        return;
      }
      if (message.MessageType === 'PositionReport') {
        this.diagPosReports++;
        if (!message.Message || typeof message.Message !== 'object' ||
            !message.Message.PositionReport || typeof message.Message.PositionReport !== 'object') {
          this.diagMalformedMsgs++;
          return;
        }
        const report = message.Message.PositionReport;
        const meta = message.MetaData || {};
        const mmsi = meta.MMSI;
        const lat = report.Latitude;
        const lon = report.Longitude;
        const rawTime = meta.time_utc;
        const time = this.normalizeTimestamp(rawTime);
        
        if (!time || lat == null || lon == null || !mmsi) {
          this.diagInvalidPos++;
          const reason = !mmsi ? 'missing MMSI'
            : lat == null || lon == null ? 'missing coordinates'
              : 'invalid timestamp';
          this.diagInvalidPositionReasons[reason] =
            (this.diagInvalidPositionReasons[reason] || 0) + 1;
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
          this.diagRegionAccepted++;
          this.diagQueued++;
          this.currentBatch.push({ mmsi, time, lat, lon, speed, course });
          this.scheduleFlush();
        } else {
          this.diagRegionRejected++;
          this.diagRegionRejectReasons['outside configured regions'] =
            (this.diagRegionRejectReasons['outside configured regions'] || 0) + 1;
        }
      }
    } catch (err) {
      this.diagMalformedMsgs++;
    }
  }

  parseRetryAfter(value) {
    if (value == null) return null;
    const retryValue = String(value).trim();
    if (!retryValue) return null;
    if (/^\d+$/.test(retryValue)) {
      try {
        return BigInt(retryValue) * 1000n;
      } catch (err) {
        return null;
      }
    }
    const httpDatePattern = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;
    if (!httpDatePattern.test(retryValue)) return null;
    const retryAt = Date.parse(retryValue);
    if (Number.isNaN(retryAt) || new Date(retryAt).toUTCString() !== retryValue) return null;
    return BigInt(Math.max(0, retryAt - Date.now()));
  }

  scheduleReconnect({ reason = 'socket close', retryAfterMs = null, generation = this.lifecycleGeneration, attemptId = 'unknown' } = {}) {
    if (!this.isActive || generation !== this.lifecycleGeneration) return;
    if (this.reconnectTimer) return;

    this.reconnectAttempts++;
    const baseDelay = Math.min(1000 * (2 ** Math.min(this.reconnectAttempts - 1, 12)), 300000);
    const delay = retryAfterMs === null
      ? BigInt(Math.min(300000, Math.floor(baseDelay * (0.5 + this.random()))))
      : retryAfterMs;
    this.reconnectRemainingMs = delay;
    this.reconnectGeneration = generation;
    console.log(`[ais] Connection attempt ${attemptId} (generation ${generation}) scheduling reconnect after ${reason} in ${delay}ms.`);
    this.scheduleReconnectChunk(generation);
  }

  scheduleReconnectChunk(generation) {
    if (!this.isActive || generation !== this.lifecycleGeneration || this.reconnectRemainingMs === null) return;

    // Chain safe-sized timers for long Retry-After waits so Node's timeout overflow cannot trigger an early retry.
    const chunkMs = this.reconnectRemainingMs > MAX_NODE_TIMEOUT_BIGINT
      ? MAX_NODE_TIMEOUT_BIGINT
      : this.reconnectRemainingMs;
    let timer;
    timer = this.setTimeoutFn(() => {
      if (this.reconnectTimer !== timer) return;
      this.reconnectTimer = null;
      if (!this.isActive || generation !== this.lifecycleGeneration) return;

      this.reconnectRemainingMs -= chunkMs;
      if (this.reconnectRemainingMs > 0n) {
        this.scheduleReconnectChunk(generation);
        return;
      }

      this.reconnectRemainingMs = null;
      this.reconnectGeneration = null;
      this.connect();
    }, Number(chunkMs));
    this.reconnectTimer = timer;
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
        this.diagBatchQueued += this.currentBatch.length;
        console.debug(`[ais-diag] Batch queued: ${this.currentBatch.length} position(s).`);
        this.currentBatch = [];
      }
      if (this.pendingBatches.length === 0) return;

      const batchObj = this.pendingBatches[0];
      const batchItems = batchObj.items;
      this.diagDbAttempted += batchItems.length;
      console.debug(`[ais-diag] Database insert attempted for ${batchItems.length} position(s).`);

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

        client = await this.pool.connect();
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
        console.debug(`[ais-diag] Database insert succeeded: ${inserted} position(s) inserted.`);

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
      await this.pool.query(`DELETE FROM live_ais WHERE timestamp < NOW() - INTERVAL '3 days'`);
    } catch (err) {
      console.error('[ais] Cleanup error:', err.message);
    }
  }
}

module.exports = new AISService();
module.exports.AISService = AISService;
