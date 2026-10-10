const pool = require("./src/config/db");
pool.query(`SELECT mmsi, ST_X(geom) AS lon, ST_Y(geom) AS lat, timestamp FROM live_ais WHERE timestamp >= NOW() - INTERVAL '4 minutes'`).then(r => console.log(r.rows)).catch(console.error).finally(() => pool.end());
