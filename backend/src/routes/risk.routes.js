const express = require('express');
const router = express.Router();
const riskService = require('../services/pre-spill-risk.service');

router.get('/evaluate', async (req, res, next) => {
  try {
    const result = await riskService.evaluateRisk(req.query);
    res.json(result);
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ error: err.message });
    }
    if (err.code === 'VALIDATION') {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

router.get('/evaluate-region', async (req, res, next) => {
  try {
    if (!req.query.region) {
      return res.status(400).json({ error: 'Missing region parameter' });
    }
    const result = await riskService.getRegionRisk(req.query.region);
    res.json(result);
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ error: err.message });
    }
    if (err.code === 'VALIDATION') {
      return res.status(400).json({ error: err.message });
    }
    if (err.code === 'DB_ERROR') {
      return res.status(500).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
