import React from "react";
import { Loader2, AlertTriangle, Clock, MapPin, Database } from "lucide-react";
import styles from "./overview.module.css";
import { getIncidentLabel } from "../../api/incidents";
import { StatusDot } from "../ui-kit";

// Use the same UTC formatting helper from overview.tsx
const utc = (iso: string) => {
  if (!iso) return "N/A";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
};

interface IncidentListProps {
  history: any[];
  historyLoading: boolean;
  historyError: Error | null;
  activeReportId: string;
  setActiveReportId: (id: string) => void;
  refetchHistory: () => void;
}

export function IncidentList({
  history,
  historyLoading,
  historyError,
  activeReportId,
  setActiveReportId,
  refetchHistory,
}: IncidentListProps) {
  if (historyError) {
    return (
      <div className={`${styles.card} overflow-hidden flex flex-col min-h-[400px]`}>
        <header className="flex items-center justify-between border-b border-white/5 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-1 h-4 rounded-full bg-[#22D3EE]" />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8FA3B5] font-mono">
              Recent Incidents
            </h2>
          </div>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-md border border-[#F87171]/20 bg-[#F87171]/5">
            <AlertTriangle className="h-5 w-5 text-[#F87171]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#E6EEF5]">Failed to load history</p>
            <p className="text-xs text-[#8FA3B5] mt-1">{historyError.message}</p>
          </div>
          <button
            onClick={refetchHistory}
            className="rounded border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-mono text-[#E6EEF5] hover:bg-white/10 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (historyLoading && history.length === 0) {
    return (
      <div className={`${styles.card} overflow-hidden flex flex-col min-h-[400px]`}>
        <header className="flex items-center justify-between border-b border-white/5 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-1 h-4 rounded-full bg-[#22D3EE]" />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8FA3B5] font-mono">
              Recent Incidents
            </h2>
          </div>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
          <Loader2 className="h-6 w-6 animate-spin text-[#22D3EE]" />
          <p className="text-xs text-[#8FA3B5] font-mono">Loading history...</p>
        </div>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className={`${styles.card} overflow-hidden flex flex-col min-h-[400px]`}>
        <header className="flex items-center justify-between border-b border-white/5 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-1 h-4 rounded-full bg-[#22D3EE]" />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8FA3B5] font-mono">
              Recent Incidents
            </h2>
          </div>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-white/5">
            <Database className="h-5 w-5 text-[#8FA3B5]" />
          </div>
          <p className="text-sm font-semibold text-[#E6EEF5]">No incidents found</p>
          <p className="text-xs text-[#8FA3B5]">The database is currently empty.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.card} overflow-hidden flex flex-col h-full max-h-[500px]`}>
      <header className="flex items-center justify-between border-b border-white/5 px-5 py-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-1 h-4 rounded-full bg-[#22D3EE]" />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8FA3B5] font-mono">
            Recent Incidents
          </h2>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent">
        <div className="flex flex-col divide-y divide-white/5">
          {history.map((incident) => {
            const isActive = incident.id === activeReportId;
            const isDemo = incident.mode === "DEMO" || !incident.mode;

            return (
              <button
                key={incident.id}
                onClick={() => setActiveReportId(incident.id)}
                className={`text-left p-4 transition-colors hover:bg-white/5 ${
                  isActive
                    ? "bg-white/5 border-l-2 border-[#22D3EE]"
                    : "border-l-2 border-transparent"
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="font-semibold text-sm text-[#E6EEF5] truncate pr-2 font-mono">
                    {getIncidentLabel(incident)}
                  </div>
                  {isDemo ? (
                    <span className="shrink-0 rounded border border-[#FB923C]/30 bg-[#FB923C]/10 px-1.5 py-0.5 text-[9px] font-mono font-semibold uppercase tracking-wider text-[#FB923C]">
                      Demo
                    </span>
                  ) : (
                    <span className="shrink-0 rounded border border-[#34D399]/30 bg-[#34D399]/10 px-1.5 py-0.5 text-[9px] font-mono font-semibold uppercase tracking-wider text-[#34D399]">
                      {incident.mode}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 mb-2.5">
                  <StatusDot label={incident.outcome ?? incident.status} />
                </div>

                <div className="flex items-center gap-4 text-[11px] font-mono text-[#8FA3B5]">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {utc(incident.acquiredAt)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
