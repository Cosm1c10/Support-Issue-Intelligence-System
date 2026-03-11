export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  const h = Math.floor(ms / 3600000);
  const d = Math.floor(ms / 86400000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

export function pctChange(prev: number, curr: number): string {
  if (prev === 0) return curr > 0 ? "+100%" : "—";
  const v = Math.round(((curr - prev) / prev) * 100);
  return v > 0 ? `+${v}%` : `${v}%`;
}
