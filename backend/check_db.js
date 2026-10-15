const pool = require('./src/config/db');

async function check() {
  try {
    const { rows: migrations } = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log('Tables:', migrations.map(r => r.table_name).join(', '));
    
    // Check columns of pre_spill_region_risk
    const { rows: riskColumns } = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'pre_spill_region_risk'
    `);
    console.log('pre_spill_region_risk columns:', riskColumns.map(r => r.column_name).join(', '));

    // Check processed_scenes columns
    const { rows: scenesColumns } = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'processed_scenes'
    `);
    console.log('processed_scenes columns:', scenesColumns.map(r => r.column_name).join(', '));

  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
check();
