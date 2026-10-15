const express = require('express');
const cors = require('cors');
const pool = require('./config/db');

// Import routes
const healthRoutes = require('./routes/health.routes');
const spillsRoutes = require('./routes/spills.routes');
const detectionRoutes = require('./routes/detection.routes');
const driftRoutes = require('./routes/drift.routes');
const vesselsRoutes = require('./routes/vessels.routes');
const reportsRoutes = require('./routes/reports.routes');
// DAY 1 — autonomous ingestion
const ingestionRoutes = require('./routes/ingestion.routes');
const scenePoller = require('./services/scene-poller.service');
// DAY 1.5 - risk engine
const riskRoutes = require('./routes/risk.routes');
// DAY 2 — autonomous acquisition worker
const workerRoutes = require('./routes/worker.routes');
const sceneWorker = require('./services/scene-worker.service');
const aisService = require('./services/ais.service');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/incidents', require('./routes/incidents.routes'));
app.use('/api/health', healthRoutes);
app.use('/api/spills', spillsRoutes);
app.use('/api/detection', detectionRoutes);
app.use('/api/drift', driftRoutes);
app.use('/api/vessels', vesselsRoutes);
app.use('/api/reports', reportsRoutes);
// DAY 1 — scene ingestion & deduplication queue
app.use('/api/ingestion', ingestionRoutes);
// DAY 1.5 — risk
app.use('/api/risk', riskRoutes);
// DAY 2 — scene acquisition worker
app.use('/api/worker', workerRoutes);

// Background services are now started in server.js to prevent duplicate starts during testing.

// Basic error handling middleware
app.use((err, req, res, next) => {
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status <= 599 ? err.status : 500;
  console.error(`[api] request failed (${status})`);
  const capacityFailure = err.code === 'OSIS_STORAGE_CAPACITY';
  const objectStorageFailure = String(err.storageReason || '').startsWith('object_');
  res.status(status).json({
    outcome: 'ANALYSIS_INCONCLUSIVE',
    availability: capacityFailure ? 'STORAGE_CAPACITY' : 'PROCESSING_ERROR',
    recovery: objectStorageFailure
      ? 'Processing is paused. Do not delete local reports or evidence; restore Supabase Storage and PostgreSQL reference persistence, then inspect GET /api/worker/status.'
      : capacityFailure
        ? 'Processing is paused and queued scenes are retained. Free disk space, restore PostgreSQL/archive availability, then retry; inspect GET /api/worker/status.'
        : 'Review the supported input and resource limits, then retry. No synthetic result was substituted.',
    error: status < 500 || status === 503 || status === 504 || capacityFailure
      ? err.message : 'Internal Server Error'
  });
});

module.exports = app;
