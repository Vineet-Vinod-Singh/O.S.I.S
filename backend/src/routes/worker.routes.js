'use strict';
/**
 * worker.routes.js
 * ================
 * DAY 2 — REST API for the autonomous Sentinel-1 acquisition worker.
 *
 * Endpoints:
 *   POST /start         Start the background acquisition worker
 *   POST /stop          Stop the background acquisition worker
 *   GET  /status        Get in-process status of the acquisition worker
 *   POST /process-next  Manually process the next queued scene
 */

const express = require('express');
const router = express.Router();
const worker = require('../services/scene-worker.service');

// ---------------------------------------------------------------------------
// POST /start
// ---------------------------------------------------------------------------
router.post('/start', async (req, res, next) => {
  try {
    await worker.startWorker();
    res.json({ ok: true, message: 'Worker started', status: worker.workerStatus() });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /stop
// ---------------------------------------------------------------------------
router.post('/stop', (req, res) => {
  worker.stopWorker();
  res.json({ ok: true, message: 'Worker stopped', status: worker.workerStatus() });
});

// ---------------------------------------------------------------------------
// GET /status
// ---------------------------------------------------------------------------
router.get('/status', (req, res) => {
  res.json({ ok: true, status: worker.workerStatus() });
});

// ---------------------------------------------------------------------------
// POST /process-next
// ---------------------------------------------------------------------------
router.post('/process-next', async (req, res, next) => {
  try {
    const result = await worker.processNextScene();
    res.json({ ok: true, result });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /recover-stale
// ---------------------------------------------------------------------------
router.post('/recover-stale', async (req, res, next) => {
  try {
    const result = await worker.recoverStaleScenes();
    res.json({
      ok: true,
      message: 'Stale recovery executed',
      recovered: result?.recovered ?? 0,
      failed: result?.failed ?? 0,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
