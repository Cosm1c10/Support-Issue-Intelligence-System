import { TrendingUp, TrendingDown, Minus, ArrowUpRight, ArrowDownRight, BarChart2 } from "lucide-react";

export const T = {
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

export const PRIORITY: Record<string, { color: string; label: string }> = {
  Critical: { color: "#F43F5E", label: "Critical" },
  High:     { color: "#F97316", label: "High"     },
  Medium:   { color: "#3B82F6", label: "Medium"   },
  Low:      { color: "#22C55E", label: "Low"      },
};
