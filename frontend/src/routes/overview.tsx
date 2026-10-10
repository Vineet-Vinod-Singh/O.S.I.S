import { createFileRoute, Link } from "@tanstack/react-router";
import { useIncident } from "../context/IncidentContext";
import { getIncidentLabel } from "../api/incidents";
import { OceanMap, Marker, MapGeoJSON, MapPolyline, MapCircle } from "../components/OceanMap";
import { OutcomeBadge } from "../components/ui-kit";
import {
  Radar,
  Compass,
  Ship,
  Users,
  AlertTriangle,
  Loader2,
  Layers,
  MapPin,
  Clock,
  LayoutDashboard,
} from "lucide-react";

import styles from "../components/overview/overview.module.css";
import { KpiCard } from "../components/overview/KpiCard";
import { PipelineStrip } from "../components/overview/PipelineStrip";
import { QuickAccess } from "../components/overview/QuickAccess";
import { IncidentList } from "../components/overview/IncidentList";

export const Route = createFileRoute("/overview")({
  head: () => ({
    meta: [
      {
        title: "O.S.I.S. — Oil Spill Identification & Source Attribution System",
      },
    ],
  }),
  component: OverviewDashboard,
});

const utc = (iso: string) => {
  if (!iso) return "N/A";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
};

function OverviewDashboard() {
  const {
    activeReport,
    autoLoading,
    historyLoading,
    historyError,
    refetchHistory,
    isSwitchingIncident,
    history,
    activeReportId,
    setActiveReportId,
  } = useIncident();

  if (autoLoading || historyLoading) {
    return (
      <div className={styles.overviewWrapper}>
        <div className="mx-auto max-w-5xl py-20 text-center space-y-6">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-md border border-[#22D3EE]/20 bg-[#22D3EE]/5">
            <Loader2 className="h-7 w-7 animate-spin text-[#22D3EE]" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#E6EEF5] font-mono tracking-wide">O.S.I.S.</h1>
            <p className="text-sm text-[#8FA3B5] mt-1.5">Initializing incident data…</p>
          </div>
        </div>
      </div>
    );
  }

  if (historyError) {
    return (
      <div className={styles.overviewWrapper}>
        <div className="mx-auto max-w-3xl py-16 space-y-8">
          <div className="text-center space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md border border-[#F87171]/20 bg-[#F87171]/5">
              <AlertTriangle className="h-6 w-6 text-[#F87171]" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-[#E6EEF5]">Connection Failed</h1>
            <p className="text-sm text-[#8FA3B5]">
              Backend server unreachable: {historyError.message}
            </p>
            <button
              onClick={() => refetchHistory()}
              className="inline-flex items-center gap-2 rounded-md bg-white/10 border border-white/20 px-5 py-2.5 text-xs font-mono font-semibold text-[#E6EEF5] mt-4 hover:bg-white/20 transition-colors"
            >
              Retry Connection
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!activeReport) {
    if (isSwitchingIncident) {
      return (
        <div className={`${styles.overviewWrapper} animate-pulse`}>
          <div className="mx-auto max-w-5xl py-8 space-y-6">
            <div className={`h-40 rounded-xl ${styles.card}`}></div>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className={`h-24 rounded-xl ${styles.card}`}></div>
              ))}
            </div>
            <div className={`h-96 rounded-xl ${styles.card}`}></div>
          </div>
        </div>
      );
    }
    return (
      <div className={styles.overviewWrapper}>
        <div className="mx-auto max-w-3xl py-16 space-y-8">
          <div className="text-center space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md border border-[#22D3EE]/20 bg-[#22D3EE]/5">
              <LayoutDashboard className="h-6 w-6 text-[#22D3EE]" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-[#E6EEF5]">O.S.I.S.</h1>
            <p className="text-sm text-[#8FA3B5]">
              Oil Spill Identification &amp; Source Attribution System
            </p>
          </div>
        </div>
      </div>
    );
  }

  const report = activeReport;
  const { spill, origin, candidates, outcome, backward } = report;
  const topCandidate = candidates[0] ?? null;
  const incidentLabel = getIncidentLabel(report);
  const isNoSpill = outcome === "NO_SPILL_DETECTED";
  const isDemo = report.mode === "DEMO" || !report.mode;
  const hasPolygon = !!spill?.geometry;
  const driftPath = backward ?? [];
  const hasDrift = driftPath.length > 0;

  const mapCenter: [number, number] = spill
    ? [spill.metrics.centroid.lat, spill.metrics.centroid.lon]
    : origin
      ? [origin.lat, origin.lon]
      : report.scene.bbox
        ? [
            (report.scene.bbox[1] + report.scene.bbox[3]) / 2,
            (report.scene.bbox[0] + report.scene.bbox[2]) / 2,
          ]
        : [15.25, 72.45];

  const pipelineSteps = [
    {
      stage: "Detection",
      label: "Satellite Spill Detection",
      icon: Radar,
      status: spill
        ? ("completed" as const)
        : isNoSpill
          ? ("completed" as const)
          : ("inconclusive" as const),
      statusBadge: spill ? "Completed" : isNoSpill ? "Clean (Completed)" : "Inconclusive",
      result: spill
        ? `Candidate spill identified (${spill.maskAreaKm2 ?? spill.metrics.areaKm2} km², ${(spill.confidence * 100).toFixed(0)}% confidence)`
        : isNoSpill
          ? "No dark-slick detected above backscatter threshold"
          : "SAR imagery classification inconclusive",
    },
    {
      stage: "Drift",
      label: "Hydrodynamic Drift & Origin",
      icon: Compass,
      status: origin
        ? ("completed" as const)
        : hasDrift
          ? report.stageStatus?.["forecast"]?.status === "partial"
            ? ("partial" as const)
            : ("completed" as const)
          : isNoSpill
            ? ("not_assessed" as const)
            : ("unavailable" as const),
      statusBadge: origin
        ? "Completed"
        : hasDrift
          ? report.stageStatus?.["forecast"]?.status === "partial"
            ? "Partial"
            : "Completed"
          : isNoSpill
            ? "Not Assessed"
            : "Unavailable",
      result: origin
        ? `${report.hindcastHours || 6}h Hindcast → Origin → ${report.forecastHours || 24}h Forecast (±${origin.uncertaintyKm} km)`
        : hasDrift
          ? report.stageStatus?.["forecast"]?.status === "partial"
            ? report.stageStatus?.["forecast"]?.reason || "Trajectory truncated"
            : `Drift trajectory computed (${driftPath.length} steps)`
          : isNoSpill
            ? "Drift analysis skipped — clean sea surface"
            : "Hydrodynamic advection data unavailable",
    },
    {
      stage: "AIS Correlation",
      label: "Spatiotemporal AIS Correlation",
      icon: Ship,
      status:
        candidates.length > 0
          ? ("completed" as const)
          : isNoSpill
            ? ("not_assessed" as const)
            : report?.stageStatus?.["ais"]?.status === "unavailable"
              ? ("unavailable" as const)
              : ("incomplete" as const),
      statusBadge:
        candidates.length > 0
          ? "Completed"
          : isNoSpill
            ? "Not Assessed"
            : report?.stageStatus?.["ais"]?.status === "unavailable"
              ? "Unavailable"
              : "No Candidates",
      result:
        candidates.length > 0
          ? `${candidates.length} candidate vessel${candidates.length !== 1 ? "s" : ""} correlated`
          : isNoSpill
            ? "Vessel correlation skipped — clean sea surface"
            : report?.stageStatus?.["ais"]?.status === "unavailable"
              ? "Historical AIS unavailable"
              : "No compatible vessels found within spatio-temporal window",
    },
    {
      stage: "Attribution",
      label: "Source Attribution & Ranking",
      icon: Users,
      status: topCandidate
        ? ("completed" as const)
        : isNoSpill
          ? ("not_assessed" as const)
          : ("inconclusive" as const),
      statusBadge: topCandidate ? "Completed" : isNoSpill ? "Not Assessed" : "Inconclusive",
      result: topCandidate
        ? `Leading candidate: ${topCandidate.name} (Score: ${topCandidate.score}/100)`
        : isNoSpill
          ? "Attribution not required"
          : report?.stageStatus?.["ais"]?.status === "unavailable"
            ? "Vessel attribution cannot be established."
            : "Source attribution inconclusive from current evidence",
    },
  ];

  const quickAccess = [
    {
      to: "/satellite",
      icon: Radar,
      iconColor: "text-[#22D3EE]",
      iconBg: "bg-[#22D3EE]/10",
      title: "Detection",
      desc: "SAR imagery analysis & spill geometry",
    },
    {
      to: "/backtracking",
      icon: Compass,
      iconColor: "text-[#FB923C]",
      iconBg: "bg-[#FB923C]/10",
      title: "Drift Analysis",
      desc: "Backward origin estimation & forward prediction",
    },
    {
      to: "/ais",
      icon: Ship,
      iconColor: "text-[#22D3EE]",
      iconBg: "bg-[#22D3EE]/10",
      title: "Vessel Attribution",
      desc: "AIS correlation & candidate ranking",
    },
    {
      to: "/analysis",
      icon: Layers,
      iconColor: "text-[#34D399]",
      iconBg: "bg-[#34D399]/10",
      title: "Full Investigation",
      desc: "Complete evidence report & technical details",
    },
  ];

  return (
    <div className={styles.overviewWrapper}>
      <div className="max-w-7xl mx-auto space-y-8">
        {/* SECTION B: Incident Heading */}
        <section
          className={
            styles.glassPanel +
            " p-6 flex flex-col md:flex-row md:items-start justify-between gap-6"
          }
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-[11px] font-mono text-[#22D3EE] uppercase tracking-[0.14em]">
              <LayoutDashboard className="h-3.5 w-3.5" />
              <span>Maritime Intelligence · Situational Awareness</span>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-bold tracking-tight text-[#E6EEF5] font-mono">
                  {incidentLabel}
                </h1>
                {isDemo ? (
                  <span className="rounded border border-[#FB923C]/30 bg-[#FB923C]/10 px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-[#FB923C]">
                    Synthetic Demo
                  </span>
                ) : (
                  <span className="rounded border border-[#34D399]/30 bg-[#34D399]/10 px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-[#34D399]">
                    {report.mode}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-[#8FA3B5]">
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-[#22D3EE]" />
                  {spill
                    ? `${spill.metrics.centroid.lat.toFixed(3)}°N, ${spill.metrics.centroid.lon.toFixed(3)}°E`
                    : report.scene.bbox
                      ? `${((report.scene.bbox[1] + report.scene.bbox[3]) / 2).toFixed(3)}°N, ${((report.scene.bbox[0] + report.scene.bbox[2]) / 2).toFixed(3)}°E`
                      : "Location unavailable"}
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-[#22D3EE]" />
                  {utc(report.scene.acquiredAt)}
                </span>
                <span>
                  Source: <strong className="text-[#E6EEF5]">{report.scene.source}</strong>
                </span>
                {report.scene.polarization && (
                  <span>
                    Pol:{" "}
                    <strong className="text-[#E6EEF5]">{String(report.scene.polarization)}</strong>
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="shrink-0 pt-2">
            <OutcomeBadge outcome={outcome ?? report.status} />
          </div>
        </section>

        {/* SECTION C: KPI Row */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <KpiCard
            isDominant
            label="Spill Area"
            value={spill ? `${spill.maskAreaKm2 ?? spill.metrics.areaKm2}` : isNoSpill ? "0" : "—"}
            detail={
              spill
                ? `km² · ${spill.metrics.lengthM.toFixed(0)}m × ${spill.metrics.widthM.toFixed(0)}m`
                : isNoSpill
                  ? "Clean surface"
                  : "SAR segmentation"
            }
            color="var(--ov-accent-cyan)"
          />
          <KpiCard
            label="Estimated Age"
            value={
              report.age
                ? `${report.age.minHours}-${report.age.maxHours}h`
                : isNoSpill
                  ? "N/A"
                  : "—"
            }
            detail={report.age ? `${report.age.confidence} confidence` : "Morphological window"}
            color="var(--ov-accent-amber)"
          />
          <KpiCard
            label="Confidence"
            value={spill ? `${(spill.confidence * 100).toFixed(0)}%` : isNoSpill ? "High" : "—"}
            detail={spill?.confidenceMeaning ?? "Classification quality"}
            color="var(--ov-accent-green)"
          />
          <KpiCard
            label="Origin"
            value={origin ? `${origin.lat.toFixed(3)}°N` : isNoSpill ? "N/A" : "—"}
            detail={
              origin
                ? `${origin.lon.toFixed(3)}°E · ±${origin.uncertaintyKm}km`
                : "Backtracked origin"
            }
            color="var(--ov-accent-amber)"
          />
          <KpiCard
            label="Vessels"
            value={candidates.length > 0 ? candidates.length : isNoSpill ? "N/A" : "0"}
            detail={topCandidate ? `Top: ${topCandidate.name}` : "AIS correlation"}
            color="var(--ov-accent-cyan)"
          />
        </section>

        {/* SECTION D: Main Workspace (Map + blank right col for Batch 2) */}
        <section className="grid grid-cols-1 xl:grid-cols-[60%_1fr] gap-6">
          <div className={`${styles.card} overflow-hidden flex flex-col`}>
            <header className="flex items-center justify-between border-b border-white/5 px-5 py-3">
              <div className="flex items-center gap-2.5">
                <div className="w-1 h-4 rounded-full bg-[#22D3EE]" />
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8FA3B5] font-mono">
                  Incident Map
                </h2>
              </div>
            </header>
            <div className="flex-1 relative min-h-[500px]">
              <OceanMap
                height={500}
                initialCenter={mapCenter}
                initialZoom={1.4}
                legend={
                  <div className="space-y-2 text-[11px] font-mono bg-[#070D14]/90 p-3 rounded border border-white/10 backdrop-blur-md">
                    <div className="font-semibold text-[#E6EEF5] border-b border-white/10 pb-1.5 mb-2">
                      MAP LAYERS
                    </div>
                    {hasPolygon && (
                      <div className="flex items-center gap-2 text-[#8FA3B5]">
                        <span className="inline-block h-2 w-2 rounded bg-[#38bdf8]" />
                        <span>Detected Spill</span>
                      </div>
                    )}
                    {origin && (
                      <div className="flex items-center gap-2 text-[#8FA3B5]">
                        <span className="inline-block h-2 w-2 rounded-full bg-[#FB923C]" />
                        <span>Estimated Origin</span>
                      </div>
                    )}
                    {hasDrift && (
                      <div className="flex items-center gap-2 text-[#8FA3B5]">
                        <span className="inline-block w-4 border-t-2 border-dashed border-[#FB923C]" />
                        <span>Drift Path</span>
                      </div>
                    )}
                    {candidates.length > 0 && (
                      <div className="flex items-center gap-2 text-[#8FA3B5]">
                        <span className="inline-block h-2 w-2 rounded-full bg-[#38bdf8]" />
                        <span>Vessels ({candidates.length})</span>
                      </div>
                    )}
                  </div>
                }
              >
                {hasPolygon && spill?.geometry && (
                  <MapGeoJSON
                    data={spill.geometry}
                    style={{ color: "#38bdf8", fillColor: "#38bdf8", fillOpacity: 0.25, weight: 2 }}
                  />
                )}
                {hasDrift && (
                  <MapPolyline
                    positions={driftPath.map((p) => [p.lat, p.lon])}
                    pathOptions={{
                      color: "#FB923C",
                      dashArray: "6 5",
                      weight: 2,
                      className: styles.driftLine,
                    }}
                  />
                )}
                {origin && (
                  <>
                    <Marker
                      lat={origin.lat}
                      lon={origin.lon}
                      color="#FB923C"
                      label="Estimated Origin"
                      pulse
                    />
                    <MapCircle
                      center={[origin.lat, origin.lon]}
                      radius={(origin.uncertaintyKm || 5) * 1000}
                      pathOptions={{
                        color: "#FB923C",
                        fillColor: "#FB923C",
                        fillOpacity: 0.08,
                        dashArray: "4 4",
                        weight: 1.5,
                      }}
                    />
                  </>
                )}
                {spill && (
                  <>
                    {[1.2, 0.8, 0.4].map((scale, i) => {
                      const rM = Math.sqrt(spill.metrics.areaKm2 / Math.PI) * 1000 * scale;
                      return (
                        <MapCircle
                          key={`spill-heat-${i}`}
                          center={[spill.metrics.centroid.lat, spill.metrics.centroid.lon]}
                          radius={rM}
                          pathOptions={{
                            color: "transparent",
                            fillColor: "#F87171",
                            fillOpacity: 0.15 + i * 0.1,
                            weight: 0,
                          }}
                        />
                      );
                    })}
                    <Marker
                      lat={spill.metrics.centroid.lat}
                      lon={spill.metrics.centroid.lon}
                      label="Detected Spill"
                      pulse
                    />
                  </>
                )}
                {candidates.map((c) => {
                  const last = c.track[c.track.length - 1];
                  if (!last) return null;
                  return (
                    <div key={c.mmsi}>
                      <MapPolyline
                        positions={c.track.map((p) => [p.latitude, p.longitude])}
                        pathOptions={{ color: "#64748b", weight: 1.5, opacity: 0.6 }}
                      />
                      <Marker
                        lat={last.latitude}
                        lon={last.longitude}
                        color="#94a3b8"
                        label={`${c.name} (${c.score})`}
                      />
                    </div>
                  );
                })}
              </OceanMap>
            </div>
          </div>

          {/* Recent Incidents Panel */}
          <div className="hidden xl:block">
            {history && (
              <IncidentList
                history={history}
                historyLoading={historyLoading}
                historyError={historyError}
                activeReportId={activeReportId}
                setActiveReportId={setActiveReportId}
                refetchHistory={refetchHistory}
              />
            )}
          </div>
        </section>

        {/* SECTION E: Pipeline Status */}
        <section>
          <div className="mb-4 flex items-center gap-2.5">
            <div className="w-1 h-4 rounded-full bg-[#22D3EE]" />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8FA3B5] font-mono">
              Investigation Pipeline
            </h2>
          </div>
          <PipelineStrip steps={pipelineSteps} />
        </section>

        {/* SECTION F: Quick Access */}
        <section>
          <div className="mb-4 flex items-center gap-2.5 mt-2">
            <div className="w-1 h-4 rounded-full bg-[#22D3EE]" />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8FA3B5] font-mono">
              Intelligence Modules
            </h2>
          </div>
          <QuickAccess cards={quickAccess} />
        </section>
      </div>
    </div>
  );
}
