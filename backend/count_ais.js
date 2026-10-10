require('dotenv').config();
const pool = require('./src/config/db');

const query = `
  WITH regions AS (
    SELECT ST_GeomFromText('POLYGON((79.5 12.5, 81.0 12.5, 81.0 14.0, 79.5 14.0, 79.5 12.5))', 4326) AS geom UNION ALL -- Chennai
    SELECT ST_GeomFromText('POLYGON((74.0 12.0, 75.0 12.0, 75.0 14.5, 74.0 14.5, 74.0 12.0))', 4326) UNION ALL -- Karnataka
    SELECT ST_GeomFromText('POLYGON((71.0 19.0, 73.0 19.0, 73.0 20.0, 71.0 20.0, 71.0 19.0))', 4326) UNION ALL -- Mumbai
    SELECT ST_GeomFromText('POLYGON((79.0 6.5, 80.5 6.5, 80.5 7.5, 79.0 7.5, 79.0 6.5))', 4326) UNION ALL -- Colombo
    SELECT ST_GeomFromText('POLYGON((80.5 5.5, 81.5 5.5, 81.5 6.5, 80.5 6.5, 80.5 5.5))', 4326) UNION ALL -- Hambantota
    SELECT ST_GeomFromText('POLYGON((56.0 25.0, 57.0 25.0, 57.0 26.0, 56.0 26.0, 56.0 25.0))', 4326) -- Fujairah
  ),
  unified_region AS (
    SELECT ST_Union(geom) as geom FROM regions
  )
  SELECT 
    COUNT(*) as total_records,
    SUM(CASE WHEN ST_Contains(u.geom, la.geom) THEN 1 ELSE 0 END) as in_region,
    SUM(CASE WHEN NOT ST_Contains(u.geom, la.geom) THEN 1 ELSE 0 END) as out_region
  FROM live_ais la
  CROSS JOIN unified_region u;
`;

async function run() {
  try {
    const result = await pool.query(query);
    console.log(result.rows[0]);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
