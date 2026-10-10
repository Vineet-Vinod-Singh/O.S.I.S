const pool = require('./src/config/db');
async function check() {
  try {
    const res = await pool.query(`
      EXPLAIN 
      SELECT 1 FROM live_ais la 
      WHERE la.mmsi = '123456789' AND la.timestamp = '2026-10-07T17:37:09.016Z'
    `);
    console.log("EXPLAIN Plan without composite index:\n", res.rows.map(r => r['QUERY PLAN']).join('\n'));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
check();
