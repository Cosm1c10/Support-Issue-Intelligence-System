"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Search,
  X,
  Activity,
  RefreshCw,
  ChevronRight,
  Clock,
  AlertCircle,
  Sparkles,
  Zap,
  Copy,
  Check,
  ArrowUpRight,
  ArrowDownRight,
  BarChart2,
} from "lucide-react";

/* ─────────────────────────────────────────────────────
   Types
───────────────────────────────────────────────────── */

interface Ticket {
  id: string;
  ticket_id: string;
  subject: string;
  description: string;
  priority: "Low" | "Medium" | "High" | "Critical";
  product_area: string;
  created_at: string;
}

interface Cluster {
  id: string;
  name: string;
  description: string;
  ticket_count: number;
  prev_window_count: number;
  curr_window_count: number;
  trend: "Increasing" | "Decreasing" | "Stable";
  updated_at: string;
  example_tickets: Ticket[];
}

type TrendFilter = "all" | "Increasing" | "Decreasing" | "Stable";

/* ─────────────────────────────────────────────────────
   Design Tokens (matching globals.css exactly)
───────────────────────────────────────────────────── */

const T = {
  Increasing: {
    label: "Increasing",
    Icon: TrendingUp,
    ArrowIcon: ArrowUpRight,
    color: "#8B5CF6",
    colorBright: "#A78BFA",
    bg: "rgba(124,58,237,0.09)",
    border: "rgba(139,92,246,0.26)",
    glow: "rgba(124,58,237,0.07)",
    line: "linear-gradient(90deg, transparent 0%, #8B5CF6 50%, transparent 100%)",
    shadow: "0 0 40px rgba(124,58,237,0.12)",
  },
  Decreasing: {
    label: "Decreasing",
    Icon: TrendingDown,
    ArrowIcon: ArrowDownRight,
    color: "#F97316",
    colorBright: "#FB923C",
    bg: "rgba(249,115,22,0.09)",
    border: "rgba(249,115,22,0.24)",
    glow: "rgba(249,115,22,0.05)",
    line: "linear-gradient(90deg, transparent 0%, #F97316 50%, transparent 100%)",
    shadow: "0 0 40px rgba(249,115,22,0.08)",
  },
  Stable: {
    label: "Stable",
    Icon: Minus,
    ArrowIcon: BarChart2,
    color: "#6B7280",
    colorBright: "#9CA3AF",
    bg: "rgba(107,114,128,0.07)",
    border: "rgba(107,114,128,0.18)",
    glow: "rgba(107,114,128,0.04)",
    line: "linear-gradient(90deg, transparent 0%, #6B7280 35%, transparent 100%)",
    shadow: "none",
  },
} as const;

const PRIORITY: Record<string, { color: string; label: string }> = {
  Critical: { color: "#F43F5E", label: "Critical" },
  High:     { color: "#F97316", label: "High"     },
  Medium:   { color: "#3B82F6", label: "Medium"   },
  Low:      { color: "#22C55E", label: "Low"      },
};

/* ─────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────── */

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  const h = Math.floor(ms / 3600000);
  const d = Math.floor(ms / 86400000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

function pctChange(prev: number, curr: number) {
  if (prev === 0) return curr > 0 ? "+100%" : "—";
  const v = Math.round(((curr - prev) / prev) * 100);
  return v > 0 ? `+${v}%` : `${v}%`;
}

/* ─────────────────────────────────────────────────────
   Tiny Components
───────────────────────────────────────────────────── */

function TrendPill({ trend }: { trend: Cluster["trend"] }) {
  const t = T[trend];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 8px 3px 6px",
        borderRadius: 100,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.02em",
        textTransform: "uppercase",
        color: t.color,
        background: t.bg,
        border: `1px solid ${t.border}`,
        whiteSpace: "nowrap",
        fontFamily: "inherit",
      }}
    >
      <t.Icon size={9} strokeWidth={3} />
      {t.label}
    </span>
  );
}

function PriorityDot({ priority }: { priority: string }) {
  const p = PRIORITY[priority];
  return (
    <span
      style={{
        width: 5,
        height: 5,
        borderRadius: "50%",
        background: p?.color ?? "#6B7280",
        flexShrink: 0,
        display: "inline-block",
        boxShadow: `0 0 6px ${p?.color ?? "#6B7280"}80`,
      }}
    />
  );
}

/* ─────────────────────────────────────────────────────
   Metric Card
───────────────────────────────────────────────────── */

function MetricCard({
  label,
  value,
  sub,
  accent,
  icon: Icon,
  delay = 0,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  icon?: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  delay?: number;
}) {
  return (
    <div
      style={{
        background: "var(--s2)",
        border: "1px solid var(--b1)",
        borderRadius: 16,
        padding: "20px 22px 22px",
        opacity: 0,
        animation: `fade-up 0.5s var(--smooth) ${delay}s forwards`,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* ambient glow for accented cards */}
      {accent && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(ellipse 80% 60% at 50% 100%, ${accent}10 0%, transparent 70%)`,
            pointerEvents: "none",
          }}
        />
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--t3)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
        {Icon && (
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: accent ? `${accent}15` : "var(--s3)",
              border: `1px solid ${accent ? `${accent}25` : "var(--b1)"}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon size={12} color={accent ?? "var(--t3)"} strokeWidth={2.2} />
          </div>
        )}
      </div>
      <div
        className="num"
        style={{
          fontSize: 46,
          fontWeight: 800,
          color: accent ?? "var(--t1)",
          lineHeight: 1,
          marginBottom: 8,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: "var(--t4)", fontWeight: 500 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   AI Root Cause Section (inside DetailPanel)
───────────────────────────────────────────────────── */

function AiRootCause({ cluster }: { cluster: Cluster }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isMock, setIsMock] = useState(false);

  const generate = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/generate-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clusterName: cluster.name,
          tickets: cluster.example_tickets,
        }),
      });
      const data = await res.json();
      setSummary(data.summary);
      setIsMock(data.mock ?? false);
    } catch {
      setSummary("Unable to generate analysis. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [cluster]);

  return (
    <div style={{ marginBottom: 28 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            fontWeight: 700,
            color: "var(--kreo-bright)",
            letterSpacing: "0.07em",
            textTransform: "uppercase",
          }}
        >
          <Sparkles size={11} strokeWidth={2} />
          AI Root Cause Analysis
        </div>

        {!loading && !summary && (
          <button
            onClick={generate}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 12px",
              background: "rgba(124,58,237,0.10)",
              border: "1px solid rgba(139,92,246,0.28)",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              color: "var(--kreo-bright)",
              cursor: "pointer",
              fontFamily: "inherit",
              letterSpacing: "-0.01em",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              const b = e.currentTarget as HTMLButtonElement;
              b.style.background = "rgba(124,58,237,0.18)";
              b.style.borderColor = "rgba(139,92,246,0.5)";
            }}
            onMouseLeave={(e) => {
              const b = e.currentTarget as HTMLButtonElement;
              b.style.background = "rgba(124,58,237,0.10)";
              b.style.borderColor = "rgba(139,92,246,0.28)";
            }}
          >
            <Sparkles size={10} />
            Generate
          </button>
        )}

        {summary && !loading && (
          <button
            onClick={() => { setSummary(null); setIsMock(false); }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 9px",
              background: "transparent",
              border: "1px solid var(--b1)",
              borderRadius: 7,
              fontSize: 11,
              color: "var(--t4)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <RefreshCw size={9} />
            Regenerate
          </button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div
          style={{
            background: "rgba(124,58,237,0.06)",
            border: "1px solid rgba(139,92,246,0.18)",
            borderRadius: 12,
            padding: "16px 18px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              border: "2px solid rgba(139,92,246,0.25)",
              borderTopColor: "#8B5CF6",
              animation: "spin 0.75s linear infinite",
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 13, color: "var(--kreo-bright)", fontWeight: 500 }}>
            Analysing ticket patterns…
          </span>
        </div>
      )}

      {/* Result */}
      {summary && !loading && (
        <div
          style={{
            background: "rgba(124,58,237,0.06)",
            border: "1px solid rgba(139,92,246,0.22)",
            borderRadius: 12,
            padding: "16px 18px",
            boxShadow: "0 0 28px rgba(124,58,237,0.09), inset 0 1px 0 rgba(196,181,253,0.10)",
            opacity: 0,
            animation: "fade-up 0.3s var(--smooth) forwards",
          }}
        >
          <p
            style={{
              fontSize: 13.5,
              color: "#D8D0F5",
              lineHeight: 1.72,
              margin: 0,
            }}
          >
            {summary}
          </p>
          {isMock && (
            <div
              style={{
                marginTop: 10,
                paddingTop: 10,
                borderTop: "1px solid rgba(139,92,246,0.12)",
                fontSize: 11,
                color: "rgba(167,139,250,0.45)",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Sparkles size={9} />
              Demo mode — add OPENAI_API_KEY for live analysis
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!summary && !loading && (
        <div
          style={{
            background: "var(--s3)",
            border: "1px dashed rgba(196,181,253,0.14)",
            borderRadius: 12,
            padding: "20px 18px",
            textAlign: "center",
          }}
        >
          <Sparkles
            size={18}
            color="rgba(139,92,246,0.30)"
            style={{ margin: "0 auto 8px", display: "block" }}
          />
          <div style={{ fontSize: 12.5, color: "var(--t4)", lineHeight: 1.55 }}>
            Click{" "}
            <strong style={{ color: "var(--kreo-bright)", fontWeight: 600 }}>
              Generate
            </strong>{" "}
            to get an AI root cause summary for this cluster.
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   QA Alert Modal
───────────────────────────────────────────────────── */

function QaAlertModal({
  cluster,
  email,
  loading,
  isMock,
  onClose,
}: {
  cluster: Cluster;
  email: string | null;
  loading: boolean;
  isMock: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const copy = useCallback(() => {
    if (!email) return;
    navigator.clipboard.writeText(email).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    });
  }, [email]);

  const change = pctChange(cluster.prev_window_count, cluster.curr_window_count);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.80)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          zIndex: 60,
          animation: "fade-in 0.2s ease forwards",
        }}
      />

      {/* Modal */}
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: "min(700px, calc(100vw - 40px))",
          maxHeight: "calc(100dvh - 60px)",
          background: "var(--s1)",
          border: "1px solid rgba(139,92,246,0.22)",
          borderRadius: 20,
          zIndex: 70,
          display: "flex",
          flexDirection: "column",
          boxShadow:
            "0 40px 100px rgba(0,0,0,0.95), 0 0 0 1px rgba(196,181,253,0.07), 0 0 80px rgba(124,58,237,0.10)",
          animation: "modal-in 0.32s var(--smooth) forwards",
          opacity: 0,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--b1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                background: "rgba(124,58,237,0.14)",
                border: "1px solid rgba(139,92,246,0.28)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                boxShadow: "0 0 20px rgba(124,58,237,0.15)",
              }}
            >
              <Zap size={14} color="#A78BFA" strokeWidth={2.5} />
            </div>
            <div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "var(--t1)",
                  letterSpacing: "-0.02em",
                  lineHeight: 1.3,
                }}
              >
                QA Alert Draft
              </div>
              <div style={{ fontSize: 11, color: "var(--t4)", marginTop: 1 }}>
                {cluster.name} · {change} this 30-day window
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {email && !loading && (
              <button
                onClick={copy}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "6px 14px",
                  background: copied
                    ? "rgba(34,197,94,0.10)"
                    : "rgba(124,58,237,0.10)",
                  border: `1px solid ${copied ? "rgba(34,197,94,0.28)" : "rgba(139,92,246,0.28)"}`,
                  borderRadius: 9,
                  fontSize: 12,
                  fontWeight: 600,
                  color: copied ? "#22C55E" : "var(--kreo-bright)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "all 0.2s var(--ease)",
                  letterSpacing: "-0.01em",
                }}
              >
                {copied ? <Check size={11} strokeWidth={2.5} /> : <Copy size={11} />}
                {copied ? "Copied!" : "Copy email"}
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: "var(--s3)",
                border: "1px solid var(--b1)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--t3)",
                transition: "background 0.14s",
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.background = "var(--s4)")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.background = "var(--s3)")
              }
            >
              <X size={13} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 24px" }}>
          {loading && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "64px 0",
                gap: 16,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  border: "3px solid rgba(139,92,246,0.18)",
                  borderTopColor: "#7C3AED",
                  animation: "spin 0.75s linear infinite",
                }}
              />
              <div>
                <div
                  style={{
                    fontSize: 14,
                    color: "var(--kreo-bright)",
                    fontWeight: 600,
                    textAlign: "center",
                    marginBottom: 4,
                    letterSpacing: "-0.015em",
                  }}
                >
                  Drafting QA Alert…
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--t4)",
                    textAlign: "center",
                    maxWidth: 260,
                  }}
                >
                  Analysing spike pattern and generating escalation email
                </div>
              </div>
            </div>
          )}

          {email && !loading && (
            <>
              {isMock && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 12px",
                    background: "rgba(249,115,22,0.07)",
                    border: "1px solid rgba(249,115,22,0.18)",
                    borderRadius: 8,
                    fontSize: 11,
                    color: "#F97316",
                    fontWeight: 500,
                    marginBottom: 14,
                  }}
                >
                  <Sparkles size={10} />
                  Demo mode — add OPENAI_API_KEY for live AI generation
                </div>
              )}
              <pre
                style={{
                  fontFamily: "inherit",
                  fontSize: 12.5,
                  color: "var(--t2)",
                  lineHeight: 1.76,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  margin: 0,
                  background: "var(--s2)",
                  border: "1px solid var(--b1)",
                  borderRadius: 12,
                  padding: "18px 20px",
                }}
              >
                {email}
              </pre>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────
   Cluster Card
───────────────────────────────────────────────────── */

function ClusterCard({
  cluster,
  onClick,
  delay,
  onDraftAlert,
}: {
  cluster: Cluster;
  onClick: () => void;
  delay: number;
  onDraftAlert?: () => void;
}) {
  const t = T[cluster.trend];
  const change = pctChange(cluster.prev_window_count, cluster.curr_window_count);

  /* mini sparkline path (up / flat / down) */
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
      {/* Colored top accent line */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: "12%",
          right: "12%",
          height: "1px",
          background: t.line,
          opacity: cluster.trend === "Stable" ? 0.5 : 0.85,
          pointerEvents: "none",
        }}
      />

      {/* Ambient trend glow — top-right corner */}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          width: 160,
          height: 160,
          background: `radial-gradient(circle at top right, ${t.glow} 0%, transparent 68%)`,
          pointerEvents: "none",
        }}
      />

      {/* Card body */}
      <div style={{ padding: "20px 20px 0" }}>
        {/* Top row */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          <TrendPill trend={cluster.trend} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Mini sparkline */}
            <svg
              width="32"
              height="32"
              viewBox="0 0 32 32"
              fill="none"
              style={{ opacity: 0.55 }}
            >
              <path
                d={sparklinePath}
                stroke={t.color}
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <ChevronRight size={13} color="var(--t4)" />
          </div>
        </div>

        {/* Name */}
        <div
          style={{
            fontSize: 17,
            fontWeight: 700,
            color: "var(--t1)",
            letterSpacing: "-0.025em",
            lineHeight: 1.3,
            marginBottom: 7,
          }}
        >
          {cluster.name}
        </div>

        {/* Description */}
        <div
          style={{
            fontSize: 12.5,
            color: "var(--t3)",
            lineHeight: 1.58,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical" as const,
            overflow: "hidden",
            marginBottom: 18,
            fontWeight: 400,
          }}
        >
          {cluster.description}
        </div>

        {/* Divider */}
        <div style={{ borderTop: "1px solid var(--b0)", marginBottom: 16 }} />

        {/* Stats row */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 20,
            marginBottom: 14,
          }}
        >
          {/* Current window — primary number */}
          <div>
            <div
              className="num"
              style={{
                fontSize: 40,
                fontWeight: 800,
                color: t.color,
                lineHeight: 1,
                marginBottom: 3,
              }}
            >
              {cluster.curr_window_count}
            </div>
            <div style={{ fontSize: 10, color: "var(--t4)", fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              This month
            </div>
          </div>

          {/* Arrow */}
          <div style={{ paddingBottom: 16, color: "var(--t4)", fontSize: 14 }}>→</div>

          {/* Previous window */}
          <div>
            <div
              className="num"
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: "var(--t3)",
                lineHeight: 1,
                marginBottom: 3,
              }}
            >
              {cluster.prev_window_count}
            </div>
            <div style={{ fontSize: 10, color: "var(--t4)", fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Previous
            </div>
          </div>

          {/* Percentage change */}
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div
              className="num"
              style={{
                fontSize: 17,
                fontWeight: 800,
                color: t.color,
                letterSpacing: "-0.03em",
                lineHeight: 1,
                marginBottom: 3,
              }}
            >
              {change}
            </div>
            <div style={{ fontSize: 10, color: "var(--t4)", fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Change
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div
          style={{
            height: 2,
            background: "var(--b0)",
            borderRadius: 2,
            overflow: "hidden",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.min((cluster.curr_window_count / Math.max(cluster.ticket_count, 1)) * 100, 100)}%`,
              background: t.color,
              borderRadius: 2,
              boxShadow: `0 0 8px ${t.color}80`,
            }}
          />
        </div>

        {/* Recent tickets */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
          {cluster.example_tickets.slice(0, 3).map((tk, i) => (
            <div
              key={tk.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
              }}
            >
              <PriorityDot priority={tk.priority} />
              <span
                style={{
                  fontSize: 12,
                  color: "var(--t3)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                  fontWeight: 400,
                }}
              >
                {tk.subject}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* QA Alert footer — Increasing only */}
      {cluster.trend === "Increasing" && onDraftAlert && (
        <div
          style={{
            borderTop: "1px solid var(--b0)",
            padding: "12px 20px",
            background: "rgba(124,58,237,0.03)",
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDraftAlert();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              width: "100%",
              padding: "8px",
              background: "rgba(124,58,237,0.08)",
              border: "1px solid rgba(139,92,246,0.22)",
              borderRadius: 10,
              fontSize: 12,
              fontWeight: 700,
              color: "var(--kreo-bright)",
              cursor: "pointer",
              fontFamily: "inherit",
              letterSpacing: "-0.01em",
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

/* ─────────────────────────────────────────────────────
   Detail Panel
───────────────────────────────────────────────────── */

function DetailPanel({
  cluster,
  onClose,
  onDraftAlert,
}: {
  cluster: Cluster;
  onClose: () => void;
  onDraftAlert: () => void;
}) {
  const t = T[cluster.trend];
  const change = pctChange(cluster.prev_window_count, cluster.curr_window_count);
  const prevPct = Math.min(
    (cluster.prev_window_count / Math.max(cluster.ticket_count, 1)) * 100,
    100
  );
  const currPct = Math.min(
    (cluster.curr_window_count / Math.max(cluster.ticket_count, 1)) * 100,
    100
  );

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
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.65)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          zIndex: 40,
          animation: "fade-in 0.22s ease forwards",
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(580px, 100vw)",
          background: "var(--s1)",
          borderLeft: "1px solid var(--b1)",
          zIndex: 50,
          display: "flex",
          flexDirection: "column",
          animation: "slide-panel 0.34s var(--smooth) forwards",
          boxShadow: "-20px 0 80px rgba(0,0,0,0.9)",
        }}
      >
        {/* Colored top line on panel */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "1px",
            background: t.line,
            opacity: 0.8,
            pointerEvents: "none",
            zIndex: 1,
          }}
        />

        {/* Panel header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--b1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <TrendPill trend={cluster.trend} />
            <span
              style={{
                fontSize: 12,
                color: "var(--t4)",
                fontWeight: 500,
              }}
            >
              {cluster.ticket_count} tickets total
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {cluster.trend === "Increasing" && (
              <button
                onClick={onDraftAlert}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "6px 12px",
                  background: "rgba(124,58,237,0.10)",
                  border: "1px solid rgba(139,92,246,0.26)",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--kreo-bright)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  letterSpacing: "-0.01em",
                  transition: "all 0.15s",
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
                width: 30,
                height: 30,
                borderRadius: 8,
                background: "var(--s3)",
                border: "1px solid var(--b1)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--t3)",
                transition: "background 0.14s",
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.background = "var(--s4)")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.background = "var(--s3)")
              }
            >
              <X size={13} />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 20px 48px" }}>
          {/* Title */}
          <h2
            style={{
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: "-0.035em",
              color: "var(--t1)",
              lineHeight: 1.2,
              marginBottom: 10,
            }}
          >
            {cluster.name}
          </h2>

          <p
            style={{
              fontSize: 13.5,
              color: "var(--t3)",
              lineHeight: 1.68,
              marginBottom: 24,
              fontWeight: 400,
            }}
          >
            {cluster.description}
          </p>

          {/* Trend Analysis Box */}
          <div
            style={{
              background: "var(--s3)",
              border: "1px solid var(--b1)",
              borderRadius: 14,
              padding: "16px 18px",
              marginBottom: 24,
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: "var(--t4)",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: 16,
              }}
            >
              Trend · 30-day windows
            </div>

            {/* Numbers */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: 18,
                marginBottom: 18,
              }}
            >
              <div>
                <div
                  className="num"
                  style={{
                    fontSize: 36,
                    fontWeight: 800,
                    color: t.color,
                    lineHeight: 1,
                    marginBottom: 3,
                  }}
                >
                  {cluster.curr_window_count}
                </div>
                <div style={{ fontSize: 10, color: "var(--t4)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Current
                </div>
              </div>

              <div style={{ color: "var(--t4)", fontSize: 18, paddingBottom: 18 }}>
                →
              </div>

              <div>
                <div
                  className="num"
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    color: "var(--t3)",
                    lineHeight: 1,
                    marginBottom: 3,
                  }}
                >
                  {cluster.prev_window_count}
                </div>
                <div style={{ fontSize: 10, color: "var(--t4)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Previous
                </div>
              </div>

              <div style={{ marginLeft: "auto", textAlign: "right" }}>
                <div
                  className="num"
                  style={{
                    fontSize: 24,
                    fontWeight: 800,
                    color: t.color,
                    letterSpacing: "-0.03em",
                    lineHeight: 1,
                    marginBottom: 3,
                  }}
                >
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
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--t4)",
                      width: 28,
                      textAlign: "right",
                      fontWeight: 600,
                      letterSpacing: "0.03em",
                    }}
                  >
                    {label}
                  </div>
                  <div
                    style={{
                      flex: 1,
                      height: 4,
                      background: "var(--b0)",
                      borderRadius: 3,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${width}%`,
                        background: color,
                        borderRadius: 3,
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

          {/* Tickets label */}
          <div
            style={{
              fontSize: 10,
              color: "var(--t4)",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Tickets · {cluster.example_tickets.length} shown
          </div>

          {/* Ticket list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {cluster.example_tickets.map((tk, i) => (
              <div
                key={tk.id}
                style={{
                  background: "var(--s3)",
                  border: "1px solid var(--b1)",
                  borderRadius: 11,
                  padding: "12px 14px",
                  opacity: 0,
                  animation: `fade-up 0.4s var(--smooth) ${i * 0.035}s forwards`,
                  transition: "border-color 0.15s",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLDivElement).style.borderColor = "var(--b2)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLDivElement).style.borderColor = "var(--b1)")
                }
              >
                <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                  <div style={{ paddingTop: 3, flexShrink: 0 }}>
                    <PriorityDot priority={tk.priority} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12.5,
                        color: "var(--t2)",
                        fontWeight: 500,
                        lineHeight: 1.45,
                        marginBottom: 5,
                      }}
                    >
                      {tk.subject}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: PRIORITY[tk.priority]?.color ?? "var(--t3)",
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                        }}
                      >
                        {tk.priority}
                      </span>
                      <span style={{ fontSize: 10, color: "var(--b2)" }}>·</span>
                      <span style={{ fontSize: 11, color: "var(--t4)", fontWeight: 500 }}>
                        {tk.product_area}
                      </span>
                      <span style={{ fontSize: 10, color: "var(--b2)" }}>·</span>
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--t4)",
                          display: "flex",
                          alignItems: "center",
                          gap: 3,
                          fontWeight: 400,
                        }}
                      >
                        <Clock size={9} />
                        {timeAgo(tk.created_at)}
                      </span>
                    </div>
                  </div>
                  <code
                    style={{
                      fontSize: 9.5,
                      color: "var(--t4)",
                      flexShrink: 0,
                      paddingTop: 2,
                      fontFamily: "ui-monospace, 'Cascadia Code', monospace",
                      letterSpacing: "0.02em",
                    }}
                  >
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

/* ─────────────────────────────────────────────────────
   Loading Skeletons
───────────────────────────────────────────────────── */

function SkeletonCard({ delay }: { delay: number }) {
  return (
    <div
      style={{
        background: "var(--s2)",
        border: "1px solid var(--b1)",
        borderRadius: 18,
        padding: 20,
        opacity: 0,
        animation: `fade-in 0.4s ease ${delay}s forwards`,
      }}
    >
      <div
        className="shimmer"
        style={{ height: 20, width: "45%", borderRadius: 6, marginBottom: 16 }}
      />
      <div
        className="shimmer"
        style={{ height: 18, width: "80%", borderRadius: 5, marginBottom: 8 }}
      />
      <div
        className="shimmer"
        style={{ height: 14, width: "60%", borderRadius: 5, marginBottom: 24 }}
      />
      <div style={{ borderTop: "1px solid var(--b0)", marginBottom: 16 }} />
      <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
        <div className="shimmer" style={{ height: 44, width: 60, borderRadius: 6 }} />
        <div className="shimmer" style={{ height: 32, width: 44, borderRadius: 6 }} />
        <div className="shimmer" style={{ height: 20, width: 52, borderRadius: 6, marginLeft: "auto" }} />
      </div>
      <div className="shimmer" style={{ height: 2, borderRadius: 2, marginBottom: 16 }} />
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="shimmer"
          style={{ height: 12, width: `${55 + i * 10}%`, borderRadius: 4, marginBottom: i < 3 ? 8 : 0 }}
        />
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   Main Page
───────────────────────────────────────────────────── */

export default function Home() {
  const [clusters, setClusters]   = useState<Cluster[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [selected, setSelected]   = useState<Cluster | null>(null);
  const [filter, setFilter]       = useState<TrendFilter>("all");
  const [search, setSearch]       = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing]   = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  /* QA Alert modal */
  const [qaCluster, setQaCluster] = useState<Cluster | null>(null);
  const [qaEmail, setQaEmail]     = useState<string | null>(null);
  const [qaLoading, setQaLoading] = useState(false);
  const [qaIsMock, setQaIsMock]   = useState(false);

  /* ── Fetch clusters ── */
  const fetchClusters = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch("/api/clusters");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setClusters(data.clusters ?? []);
      setLastUpdated(new Date());
      setError(null);
    } catch {
      setError("Cannot reach Supabase — check env vars and network connection.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchClusters();
    intervalRef.current = setInterval(() => fetchClusters(true), 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchClusters]);

  /* ── Draft QA Alert ── */
  const handleDraftAlert = useCallback(async (cluster: Cluster) => {
    setQaCluster(cluster);
    setQaEmail(null);
    setQaLoading(true);
    setQaIsMock(false);
    try {
      const res = await fetch("/api/draft-qa-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clusterName: cluster.name,
          prevCount: cluster.prev_window_count,
          currCount: cluster.curr_window_count,
          tickets: cluster.example_tickets,
        }),
      });
      const data = await res.json();
      setQaEmail(data.email);
      setQaIsMock(data.mock ?? false);
    } catch {
      setQaEmail("Failed to generate QA Alert. Please check your connection and try again.");
    } finally {
      setQaLoading(false);
    }
  }, []);

  /* ── Derived ── */
  const filtered = clusters.filter((c) => {
    const matchTrend = filter === "all" || c.trend === filter;
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.example_tickets.some((t) => t.subject.toLowerCase().includes(q));
    return matchTrend && matchSearch;
  });

  const totalTickets = clusters.reduce((s, c) => s + c.ticket_count, 0);
  const increasing   = clusters.filter((c) => c.trend === "Increasing").length;
  const decreasing   = clusters.filter((c) => c.trend === "Decreasing").length;
  const stable       = clusters.filter((c) => c.trend === "Stable").length;

  const TABS: { id: TrendFilter; label: string }[] = [
    { id: "all",        label: "All" },
    { id: "Increasing", label: "Increasing" },
    { id: "Stable",     label: "Stable" },
    { id: "Decreasing", label: "Decreasing" },
  ];

  /* ── Render ── */
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", position: "relative" }}>

      {/* ── Top ambient gradient — Kreo purple ── */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background:
            "radial-gradient(ellipse 100% 50% at 50% -5%, rgba(124,58,237,0.13) 0%, transparent 60%)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      {/* ══ Navigation ══ */}
      <nav
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          background: "rgba(8,8,15,0.88)",
          backdropFilter: "blur(32px)",
          WebkitBackdropFilter: "blur(32px)",
          borderBottom: "1px solid var(--b1)",
        }}
      >
        <div
          style={{
            maxWidth: 1240,
            margin: "0 auto",
            padding: "0 28px",
            height: 52,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                background: "linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                boxShadow: "0 0 16px rgba(124,58,237,0.50), 0 0 0 1px rgba(196,181,253,0.15)",
              }}
            >
              <Activity size={14} color="#fff" strokeWidth={2.5} />
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
              <span
                style={{
                  fontSize: 15,
                  fontWeight: 800,
                  color: "var(--kreo-soft)",
                  letterSpacing: "-0.04em",
                }}
              >
                kreo.
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--t3)",
                  letterSpacing: "-0.01em",
                }}
              >
                Support Intelligence
              </span>
            </div>
          </div>

          {/* Nav right */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {lastUpdated && (
              <span
                style={{
                  fontSize: 11.5,
                  color: "var(--t4)",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontWeight: 500,
                }}
              >
                <Clock size={10} color="var(--t4)" />
                {timeAgo(lastUpdated.toISOString())}
              </span>
            )}

            <button
              onClick={() => fetchClusters(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "5px 11px",
                background: "var(--s3)",
                border: "1px solid var(--b1)",
                borderRadius: 8,
                color: "var(--t3)",
                fontSize: 11.5,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.14s",
                letterSpacing: "-0.01em",
              }}
              onMouseEnter={(e) => {
                const b = e.currentTarget as HTMLButtonElement;
                b.style.background = "var(--s4)";
                b.style.borderColor = "var(--b2)";
                b.style.color = "var(--t2)";
              }}
              onMouseLeave={(e) => {
                const b = e.currentTarget as HTMLButtonElement;
                b.style.background = "var(--s3)";
                b.style.borderColor = "var(--b1)";
                b.style.color = "var(--t3)";
              }}
            >
              <RefreshCw
                size={11}
                className={refreshing ? "spin" : ""}
                style={{ transition: "none" }}
              />
              Refresh
            </button>

            {/* Live indicator */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 9px",
                background: "rgba(34,197,94,0.07)",
                border: "1px solid rgba(34,197,94,0.18)",
                borderRadius: 100,
              }}
            >
              <div
                className="live-dot"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--green)",
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 11, color: "#22C55E", fontWeight: 600, letterSpacing: "0.02em" }}>
                Live
              </span>
            </div>
          </div>
        </div>
      </nav>

      {/* ══ Main content ══ */}
      <main
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          padding: "0 28px 100px",
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* ── Hero ── */}
        <div style={{ padding: "56px 0 42px" }}>
          {/* Pill badge */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "5px 12px",
              background: "rgba(196,181,253,0.07)",
              border: "1px solid rgba(196,181,253,0.18)",
              borderRadius: 100,
              fontSize: 10.5,
              fontWeight: 700,
              color: "var(--kreo-soft)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 24,
              opacity: 0,
              animation: "fade-up 0.45s var(--smooth) 0s forwards",
            }}
          >
            <div
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "var(--kreo-soft)",
                boxShadow: "0 0 8px var(--kreo-soft)",
              }}
            />
            AI · Semantic Clustering · Trend Detection · Agentic Actions
          </div>

          {/* Heading */}
          <h1
            style={{
              fontSize: "clamp(40px, 5.8vw, 64px)",
              fontWeight: 800,
              letterSpacing: "-0.045em",
              color: "var(--t1)",
              lineHeight: 1.06,
              marginBottom: 18,
              opacity: 0,
              animation: "fade-up 0.52s var(--smooth) 0.07s forwards",
            }}
          >
            Issue Intelligence
            <span
              style={{
                display: "block",
                background: "linear-gradient(90deg, var(--t3) 0%, var(--t4) 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Dashboard
            </span>
          </h1>

          {/* Subtitle */}
          <p
            style={{
              fontSize: 15,
              color: "var(--t3)",
              maxWidth: 500,
              lineHeight: 1.68,
              fontWeight: 400,
              opacity: 0,
              animation: "fade-up 0.52s var(--smooth) 0.14s forwards",
            }}
          >
            Support tickets automatically clustered by semantic similarity.
            Trends detected across rolling 30-day windows. AI root cause analysis
            and QA alerts on demand.
          </p>
        </div>

        {/* ── Metrics ── */}
        {!loading && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 12,
              marginBottom: 36,
            }}
          >
            <MetricCard
              label="Total Tickets"
              value={totalTickets}
              sub="across all clusters"
              icon={BarChart2}
              delay={0.18}
            />
            <MetricCard
              label="Clusters"
              value={clusters.length}
              sub="semantic groups"
              icon={Activity}
              delay={0.22}
            />
            <MetricCard
              label="Increasing"
              value={increasing}
              sub="requires attention"
              accent="var(--kreo)"
              icon={TrendingUp}
              delay={0.26}
            />
            <MetricCard
              label="Decreasing"
              value={decreasing}
              sub="trending down"
              accent="var(--trend-dn)"
              icon={TrendingDown}
              delay={0.30}
            />
          </div>
        )}

        {/* ── Search + Filter ── */}
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            marginBottom: 24,
            opacity: 0,
            animation: "fade-up 0.45s var(--smooth) 0.36s forwards",
            flexWrap: "wrap",
          }}
        >
          {/* Search */}
          <div style={{ position: "relative", flex: 1, minWidth: 220, maxWidth: 380 }}>
            <Search
              size={13}
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--t4)",
                pointerEvents: "none",
              }}
            />
            <input
              type="text"
              placeholder="Search clusters or tickets…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%",
                height: 36,
                padding: "0 12px 0 34px",
                background: "var(--s2)",
                border: "1px solid var(--b1)",
                borderRadius: 10,
                color: "var(--t1)",
                fontSize: 12.5,
                outline: "none",
                transition: "border-color 0.15s",
                fontFamily: "inherit",
                fontWeight: 400,
              }}
              onFocus={(e) =>
                (e.target.style.borderColor = "rgba(139,92,246,0.50)")
              }
              onBlur={(e) =>
                (e.target.style.borderColor = "var(--b1)")
              }
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                style={{
                  position: "absolute",
                  right: 9,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--t4)",
                  display: "flex",
                  padding: 0,
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Filter pills */}
          <div
            style={{
              display: "flex",
              gap: 2,
              background: "var(--s2)",
              border: "1px solid var(--b1)",
              borderRadius: 10,
              padding: "3px",
            }}
          >
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setFilter(id)}
                style={{
                  padding: "4px 12px",
                  borderRadius: 7,
                  fontSize: 11.5,
                  fontWeight: filter === id ? 700 : 500,
                  border: "none",
                  cursor: "pointer",
                  transition: "background 0.14s, color 0.14s",
                  background: filter === id ? "var(--s4)" : "transparent",
                  color: filter === id ? "var(--t1)" : "var(--t3)",
                  fontFamily: "inherit",
                  letterSpacing: filter === id ? "-0.01em" : "0",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <span style={{ fontSize: 12, color: "var(--t4)", fontWeight: 500 }}>
            {filtered.length} cluster{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* ── Error ── */}
        {error && (
          <div
            style={{
              background: "rgba(244,63,94,0.07)",
              border: "1px solid rgba(244,63,94,0.22)",
              borderRadius: 12,
              padding: "14px 18px",
              color: "var(--red)",
              fontSize: 13,
              marginBottom: 24,
              display: "flex",
              alignItems: "center",
              gap: 9,
              fontWeight: 500,
            }}
          >
            <AlertCircle size={15} />
            {error}
          </div>
        )}

        {/* ── Loading ── */}
        {loading ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
              gap: 16,
            }}
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} delay={i * 0.06} />
            ))}
          </div>
        ) : (
          <>
            {/* ── Cluster grid ── */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
                gap: 16,
              }}
            >
              {filtered.map((c, i) => (
                <ClusterCard
                  key={c.id}
                  cluster={c}
                  delay={0.04 + i * 0.05}
                  onClick={() => setSelected(c)}
                  onDraftAlert={
                    c.trend === "Increasing"
                      ? () => handleDraftAlert(c)
                      : undefined
                  }
                />
              ))}
            </div>

            {/* Empty state */}
            {filtered.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  padding: "100px 0",
                  opacity: 0,
                  animation: "fade-in 0.4s ease 0.1s forwards",
                }}
              >
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 14,
                    background: "var(--s2)",
                    border: "1px solid var(--b1)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 16px",
                  }}
                >
                  <Search size={20} color="var(--t4)" />
                </div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: "var(--t3)",
                    marginBottom: 6,
                    letterSpacing: "-0.02em",
                  }}
                >
                  No clusters found
                </div>
                <div style={{ fontSize: 12.5, color: "var(--t4)" }}>
                  Try a different search term or filter
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* ── Detail Panel ── */}
      {selected && (
        <DetailPanel
          cluster={selected}
          onClose={() => setSelected(null)}
          onDraftAlert={() => handleDraftAlert(selected)}
        />
      )}

      {/* ── QA Alert Modal ── */}
      {qaCluster && (
        <QaAlertModal
          cluster={qaCluster}
          email={qaEmail}
          loading={qaLoading}
          isMock={qaIsMock}
          onClose={() => {
            setQaCluster(null);
            setQaEmail(null);
            setQaIsMock(false);
          }}
        />
      )}
    </div>
  );
}
