"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Copy, Check, Sparkles, Zap } from "lucide-react";
import { pctChange } from "./utils";
import type { Cluster } from "./types";

interface QaAlertModalProps {
  cluster: Cluster;
  email: string | null;
  loading: boolean;
  isMock: boolean;
  onClose: () => void;
}

export function QaAlertModal({ cluster, email, loading, isMock, onClose }: QaAlertModalProps) {
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
    }).catch((err) => {
      console.error("[clipboard] Write failed:", err);
    });
  }, [email]);

  const change = pctChange(cluster.prev_window_count, cluster.curr_window_count);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0,
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
          top: "50%", left: "50%",
          transform: "translate(-50%,-50%)",
          width: "min(700px, calc(100vw - 40px))",
          maxHeight: "calc(100dvh - 60px)",
          background: "var(--s1)",
          border: "1px solid rgba(139,92,246,0.22)",
          borderRadius: 20,
          zIndex: 70,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 40px 100px rgba(0,0,0,0.95), 0 0 0 1px rgba(196,181,253,0.07), 0 0 80px rgba(124,58,237,0.10)",
          animation: "modal-in 0.32s var(--smooth) forwards",
          opacity: 0,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--b1)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32, height: 32, borderRadius: 9,
                background: "rgba(124,58,237,0.14)",
                border: "1px solid rgba(139,92,246,0.28)",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
                boxShadow: "0 0 20px rgba(124,58,237,0.15)",
              }}
            >
              <Zap size={14} color="#A78BFA" strokeWidth={2.5} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--t1)", letterSpacing: "-0.02em", lineHeight: 1.3 }}>
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
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "6px 14px",
                  background: copied ? "rgba(34,197,94,0.10)" : "rgba(124,58,237,0.10)",
                  border: `1px solid ${copied ? "rgba(34,197,94,0.28)" : "rgba(139,92,246,0.28)"}`,
                  borderRadius: 9,
                  fontSize: 12, fontWeight: 600,
                  color: copied ? "#22C55E" : "var(--kreo-bright)",
                  cursor: "pointer", fontFamily: "inherit",
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

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 24px" }}>
          {loading && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "64px 0", gap: 16 }}>
              <div
                style={{
                  width: 40, height: 40, borderRadius: "50%",
                  border: "3px solid rgba(139,92,246,0.18)",
                  borderTopColor: "#7C3AED",
                  animation: "spin 0.75s linear infinite",
                }}
              />
              <div>
                <div style={{ fontSize: 14, color: "var(--kreo-bright)", fontWeight: 600, textAlign: "center", marginBottom: 4, letterSpacing: "-0.015em" }}>
                  Drafting QA Alert…
                </div>
                <div style={{ fontSize: 12, color: "var(--t4)", textAlign: "center", maxWidth: 260 }}>
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
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "8px 12px",
                    background: "rgba(249,115,22,0.07)", border: "1px solid rgba(249,115,22,0.18)",
                    borderRadius: 8, fontSize: 11, color: "#F97316", fontWeight: 500, marginBottom: 14,
                  }}
                >
                  <Sparkles size={10} />
                  Demo mode — add OPENAI_API_KEY for live AI generation
                </div>
              )}
              <pre
                style={{
                  fontFamily: "inherit", fontSize: 12.5, color: "var(--t2)",
                  lineHeight: 1.76, whiteSpace: "pre-wrap", wordBreak: "break-word",
                  margin: 0, background: "var(--s2)", border: "1px solid var(--b1)",
                  borderRadius: 12, padding: "18px 20px",
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
