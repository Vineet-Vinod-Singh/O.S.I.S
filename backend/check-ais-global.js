const pool = require("./src/config/db");

async function main() {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) AS observations_10m,
        COUNT(DISTINCT mmsi) AS unique_vessels_10m,
        MIN(ST_X(geom)) AS min_lon,
        MAX(ST_X(geom)) AS max_lon,
        MIN(ST_Y(geom)) AS min_lat,
        MAX(ST_Y(geom)) AS max_lat,
        MAX(timestamp) AS latest_observation
      FROM live_ais
      WHERE timestamp >= NOW() - INTERVAL '10 minutes'
    `);

    console.log(result.rows[0]);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
