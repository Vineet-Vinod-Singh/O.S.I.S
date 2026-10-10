require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Client } = require('pg');
const client = new Client(process.env.DATABASE_URL);
client.connect().then(async () => {
  try {
    const res = await client.query('SELECT MIN(ST_X(geom)) as min_lon, MAX(ST_X(geom)) as max_lon, MIN(ST_Y(geom)) as min_lat, MAX(ST_Y(geom)) as max_lat FROM live_ais');
    console.log(res.rows[0]);
  } catch (err) {
    console.error(err);
  } finally {
    client.end();
  }
});
