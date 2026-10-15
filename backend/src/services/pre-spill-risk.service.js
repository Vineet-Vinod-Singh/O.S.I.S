'use strict';

const pool = require('../config/db');

// Calculate distance using Haversine formula (in km)
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Distance to a bounding box (approximate closest distance)
function distanceToBbox(lat, lon, bbox) {
  // bbox: [minLon, minLat, maxLon, maxLat]
  const [minLon, minLat, maxLon, maxLat] = bbox;
  
  // closest lat
  let cLat = lat;
  if (lat < minLat) cLat = minLat;
  else if (lat > maxLat) cLat = maxLat;
  
  // closest lon
  let cLon = lon;
  if (lon < minLon) cLon = minLon;
  else if (lon > maxLon) cLon = maxLon;
  
  return haversineDistance(lat, lon, cLat, cLon);
}

class PreSpillRiskService {
  
  async getLatestAisPosition(mmsi) {
    const query = `
      SELECT mmsi, timestamp, ST_Y(geom) as lat, ST_X(geom) as lon, speed, course
      FROM live_ais
      WHERE mmsi = $1
      ORDER BY timestamp DESC
      LIMIT 1
    `;
    const res = await pool.query(query, [mmsi]);
    if (res.rows.length === 0) {
      throw { code: 'NOT_FOUND', message: `No AIS data found for MMSI ${mmsi}` };
    }
    
    const row = res.rows[0];
    const ageHours = (Date.now() - new Date(row.timestamp).getTime()) / (1000 * 60 * 60);
    
    return {
      mmsi: row.mmsi,
      lat: row.lat,
      lon: row.lon,
      speed: row.speed,
      course: row.course,
      timestamp: row.timestamp,
      age_hours: ageHours
    };
  }

  async fetchWeather(lat, lon) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    try {
      // Fetch both marine and standard weather from Open-Meteo
      const [marineRes, weatherRes] = await Promise.all([
        fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=wave_height,ocean_current_velocity`, { signal: controller.signal }),
        fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=wind_speed_10m`, { signal: controller.signal })
      ]);
      
      clearTimeout(timeout);
      
      const marineData = marineRes.ok ? await marineRes.json() : null;
      const weatherData = weatherRes.ok ? await weatherRes.json() : null;
      
      return {
        wave_height_m: marineData?.current?.wave_height ?? null,
        current_speed_ms: marineData?.current?.ocean_current_velocity ?? null,
        wind_speed_ms: weatherData?.current?.wind_speed_10m ?? null,
        source: 'Open-Meteo API',
        timestamp: new Date().toISOString(),
        errors: {
          marine: marineRes.ok ? null : `Status ${marineRes.status}`,
          weather: weatherRes.ok ? null : `Status ${weatherRes.status}`
        }
      };
    } catch (err) {
      clearTimeout(timeout);
      return {
        wave_height_m: null,
        current_speed_ms: null,
        wind_speed_ms: null,
        source: 'Open-Meteo API',
        timestamp: new Date().toISOString(),
        errors: { fetch: err.message }
      };
    }
  }

  evaluateLikelihood(aisData) {
    if (!aisData) {
      return { level: 'UNDETERMINED', reason: 'No vessel data provided.' };
    }
    
    const { speed, course, age_hours } = aisData;
    let reason = 'Vessel type unknown. No predictive historical baseline available.';
    let level = 'UNDETERMINED';
    
    if (age_hours > 24) {
      return { level: 'UNDETERMINED', reason: `Data is too stale (${age_hours.toFixed(1)} hours old).` };
    }
    
    if (speed !== null && speed < 1.0) {
      level = 'LOW';
      reason = 'Heuristic: Vessel is nearly stationary (speed < 1 knot). This is a weak indicator and does not prove impending spill.';
    } else if (speed !== null) {
      level = 'LOW';
      reason = 'Heuristic: Vessel is in normal transit. This is a weak indicator and does not guarantee safety.';
    }
    
    return { level, reason };
  }

  evaluateTransport(weather) {
    if (!weather.wave_height_m && !weather.wind_speed_ms) {
      return {
        level: 'UNKNOWN',
        reason: 'Weather data unavailable.',
        data_source: weather.source
      };
    }
    
    const wind = weather.wind_speed_ms || 0;
    const wave = weather.wave_height_m || 0;
    
    let level = 'LOW';
    let reason = 'Normal marine conditions.';
    
    // Wind > 15 m/s (~30 knots) or Wave > 3m
    if (wind > 15 || wave > 3) {
      level = 'HIGH';
      reason = `Severe conditions (Wind: ${wind} m/s, Wave: ${wave} m) would accelerate transport and severely hamper containment efforts. Weather DOES NOT increase spill probability.`;
    } else if (wind > 10 || wave > 1.5) {
      level = 'MEDIUM';
      reason = `Moderate conditions (Wind: ${wind} m/s, Wave: ${wave} m). Response may be slightly impeded.`;
    }
    
    return {
      level,
      reason,
      data_source: weather.source,
      units: { wind: 'm/s', wave: 'm' }
    };
  }

  evaluateImpact(lat, lon) {
    let priorityAreas = [];
    try {
      priorityAreas = JSON.parse(process.env.POLLER_PRIORITY_AREAS_JSON || '[]');
    } catch (e) {
      return { level: 'UNKNOWN', reason: 'Priority areas configuration is invalid or missing.' };
    }
    
    if (priorityAreas.length === 0) {
      return { level: 'UNKNOWN', reason: 'No priority areas configured.' };
    }
    
    let closestArea = null;
    let minDistance = Infinity;
    
    for (const area of priorityAreas) {
      if (area.bbox && area.bbox.length === 4) {
        const dist = distanceToBbox(lat, lon, area.bbox);
        if (dist < minDistance) {
          minDistance = dist;
          closestArea = area.id;
        }
      }
    }
    
    let level = 'LOW';
    let reason = 'Vessel is far from configured coastal priority areas.';
    
    if (minDistance < 20) {
      level = 'CRITICAL';
      reason = `Approximated distance is ${minDistance.toFixed(1)} km from priority area (${closestArea}).`;
    } else if (minDistance < 100) {
      level = 'HIGH';
      reason = `Approximated distance is ${minDistance.toFixed(1)} km from priority area (${closestArea}).`;
    }
    
    return { level, reason, nearest_priority_area: closestArea, distance_km: minDistance };
  }

  async evaluateRisk(params) {
    let lat, lon, aisData = null;
    
    if (params.mmsi) {
      aisData = await this.getLatestAisPosition(params.mmsi);
      lat = aisData.lat;
      lon = aisData.lon;
    } else if (params.lat != null && params.lon != null) {
      lat = parseFloat(params.lat);
      lon = parseFloat(params.lon);
      if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        throw { code: 'VALIDATION', message: 'Invalid coordinates' };
      }
    } else {
      throw { code: 'VALIDATION', message: 'Must provide either mmsi, or lat and lon' };
    }
    
    const weather = await this.fetchWeather(lat, lon);
    
    const likelihood = this.evaluateLikelihood(aisData);
    const transport = this.evaluateTransport(weather);
    const impact = this.evaluateImpact(lat, lon);
    
    return {
      metadata: {
        timestamp: new Date().toISOString(),
        input: params,
        resolved_coordinates: { lat, lon },
        ais_staleness_hours: aisData ? aisData.age_hours : null
      },
      weather,
      assessments: {
        spill_likelihood: likelihood,
        environmental_transport: transport,
        potential_impact: impact
      }
    };
  }

  async evaluateRegionRisk(regionId) {
    let priorityAreas = [];
    try {
      priorityAreas = JSON.parse(process.env.POLLER_PRIORITY_AREAS_JSON || '[]');
    } catch (e) {
      throw { code: 'VALIDATION', message: 'Priority areas configuration is invalid or missing.' };
    }
    
    const region = priorityAreas.find(a => a.id === regionId);
    if (!region) {
      throw { code: 'NOT_FOUND', message: `Region ${regionId} not found.` };
    }

    const REGION_LABELS = {
      'karnataka_coast_in': 'Karnataka Coast',
      'mumbai_high_in': 'Mumbai High',
      'chennai_port_in': 'Chennai Port',
      'colombo_anchorage_lk': 'Colombo Anchorage',
      'hambantota_lk': 'Hambantota',
      'fujairah_anchorage_ae': 'Fujairah Anchorage'
    };
    const regionLabel = REGION_LABELS[region.id] || region.id;

    const bbox = region.bbox;
    // Calculate centroid
    const lat = (bbox[1] + bbox[3]) / 2;
    const lon = (bbox[0] + bbox[2]) / 2;
    
    // Fetch weather at centroid
    const weather = await this.fetchWeather(lat, lon);
    
    // Query postgis for recent 24h
    const currentQuery = `
      SELECT COUNT(DISTINCT mmsi) as unique_vessels, MAX(timestamp) as latest_obs
      FROM live_ais
      WHERE timestamp >= NOW() - INTERVAL '24 hours'
        AND ST_Intersects(geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))
    `;
    
    const priorQuery = `
      SELECT COUNT(DISTINCT mmsi) as unique_vessels
      FROM live_ais
      WHERE timestamp >= NOW() - INTERVAL '48 hours'
        AND timestamp < NOW() - INTERVAL '24 hours'
        AND ST_Intersects(geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))
    `;
    
    const bboxParams = [bbox[0], bbox[1], bbox[2], bbox[3]];
    
    let currentRes, priorRes;
    try {
      currentRes = await pool.query(currentQuery, bboxParams);
      priorRes = await pool.query(priorQuery, bboxParams);
    } catch (dbErr) {
      throw { code: 'DB_ERROR', message: `Database query failed: ${dbErr.message}` };
    }
    
    const currentCount = (currentRes.rows && currentRes.rows.length > 0) ? parseInt(currentRes.rows[0].unique_vessels, 10) || 0 : 0;
    const latestObs = (currentRes.rows && currentRes.rows.length > 0) ? currentRes.rows[0].latest_obs || null : null;
    const priorCount = (priorRes.rows && priorRes.rows.length > 0) ? parseInt(priorRes.rows[0].unique_vessels, 10) || 0 : 0;
    
    // Anomaly calculation
    let traffic_anomaly = 'UNDETERMINED';
    let traffic_reason = 'Insufficient historical baseline.';
    
    if (currentCount === 0) {
      traffic_anomaly = 'NO_OBSERVATIONS';
      traffic_reason = 'No vessels detected in the region during the last 24h.';
    } else if (priorCount > 0) {
      const ratio = currentCount / priorCount;
      if (ratio > 1.5) {
        traffic_anomaly = 'HIGH';
        traffic_reason = `Traffic is ${(ratio*100).toFixed(0)}% of the prior 24h period. Significant increase.`;
      } else if (ratio < 0.5) {
        traffic_anomaly = 'LOW';
        traffic_reason = `Traffic is ${(ratio*100).toFixed(0)}% of the prior 24h period. Significant decrease.`;
      } else {
        traffic_anomaly = 'NORMAL';
        traffic_reason = 'Traffic volume is consistent with prior 24h period.';
      }
    }
    
    const transport = this.evaluateTransport(weather);
    
    let monitoring_priority = 'LOW';
    let priority_reason = 'Normal conditions. Environmental tracking not urgent.';
    
    if (currentCount === 0) {
      monitoring_priority = 'INSUFFICIENT_DATA';
      priority_reason = 'Cannot determine monitoring priority due to lack of recent AIS coverage in this region.';
    } else if (traffic_anomaly === 'HIGH' || transport.level === 'HIGH') {
      monitoring_priority = 'HIGH';
      priority_reason = 'Elevated vessel traffic or severe environmental conditions warrant closer monitoring.';
    } else if (traffic_anomaly === 'UNDETERMINED' && currentCount > 10) {
       monitoring_priority = 'MEDIUM';
       priority_reason = 'Moderate volume but missing baseline to confirm anomaly.';
    }
    
    const assessment = {
      metadata: {
        timestamp: new Date().toISOString(),
        region: regionId,
        resolved_centroid: { lat, lon },
        latest_observation: latestObs,
        data_coverage: latestObs ? 'Recent observations found.' : 'No observations found in last 24h.'
      },
      weather,
      assessments: {
        vessel_activity: {
          unique_vessels_24h: currentCount,
          time_window: 'Last 24 hours'
        },
        traffic_anomaly: {
          level: traffic_anomaly,
          reason: traffic_reason,
          prior_count: priorCount > 0 ? priorCount : null,
          baseline_period: 'Previous 24-48 hours'
        },
        environmental_transport: transport,
        geographic_exposure: {
          level: 'HIGH',
          reason: `Region ${regionLabel} is a configured priority area.`
        },
        monitoring_priority: {
          level: monitoring_priority,
          reason: priority_reason
        }
      }
    };

    // Do not cache/persist if weather fetch failed
    const hasWeatherError = weather.errors && (weather.errors.marine || weather.errors.weather || weather.errors.fetch);
    if (!hasWeatherError) {
      try {
        await pool.query(
          `INSERT INTO pre_spill_region_risk (region_id, risk_data)
           VALUES ($1, $2)
           ON CONFLICT (region_id) 
           DO UPDATE SET risk_data = EXCLUDED.risk_data, timestamp = NOW()`,
          [regionId, JSON.stringify(assessment)]
        );
      } catch (e) {
        console.error(`[pre-spill-risk] DB persist error for ${regionId}:`, e.message);
      }
    }

    return assessment;
  }

  // Deduplication map for in-flight requests
  _inFlight = new Map();
  _timer = null;

  async getRegionRisk(regionId) {
    try {
      // 1. Try to fetch from DB first
      const { rows } = await pool.query(
        `SELECT risk_data, timestamp FROM pre_spill_region_risk WHERE region_id = $1`,
        [regionId]
      );
      if (rows.length > 0) {
        const ageHours = (Date.now() - new Date(rows[0].timestamp).getTime()) / (1000 * 60 * 60);
        // If fresher than 2 hours, return it
        if (ageHours < 2) {
          const data = rows[0].risk_data;
          data.metadata = data.metadata || {};
          data.metadata.cached = true;
          data.metadata.age_hours = ageHours;
          return data;
        }
      }
    } catch (e) {
      console.warn(`[pre-spill-risk] DB read error for ${regionId}:`, e.message);
    }

    // 2. Fetch or wait for in-flight fetch
    if (this._inFlight.has(regionId)) {
      return this._inFlight.get(regionId);
    }

    const promise = this.evaluateRegionRisk(regionId).finally(() => {
      this._inFlight.delete(regionId);
    });
    this._inFlight.set(regionId, promise);
    return promise;
  }

  startScheduler() {
    if (this._timer) return;
    console.log('[pre-spill-risk] Starting scheduler...');
    
    const run = async () => {
      let priorityAreas = [];
      try {
        priorityAreas = JSON.parse(process.env.POLLER_PRIORITY_AREAS_JSON || '[]');
      } catch (e) {}

      for (const area of priorityAreas) {
        try {
          if (!this._inFlight.has(area.id)) {
            const promise = this.evaluateRegionRisk(area.id).finally(() => {
              this._inFlight.delete(area.id);
            });
            this._inFlight.set(area.id, promise);
            await promise;
          }
        } catch (e) {
          console.error(`[pre-spill-risk] Scheduler error for ${area.id}:`, e.message);
        }
      }
    };
    
    // Run immediately and every 1 hour
    run();
    this._timer = setInterval(run, 60 * 60 * 1000);
    if (this._timer.unref) this._timer.unref();
  }

  stopScheduler() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}

module.exports = new PreSpillRiskService();
