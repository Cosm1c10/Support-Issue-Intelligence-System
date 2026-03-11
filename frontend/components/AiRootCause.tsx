"use client";

import { useState, useCallback } from "react";
import { Sparkles, RefreshCw } from "lucide-react";
import type { Cluster } from "./types";

export function AiRootCause({ cluster }: { cluster: Cluster }) {
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
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
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
          <p style={{ fontSize: 13.5, color: "#D8D0F5", lineHeight: 1.72, margin: 0 }}>
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
            <strong style={{ color: "var(--kreo-bright)", fontWeight: 600 }}>Generate</strong>{" "}
            to get an AI root cause summary for this cluster.
          </div>
        </div>
      )}
    </div>
  );
}
