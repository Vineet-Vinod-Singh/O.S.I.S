const pool = require("./src/config/db");

async function main() {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) AS observations,
        COUNT(DISTINCT mmsi) AS unique_vessels,
        MAX(timestamp) AS latest_observation
      FROM live_ais
      WHERE timestamp >= NOW() - INTERVAL '10 minutes'
        AND ST_Intersects(
          geom,
          ST_MakeEnvelope(74.70, 13.20, 74.78, 13.28, 4326)
        )
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
