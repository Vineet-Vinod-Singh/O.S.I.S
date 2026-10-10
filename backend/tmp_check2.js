const pool = require('./src/config/db');
async function check() {
  try {
    const res = await pool.query(`
      SELECT mmsi, timestamp, speed, course, ST_AsText(geom) as geom, COUNT(*) 
      FROM live_ais 
      GROUP BY mmsi, timestamp, speed, course, ST_AsText(geom)
      HAVING COUNT(*) > 1 
      LIMIT 5
    `);
    console.log("Full Duplicates:", res.rows);
    const res2 = await pool.query(`
      SELECT mmsi, timestamp, COUNT(*) 
      FROM live_ais 
      GROUP BY mmsi, timestamp
      HAVING COUNT(*) > 1 
      LIMIT 5
    `);
    console.log("TS Duplicates:", res2.rows);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
check();
