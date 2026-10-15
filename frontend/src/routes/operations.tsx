import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  getIngestionQueue,
  getIngestionStatus,
  getWorkerStatus,
  replayScene,
  recoverStale,
} from "../api/operations";
import { analyzeIncident } from "../api/incidents";
import { useIncident } from "../context/IncidentContext";
import { Panel, StatusDot } from "../components/ui-kit";
import styles from "../components/overview/overview.module.css";
import {
  Activity,
  Database,
  Server,
  Loader2,
  ArrowRight,
  HardDrive,
  Cpu,
  AlertTriangle,
} from "lucide-react";

export const Route = createFileRoute("/operations")({
  component: OperationsDashboard,
});

function OperationsDashboard() {
  const navigate = useNavigate();
  const { setActiveReportId } = useIncident();

  const {
    data: ingestion,
    isLoading: ingestionLoading,
    error: ingestionError,
  } = useQuery({
    queryKey: ["ingestionStatus"],
    queryFn: getIngestionStatus,
    refetchInterval: (query) => (query.state.error ? 30000 : 5000),
  });

  const {
    data: worker,
    isLoading: workerLoading,
    error: workerError,
  } = useQuery({
    queryKey: ["workerStatus"],
    queryFn: getWorkerStatus,
    refetchInterval: (query) => (query.state.error ? 30000 : 5000),
  });

  const {
    data: queue,
    isLoading: queueLoading,
    error: queueError,
    refetch: refetchQueue,
  } = useQuery({
    queryKey: ["ingestionQueue"],
    queryFn: () => getIngestionQueue("all", 50, 0),
    refetchInterval: (query) => (query.state.error ? 30000 : 5000),
  });

  const analyzeMutation = useMutation({
    mutationFn: async (sceneId: string) => {
      const report = await analyzeIncident({ mode: "REAL", sceneId, forecastHours: 24 });
      return report;
    },
    onSuccess: (report) => {
      navigate({ to: "/analysis", search: { id: report.id } });
    },
  });

  const replayMutation = useMutation({
    mutationFn: replayScene,
    onSuccess: () => refetchQueue(),
  });

  const recoverStaleMutation = useMutation({
    mutationFn: recoverStale,
    onSuccess: () => refetchQueue(),
  });

  const utc = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? iso
      : `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)}Z`;
  };

  const mapErrorMessage = (msg: string) => {
    if (!msg) return msg;
    if (msg.startsWith("[detection_failed]")) return "SAR Detection Pipeline Failed";
    if (msg.startsWith("[unavailable]")) return "Data Source Unavailable";
    if (msg.includes("REAL_DATA_UNAVAILABLE")) return "Live Data Pipeline Offline";
    return msg;
  };

  const quickQueueStats = Object.entries(ingestion?.db.sceneCounts ?? {})
    .filter(([key]) => ["queued", "processing", "completed", "failed"].includes(key))
    .map(([key, value]) => ({
      key,
      value: Number(value) || 0,
      label: key.replace(/^(.)/, (_, c) => c.toUpperCase()),
    }));

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 pb-20">
      <div>
        <div className="mb-2 flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--primary)]">
          <Activity className="h-3.5 w-3.5" />
          <span>System Telemetry</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Operations Center</h1>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          Monitor autonomous Sentinel-1 acquisition and processing queue.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_1.05fr_0.9fr]">
        <Panel className={`${styles.card} ${styles.interactiveCard} space-y-3 p-4`}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Database className="h-4 w-4 text-[var(--primary)]" />
              CDSE Ingestion Poller
            </h2>
            {ingestionError ? (
              <StatusDot label="OFFLINE" />
            ) : (
              <StatusDot label={ingestion?.poller.running ? "ACTIVE" : "STOPPED"} />
            )}
          </div>
          <div className="grid grid-cols-2 gap-4 rounded border border-border bg-secondary/30 p-3 font-mono text-xs text-muted-foreground">
            <div>
              <span className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
                Last Poll
              </span>
              <span className="text-foreground">{utc(ingestion?.poller.lastPollAt ?? null)}</span>
            </div>
            <div>
              <span className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
                DB Queued
              </span>
              <span className="text-foreground">{ingestion?.db.sceneCounts?.["queued"] ?? 0}</span>
            </div>
          </div>
        </Panel>

        <Panel className={`${styles.card} ${styles.interactiveCard} space-y-3 p-4`}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Cpu className="h-4 w-4 text-[var(--primary)]" />
              Acquisition Worker
            </h2>
            <div className="flex items-center gap-3">
              <button
                onClick={() => recoverStaleMutation.mutate()}
                disabled={recoverStaleMutation.isPending}
                className="rounded border border-border bg-secondary px-2 py-1 text-[11px] font-mono font-medium text-foreground transition-colors hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {recoverStaleMutation.isPending ? "RECOVERING..." : "RECOVER STALE"}
              </button>
              {workerError ? (
                <StatusDot label="OFFLINE" />
              ) : (
                <StatusDot
                  label={
                    worker?.status.running
                      ? worker?.status.inFlight
                        ? "PROCESSING"
                        : "IDLE"
                      : "STOPPED"
                  }
                />
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 rounded border border-border bg-secondary/30 p-3 font-mono text-xs text-muted-foreground">
            <div>
              <span className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
                Processed
              </span>
              <span className="text-foreground">{worker?.status.processedCount ?? 0}</span>
            </div>
            <div>
              <span className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
                Failed
              </span>
              <span className="text-foreground">{worker?.status.failedCount ?? 0}</span>
            </div>
            <div>
              <span className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
                Last Activity
              </span>
              <span className="text-foreground">{utc(worker?.status.lastActivity ?? null)}</span>
            </div>
          </div>
        </Panel>

        <Panel className={`${styles.card} ${styles.interactiveCard} space-y-3 p-4`}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Server className="h-4 w-4 text-[var(--primary)]" />
              Queue Snapshot
            </h2>
            <button
              type="button"
              onClick={() => refetchQueue()}
              className="rounded border border-border bg-secondary px-2 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:bg-secondary/80 hover:text-foreground"
            >
              Refresh
            </button>
          </div>
          <div className="space-y-2 rounded border border-border bg-secondary/30 p-3">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <span>Total</span>
              <span className="font-mono text-sm text-foreground">{queue?.total ?? 0}</span>
            </div>
            {quickQueueStats.map((item) => (
              <div key={item.key} className="flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <span>{item.label}</span>
                <span className="font-mono text-sm text-foreground">{item.value}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Server className="h-5 w-5 text-[var(--primary)]" />
            Processing Queue
          </h2>
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            <span>Visible</span>
            <span className="rounded border border-border bg-secondary px-2 py-1 text-foreground">
              {queue?.scenes.length ?? 0}
            </span>
          </div>
        </div>

        <div className={`${styles.card} ${styles.interactiveCard} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="border-b border-border bg-secondary/60 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Scene ID</th>
                  <th className="px-4 py-3 font-medium">Acquired (UTC)</th>
                  <th className="px-4 py-3 font-medium">
                    <span className="inline-flex items-center gap-2">
                      Status
                      {queueError && (
                        <AlertTriangle
                          className="h-3 w-3 text-destructive"
                          title="Connection error — queue may be stale"
                        />
                      )}
                    </span>
                  </th>
                  <th className="px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {queueLoading &&
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="animate-pulse border-b border-border/50">
                      <td className="px-4 py-3">
                        <div className="h-4 w-3/4 rounded bg-secondary" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-4 w-1/2 rounded bg-secondary" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-4 w-1/3 rounded bg-secondary" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-4 w-1/4 rounded bg-secondary" />
                      </td>
                    </tr>
                  ))}
                {!queueLoading &&
                  queue?.scenes.map((scene) => {
                    const isCompleted = scene.status === "completed";
                    const isFailed = scene.status === "failed";
                    const isProcessing = scene.status === "processing";
                    const detectionFailed =
                      isCompleted &&
                      !scene.incident_id &&
                      scene.error_message?.startsWith("[detection_failed]");

                    let displayStatus = scene.status.toUpperCase();
                    if (isCompleted) {
                      if (scene.incident_id) displayStatus = "ANALYSIS READY";
                      else if (detectionFailed) displayStatus = "ANALYSIS FAILED";
                      else displayStatus = "ANALYSIS PENDING";
                    } else if (isFailed) {
                      displayStatus = "ACQUISITION FAILED";
                    }

                    return (
                      <tr key={scene.id} className="transition-colors hover:bg-secondary/20">
                        <td className="px-4 py-3 font-mono">
                          <span
                            className="block max-w-[260px] truncate"
                            title={scene.scene_id}
                          >
                            {scene.scene_id}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {utc(scene.acquired_at)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusDot label={displayStatus} />
                          {scene.error_message && (
                            <div className="mt-1 flex items-center gap-1 text-[11px] text-rose-400">
                              <AlertTriangle className="h-3 w-3" />
                              <span className="max-w-[220px] truncate" title={scene.error_message}>
                                {mapErrorMessage(scene.error_message)}
                              </span>
                            </div>
                          )}
                          {scene.retry_count > 0 && (
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              Retries: {scene.retry_count}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {scene.incident_ids && scene.incident_ids.length > 0 ? (
                            <div className="flex flex-col gap-2">
                              {scene.incident_ids.map((id, idx) => (
                                <button
                                  key={id}
                                  onClick={() => {
                                    setActiveReportId(id);
                                    navigate({
                                      to: "/analysis",
                                      search: { id },
                                    });
                                  }}
                                  className="inline-flex items-center gap-1.5 rounded bg-[var(--primary)]/10 px-2.5 py-1 text-[11px] font-mono font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/70"
                                >
                                  VIEW TILE {idx + 1} <ArrowRight className="h-3 w-3" />
                                </button>
                              ))}
                            </div>
                          ) : scene.incident_id ? (
                            <button
                              onClick={() => {
                                setActiveReportId(scene.incident_id as string);
                                navigate({
                                  to: "/analysis",
                                  search: { id: scene.incident_id as string },
                                });
                              }}
                              className="inline-flex items-center gap-1.5 rounded bg-[var(--primary)]/10 px-2.5 py-1 text-[11px] font-mono font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/70"
                            >
                              VIEW ANALYSIS <ArrowRight className="h-3 w-3" />
                            </button>
                          ) : detectionFailed || isFailed ? (
                            <button
                              onClick={() => replayMutation.mutate(scene.scene_id)}
                              disabled={replayMutation.isPending}
                              className="inline-flex items-center gap-1.5 rounded border border-border bg-secondary px-2.5 py-1 text-[11px] font-mono font-medium text-foreground transition-colors hover:bg-secondary/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/70 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {replayMutation.isPending ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                "REPLAY"
                              )}
                            </button>
                          ) : isCompleted ? (
                            <button
                              onClick={() => analyzeMutation.mutate(scene.scene_id)}
                              disabled={analyzeMutation.isPending}
                              className="inline-flex items-center gap-1.5 rounded border border-border bg-secondary px-2.5 py-1 text-[11px] font-mono font-medium text-foreground transition-colors hover:bg-secondary/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/70 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {analyzeMutation.isPending ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                "ANALYZE PIPELINE"
                              )}
                            </button>
                          ) : (
                            <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                              {isProcessing ? "Working..." : "Waiting"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                {queue?.scenes.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-8 text-center font-mono text-muted-foreground"
                    >
                      Queue is empty
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
