"use client";

import { useEffect } from "react";
import { X, Clock, Zap } from "lucide-react";
import { T, PRIORITY } from "./tokens";
import { pctChange, timeAgo } from "./utils";
import { TrendPill, PriorityDot } from "./TrendPill";
import { AiRootCause } from "./AiRootCause";
import type { Cluster } from "./types";

interface DetailPanelProps {
  cluster: Cluster;
  onClose: () => void;
  onDraftAlert: () => void;
}

export function DetailPanel({ cluster, onClose, onDraftAlert }: DetailPanelProps) {
  const t = T[cluster.trend];
  const change = pctChange(cluster.prev_window_count, cluster.curr_window_count);
  const prevPct = Math.min((cluster.prev_window_count / Math.max(cluster.ticket_count, 1)) * 100, 100);
  const currPct = Math.min((cluster.curr_window_count / Math.max(cluster.ticket_count, 1)) * 100, 100);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.65)",
          backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
          zIndex: 40, animation: "fade-in 0.22s ease forwards",
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0,
          width: "min(580px, 100vw)",
          background: "var(--s1)", borderLeft: "1px solid var(--b1)",
          zIndex: 50, display: "flex", flexDirection: "column",
          animation: "slide-panel 0.34s var(--smooth) forwards",
          boxShadow: "-20px 0 80px rgba(0,0,0,0.9)",
        }}
      >
        {/* Top accent line */}
        <div
          style={{
            position: "absolute", top: 0, left: 0, right: 0, height: "1px",
            background: t.line, opacity: 0.8, pointerEvents: "none", zIndex: 1,
          }}
        />

        {/* Header */}
        <div
          style={{
            padding: "16px 20px", borderBottom: "1px solid var(--b1)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <TrendPill trend={cluster.trend} />
            <span style={{ fontSize: 12, color: "var(--t4)", fontWeight: 500 }}>
              {cluster.ticket_count} tickets total
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {cluster.trend === "Increasing" && (
              <button
                onClick={onDraftAlert}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "6px 12px",
                  background: "rgba(124,58,237,0.10)", border: "1px solid rgba(139,92,246,0.26)",
                  borderRadius: 8, fontSize: 12, fontWeight: 600, color: "var(--kreo-bright)",
                  cursor: "pointer", fontFamily: "inherit", letterSpacing: "-0.01em", transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  const b = e.currentTarget as HTMLButtonElement;
                  b.style.background = "rgba(124,58,237,0.18)";
                  b.style.borderColor = "rgba(139,92,246,0.48)";
                }}
                onMouseLeave={(e) => {
                  const b = e.currentTarget as HTMLButtonElement;
                  b.style.background = "rgba(124,58,237,0.10)";
                  b.style.borderColor = "rgba(139,92,246,0.26)";
                }}
              >
                <Zap size={11} strokeWidth={2.5} />
                Draft QA Alert
              </button>
            )}

            <button
              onClick={onClose}
              style={{
                width: 30, height: 30, borderRadius: 8,
                background: "var(--s3)", border: "1px solid var(--b1)",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                color: "var(--t3)", transition: "background 0.14s",
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "var(--s4)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "var(--s3)")}
            >
              <X size={13} />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 20px 48px" }}>
          {/* Title */}
          <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.035em", color: "var(--t1)", lineHeight: 1.2, marginBottom: 10 }}>
            {cluster.name}
          </h2>

          <p style={{ fontSize: 13.5, color: "var(--t3)", lineHeight: 1.68, marginBottom: 24, fontWeight: 400 }}>
            {cluster.description}
          </p>

          {/* Trend Analysis Box */}
          <div style={{ background: "var(--s3)", border: "1px solid var(--b1)", borderRadius: 14, padding: "16px 18px", marginBottom: 24 }}>
            <div style={{ fontSize: 10, color: "var(--t4)", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 16 }}>
              Trend · 30-day windows
            </div>

            {/* Numbers */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 18, marginBottom: 18 }}>
              <div>
                <div className="num" style={{ fontSize: 36, fontWeight: 800, color: t.color, lineHeight: 1, marginBottom: 3 }}>
                  {cluster.curr_window_count}
                </div>
                <div style={{ fontSize: 10, color: "var(--t4)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Current
                </div>
              </div>
              <div style={{ color: "var(--t4)", fontSize: 18, paddingBottom: 18 }}>→</div>
              <div>
                <div className="num" style={{ fontSize: 28, fontWeight: 700, color: "var(--t3)", lineHeight: 1, marginBottom: 3 }}>
                  {cluster.prev_window_count}
                </div>
                <div style={{ fontSize: 10, color: "var(--t4)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Previous
                </div>
              </div>
              <div style={{ marginLeft: "auto", textAlign: "right" }}>
                <div className="num" style={{ fontSize: 24, fontWeight: 800, color: t.color, letterSpacing: "-0.03em", lineHeight: 1, marginBottom: 3 }}>
                  {change}
                </div>
                <div style={{ fontSize: 10, color: "var(--t4)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Change
                </div>
              </div>
            </div>

            {/* Bar comparison */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { label: "Prev", width: prevPct, color: "rgba(196,181,253,0.22)" },
                { label: "Curr", width: currPct, color: t.color },
              ].map(({ label, width, color }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ fontSize: 10, color: "var(--t4)", width: 28, textAlign: "right", fontWeight: 600, letterSpacing: "0.03em" }}>
                    {label}
                  </div>
                  <div style={{ flex: 1, height: 4, background: "var(--b0)", borderRadius: 3, overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%", width: `${width}%`, background: color, borderRadius: 3,
                        boxShadow: label === "Curr" ? `0 0 8px ${color}80` : "none",
                        transition: "width 0.8s var(--smooth)",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* AI Root Cause */}
          <AiRootCause cluster={cluster} />

          {/* Tickets list */}
          <div style={{ fontSize: 10, color: "var(--t4)", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>
            Tickets · {cluster.example_tickets.length} shown
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {cluster.example_tickets.map((tk, i) => (
              <div
                key={tk.id}
                style={{
                  background: "var(--s3)", border: "1px solid var(--b1)", borderRadius: 11,
                  padding: "12px 14px", opacity: 0,
                  animation: `fade-up 0.4s var(--smooth) ${i * 0.035}s forwards`,
                  transition: "border-color 0.15s",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = "var(--b2)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = "var(--b1)")}
              >
                <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                  <div style={{ paddingTop: 3, flexShrink: 0 }}>
                    <PriorityDot priority={tk.priority} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: "var(--t2)", fontWeight: 500, lineHeight: 1.45, marginBottom: 5 }}>
                      {tk.subject}
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: PRIORITY[tk.priority]?.color ?? "var(--t3)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                        {tk.priority}
                      </span>
                      <span style={{ fontSize: 10, color: "var(--b2)" }}>·</span>
                      <span style={{ fontSize: 11, color: "var(--t4)", fontWeight: 500 }}>{tk.product_area}</span>
                      <span style={{ fontSize: 10, color: "var(--b2)" }}>·</span>
                      <span style={{ fontSize: 11, color: "var(--t4)", display: "flex", alignItems: "center", gap: 3, fontWeight: 400 }}>
                        <Clock size={9} />
                        {timeAgo(tk.created_at)}
                      </span>
                    </div>
                  </div>
                  <code style={{ fontSize: 9.5, color: "var(--t4)", flexShrink: 0, paddingTop: 2, fontFamily: "ui-monospace, 'Cascadia Code', monospace", letterSpacing: "0.02em" }}>
                    {tk.ticket_id}
                  </code>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
