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
} from "lucide-react";

/* ─────────────────────── Types ─────────────────────── */

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

/* ─────────────────────── Constants ─────────────────── */

const TREND = {
  Increasing: {
    label: "Increasing",
    Icon: TrendingUp,
    color: "#30d158",
    bg: "rgba(48,209,88,0.11)",
    border: "rgba(48,209,88,0.22)",
    glow: "rgba(48,209,88,0.06)",
  },
  Decreasing: {
    label: "Decreasing",
    Icon: TrendingDown,
    color: "#ff9f0a",
    bg: "rgba(255,159,10,0.11)",
    border: "rgba(255,159,10,0.22)",
    glow: "rgba(255,159,10,0.06)",
  },
  Stable: {
    label: "Stable",
    Icon: Minus,
    color: "#a1a1a6",
    bg: "rgba(161,161,166,0.10)",
    border: "rgba(161,161,166,0.18)",
    glow: "rgba(161,161,166,0.04)",
  },
};

const PRIORITY_COLOR: Record<string, string> = {
  Critical: "#ff453a",
  High: "#ff9f0a",
  Medium: "#0a84ff",
  Low: "#30d158",
};

/* ─────────────────────── Helpers ───────────────────── */

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

function pct(prev: number, curr: number) {
  if (prev === 0) return curr > 0 ? "+100%" : "—";
  const v = Math.round(((curr - prev) / prev) * 100);
  return v > 0 ? `+${v}%` : `${v}%`;
}

/* ─────────────────────── Sub-components ────────────── */

function TrendBadge({ trend }: { trend: Cluster["trend"] }) {
  const t = TREND[trend];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 9px",
        borderRadius: 100,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.03em",
        color: t.color,
        background: t.bg,
        border: `1px solid ${t.border}`,
        whiteSpace: "nowrap",
      }}
    >
      <t.Icon size={10} strokeWidth={2.5} />
      {t.label}
    </span>
  );
}

function PriorityDot({ priority }: { priority: string }) {
  return (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: PRIORITY_COLOR[priority] || "#6e6e73",
        flexShrink: 0,
        display: "inline-block",
      }}
    />
  );
}

/* ── Metric card ── */
function Metric({
  label,
  value,
  sub,
  accent,
  delay = 0,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  delay?: number;
}) {
  return (
    <div
      style={{
        background: "var(--s2)",
        border: "1px solid var(--b1)",
        borderRadius: 16,
        padding: "20px 22px",
        opacity: 0,
        animation: `fade-up 0.5s var(--smooth) ${delay}s forwards`,
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: "var(--t3)",
          fontWeight: 500,
          marginBottom: 10,
          letterSpacing: "0.01em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 34,
          fontWeight: 700,
          letterSpacing: "-0.04em",
          color: accent || "var(--t1)",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: "var(--t4)", marginTop: 6 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/* ── Cluster card ── */
function ClusterCard({
  cluster,
  onClick,
  delay,
}: {
  cluster: Cluster;
  onClick: () => void;
  delay: number;
}) {
  const t = TREND[cluster.trend];
  const change = pct(cluster.prev_window_count, cluster.curr_window_count);
  const barPct = Math.min(
    (cluster.curr_window_count / Math.max(cluster.ticket_count, 1)) * 100,
    100
  );

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      style={{
        background: "var(--s2)",
        border: "1px solid var(--b1)",
        borderRadius: 20,
        padding: "22px 22px 20px",
        cursor: "pointer",
        opacity: 0,
        animation: `fade-up 0.52s var(--smooth) ${delay}s forwards`,
        position: "relative",
        overflow: "hidden",
        transition: "border-color 0.18s, box-shadow 0.18s, transform 0.18s",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = "var(--b2)";
        el.style.transform = "translateY(-3px)";
        el.style.boxShadow = "0 16px 48px rgba(0,0,0,0.7)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = "var(--b1)";
        el.style.transform = "translateY(0)";
        el.style.boxShadow = "none";
      }}
    >
      {/* Trend glow corner */}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          width: 130,
          height: 130,
          background: `radial-gradient(circle at top right, ${t.glow}, transparent 65%)`,
          pointerEvents: "none",
        }}
      />

      {/* Header row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 14,
        }}
      >
        <TrendBadge trend={cluster.trend} />
        <ChevronRight size={14} color="var(--t4)" />
      </div>

      {/* Name */}
      <div
        style={{
          fontSize: 17,
          fontWeight: 650,
          color: "var(--t1)",
          letterSpacing: "-0.022em",
          lineHeight: 1.3,
          marginBottom: 7,
        }}
      >
        {cluster.name}
      </div>

      {/* Description */}
      <div
        style={{
          fontSize: 13,
          color: "var(--t3)",
          lineHeight: 1.55,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical" as const,
          overflow: "hidden",
          marginBottom: 18,
        }}
      >
        {cluster.description}
      </div>

      {/* Divider */}
      <div
        style={{
          borderTop: "1px solid var(--b0)",
          marginBottom: 14,
        }}
      />

      {/* Stats row */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 18,
          marginBottom: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: "-0.04em",
              color: "var(--t1)",
              lineHeight: 1,
            }}
          >
            {cluster.ticket_count}
          </div>
          <div
            style={{ fontSize: 11, color: "var(--t4)", marginTop: 3 }}
          >
            total
          </div>
        </div>
        <div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: "-0.04em",
              color: t.color,
              lineHeight: 1,
            }}
          >
            {cluster.curr_window_count}
          </div>
          <div
            style={{ fontSize: 11, color: "var(--t4)", marginTop: 3 }}
          >
            this month
          </div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: t.color,
            }}
          >
            {change}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: 3,
          background: "var(--b0)",
          borderRadius: 2,
          overflow: "hidden",
          marginBottom: 14,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${barPct}%`,
            background: t.color,
            borderRadius: 2,
          }}
        />
      </div>

      {/* Recent tickets */}
      {cluster.example_tickets.slice(0, 3).map((tk, i) => (
        <div
          key={tk.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            paddingTop: i > 0 ? 5 : 0,
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
            }}
          >
            {tk.subject}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Detail panel ── */
function DetailPanel({
  cluster,
  onClose,
}: {
  cluster: Cluster;
  onClose: () => void;
}) {
  const t = TREND[cluster.trend];
  const change = pct(cluster.prev_window_count, cluster.curr_window_count);
  const prevBar = Math.min(
    (cluster.prev_window_count / Math.max(cluster.ticket_count, 1)) * 100,
    100
  );
  const currBar = Math.min(
    (cluster.curr_window_count / Math.max(cluster.ticket_count, 1)) * 100,
    100
  );

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
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
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
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
          width: "min(560px, 100vw)",
          background: "var(--s1)",
          borderLeft: "1px solid var(--b1)",
          zIndex: 50,
          display: "flex",
          flexDirection: "column",
          animation: "slide-panel 0.32s var(--smooth) forwards",
          boxShadow: "-16px 0 64px rgba(0,0,0,0.9)",
        }}
      >
        {/* Panel header */}
        <div
          style={{
            padding: "18px 22px",
            borderBottom: "1px solid var(--b1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <TrendBadge trend={cluster.trend} />
            <span style={{ fontSize: 13, color: "var(--t3)" }}>
              {cluster.ticket_count} tickets
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: "var(--b1)",
              border: "1px solid var(--b1)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--t2)",
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                "var(--b2)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                "var(--b1)")
            }
          >
            <X size={14} />
          </button>
        </div>

        {/* Scrollable body */}
        <div
          style={{ flex: 1, overflowY: "auto", padding: "26px 22px 40px" }}
        >
          <h2
            style={{
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: "-0.033em",
              color: "var(--t1)",
              lineHeight: 1.25,
              marginBottom: 10,
            }}
          >
            {cluster.name}
          </h2>

          <p
            style={{
              fontSize: 14,
              color: "var(--t3)",
              lineHeight: 1.65,
              marginBottom: 26,
            }}
          >
            {cluster.description}
          </p>

          {/* Trend analysis box */}
          <div
            style={{
              background: "var(--s3)",
              border: "1px solid var(--b1)",
              borderRadius: 14,
              padding: "18px 20px",
              marginBottom: 28,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: "var(--t4)",
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: 14,
              }}
            >
              Trend · 30-day windows
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: 20,
                marginBottom: 18,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 30,
                    fontWeight: 700,
                    letterSpacing: "-0.04em",
                    color: "var(--t3)",
                    lineHeight: 1,
                  }}
                >
                  {cluster.prev_window_count}
                </div>
                <div
                  style={{ fontSize: 11, color: "var(--t4)", marginTop: 3 }}
                >
                  previous
                </div>
              </div>

              <div style={{ color: "var(--t4)", fontSize: 18, paddingBottom: 4 }}>
                →
              </div>

              <div>
                <div
                  style={{
                    fontSize: 30,
                    fontWeight: 700,
                    letterSpacing: "-0.04em",
                    color: t.color,
                    lineHeight: 1,
                  }}
                >
                  {cluster.curr_window_count}
                </div>
                <div
                  style={{ fontSize: 11, color: "var(--t4)", marginTop: 3 }}
                >
                  current
                </div>
              </div>

              <div style={{ marginLeft: "auto" }}>
                <span
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    letterSpacing: "-0.03em",
                    color: t.color,
                  }}
                >
                  {change}
                </span>
              </div>
            </div>

            {/* Bar comparison */}
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {[
                { label: "prev", width: prevBar, color: "rgba(255,255,255,0.18)" },
                { label: "curr", width: currBar, color: t.color },
              ].map(({ label, width, color }) => (
                <div
                  key={label}
                  style={{ display: "flex", alignItems: "center", gap: 10 }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--t4)",
                      width: 30,
                      textAlign: "right",
                    }}
                  >
                    {label}
                  </div>
                  <div
                    style={{
                      flex: 1,
                      height: 5,
                      background: "var(--b1)",
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
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tickets list */}
          <div
            style={{
              fontSize: 11,
              color: "var(--t4)",
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 12,
            }}
          >
            Tickets · {cluster.example_tickets.length} shown
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {cluster.example_tickets.map((tk, i) => (
              <div
                key={tk.id}
                style={{
                  background: "var(--s3)",
                  border: "1px solid var(--b1)",
                  borderRadius: 12,
                  padding: "13px 15px",
                  opacity: 0,
                  animation: `fade-up 0.4s var(--smooth) ${i * 0.04}s forwards`,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 9,
                    alignItems: "flex-start",
                  }}
                >
                  <div style={{ paddingTop: 3 }}>
                    <PriorityDot priority={tk.priority} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        color: "#e0e0e5",
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
                        gap: 8,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color:
                            PRIORITY_COLOR[tk.priority] || "var(--t3)",
                        }}
                      >
                        {tk.priority}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--t4)" }}>
                        ·
                      </span>
                      <span style={{ fontSize: 11, color: "var(--t3)" }}>
                        {tk.product_area}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--t4)" }}>
                        ·
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--t4)",
                          display: "flex",
                          alignItems: "center",
                          gap: 3,
                        }}
                      >
                        <Clock size={10} />
                        {timeAgo(tk.created_at)}
                      </span>
                    </div>
                  </div>
                  <code
                    style={{
                      fontSize: 10,
                      color: "var(--t4)",
                      flexShrink: 0,
                      paddingTop: 2,
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

/* ─────────────────────── Main Page ─────────────────── */

export default function Home() {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Cluster | null>(null);
  const [filter, setFilter] = useState<TrendFilter>("all");
  const [search, setSearch] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

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
      setError("Unable to reach Supabase — check your env vars and network.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchClusters();
    intervalRef.current = setInterval(() => fetchClusters(true), 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchClusters]);

  /* Derived */
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
  const increasing = clusters.filter((c) => c.trend === "Increasing").length;
  const decreasing = clusters.filter((c) => c.trend === "Decreasing").length;

  /* Filter tabs */
  const TABS: { id: TrendFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "Increasing", label: "Increasing" },
    { id: "Stable", label: "Stable" },
    { id: "Decreasing", label: "Decreasing" },
  ];

  return (
    <div
      style={{ minHeight: "100vh", background: "var(--bg)", position: "relative" }}
    >
      {/* Background ambient gradient */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background:
            "radial-gradient(ellipse 90% 60% at 50% -10%, rgba(10,132,255,0.07) 0%, transparent 65%)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      {/* ── Nav ── */}
      <nav
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          background: "rgba(0,0,0,0.82)",
          backdropFilter: "blur(28px)",
          WebkitBackdropFilter: "blur(28px)",
          borderBottom: "1px solid var(--b1)",
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "0 28px",
            height: 54,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: "linear-gradient(135deg, #0a84ff 0%, #5e5ce6 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Activity size={14} color="#fff" strokeWidth={2} />
            </div>
            <span
              style={{
                fontSize: 15,
                fontWeight: 660,
                color: "var(--t1)",
                letterSpacing: "-0.022em",
              }}
            >
              Support Intelligence
            </span>
          </div>

          {/* Right controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {lastUpdated && (
              <span
                style={{
                  fontSize: 12,
                  color: "var(--t4)",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Clock size={11} color="var(--t4)" />
                {timeAgo(lastUpdated.toISOString())}
              </span>
            )}

            <button
              onClick={() => fetchClusters(true)}
              title="Refresh"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "5px 11px",
                background: "var(--b1)",
                border: "1px solid var(--b1)",
                borderRadius: 8,
                color: "var(--t2)",
                fontSize: 12,
                cursor: "pointer",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.background =
                  "var(--b2)")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.background =
                  "var(--b1)")
              }
            >
              <RefreshCw
                size={12}
                className={refreshing ? "spin" : ""}
                style={{ transition: "none" }}
              />
              Refresh
            </button>

            {/* Live dot */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div
                className="live-dot"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "var(--apple-green)",
                  boxShadow: "0 0 8px rgba(48,209,88,0.6)",
                }}
              />
              <span style={{ fontSize: 12, color: "var(--t3)" }}>Live</span>
            </div>
          </div>
        </div>
      </nav>

      {/* ── Main ── */}
      <main
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "0 28px 80px",
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* ── Hero ── */}
        <div style={{ padding: "52px 0 38px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 11px",
              background: "rgba(10,132,255,0.10)",
              border: "1px solid rgba(10,132,255,0.18)",
              borderRadius: 100,
              fontSize: 11,
              fontWeight: 600,
              color: "var(--apple-blue)",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              marginBottom: 22,
              opacity: 0,
              animation: "fade-up 0.45s var(--smooth) 0s forwards",
            }}
          >
            <div
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "var(--apple-blue)",
              }}
            />
            AI · Semantic Clustering · Trend Detection
          </div>

          <h1
            style={{
              fontSize: "clamp(38px, 5.5vw, 60px)",
              fontWeight: 700,
              letterSpacing: "-0.042em",
              color: "var(--t1)",
              lineHeight: 1.08,
              marginBottom: 18,
              opacity: 0,
              animation: "fade-up 0.5s var(--smooth) 0.06s forwards",
            }}
          >
            Issue Intelligence
            <span
              style={{
                display: "block",
                background:
                  "linear-gradient(90deg, #a1a1a6 0%, #48484a 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Dashboard
            </span>
          </h1>

          <p
            style={{
              fontSize: 16,
              color: "var(--t3)",
              maxWidth: 480,
              lineHeight: 1.65,
              opacity: 0,
              animation: "fade-up 0.5s var(--smooth) 0.12s forwards",
            }}
          >
            Support tickets automatically clustered by semantic similarity.
            Trends detected across rolling 30-day windows.
          </p>
        </div>

        {/* ── Metrics ── */}
        {!loading && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 12,
              marginBottom: 32,
            }}
          >
            <Metric
              label="Total Tickets"
              value={totalTickets}
              sub="across all clusters"
              delay={0.18}
            />
            <Metric
              label="Clusters"
              value={clusters.length}
              sub="semantic groups"
              delay={0.22}
            />
            <Metric
              label="Increasing"
              value={increasing}
              sub="needs attention"
              accent="var(--apple-green)"
              delay={0.26}
            />
            <Metric
              label="Decreasing"
              value={decreasing}
              sub="resolving"
              accent="var(--apple-orange)"
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
            marginBottom: 22,
            opacity: 0,
            animation: "fade-up 0.45s var(--smooth) 0.34s forwards",
          }}
        >
          {/* Search input */}
          <div style={{ position: "relative", flex: 1, maxWidth: 360 }}>
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
                fontSize: 13,
                outline: "none",
                transition: "border-color 0.15s",
                fontFamily: "inherit",
              }}
              onFocus={(e) =>
                (e.target.style.borderColor = "rgba(10,132,255,0.45)")
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
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Filter pills */}
          <div
            style={{
              display: "flex",
              gap: 3,
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
                  padding: "4px 13px",
                  borderRadius: 7,
                  fontSize: 12,
                  fontWeight: 500,
                  border: "none",
                  cursor: "pointer",
                  transition: "background 0.14s, color 0.14s",
                  background: filter === id ? "var(--s4)" : "transparent",
                  color: filter === id ? "var(--t1)" : "var(--t3)",
                  fontFamily: "inherit",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <span style={{ fontSize: 12, color: "var(--t4)" }}>
            {filtered.length} cluster{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* ── Error ── */}
        {error && (
          <div
            style={{
              background: "rgba(255,69,58,0.09)",
              border: "1px solid rgba(255,69,58,0.22)",
              borderRadius: 12,
              padding: "14px 18px",
              color: "#ff453a",
              fontSize: 13,
              marginBottom: 24,
              display: "flex",
              alignItems: "center",
              gap: 9,
            }}
          >
            <AlertCircle size={15} />
            {error}
          </div>
        )}

        {/* ── Loading skeletons ── */}
        {loading ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
              gap: 16,
            }}
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="skeleton"
                style={{
                  background: "var(--s2)",
                  border: "1px solid var(--b1)",
                  borderRadius: 20,
                  height: 280,
                }}
              />
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
                  delay={0.04 + i * 0.055}
                  onClick={() => setSelected(c)}
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
                  <Search size={22} color="var(--t4)" />
                </div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: "var(--t3)",
                    marginBottom: 6,
                  }}
                >
                  No clusters found
                </div>
                <div style={{ fontSize: 13, color: "var(--t4)" }}>
                  Try a different search term or filter
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* ── Detail panel ── */}
      {selected && (
        <DetailPanel
          cluster={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
