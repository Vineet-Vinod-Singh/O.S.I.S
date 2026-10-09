const assert = require('assert');
const riskService = require('../src/services/pre-spill-risk.service');
const pool = require('../src/config/db');

// Mock pool.query for the test
const originalQuery = pool.query;

// Set up fake regions for testing but with known IDs to test label resolution
process.env.POLLER_PRIORITY_AREAS_JSON = JSON.stringify([
  { id: 'karnataka_coast_in', lat: 10, lon: 10, label: 'Karnataka Coast', bbox: [9, 9, 11, 11] },
  { id: 'mumbai_high_in', lat: 19, lon: 71, label: 'Mumbai High', bbox: [18, 70, 20, 72] },
  { id: 'unknown_region_123', lat: 0, lon: 0, label: 'Unknown', bbox: [-1, -1, 1, 1] }
]);

async function runTests() {
  console.log('--- Running Pre-Spill Risk Service Tests ---');
  let testsPassed = 0;
  let testsFailed = 0;

  try {
    console.log('Test 1: Region Name Resolution (Karnataka Coast)');
    pool.query = async (query, params) => {
      // Simulate normal traffic
      if (query.includes('24 hours') && !query.includes('48 hours')) {
        return { rows: [{ unique_vessels: '15', latest_obs: new Date().toISOString() }] };
      } else if (query.includes('48 hours')) {
        return { rows: [{ unique_vessels: '10' }] };
      }
      return { rows: [] };
    };
    const res1 = await riskService.evaluateRegionRisk('karnataka_coast_in');
    assert.ok(res1.assessments.geographic_exposure.reason.includes('Karnataka Coast'), 'Label must be resolved correctly');
    testsPassed++;
    console.log('  -> PASS');
  } catch (err) {
    testsFailed++;
    console.error('  -> FAIL', err);
  } finally {
    pool.query = originalQuery;
  }

  try {
    console.log('Test 2: Zero Observations (NO_OBSERVATIONS / INSUFFICIENT_DATA)');
    pool.query = async (query, params) => {
      // Return 0 unique vessels
      return { rows: [{ unique_vessels: '0', latest_obs: null }] };
    };
    const res2 = await riskService.evaluateRegionRisk('mumbai_high_in');
    assert.strictEqual(res2.assessments.vessel_activity.unique_vessels_24h, 0);
    assert.strictEqual(res2.assessments.traffic_anomaly.level, 'NO_OBSERVATIONS');
    assert.strictEqual(res2.assessments.monitoring_priority.level, 'INSUFFICIENT_DATA');
    assert.ok(res2.assessments.geographic_exposure.reason.includes('Mumbai High'), 'Mumbai High label must be resolved');
    testsPassed++;
    console.log('  -> PASS');
  } catch (err) {
    testsFailed++;
    console.error('  -> FAIL', err);
  } finally {
    pool.query = originalQuery;
  }

  try {
    console.log('Test 3: DB Error handling');
    pool.query = async (query, params) => {
      throw new Error('Simulated Connection Timeout');
    };
    await riskService.evaluateRegionRisk('mumbai_high_in');
    throw new Error('Should have thrown DB_ERROR');
  } catch (err) {
    if (err.code === 'DB_ERROR' && err.message.includes('Simulated Connection Timeout')) {
      testsPassed++;
      console.log('  -> PASS');
    } else {
      testsFailed++;
      console.error('  -> FAIL', err);
    }
  } finally {
    pool.query = originalQuery;
  }

  try {
    console.log('Test 4: Region without explicit label definition fallback');
    pool.query = async (query, params) => {
      return { rows: [{ unique_vessels: '5', latest_obs: new Date().toISOString() }] };
    };
    const res4 = await riskService.evaluateRegionRisk('unknown_region_123');
    assert.ok(res4.assessments.geographic_exposure.reason.includes('unknown_region_123'), 'Must fallback to ID');
    testsPassed++;
    console.log('  -> PASS');
  } catch (err) {
    testsFailed++;
    console.error('  -> FAIL', err);
  } finally {
    pool.query = originalQuery;
  }
  
  try {
    console.log('Test 5: Stale Data checks (MMSI evaluation)');
    pool.query = async (query, params) => {
      // Return a date that is 48 hours old
      const pastDate = new Date();
      pastDate.setHours(pastDate.getHours() - 48);
      return {
        rows: [{ mmsi: 12345, timestamp: pastDate.toISOString(), lat: 13.1, lon: 74.7, speed: 0.5, course: 180 }]
      };
    };
    const res5 = await riskService.evaluateRisk({ mmsi: 12345 });
    assert.strictEqual(res5.assessments.spill_likelihood.level, 'UNDETERMINED');
    assert.ok(res5.assessments.spill_likelihood.reason.includes('too stale'));
    testsPassed++;
    console.log('  -> PASS');
  } catch (err) {
    testsFailed++;
    console.error('  -> FAIL', err);
  } finally {
    pool.query = originalQuery;
  }

  console.log(`\nTests completed: ${testsPassed} passed, ${testsFailed} failed.`);
  if (testsFailed > 0) process.exit(1);
  process.exit(0);
}

runTests();
