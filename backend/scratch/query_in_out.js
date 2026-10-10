require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Client } = require('pg');
const client = new Client(process.env.DATABASE_URL);
client.connect().then(async () => {
  try {
    const res = await client.query('SELECT COUNT(*) FROM live_ais');
    console.log('Total live_ais:', res.rows[0].count);
    
    const regions = JSON.parse(process.env.POLLER_PRIORITY_AREAS_JSON);
    let inRegionConds = [];
    for (const r of regions) {
       inRegionConds.push(`ST_Intersects(geom, ST_MakeEnvelope(${r.bbox[0]}, ${r.bbox[1]}, ${r.bbox[2]}, ${r.bbox[3]}, 4326))`);
    }
    
    const inRes = await client.query(`SELECT COUNT(*) FROM live_ais WHERE ${inRegionConds.join(' OR ')}`);
    console.log('Inside regions:', inRes.rows[0].count);
    
    const outRes = await client.query(`SELECT COUNT(*) FROM live_ais WHERE NOT (${inRegionConds.join(' OR ')})`);
    console.log('Outside regions:', outRes.rows[0].count);
  } catch (err) {
    console.error(err);
  } finally {
    client.end();
  }
});
