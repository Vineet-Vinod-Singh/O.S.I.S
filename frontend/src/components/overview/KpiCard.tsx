import React from "react";
import styles from "./overview.module.css";

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  detail: string;
  color: string;
  isDominant?: boolean;
}

export function KpiCard({ label, value, detail, color, isDominant }: KpiCardProps) {
  return (
    <div 
      className={`${styles['kpiCard']} ${isDominant ? styles['kpiCardMain'] : ""}`}
      style={{ "--kpi-color": color } as React.CSSProperties}
    >
      <div
        className={styles.kpiCardTopEdge}
        style={{ backgroundColor: color, height: isDominant ? "4px" : "2px" }}
      />
      <div className={styles.kpiLabel}>{label}</div>
      <div className={`${styles.kpiValue} ${isDominant ? styles.kpiValueLarge : ""}`}>{value}</div>
      <div className={styles.kpiDetail}>{detail}</div>
    </div>
  );
}
