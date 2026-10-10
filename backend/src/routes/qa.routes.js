const express = require('express');
const router = express.Router();
const tinyfishService = require('../services/tinyfish.service');
const qaSuites = require('../config/qa-suites.json');

// Middleware to ensure only authorized admins can trigger/view QA runs
const adminAuth = (req, res, next) => {
  // In a real application, check JWT token for admin role here.
  // For O.S.I.S, assuming an environment variable or simple header for demo purposes.
  const authHeader = req.headers['authorization'];
  if (process.env.QA_ADMIN_TOKEN && authHeader !== `Bearer ${process.env.QA_ADMIN_TOKEN}`) {
    return res.status(403).json({ error: 'Unauthorized to access QA subsystem.' });
  }
  next();
};

router.use(adminAuth);

/**
 * GET /api/qa/suites
 * List available QA test suites
 */
router.get('/suites', (req, res) => {
  res.json(qaSuites);
});

/**
 * GET /api/qa/runs
 * List all QA runs
 */
router.get('/runs', (req, res) => {
  try {
    const runs = tinyfishService.getAllRuns();
    res.json({ runs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/qa/runs/:id
 * Get status of a specific run
 */
router.get('/runs/:id', (req, res) => {
  try {
    const run = tinyfishService.getRunStatus(req.params.id);
    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }
    res.json(run);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/qa/runs
 * Trigger a new QA suite run
 */
router.post('/runs', async (req, res) => {
  try {
    const { suiteName, task } = req.body;
    
    if (!task) {
      return res.status(400).json({ error: 'Task description is required' });
    }

    const suite = {
      name: suiteName || 'Custom Run',
      task: task
    };

    const result = await tinyfishService.triggerRun(suite);
    res.status(202).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
