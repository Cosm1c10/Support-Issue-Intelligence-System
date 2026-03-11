"use client"

import { useMemo } from "react"
import { Label, Pie, PieChart } from "recharts"
import {
  Chart,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/pie-chart"
import type { ChartConfig } from "@/components/ui/pie-chart"
import type { Cluster } from "./types"

/* ── Category definitions (same keyword rules as area chart) ── */

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

/* ── Component ────────────────────────────────────────────── */

interface Props {
  clusters: Cluster[]
}

export function ClusterPieChart({ clusters }: Props) {
  const { chartData, chartConfig, total, legend } = useMemo(() => {
    // Aggregate into segments
    const segMap = new Map<SegmentLabel, { tickets: number; color: string }>()
    clusters.forEach((c) => {
      const { label, color } = getSegment(c.name)
      const existing = segMap.get(label) ?? { tickets: 0, color }
      segMap.set(label, { tickets: existing.tickets + c.ticket_count, color })
    })

    // Stable order
    const orderedLabels: SegmentLabel[] = [
      ...SEGMENTS.map((s) => s.label),
      "Other" as SegmentLabel,
    ]

    // recharts needs a key field that matches chartConfig
    const data = orderedLabels
      .filter((l) => segMap.has(l))
      .map((l) => {
        const key = l.toLowerCase().replace(/[^a-z]/g, "")
        return {
          key,
          label: l,
          tickets: segMap.get(l)!.tickets,
          fill: `var(--color-${key})`,
        }
      })

    const config: ChartConfig = {
      tickets: { label: "Tickets" },
      ...Object.fromEntries(
        data.map((d) => [d.key, { label: d.label, color: segMap.get(d.label as SegmentLabel)!.color }]),
      ),
    }

    const totalCount = data.reduce((s, d) => s + d.tickets, 0)

    const legendItems = data.map((d) => ({
      key: d.key,
      label: d.label,
      color: segMap.get(d.label as SegmentLabel)!.color,
      pct: totalCount ? Math.round((d.tickets / totalCount) * 100) : 0,
    }))

    return { chartData: data, chartConfig: config, total: totalCount, legend: legendItems }
  }, [clusters])

  if (!clusters.length) return null

  return (
    <div
      style={{
        background: "var(--s2)",
        border: "1px solid var(--b1)",
        borderRadius: 18,
        padding: "20px 20px 12px",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        boxSizing: "border-box",
        opacity: 0,
        animation: "fade-up 0.52s var(--smooth) 0.32s forwards",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 2 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--t1)", letterSpacing: "-0.02em" }}>
          Issue Breakdown
        </div>
        <div style={{ fontSize: 11.5, color: "var(--t4)", marginTop: 2, fontWeight: 400 }}>
          By support category
        </div>
      </div>

      {/* Donut chart — no legend inside recharts */}
      <Chart config={chartConfig} className="mx-auto aspect-square max-h-[170px] w-full">
        <PieChart>
          <ChartTooltip cursor={false} content={(props) => <ChartTooltipContent {...props} hideLabel />} />
          <Pie
            data={chartData}
            dataKey="tickets"
            nameKey="key"
            innerRadius="55%"
            outerRadius="78%"
            strokeWidth={2}
            stroke="var(--s2)"
          >
            <Label
              content={({ viewBox }) => {
                if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                  return (
                    <text textAnchor="middle" dominantBaseline="middle">
                      <tspan
                        x={viewBox.cx}
                        y={(viewBox.cy ?? 0) - 8}
                        style={{
                          fill: "var(--t1)",
                          fontSize: 22,
                          fontWeight: 800,
                          fontFamily: "inherit",
                          letterSpacing: "-0.04em",
                        }}
                      >
                        {total}
                      </tspan>
                      <tspan
                        x={viewBox.cx}
                        y={(viewBox.cy ?? 0) + 12}
                        style={{
                          fill: "var(--t4)",
                          fontSize: 9,
                          fontWeight: 500,
                          fontFamily: "inherit",
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                        }}
                      >
                        tickets
                      </tspan>
                    </text>
                  )
                }
              }}
            />
          </Pie>
        </PieChart>
      </Chart>

      {/* Manual legend — rendered in HTML, can never overlap the chart */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 4 }}>
        {legend.map((item) => (
          <div key={item.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: item.color,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 11, color: "var(--t2)", fontWeight: 500 }}>{item.label}</span>
            </div>
            <span style={{ fontSize: 11, color: "var(--t4)", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
              {item.pct}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
