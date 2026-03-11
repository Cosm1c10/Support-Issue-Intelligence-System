"use client"

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import {
  Chart,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/area-chart"
import type { ChartConfig } from "@/components/ui/area-chart"
import type { Cluster } from "./types"

/* ── Category definitions ─────────────────────────────────── */

const SEGMENTS = [
  { label: "Connectivity", color: "var(--chart-1)", re: /connect|wireless|bluetooth|usb|sync|pair|detect/i },
  { label: "Hardware",     color: "var(--chart-3)", re: /defect|hardware|scroll|wheel|key|mouse|camera|webcam|audio|bass|distort|controller|click/i },
  { label: "Software",     color: "var(--chart-6)", re: /software|firmware|driver|rgb|light|app|update/i },
  { label: "Delivery",     color: "var(--chart-5)", re: /ship|deliver|order|missing|packag/i },
  { label: "Returns",      color: "var(--chart-2)", re: /return|warrant|refund|replac|exchange/i },
] as const

type SegmentLabel = (typeof SEGMENTS)[number]["label"] | "Other"

function getSegment(name: string): { label: SegmentLabel; color: string } {
  return SEGMENTS.find((s) => s.re.test(name)) ?? { label: "Other", color: "var(--chart-4)" }
}

/* ── Custom tick: first=left-align, last=right-align, rest=center ── */

function EdgeAwareTick({
  x, y, payload, index, visibleTicksCount,
}: {
  x: number; y: number;
  payload: { value: string };
  index: number;
  visibleTicksCount: number;
}) {
  const anchor =
    index === 0 ? "start" : index === visibleTicksCount - 1 ? "end" : "middle"
  return (
    <text
      x={x}
      y={y + 8}
      textAnchor={anchor}
      fill="var(--t3)"
      fontSize={11}
      fontFamily="inherit"
    >
      {payload.value}
    </text>
  )
}

/* ── Chart config ─────────────────────────────────────────── */

const chartConfig = {
  curr: { label: "Current 30 days",  color: "var(--chart-1)" },  // kreo purple
  prev: { label: "Previous 30 days", color: "var(--chart-3)" },  // deep violet — distinct from curr purple
} satisfies ChartConfig

/* ── Component ────────────────────────────────────────────── */

interface Props {
  clusters: Cluster[]
}

export function ClusterTrendsChart({ clusters }: Props) {
  if (!clusters.length) return null

  // Aggregate clusters into segments
  const segMap = new Map<SegmentLabel, { prev: number; curr: number }>()
  clusters.forEach((c) => {
    const { label } = getSegment(c.name)
    const existing = segMap.get(label) ?? { prev: 0, curr: 0 }
    segMap.set(label, {
      prev: existing.prev + c.prev_window_count,
      curr: existing.curr + c.curr_window_count,
    })
  })

  // Maintain a stable order matching SEGMENTS, then Other
  const orderedLabels: SegmentLabel[] = [
    ...SEGMENTS.map((s) => s.label),
    "Other" as SegmentLabel,
  ]
  const data = orderedLabels
    .filter((l) => segMap.has(l))
    .map((l) => ({ name: l, ...segMap.get(l)! }))

  return (
    <div
      style={{
        background: "var(--s2)",
        border: "1px solid var(--b1)",
        borderRadius: 18,
        padding: "20px 20px 8px",
        marginBottom: 0,
        opacity: 0,
        animation: "fade-up 0.52s var(--smooth) 0.28s forwards",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--t1)", letterSpacing: "-0.02em" }}>
            30-Day Ticket Volume by Category
          </div>
          <div style={{ fontSize: 11.5, color: "var(--t4)", marginTop: 2, fontWeight: 400 }}>
            Previous vs current window — hover for exact counts
          </div>
        </div>
      </div>

      <Chart config={chartConfig} className="max-h-[200px] w-full mt-2">
        <AreaChart data={data} margin={{ left: 4, right: 4, top: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="fillCurr" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="var(--color-curr)" stopOpacity={0.75} />
              <stop offset="95%" stopColor="var(--color-curr)" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="fillPrev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="var(--color-prev)" stopOpacity={0.45} />
              <stop offset="95%" stopColor="var(--color-prev)" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid vertical={false} stroke="var(--b1)" />
          <XAxis
            dataKey="name"
            tickLine={false}
            axisLine={false}
            tickMargin={0}
            interval={0}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tick={(props: any) => <EdgeAwareTick {...props} />}
          />
          <YAxis hide />
          <ChartTooltip cursor={false} content={(props) => <ChartTooltipContent {...props} indicator="dot" />} />

          <Area dataKey="prev" type="monotone" fill="url(#fillPrev)" fillOpacity={1} stroke="var(--color-prev)" strokeWidth={1.5} />
          <Area dataKey="curr" type="monotone" fill="url(#fillCurr)" fillOpacity={1} stroke="var(--color-curr)" strokeWidth={2} />

          <ChartLegend content={(props) => <ChartLegendContent {...props} />} />
        </AreaChart>
      </Chart>
    </div>
  )
}
