import React from "react";
import styles from "./overview.module.css";
import { CheckCircle2, AlertTriangle, HelpCircle } from "lucide-react";

interface PipelineStep {
  stage: string;
  label: string;
  icon: React.ElementType;
  status: "completed" | "partial" | "unavailable" | "inconclusive" | "incomplete" | "not_assessed";
  statusBadge: string;
  result: string;
}

export function PipelineStrip({ steps }: { steps: PipelineStep[] }) {
  return (
    <div className="flex flex-col md:flex-row gap-4 w-full">
      {steps.map((step, i) => {
        const Icon = step.icon;
        const isCompleted = step.status === "completed";
        const isPartial = step.status === "partial";
        const isUnavailable = step.status === "unavailable";
        const isInconclusive = step.status === "inconclusive";
        const isIncomplete = step.status === "incomplete";

        const statusColor = isCompleted
          ? "text-[#34D399] border-[#34D399]/30 bg-[#34D399]/10"
          : isPartial
            ? "text-[#FB923C] border-[#FB923C]/40 bg-[#FB923C]/10"
            : isUnavailable || isInconclusive
              ? "text-[#FB923C] border-[#FB923C]/30 bg-[#FB923C]/10"
              : isIncomplete
                ? "text-[#8FA3B5] border-white/10 bg-white/5"
                : "text-[#8FA3B5] border-white/10 bg-white/5";

        const StatusIcon = isCompleted ? (
          <CheckCircle2 className="h-4 w-4 text-[#34D399]" />
        ) : isPartial || isUnavailable || isInconclusive ? (
          <AlertTriangle className="h-4 w-4 text-[#FB923C]" />
        ) : (
          <HelpCircle className="h-4 w-4 text-[#8FA3B5]" />
        );

        return (
          <div
            key={step.stage}
            className={`flex-1 ${styles.card} p-4 flex flex-col gap-3 relative`}
          >
            {/* Arrow connecting cards on desktop */}
            {i !== steps.length - 1 && (
              <div className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 text-white/20 z-10">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </div>
            )}

            <div className="flex items-center gap-3">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white/5 border border-white/10`}
              >
                <Icon className="h-5 w-5 text-[#E6EEF5]" />
              </div>
              <div>
                <div className="text-sm font-semibold text-[#E6EEF5]">{step.label}</div>
                <div
                  className={`inline-flex mt-1 rounded px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider border ${statusColor}`}
                >
                  <span className="flex items-center gap-1.5">
                    {StatusIcon}
                    {step.statusBadge}
                  </span>
                </div>
              </div>
            </div>

            <p className="text-xs text-[#8FA3B5] leading-relaxed mt-auto border-t border-white/5 pt-3">
              {step.result}
            </p>
          </div>
        );
      })}
    </div>
  );
}
