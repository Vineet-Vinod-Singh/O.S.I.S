import React from "react";
import { Link } from "@tanstack/react-router";
import styles from "./overview.module.css";
import { ArrowRight } from "lucide-react";

interface QuickAccessCard {
  to: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  title: string;
  desc: string;
}

export function QuickAccess({ cards }: { cards: QuickAccessCard[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => {
        const CardIcon = card.icon;
        return (
          <Link
            key={card.to}
            to={card.to as any}
            className={`${styles['kpiCard']} ${styles['interactiveCard']} p-4 flex flex-col gap-3 group`}
            style={{ "--kpi-color": card.iconColor.match(/#([0-9A-Fa-f]{6})/)?.[0] || "#22D3EE" } as React.CSSProperties}
          >
            {/* Colored top edge matching the icon color */}
            <div className={`absolute top-0 left-0 right-0 h-[2px] ${card.iconBg.replace("/10", "")}`} />
            
            <div className="flex items-center justify-between relative z-10">
              <div className={`flex h-8 w-8 items-center justify-center rounded-md ${card.iconBg}`}>
                <CardIcon className={`h-4 w-4 ${card.iconColor}`} />
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-[#8FA3B5] group-hover:text-[#22D3EE] transition-colors" />
            </div>
            <div className="relative z-10">
              <h3 className="text-sm font-semibold text-[#E6EEF5]">{card.title}</h3>
              <p className="text-[11px] text-[#8FA3B5] mt-1 leading-relaxed">{card.desc}</p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
