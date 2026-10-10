const { searchCatalog } = require('./src/services/sentinel.service');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

(async () => {
  try {
    const datetime = "2026-10-01T00:00:00.000Z/2026-10-01T23:59:59.000Z";
    const bbox = [74.70,13.20,74.78,13.28];
    const result = await searchCatalog({ bbox, datetime });
    console.log('Scenes found:', result.features.length);
  } catch (err) {
    console.error('Failed to search scenes:', err.message);
  }
})();
