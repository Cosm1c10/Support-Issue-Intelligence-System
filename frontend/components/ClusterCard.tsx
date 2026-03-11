"use client";

import { ChevronRight, Zap } from "lucide-react";
import { T } from "./tokens";
import { pctChange } from "./utils";
import { TrendPill, PriorityDot } from "./TrendPill";
import type { Cluster } from "./types";

interface ClusterCardProps {
  cluster: Cluster;
  onClick: () => void;
  delay: number;
  onDraftAlert?: () => void;
}

export function ClusterCard({ cluster, onClick, delay, onDraftAlert }: ClusterCardProps) {
  const t = T[cluster.trend];
  const change = pctChange(cluster.prev_window_count, cluster.curr_window_count);

  const sparklinePath = (() => {
    const prev = cluster.prev_window_count;
    const curr = cluster.curr_window_count;
    const max = Math.max(prev, curr, 1);
    const px = (v: number) => Math.round(((max - v) / max) * 28) + 2;
    return `M2,${px(prev)} L30,${px(curr)}`;
  })();

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      style={{
        background: "var(--s2)",
        border: "1px solid var(--b1)",
        borderRadius: 18,
        padding: 0,
        cursor: "pointer",
        opacity: 0,
        animation: `fade-up 0.52s var(--smooth) ${delay}s forwards`,
        position: "relative",
        overflow: "hidden",
        transition: "border-color 0.2s var(--ease), box-shadow 0.2s var(--ease), transform 0.2s var(--ease)",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = "rgba(196,181,253,0.22)";
        el.style.transform = "translateY(-3px)";
        el.style.boxShadow = `0 20px 60px rgba(0,0,0,0.65), ${t.shadow}`;
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = "var(--b1)";
        el.style.transform = "translateY(0)";
        el.style.boxShadow = "none";
      }}
    >
      {/* Top accent line */}
      <div
        style={{
          position: "absolute", top: 0, left: "12%", right: "12%", height: "1px",
          background: t.line,
          opacity: cluster.trend === "Stable" ? 0.5 : 0.85,
          pointerEvents: "none",
        }}
      />

      {/* Ambient glow */}
      <div
        style={{
          position: "absolute", top: 0, right: 0, width: 160, height: 160,
          background: `radial-gradient(circle at top right, ${t.glow} 0%, transparent 68%)`,
          pointerEvents: "none",
        }}
      />

      {/* Card body */}
      <div style={{ padding: "20px 20px 0" }}>
        {/* Top row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <TrendPill trend={cluster.trend} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" style={{ opacity: 0.55 }}>
              <path d={sparklinePath} stroke={t.color} strokeWidth="2" strokeLinecap="round" />
            </svg>
            <ChevronRight size={13} color="var(--t4)" />
          </div>
        </div>

        {/* Name */}
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--t1)", letterSpacing: "-0.025em", lineHeight: 1.3, marginBottom: 7 }}>
          {cluster.name}
        </div>

        {/* Description */}
        <div
          style={{
            fontSize: 12.5, color: "var(--t3)", lineHeight: 1.58,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
            overflow: "hidden", marginBottom: 18, fontWeight: 400,
          }}
        >
          {cluster.description}
        </div>

        <div style={{ borderTop: "1px solid var(--b0)", marginBottom: 16 }} />

        {/* Stats row */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 20, marginBottom: 14 }}>
          <div>
            <div className="num" style={{ fontSize: 40, fontWeight: 800, color: t.color, lineHeight: 1, marginBottom: 3 }}>
              {cluster.curr_window_count}
            </div>
            <div style={{ fontSize: 10, color: "var(--t4)", fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              This month
            </div>
          </div>
          <div style={{ paddingBottom: 16, color: "var(--t4)", fontSize: 14 }}>→</div>
          <div>
            <div className="num" style={{ fontSize: 28, fontWeight: 700, color: "var(--t3)", lineHeight: 1, marginBottom: 3 }}>
              {cluster.prev_window_count}
            </div>
            <div style={{ fontSize: 10, color: "var(--t4)", fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Previous
            </div>
          </div>
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div className="num" style={{ fontSize: 17, fontWeight: 800, color: t.color, letterSpacing: "-0.03em", lineHeight: 1, marginBottom: 3 }}>
              {change}
            </div>
            <div style={{ fontSize: 10, color: "var(--t4)", fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Change
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ height: 2, background: "var(--b0)", borderRadius: 2, overflow: "hidden", marginBottom: 16 }}>
          <div
            style={{
              height: "100%",
              width: `${Math.min((cluster.curr_window_count / Math.max(cluster.ticket_count, 1)) * 100, 100)}%`,
              background: t.color, borderRadius: 2,
              boxShadow: `0 0 8px ${t.color}80`,
            }}
          />
        </div>

        {/* Recent tickets preview */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
          {cluster.example_tickets.slice(0, 3).map((tk) => (
            <div key={tk.id} style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <PriorityDot priority={tk.priority} />
              <span style={{ fontSize: 12, color: "var(--t3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, fontWeight: 400 }}>
                {tk.subject}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* QA Alert footer — Increasing only */}
      {cluster.trend === "Increasing" && onDraftAlert && (
        <div style={{ borderTop: "1px solid var(--b0)", padding: "12px 20px", background: "rgba(124,58,237,0.03)" }}>
          <button
            onClick={(e) => { e.stopPropagation(); onDraftAlert(); }}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              width: "100%", padding: "8px",
              background: "rgba(124,58,237,0.08)", border: "1px solid rgba(139,92,246,0.22)",
              borderRadius: 10, fontSize: 12, fontWeight: 700, color: "var(--kreo-bright)",
              cursor: "pointer", fontFamily: "inherit", letterSpacing: "-0.01em",
              transition: "all 0.15s var(--ease)",
            }}
            onMouseEnter={(e) => {
              const b = e.currentTarget as HTMLButtonElement;
              b.style.background = "rgba(124,58,237,0.16)";
              b.style.borderColor = "rgba(139,92,246,0.45)";
              b.style.boxShadow = "0 0 20px rgba(124,58,237,0.15)";
            }}
            onMouseLeave={(e) => {
              const b = e.currentTarget as HTMLButtonElement;
              b.style.background = "rgba(124,58,237,0.08)";
              b.style.borderColor = "rgba(139,92,246,0.22)";
              b.style.boxShadow = "none";
            }}
          >
            <Zap size={11} strokeWidth={2.5} />
            Draft QA Alert
          </button>
        </div>
      )}
    </div>
  );
}
