import React from "react";

interface MetricCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  icon?: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  delay?: number;
}

export function MetricCard({ label, value, sub, accent, icon: Icon, delay = 0 }: MetricCardProps) {
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
