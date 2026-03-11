"use client";

import { useState, useRef, type CSSProperties } from "react";
import { X, Upload, AlertCircle, RefreshCw } from "lucide-react";

interface CsvUploadModalProps {
  onUpload: (file: File, month: string) => void;
  onClose: () => void;
  status: string | null;
  error: string | null;
}

const SELECT_STYLE: CSSProperties = {
  background: "var(--s3)",
  border: "1px solid var(--b1)",
  borderRadius: 8,
  color: "var(--t2)",
  fontSize: 12,
  fontFamily: "inherit",
  fontWeight: 500,
  padding: "5px 28px 5px 10px",
  cursor: "pointer",
  outline: "none",
  appearance: "none",
  WebkitAppearance: "none",
  MozAppearance: "none",
  colorScheme: "dark",
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23666'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 8px center",
  width: "100%",
};

function getMonthOptions(): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [{ value: "all", label: "All Time" }];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    opts.push({ value, label });
  }
  return opts;
}

const MONTH_OPTIONS = getMonthOptions();

function getCurrentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function CsvUploadModal({ onUpload, onClose, status, error }: CsvUploadModalProps) {
  const [dragOver, setDragOver] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const isProcessing = !!status && !status.startsWith("Done");

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onUpload(file, selectedMonth);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onUpload(file, selectedMonth);
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !isProcessing) onClose(); }}
    >
      <div
        style={{
          background: "var(--s2)", border: "1px solid var(--b2)", borderRadius: 16,
          padding: 28, width: "100%", maxWidth: 480,
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 9,
              background: "rgba(124,58,237,0.12)", border: "1px solid rgba(139,92,246,0.25)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Upload size={14} color="var(--kreo-soft)" />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--t1)", letterSpacing: "-0.02em" }}>
                Upload Historical CSV
              </div>
              <div style={{ fontSize: 11.5, color: "var(--t4)", marginTop: 1 }}>
                Tickets are embedded and clustered automatically
              </div>
            </div>
          </div>
          {!isProcessing && (
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--t4)", display: "flex", padding: 4, borderRadius: 6 }}>
              <X size={15} />
            </button>
          )}
        </div>

        {/* Target Month selector */}
        {!status && !error && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--t4)", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 6 }}>
              Target Month
            </label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              style={SELECT_STYLE}
            >
              {MONTH_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Drag-and-drop zone */}
        {!status && !error && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            style={{
              border: `1.5px dashed ${dragOver ? "rgba(139,92,246,0.6)" : "var(--b2)"}`,
              borderRadius: 12, padding: "36px 24px", textAlign: "center",
              cursor: "pointer", background: dragOver ? "rgba(124,58,237,0.05)" : "var(--s3)",
              transition: "all 0.15s", marginBottom: 20,
            }}
          >
            <input ref={inputRef} type="file" accept=".csv" onChange={handleFileChange} style={{ display: "none" }} />
            <Upload size={22} color="var(--t4)" style={{ margin: "0 auto 12px" }} />
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--t2)", marginBottom: 6 }}>
              {dragOver ? "Drop to upload" : "Drag & drop your CSV file"}
            </div>
            <div style={{ fontSize: 12, color: "var(--t4)", marginBottom: 14 }}>or click to browse</div>
            <div style={{
              display: "inline-block", padding: "4px 10px",
              background: "var(--s4)", border: "1px solid var(--b1)",
              borderRadius: 6, fontSize: 11, color: "var(--t4)", fontFamily: "monospace",
            }}>
              subject, description, date, priority, ticket_type, product_area
            </div>
          </div>
        )}

        {/* Processing state */}
        {status && (
          <div style={{ padding: "24px", background: "var(--s3)", border: "1px solid var(--b1)", borderRadius: 12, marginBottom: 20, textAlign: "center" }}>
            {isProcessing && (
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
                <RefreshCw size={18} color="var(--kreo-soft)" className="spin" />
              </div>
            )}
            <div style={{ fontSize: 13.5, fontWeight: 600, color: status.startsWith("Done") ? "#22C55E" : "var(--t2)", letterSpacing: "-0.01em" }}>
              {status}
            </div>
            {isProcessing && (
              <div style={{ fontSize: 11.5, color: "var(--t4)", marginTop: 6 }}>Embedding tickets and re-clustering — may take 1-2 minutes</div>
            )}
          </div>
        )}

        {/* Error state */}
        {error && (
          <div style={{ padding: "12px 16px", background: "rgba(244,63,94,0.07)", border: "1px solid rgba(244,63,94,0.22)", borderRadius: 10, marginBottom: 20, display: "flex", alignItems: "flex-start", gap: 8 }}>
            <AlertCircle size={14} color="var(--red)" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12.5, color: "var(--red)", lineHeight: 1.5, whiteSpace: "pre-wrap", fontFamily: "monospace" }}>{error}</div>
          </div>
        )}

        {/* Footer */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          {!isProcessing && (
            <button
              onClick={onClose}
              style={{ padding: "7px 16px", background: "var(--s3)", border: "1px solid var(--b1)", borderRadius: 8, color: "var(--t3)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
            >
              {status?.startsWith("Done") ? "Close" : "Cancel"}
            </button>
          )}
          {!status && !error && (
            <button
              onClick={() => inputRef.current?.click()}
              style={{ padding: "7px 16px", background: "var(--kreo)", border: "1px solid rgba(139,92,246,0.4)", borderRadius: 8, color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", letterSpacing: "-0.01em" }}
            >
              Select File
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
