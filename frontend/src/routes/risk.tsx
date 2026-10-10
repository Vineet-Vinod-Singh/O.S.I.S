import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ShieldAlert,
  Ship,
  MapPin,
  AlertTriangle,
  Info,
  Wind,
  Waves,
  Navigation,
  ActivitySquare,
} from "lucide-react";
import { Panel, KeyVal } from "../components/ui-kit";

export const Route = createFileRoute("/risk")({
  head: () => ({
    meta: [
      { title: "Pre-Spill Maritime Risk Engine — O.S.I.S." },
      { name: "description", content: "Evaluate predictive marine conditions and vessel risk." },
    ],
  }),
  component: RiskPage,
});

const PRIORITY_AREAS = [
  { id: "karnataka_coast_in", lat: 13.24, lon: 74.74, label: "Karnataka Coast" },
  { id: "mumbai_high_in", lat: 19.39, lon: 71.49, label: "Mumbai High" },
  { id: "chennai_port_in", lat: 13.09, lon: 80.39, label: "Chennai Port" },
  { id: "colombo_anchorage_lk", lat: 6.99, lon: 79.79, label: "Colombo Anchorage" },
  { id: "hambantota_lk", lat: 6.09, lon: 81.19, label: "Hambantota" },
  { id: "fujairah_anchorage_ae", lat: 25.19, lon: 56.39, label: "Fujairah Anchorage" },
];

function RiskPage() {
  const [inputType, setInputType] = useState<"mmsi" | "coord" | "region">("region");
  const [mmsi, setMmsi] = useState("123456789");
  const [lat, setLat] = useState("19.39");
  const [lon, setLon] = useState("71.49");
  const [regionId, setRegionId] = useState("karnataka_coast_in");

  const [queryKey, setQueryKey] = useState<any>(null);

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["risk", queryKey],
    queryFn: async () => {
      if (!queryKey) return null;
      let url = "";
      if (queryKey.region) {
        url = `http://localhost:5000/api/risk/evaluate-region?region=${queryKey.region}`;
      } else {
        url = `http://localhost:5000/api/risk/evaluate?`;
        if (queryKey.mmsi) url += `mmsi=${queryKey.mmsi}`;
        else url += `lat=${queryKey.lat}&lon=${queryKey.lon}`;
      }

      const res = await fetch(url);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Status ${res.status}`);
      }
      return res.json();
    },
    enabled: !!queryKey,
    retry: false,
  });

  const handleEvaluate = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputType === "mmsi") {
      setQueryKey({ mmsi: mmsi.trim() });
    } else if (inputType === "coord") {
      setQueryKey({ lat: parseFloat(lat), lon: parseFloat(lon) });
    } else {
      setQueryKey({ region: regionId });
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto py-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2 font-mono text-xs text-[var(--accent-blue)] uppercase tracking-wider">
          <ShieldAlert className="h-4 w-4" />
          Pre-Spill Maritime Risk Engine
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground font-sans">
          Proactive Risk &amp; Environmental Exposure
        </h1>
        <p className="text-sm text-muted-foreground">
          Evaluate vessel profiles, marine weather conditions, and proximity to sensitive coastal
          areas before an incident occurs.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[300px_1fr]">
        <Panel title="Evaluation Parameters">
          <form onSubmit={handleEvaluate} className="space-y-4">
            <div className="flex gap-1 bg-secondary p-1 rounded-md">
              <button
                type="button"
                onClick={() => setInputType("region")}
                className={`flex-1 text-xs py-1.5 rounded ${inputType === "region" ? "bg-background shadow-sm font-semibold text-foreground" : "text-muted-foreground"}`}
              >
                Region
              </button>
              <button
                type="button"
                onClick={() => setInputType("mmsi")}
                className={`flex-1 text-xs py-1.5 rounded ${inputType === "mmsi" ? "bg-background shadow-sm font-semibold text-foreground" : "text-muted-foreground"}`}
              >
                MMSI
              </button>
              <button
                type="button"
                onClick={() => setInputType("coord")}
                className={`flex-1 text-xs py-1.5 rounded ${inputType === "coord" ? "bg-background shadow-sm font-semibold text-foreground" : "text-muted-foreground"}`}
              >
                Coord
              </button>
            </div>

            {inputType === "mmsi" && (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-foreground">
                  Vessel MMSI (live_ais)
                </label>
                <input
                  type="text"
                  value={mmsi}
                  onChange={(e) => setMmsi(e.target.value)}
                  className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-[var(--accent-blue)]"
                  placeholder="e.g. 123456789"
                  required
                />
                <p className="text-[10px] text-muted-foreground">
                  Checks the live AIS ingestion buffer for the latest transmitted position.
                </p>
              </div>
            )}

            {inputType === "coord" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground">Latitude</label>
                    <input
                      type="number"
                      step="any"
                      required
                      value={lat}
                      onChange={(e) => setLat(e.target.value)}
                      className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground">Longitude</label>
                    <input
                      type="number"
                      step="any"
                      required
                      value={lon}
                      onChange={(e) => setLon(e.target.value)}
                      className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm"
                    />
                  </div>
                </div>
              </div>
            )}

            {inputType === "region" && (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-foreground">Priority Region</label>
                <select
                  className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none"
                  value={regionId}
                  onChange={(e) => setRegionId(e.target.value)}
                  required
                >
                  <option value="" disabled>
                    Select preset region...
                  </option>
                  {PRIORITY_AREAS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground">
                  Aggregates regional traffic density and monitors environmental anomalies.
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={isFetching}
              className="w-full bg-primary text-primary-foreground font-semibold rounded py-2 text-sm hover:opacity-90 disabled:opacity-50"
            >
              {isFetching ? "Evaluating..." : "Run Risk Evaluation"}
            </button>
          </form>
        </Panel>

        <div className="space-y-6">
          {!queryKey && !data && !isLoading && !isError && (
            <Panel className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
              <ShieldAlert className="h-10 w-10 mb-4 opacity-20" />
              <p className="text-sm font-medium">No Evaluation Active</p>
              <p className="text-xs max-w-xs mt-2">
                Enter an MMSI, coordinates, or select a region on the left to evaluate pre-spill
                maritime risk.
              </p>
            </Panel>
          )}

          {isFetching && (
            <Panel className="flex flex-col items-center justify-center py-16 text-center space-y-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p className="text-sm font-medium text-foreground">
                Fetching environment and routing data...
              </p>
            </Panel>
          )}

          {isError && (
            <Panel className="border-red-500/50 bg-red-500/5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5" />
                <div>
                  <h3 className="text-sm font-bold text-red-500">Evaluation Failed</h3>
                  <p className="text-xs text-red-400/80 mt-1">
                    {error instanceof Error ? error.message : "Unknown error"}
                  </p>
                </div>
              </div>
            </Panel>
          )}

          {data && !isFetching && !queryKey?.region && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                {/* Likelihood */}
                <div
                  className={`rounded-xl border p-4 shadow-sm ${
                    data.assessments.spill_likelihood.level === "HIGH"
                      ? "bg-red-500/10 border-red-500/30"
                      : data.assessments.spill_likelihood.level === "MEDIUM"
                        ? "bg-amber-500/10 border-amber-500/30"
                        : "bg-card border-border"
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    <Ship className="h-4 w-4" /> Likelihood
                  </div>
                  <div className="text-xl font-bold font-mono text-foreground mb-1">
                    {data.assessments.spill_likelihood.level}
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    {data.assessments.spill_likelihood.reason}
                  </div>
                </div>

                {/* Transport */}
                <div
                  className={`rounded-xl border p-4 shadow-sm ${
                    data.assessments.environmental_transport.level === "HIGH"
                      ? "bg-red-500/10 border-red-500/30"
                      : data.assessments.environmental_transport.level === "MEDIUM"
                        ? "bg-amber-500/10 border-amber-500/30"
                        : "bg-card border-border"
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    <Wind className="h-4 w-4" /> Transport &amp; Response
                  </div>
                  <div className="text-xl font-bold font-mono text-foreground mb-1">
                    {data.assessments.environmental_transport.level}
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    {data.assessments.environmental_transport.reason}
                  </div>
                </div>

                {/* Impact */}
                <div
                  className={`rounded-xl border p-4 shadow-sm ${
                    data.assessments.potential_impact.level === "CRITICAL"
                      ? "bg-red-500/10 border-red-500/30"
                      : data.assessments.potential_impact.level === "HIGH"
                        ? "bg-amber-500/10 border-amber-500/30"
                        : "bg-card border-border"
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    <MapPin className="h-4 w-4" /> Exposure Impact
                  </div>
                  <div className="text-xl font-bold font-mono text-foreground mb-1">
                    {data.assessments.potential_impact.level}
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    {data.assessments.potential_impact.reason}
                  </div>
                </div>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <Panel title="Environmental Readings">
                  <div className="space-y-3 font-mono text-xs">
                    <KeyVal k="Source" v={data.weather.source} />
                    <KeyVal
                      k="Fetch Timestamp"
                      v={new Date(data.weather.timestamp).toLocaleString()}
                    />
                    <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-border/50">
                      <div className="bg-secondary/50 rounded p-2">
                        <div className="text-[10px] text-muted-foreground flex items-center gap-1 mb-1">
                          <Wind className="h-3 w-3" /> Wind (10m)
                        </div>
                        <div className="font-bold">
                          {data.weather.wind_speed_ms !== null
                            ? `${data.weather.wind_speed_ms} m/s`
                            : "N/A"}
                        </div>
                      </div>
                      <div className="bg-secondary/50 rounded p-2">
                        <div className="text-[10px] text-muted-foreground flex items-center gap-1 mb-1">
                          <Waves className="h-3 w-3" /> Wave Height
                        </div>
                        <div className="font-bold">
                          {data.weather.wave_height_m !== null
                            ? `${data.weather.wave_height_m} m`
                            : "N/A"}
                        </div>
                      </div>
                    </div>
                    {data.weather.errors &&
                      (data.weather.errors.marine || data.weather.errors.weather) && (
                        <div className="text-[10px] text-amber-500 mt-2">
                          Partial fetch error occurred (check connectivity).
                        </div>
                      )}
                  </div>
                </Panel>

                <Panel title="Evaluation Provenance">
                  <div className="space-y-3 font-mono text-xs">
                    <KeyVal
                      k="Resolved Lat"
                      v={data.metadata.resolved_coordinates.lat.toFixed(4)}
                    />
                    <KeyVal
                      k="Resolved Lon"
                      v={data.metadata.resolved_coordinates.lon.toFixed(4)}
                    />

                    {data.metadata.input.mmsi && (
                      <>
                        <KeyVal k="Input MMSI" v={data.metadata.input.mmsi} />
                        <KeyVal
                          k="AIS Staleness"
                          v={
                            data.metadata.ais_staleness_hours !== null
                              ? `${data.metadata.ais_staleness_hours.toFixed(2)} hours`
                              : "Unknown"
                          }
                        />
                      </>
                    )}

                    <div className="border-t border-border/50 pt-3 mt-3 space-y-1">
                      <div className="flex gap-2 items-start text-[10px] text-muted-foreground">
                        <Info className="h-3 w-3 mt-0.5 shrink-0" />
                        <p>
                          Likelihood is heuristic only. Weather alone does not indicate a spill.
                          Bounding box distance is approximate.
                        </p>
                      </div>
                    </div>
                  </div>
                </Panel>
              </div>
            </div>
          )}

          {data && !isFetching && queryKey?.region && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                {/* Traffic Anomaly */}
                <div
                  className={`rounded-xl border p-4 shadow-sm ${
                    data.assessments.traffic_anomaly.level === "HIGH"
                      ? "bg-red-500/10 border-red-500/30"
                      : data.assessments.traffic_anomaly.level === "LOW"
                        ? "bg-amber-500/10 border-amber-500/30"
                        : data.assessments.traffic_anomaly.level === "UNDETERMINED"
                          ? "bg-secondary/40 border-border"
                          : "bg-card border-border"
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    <ActivitySquare className="h-4 w-4" /> Traffic Anomaly
                  </div>
                  <div className="text-xl font-bold font-mono text-foreground mb-1">
                    {data.assessments.traffic_anomaly.level}
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    {data.assessments.traffic_anomaly.reason}
                  </div>
                </div>

                {/* Transport */}
                <div
                  className={`rounded-xl border p-4 shadow-sm ${
                    data.assessments.environmental_transport.level === "HIGH"
                      ? "bg-red-500/10 border-red-500/30"
                      : data.assessments.environmental_transport.level === "MEDIUM"
                        ? "bg-amber-500/10 border-amber-500/30"
                        : "bg-card border-border"
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    <Wind className="h-4 w-4" /> Environment
                  </div>
                  <div className="text-xl font-bold font-mono text-foreground mb-1">
                    {data.assessments.environmental_transport.level}
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    {data.assessments.environmental_transport.reason}
                  </div>
                </div>

                {/* Priority */}
                <div
                  className={`rounded-xl border p-4 shadow-sm ${
                    data.assessments.monitoring_priority.level === "HIGH"
                      ? "bg-red-500/10 border-red-500/30"
                      : data.assessments.monitoring_priority.level === "MEDIUM"
                        ? "bg-amber-500/10 border-amber-500/30"
                        : "bg-card border-border"
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    <ShieldAlert className="h-4 w-4" /> Monitoring Priority
                  </div>
                  <div className="text-xl font-bold font-mono text-foreground mb-1">
                    {data.assessments.monitoring_priority.level}
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    {data.assessments.monitoring_priority.reason}
                  </div>
                </div>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <Panel title="Vessel Activity (24h)">
                  <div className="space-y-3 font-mono text-xs">
                    <KeyVal
                      k="Unique Vessels"
                      v={`${data.assessments.vessel_activity.unique_vessels_24h} tracked`}
                    />
                    <KeyVal
                      k="Prior Baseline"
                      v={
                        data.assessments.traffic_anomaly.prior_count !== null
                          ? `${data.assessments.traffic_anomaly.prior_count} vessels`
                          : "Insufficient Data"
                      }
                    />
                    <KeyVal
                      k="Latest Observation"
                      v={
                        data.metadata.latest_observation
                          ? new Date(data.metadata.latest_observation).toLocaleString()
                          : "None"
                      }
                    />
                    <div className="border-t border-border/50 pt-3 mt-3 space-y-1">
                      <div className="flex gap-2 items-start text-[10px] text-muted-foreground">
                        <Info className="h-3 w-3 mt-0.5 shrink-0" />
                        <p>{data.metadata.data_coverage}</p>
                      </div>
                    </div>
                  </div>
                </Panel>

                <Panel title="Environmental Readings">
                  <div className="space-y-3 font-mono text-xs">
                    <KeyVal k="Source" v={data.weather.source} />
                    <KeyVal
                      k="Centroid"
                      v={`${data.metadata.resolved_centroid.lat.toFixed(4)}, ${data.metadata.resolved_centroid.lon.toFixed(4)}`}
                    />
                    <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-border/50">
                      <div className="bg-secondary/50 rounded p-2">
                        <div className="text-[10px] text-muted-foreground flex items-center gap-1 mb-1">
                          <Wind className="h-3 w-3" /> Wind (10m)
                        </div>
                        <div className="font-bold">
                          {data.weather.wind_speed_ms !== null
                            ? `${data.weather.wind_speed_ms} m/s`
                            : "N/A"}
                        </div>
                      </div>
                      <div className="bg-secondary/50 rounded p-2">
                        <div className="text-[10px] text-muted-foreground flex items-center gap-1 mb-1">
                          <Waves className="h-3 w-3" /> Wave Height
                        </div>
                        <div className="font-bold">
                          {data.weather.wave_height_m !== null
                            ? `${data.weather.wave_height_m} m`
                            : "N/A"}
                        </div>
                      </div>
                    </div>
                    {data.weather.errors &&
                      (data.weather.errors.marine || data.weather.errors.weather) && (
                        <div className="text-[10px] text-amber-500 mt-2">
                          Partial fetch error occurred (check connectivity).
                        </div>
                      )}
                  </div>
                </Panel>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
