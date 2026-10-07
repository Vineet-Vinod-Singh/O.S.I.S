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
    this.batch = [];
    this.batchTimer = null;
  }

  start() {
    if (this.isActive) return;
    const apiKey = process.env.AISSTREAM_API_KEY;
    if (!apiKey) {
      console.warn('[ais] AISSTREAM_API_KEY not set. Live AIS ingestion disabled.');
      return;
    }

    console.log('[ais] Starting live AIS ingestion...');
    this.isActive = true;
    this.connect();
    
    // Cleanup every 30 minutes (3 days retention)
    this.cleanupTimer = setInterval(() => this.cleanup(), 30 * 60 * 1000);
  }

  stop() {
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
    this.flushBatch(); // Try to flush any remaining
    console.log('[ais] Live AIS ingestion stopped.');
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
      
      const subscriptionMessage = {
        Apikey: apiKey,
        BoundingBoxes: [[[-90, -180], [90, 180]]], // Global for now or can be bounded
        FiltersShipMMSI: [],
        FilterMessageTypes: ["PositionReport"]
      };
      this.ws.send(JSON.stringify(subscriptionMessage));
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        if (message.MessageType === 'PositionReport') {
          const report = message.Message.PositionReport;
          const mmsi = message.MetaData.MMSI;
          const lat = report.Latitude;
          const lon = report.Longitude;
          const time = message.MetaData.time_utc;
          
          if (lat != null && lon != null && mmsi && time) {
             this.batch.push({ mmsi, time, lat, lon });
             this.scheduleFlush();
          }
        }
      } catch (err) {
        // Ignore malformed messages silently
      }
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
    // Flush every 2 seconds
    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      this.flushBatch();
    }, 2000);
  }

  async flushBatch() {
    if (this.batch.length === 0) return;
    const currentBatch = [...this.batch];
    this.batch = [];

    try {
      const values = [];
      let queryParams = [];
      let i = 1;
      for (const row of currentBatch) {
        values.push(`($${i++}, $${i++}, ST_SetSRID(ST_MakePoint($${i++}, $${i++}), 4326))`);
        queryParams.push(row.mmsi, row.time, row.lon, row.lat);
      }
      
      const query = `
        INSERT INTO live_ais (mmsi, timestamp, geom) 
        VALUES ${values.join(', ')}
      `;
      await pool.query(query, queryParams);
    } catch (err) {
      console.error('[ais] Database flush error:', err.message);
    }
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
