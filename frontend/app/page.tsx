"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Activity, RefreshCw, Search, X, Clock, AlertCircle,
  TrendingUp, TrendingDown, BarChart2, Upload, Database, Globe,
} from "lucide-react";

import { MetricCard } from "../components/MetricCard";
import { ClusterCard } from "../components/ClusterCard";
import { DetailPanel } from "../components/DetailPanel";
import { QaAlertModal } from "../components/QaAlertModal";
import { CsvUploadModal } from "../components/CsvUploadModal";
import { SkeletonCard } from "../components/SkeletonCard";
import { timeAgo } from "../components/utils";
import type { Cluster, TrendFilter, Space } from "../components/types";

/* ── Constants ─────────────────────────────────────────────── */

const TABS: { id: TrendFilter; label: string }[] = [
  { id: "all",        label: "All"        },
  { id: "Increasing", label: "Increasing" },
  { id: "Stable",     label: "Stable"     },
  { id: "Decreasing", label: "Decreasing" },
];

/* ══════════════════════════════════════════════════════════════
   Main Page
══════════════════════════════════════════════════════════════ */

export default function Home() {
  const [clusters, setClusters]       = useState<Cluster[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [selected, setSelected]       = useState<Cluster | null>(null);
  const [filter, setFilter]           = useState<TrendFilter>("all");
  const [search, setSearch]           = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing]   = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  /* QA Alert modal */
  const [qaCluster, setQaCluster] = useState<Cluster | null>(null);
  const [qaEmail, setQaEmail]     = useState<string | null>(null);
  const [qaLoading, setQaLoading] = useState(false);
  const [qaIsMock, setQaIsMock]   = useState(false);

  /* Spaces */
  const [space, setSpace] = useState<Space>("support");

  /* Marketplace sync */
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  /* CSV upload */
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvStatus, setCsvStatus]       = useState<string | null>(null);
  const [csvError, setCsvError]         = useState<string | null>(null);

  /* ── Fetch clusters ─────────────────────────────────────── */
  const fetchClusters = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch(`/api/clusters?source=${space}`);
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
  }, [space]);

  useEffect(() => {
    fetchClusters();
    intervalRef.current = setInterval(() => fetchClusters(true), 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchClusters]);

  /* ── Draft QA Alert ─────────────────────────────────────── */
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
          prevCount:   cluster.prev_window_count,
          currCount:   cluster.curr_window_count,
          tickets:     cluster.example_tickets,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setQaEmail(data.email);
      setQaIsMock(data.mock ?? false);
    } catch {
      setQaEmail("Failed to generate QA Alert. Please check your connection and try again.");
    } finally {
      setQaLoading(false);
    }
  }, []);

  /* ── Sync Marketplace ───────────────────────────────────── */
  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/sync-marketplaces", { method: "POST" });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      await fetchClusters(true);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setIsSyncing(false);
    }
  }, [fetchClusters]);

  /* ── CSV Upload ─────────────────────────────────────────── */
  const handleCsvUpload = useCallback(async (file: File) => {
    setCsvStatus("Uploading file...");
    setCsvError(null);
    const timers: ReturnType<typeof setTimeout>[] = [];
    const clearTimers = () => timers.forEach(clearTimeout);
    timers.push(setTimeout(() => setCsvStatus("Vectorizing data..."),  2_500));
    timers.push(setTimeout(() => setCsvStatus("Clustering issues..."), 7_000));
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload-csv", { method: "POST", body: formData });
      clearTimers();
      const data = (await res.json()) as { inserted?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setCsvStatus(`Done — ${data.inserted ?? 0} tickets ingested.`);
      await fetchClusters(true);
      timers.push(setTimeout(() => { setShowCsvModal(false); setCsvStatus(null); }, 2_200));
    } catch (err) {
      clearTimers();
      setCsvError(err instanceof Error ? err.message : "Upload failed");
      setCsvStatus(null);
    }
  }, [fetchClusters]);

  /* ── Derived state ──────────────────────────────────────── */
  const filtered = clusters.filter((c) => {
    const matchTrend  = filter === "all" || c.trend === filter;
    const q           = search.toLowerCase();
    const matchSearch = !q
      || c.name.toLowerCase().includes(q)
      || c.description.toLowerCase().includes(q)
      || c.example_tickets.some((t) => t.subject.toLowerCase().includes(q));
    return matchTrend && matchSearch;
  });

  const totalTickets = clusters.reduce((s, c) => s + c.ticket_count, 0);
  const increasing   = clusters.filter((c) => c.trend === "Increasing").length;
  const decreasing   = clusters.filter((c) => c.trend === "Decreasing").length;

  /* ── Render ─────────────────────────────────────────────── */
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", position: "relative" }}>

      {/* Ambient gradient */}
      <div style={{ position: "fixed", inset: 0, background: "radial-gradient(ellipse 100% 50% at 50% -5%, rgba(124,58,237,0.13) 0%, transparent 60%)", pointerEvents: "none", zIndex: 0 }} />

      {/* ── Navigation ── */}
      <nav style={{ position: "sticky", top: 0, zIndex: 30, background: "rgba(8,8,15,0.88)", backdropFilter: "blur(32px)", WebkitBackdropFilter: "blur(32px)", borderBottom: "1px solid var(--b1)" }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "0 28px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 0 16px rgba(124,58,237,0.50), 0 0 0 1px rgba(196,181,253,0.15)" }}>
              <Activity size={14} color="#fff" strokeWidth={2.5} />
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: "var(--kreo-soft)", letterSpacing: "-0.04em" }}>kreo.</span>
              <span style={{ fontSize: 13, fontWeight: 500, color: "var(--t3)", letterSpacing: "-0.01em" }}>Support Intelligence</span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {lastUpdated && (
              <span style={{ fontSize: 11.5, color: "var(--t4)", display: "flex", alignItems: "center", gap: 4, fontWeight: 500 }}>
                <Clock size={10} color="var(--t4)" />
                {timeAgo(lastUpdated.toISOString())}
              </span>
            )}
            <button
              onClick={() => { setShowCsvModal(true); setCsvStatus(null); setCsvError(null); }}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 11px", background: "rgba(124,58,237,0.10)", border: "1px solid rgba(139,92,246,0.28)", borderRadius: 8, color: "var(--kreo-soft)", fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all 0.14s", letterSpacing: "-0.01em" }}
              onMouseEnter={(e) => { const b = e.currentTarget as HTMLButtonElement; b.style.background = "rgba(124,58,237,0.18)"; b.style.borderColor = "rgba(139,92,246,0.50)"; }}
              onMouseLeave={(e) => { const b = e.currentTarget as HTMLButtonElement; b.style.background = "rgba(124,58,237,0.10)"; b.style.borderColor = "rgba(139,92,246,0.28)"; }}
            >
              <Upload size={11} />
              Upload CSV
            </button>
            <button
              onClick={() => fetchClusters(true)}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 11px", background: "var(--s3)", border: "1px solid var(--b1)", borderRadius: 8, color: "var(--t3)", fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all 0.14s", letterSpacing: "-0.01em" }}
              onMouseEnter={(e) => { const b = e.currentTarget as HTMLButtonElement; b.style.background = "var(--s4)"; b.style.borderColor = "var(--b2)"; b.style.color = "var(--t2)"; }}
              onMouseLeave={(e) => { const b = e.currentTarget as HTMLButtonElement; b.style.background = "var(--s3)"; b.style.borderColor = "var(--b1)"; b.style.color = "var(--t3)"; }}
            >
              <RefreshCw size={11} className={refreshing ? "spin" : ""} style={{ transition: "none" }} />
              Refresh
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 9px", background: "rgba(34,197,94,0.07)", border: "1px solid rgba(34,197,94,0.18)", borderRadius: 100 }}>
              <div className="live-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "#22C55E", fontWeight: 600, letterSpacing: "0.02em" }}>Live</span>
            </div>
          </div>
        </div>
      </nav>

      {/* ── Main content ── */}
      <main style={{ maxWidth: 1240, margin: "0 auto", padding: "0 28px 100px", position: "relative", zIndex: 1 }}>

        {/* Hero */}
        <div style={{ padding: "56px 0 42px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 12px", background: "rgba(196,181,253,0.07)", border: "1px solid rgba(196,181,253,0.18)", borderRadius: 100, fontSize: 10.5, fontWeight: 700, color: "var(--kreo-soft)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 24, opacity: 0, animation: "fade-up 0.45s var(--smooth) 0s forwards" }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--kreo-soft)", boxShadow: "0 0 8px var(--kreo-soft)" }} />
            AI · Semantic Clustering · Trend Detection · Agentic Actions
          </div>
          <h1 style={{ fontSize: "clamp(40px, 5.8vw, 64px)", fontWeight: 800, letterSpacing: "-0.045em", color: "var(--t1)", lineHeight: 1.06, marginBottom: 18, opacity: 0, animation: "fade-up 0.52s var(--smooth) 0.07s forwards" }}>
            Issue Intelligence
            <span style={{ display: "block", background: "linear-gradient(90deg, var(--t3) 0%, var(--t4) 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Dashboard</span>
          </h1>
          <p style={{ fontSize: 15, color: "var(--t3)", maxWidth: 500, lineHeight: 1.68, fontWeight: 400, opacity: 0, animation: "fade-up 0.52s var(--smooth) 0.14s forwards" }}>
            Support tickets automatically clustered by semantic similarity. Trends detected across rolling 30-day windows. AI root cause analysis and QA alerts on demand.
          </p>
        </div>

        {/* Spaces Toggle */}
        <div style={{ display: "inline-flex", gap: 0, background: "var(--s2)", border: "1px solid var(--b1)", borderRadius: 10, padding: 3, marginBottom: 32, opacity: 0, animation: "fade-up 0.45s var(--smooth) 0.20s forwards" }}>
          {([ ["support", "Internal Support", Database], ["marketplace", "Marketplaces", Globe] ] as const).map(([id, label, Icon]) => {
            const active = space === id;
            return (
              <button key={id} onClick={() => { setSpace(id); setFilter("all"); setSearch(""); }}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 16px", borderRadius: 7, fontSize: 12.5, fontWeight: active ? 700 : 500, border: "none", cursor: "pointer", transition: "background 0.14s, color 0.14s", background: active ? "var(--s4)" : "transparent", color: active ? "var(--t1)" : "var(--t3)", fontFamily: "inherit", letterSpacing: active ? "-0.02em" : "0", boxShadow: active ? "0 0 0 1px var(--b2)" : "none" }}
              >
                <Icon size={12} />{label}
              </button>
            );
          })}
        </div>

        {/* Metrics */}
        {!loading && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 36 }}>
            <MetricCard label="Total Tickets" value={totalTickets} sub="across all clusters"  icon={BarChart2}    delay={0.18} />
            <MetricCard label="Clusters"      value={clusters.length} sub="semantic groups"   icon={Activity}    delay={0.22} />
            <MetricCard label="Increasing"    value={increasing}  sub="requires attention" accent="var(--kreo)"      icon={TrendingUp}  delay={0.26} />
            <MetricCard label="Decreasing"    value={decreasing}  sub="trending down"      accent="var(--trend-dn)"  icon={TrendingDown} delay={0.30} />
          </div>
        )}

        {/* Search + Filter */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 24, opacity: 0, animation: "fade-up 0.45s var(--smooth) 0.36s forwards", flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 220, maxWidth: 380 }}>
            <Search size={13} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--t4)", pointerEvents: "none" }} />
            <input type="text" placeholder="Search clusters or tickets…" value={search} onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%", height: 36, padding: "0 12px 0 34px", background: "var(--s2)", border: "1px solid var(--b1)", borderRadius: 10, color: "var(--t1)", fontSize: 12.5, outline: "none", transition: "border-color 0.15s", fontFamily: "inherit", fontWeight: 400 }}
              onFocus={(e) => (e.target.style.borderColor = "rgba(139,92,246,0.50)")}
              onBlur={(e)  => (e.target.style.borderColor = "var(--b1)")}
            />
            {search && (
              <button onClick={() => setSearch("")} style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--t4)", display: "flex", padding: 0 }}>
                <X size={12} />
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 2, background: "var(--s2)", border: "1px solid var(--b1)", borderRadius: 10, padding: "3px" }}>
            {TABS.map(({ id, label }) => (
              <button key={id} onClick={() => setFilter(id)}
                style={{ padding: "4px 12px", borderRadius: 7, fontSize: 11.5, fontWeight: filter === id ? 700 : 500, border: "none", cursor: "pointer", transition: "background 0.14s, color 0.14s", background: filter === id ? "var(--s4)" : "transparent", color: filter === id ? "var(--t1)" : "var(--t3)", fontFamily: "inherit", letterSpacing: filter === id ? "-0.01em" : "0" }}
              >
                {label}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 12, color: "var(--t4)", fontWeight: 500 }}>
            {filtered.length} cluster{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Marketplace Sync Bar */}
        {space === "marketplace" && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "rgba(124,58,237,0.06)", border: "1px solid rgba(139,92,246,0.18)", borderRadius: 10, marginBottom: 20, opacity: 0, animation: "fade-up 0.35s var(--smooth) 0s forwards" }}>
            <Globe size={13} color="var(--kreo-soft)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 12.5, color: "var(--t3)", flex: 1, fontWeight: 500 }}>Showing Amazon review tickets ingested via Apify.</span>
            {syncError && <span style={{ fontSize: 11.5, color: "var(--red)", fontWeight: 500 }}>{syncError}</span>}
            <button onClick={handleSync} disabled={isSyncing}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", background: isSyncing ? "var(--s3)" : "var(--kreo)", border: "1px solid rgba(139,92,246,0.35)", borderRadius: 8, color: isSyncing ? "var(--t3)" : "#fff", fontSize: 12, fontWeight: 700, cursor: isSyncing ? "default" : "pointer", fontFamily: "inherit", letterSpacing: "-0.01em", transition: "all 0.14s", opacity: isSyncing ? 0.7 : 1, whiteSpace: "nowrap" }}
            >
              <RefreshCw size={11} className={isSyncing ? "spin" : ""} style={{ transition: "none" }} />
              {isSyncing ? "Scraping marketplace data..." : "[ Sync Marketplaces Data ]"}
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ background: "rgba(244,63,94,0.07)", border: "1px solid rgba(244,63,94,0.22)", borderRadius: 12, padding: "14px 18px", color: "var(--red)", fontSize: 13, marginBottom: 24, display: "flex", alignItems: "center", gap: 9, fontWeight: 500 }}>
            <AlertCircle size={15} />{error}
          </div>
        )}

        {/* Grid */}
        {loading ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} delay={i * 0.06} />)}
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
              {filtered.map((c, i) => (
                <ClusterCard key={c.id} cluster={c} delay={0.04 + i * 0.05} onClick={() => setSelected(c)} onDraftAlert={c.trend === "Increasing" ? () => handleDraftAlert(c) : undefined} />
              ))}
            </div>
            {filtered.length === 0 && (
              <div style={{ textAlign: "center", padding: "100px 0", opacity: 0, animation: "fade-in 0.4s ease 0.1s forwards" }}>
                <div style={{ width: 52, height: 52, borderRadius: 14, background: "var(--s2)", border: "1px solid var(--b1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                  <Search size={20} color="var(--t4)" />
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--t3)", marginBottom: 6, letterSpacing: "-0.02em" }}>No clusters found</div>
                <div style={{ fontSize: 12.5, color: "var(--t4)" }}>Try a different search term or filter</div>
              </div>
            )}
          </>
        )}
      </main>

      {selected && <DetailPanel cluster={selected} onClose={() => setSelected(null)} onDraftAlert={() => handleDraftAlert(selected)} />}
      {qaCluster && <QaAlertModal cluster={qaCluster} email={qaEmail} loading={qaLoading} isMock={qaIsMock} onClose={() => { setQaCluster(null); setQaEmail(null); setQaIsMock(false); }} />}
      {showCsvModal && <CsvUploadModal onUpload={handleCsvUpload} onClose={() => { setShowCsvModal(false); setCsvStatus(null); setCsvError(null); }} status={csvStatus} error={csvError} />}
    </div>
  );
}
