const pool = require("./src/config/db");
pool.query(`SELECT COUNT(*) AS obs, MAX(timestamp) AS latest FROM live_ais WHERE timestamp >= NOW() - INTERVAL '4 minutes'`).then(r => console.log(r.rows[0])).catch(console.error).finally(() => pool.end());
