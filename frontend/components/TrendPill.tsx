import { T, PRIORITY } from "./tokens";
import type { Cluster } from "./types";

export function TrendPill({ trend }: { trend: Cluster["trend"] }) {
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

export function PriorityDot({ priority }: { priority: string }) {
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
