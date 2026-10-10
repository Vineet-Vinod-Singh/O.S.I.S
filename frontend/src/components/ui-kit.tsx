import { useEffect, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CheckCircle2, HelpCircle, Circle, ChevronRight } from "lucide-react";

export function Panel({
  title,
  badge,
  action,
  children,
  className = "",
}: {
  title?: string;
  badge?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-md border border-border bg-card ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-0.5 h-4 rounded-full bg-[var(--primary)]" />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground font-mono">
              {title}
            </h2>
            {badge}
          </div>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export type Tone = "cyan" | "amber" | "emerald" | "rose" | "default";

export const TONE_MAP = {
  cyan: {
    border: "border-[var(--accent-cyan)]",
    text: "text-[var(--accent-cyan)]",
    bg: "bg-[var(--accent-cyan)]",
    bgMuted: "bg-[var(--accent-cyan)]/10",
    borderMuted: "border-[var(--accent-cyan)]/40",
  },
  amber: {
    border: "border-[var(--accent-amber)]",
    text: "text-[var(--accent-amber)]",
    bg: "bg-[var(--accent-amber)]",
    bgMuted: "bg-[var(--accent-amber)]/10",
    borderMuted: "border-[var(--accent-amber)]/40",
  },
  emerald: {
    border: "border-[var(--accent-emerald)]",
    text: "text-[var(--accent-emerald)]",
    bg: "bg-[var(--accent-emerald)]",
    bgMuted: "bg-[var(--accent-emerald)]/10",
    borderMuted: "border-[var(--accent-emerald)]/40",
  },
  rose: {
    border: "border-[var(--accent-rose)]",
    text: "text-[var(--accent-rose)]",
    bg: "bg-[var(--accent-rose)]",
    bgMuted: "bg-[var(--accent-rose)]/10",
    borderMuted: "border-[var(--accent-rose)]/40",
  },
  default: {
    border: "border-border",
    text: "text-foreground",
    textMuted: "text-muted-foreground",
    bg: "bg-muted-foreground",
    bgMuted: "bg-secondary/60",
    borderMuted: "border-border",
  },
};

export function Stat({
  label,
  value,
  hint,
  highlight,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  highlight?: Tone | undefined;
}) {
  const tone = highlight || "default";
  const theme = TONE_MAP[tone];
  const borderClass = theme.border;
  const highlightClass = `${theme.text} ${tone === "default" ? "font-medium" : "font-semibold"}`;

  return (
    <div className={`border-l-2 ${borderClass} pl-3.5 py-1 space-y-0.5`}>
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-mono">
        {label}
      </div>
      <div className={`text-xl tabular-nums font-mono ${highlightClass}`}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function Meter({
  label,
  value,
  max = 100,
  tone,
}: {
  label: string;
  value: number;
  max?: number;
  tone?: Tone;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const theme = TONE_MAP[tone || "cyan"];
  const barColor = theme.bg;

  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="uppercase tracking-[0.12em] text-muted-foreground font-mono">{label}</span>
        <span className="tabular-nums font-mono text-foreground font-medium">
          {Math.round(value)}%
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full rounded-full ${barColor} transition-[width] duration-300 ease-out`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function StatusDot({ label }: { label: string }) {
  const upper = label.toUpperCase();
  let tone: Tone = "default";

  if (
    upper.includes("SPILL_DETECTED") ||
    upper.includes("ALERT") ||
    upper.includes("DISCONTINUITY") ||
    upper.includes("OFFLINE")
  ) {
    tone = "rose";
  } else if (
    upper.includes("NO_SPILL") ||
    upper.includes("CLEAN") ||
    upper.includes("VERIFIED") ||
    upper.includes("ACTIVE")
  ) {
    tone = "emerald";
  } else if (
    upper.includes("INCONCLUSIVE") ||
    upper.includes("UNAVAILABLE") ||
    upper.includes("PENDING")
  ) {
    tone = "amber";
  } else if (upper.includes("WORKING") || upper.includes("PROCESSING")) {
    tone = "cyan";
  }

  const theme = TONE_MAP[tone];
  const textClass = `${tone === "default" ? theme.textMuted : theme.text} ${theme.borderMuted} ${theme.bgMuted}`;
  const dotBg = theme.bg;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] uppercase tracking-[0.12em] font-mono ${textClass}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotBg}`} />
      {label}
    </span>
  );
}

export function OutcomeBadge({ outcome }: { outcome?: string | null }) {
  if (!outcome) return null;
  if (outcome === "SPILL_DETECTED") {
    const theme = TONE_MAP["rose"];
    return (
      <div
        className={`inline-flex items-center gap-2 rounded-md border ${theme.borderMuted} ${theme.bgMuted} px-2.5 py-1 text-xs font-mono font-semibold ${theme.text}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${theme.bg} om-pulse-dot`} />
        OIL-LIKE SIGNATURE DETECTED
      </div>
    );
  }
  if (outcome === "NO_SPILL_DETECTED") {
    const theme = TONE_MAP["emerald"];
    return (
      <div
        className={`inline-flex items-center gap-2 rounded-md border ${theme.borderMuted} ${theme.bgMuted} px-2.5 py-1 text-xs font-mono font-semibold ${theme.text}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${theme.bg}`} />
        NO SPILL DETECTED
      </div>
    );
  }
  if (outcome === "ANALYSIS_INCONCLUSIVE") {
    const theme = TONE_MAP["amber"];
    return (
      <div
        className={`inline-flex items-center gap-2 rounded-md border ${theme.borderMuted} ${theme.bgMuted} px-2.5 py-1 text-xs font-mono font-semibold ${theme.text}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${theme.bg}`} />
        ANALYSIS INCONCLUSIVE
      </div>
    );
  }
  return <StatusDot label={outcome} />;
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string | undefined;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/80 om-fade" />
        <Dialog.Content
          className="fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] rounded-md border border-border bg-card shadow-2xl om-rise outline-none"
          aria-describedby={subtitle ? "modal-subtitle" : undefined}
        >
          <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
            <div>
              <Dialog.Title className="text-sm font-semibold text-foreground font-mono">
                {title}
              </Dialog.Title>
              {subtitle && (
                <Dialog.Description
                  id="modal-subtitle"
                  className="text-[11px] text-muted-foreground font-mono"
                >
                  {subtitle}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground font-mono transition-colors hover:bg-secondary hover:text-foreground outline-none"
              >
                Close
              </button>
            </Dialog.Close>
          </header>
          <div className="max-h-[65vh] overflow-y-auto px-5 py-4 text-sm">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function KeyVal({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/50 py-1.5 last:border-0">
      <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-mono">
        {k}
      </span>
      <span className="tabular-nums text-foreground font-mono text-xs">{v}</span>
    </div>
  );
}

export function ReportSkeleton() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto py-8 animate-pulse">
      <div className="h-8 w-1/3 bg-secondary rounded mb-2" />
      <div className="h-4 w-1/2 bg-secondary rounded mb-8" />
      <div className="h-64 rounded-md border border-border bg-card/50" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="h-32 rounded-md border border-border bg-card/50" />
        <div className="h-32 rounded-md border border-border bg-card/50" />
      </div>
    </div>
  );
}

export function Stepper({
  steps,
}: {
  steps: { label: string; ok: boolean | null; description?: string }[];
}) {
  return (
    <div className="flex flex-col gap-3 font-mono text-xs">
      {steps.map((step, i, arr) => {
        const isLast = i === arr.length - 1;
        const icon =
          step.ok === true ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400 z-10 bg-card rounded-full" />
          ) : step.ok === false ? (
            <HelpCircle className="h-4 w-4 text-amber-400 z-10 bg-card rounded-full" />
          ) : (
            <Circle className="h-4 w-4 text-muted-foreground/40 z-10 bg-card rounded-full" />
          );

        return (
          <div key={step.label} className="relative flex items-start gap-3">
            {!isLast && (
              <div
                className={`absolute left-2 top-4 bottom-[-12px] w-px ${
                  step.ok === true ? "bg-emerald-500/40" : "bg-border"
                }`}
              />
            )}
            <div className="mt-0.5">{icon}</div>
            <div>
              <div
                className={`font-semibold ${
                  step.ok === true
                    ? "text-foreground"
                    : step.ok === false
                      ? "text-amber-300"
                      : "text-muted-foreground"
                }`}
              >
                {step.label}
              </div>
              {step.description && (
                <div className="mt-0.5 text-[11px] text-muted-foreground max-w-sm">
                  {step.description}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
