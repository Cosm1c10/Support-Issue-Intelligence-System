import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;

// ── Helpers ──────────────────────────────────────────────────

function getMonthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01T00:00:00.000Z`;
  const nextDate = new Date(Date.UTC(y, m, 1));
  const end = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, "0")}-01T00:00:00.000Z`;
  return { start, end };
}

function getPrevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function calcTrend(curr: number, prev: number): "Increasing" | "Decreasing" | "Stable" {
  if (prev === 0) return curr > 0 ? "Increasing" : "Stable";
  if (curr > prev * 1.25) return "Increasing";
  if (curr < prev * 0.75) return "Decreasing";
  return "Stable";
}

// ── Route ────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month"); // 'YYYY-MM' | 'all' | null

    const filterByMonth = !!(month && month !== "all");

    // ── Fetch all clusters via existing RPC ─────────────────────
    const rpcRes = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/get_clusters_with_tickets`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: "{}",
        cache: "no-store",
      }
    );

    if (!rpcRes.ok) {
      const text = await rpcRes.text();
      return NextResponse.json(
        { error: "Supabase error", detail: text },
        { status: rpcRes.status }
      );
    }

    type ExampleTicket = { id: string; created_at?: string };
    type RawCluster = Record<string, unknown> & {
      id: string;
      example_tickets?: ExampleTicket[];
    };
    const allClusters = (await rpcRes.json()) as RawCluster[];

    // Sort each cluster's example_tickets newest-first so freshly uploaded
    // tickets surface immediately on the cards (RPC orders by similarity_score
    // which gives seed data higher priority).
    for (const c of allClusters) {
      if (Array.isArray(c.example_tickets)) {
        c.example_tickets.sort((a, b) =>
          new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
        );
      }
    }

    // Fast path: no month filter — return stored cluster data as-is
    if (!filterByMonth) {
      return NextResponse.json(
        { clusters: allClusters, timestamp: new Date().toISOString() },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // ── Month filter: recalculate trends dynamically ─────────────
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    const currRange = getMonthRange(month!);
    const prevRange = getMonthRange(getPrevMonth(month!));

    async function fetchTicketIds(dateRange: { start: string; end: string }): Promise<string[]> {
      const { data, error } = await supabase
        .from("tickets")
        .select("id")
        .gte("created_at", dateRange.start)
        .lt("created_at", dateRange.end);
      if (error) {
        console.error("[/api/clusters] fetchTicketIds error:", error);
        return [];
      }
      return (data ?? []).map((t) => t.id);
    }

    async function countPerCluster(ticketIds: string[]): Promise<Record<string, number>> {
      if (ticketIds.length === 0) return {};
      const { data, error } = await supabase
        .from("cluster_members")
        .select("cluster_id")
        .in("ticket_id", ticketIds);
      if (error) {
        console.error("[/api/clusters] countPerCluster error:", error);
        return {};
      }
      const counts: Record<string, number> = {};
      for (const m of data ?? []) {
        counts[m.cluster_id] = (counts[m.cluster_id] || 0) + 1;
      }
      return counts;
    }

    const [currTicketIds, prevTicketIds] = await Promise.all([
      fetchTicketIds(currRange),
      fetchTicketIds(prevRange),
    ]);

    const [currCounts, prevCounts] = await Promise.all([
      countPerCluster(currTicketIds),
      countPerCluster(prevTicketIds),
    ]);

    const currTicketIdSet = new Set(currTicketIds);

    const result = allClusters
      .filter((c) => (currCounts[c.id] || 0) > 0)
      .map((c) => {
        const curr = currCounts[c.id] || 0;
        const prev = prevCounts[c.id] || 0;
        const filteredExamples = (c.example_tickets ?? []).filter((t) =>
          currTicketIdSet.has(t.id)
        );
        return {
          ...c,
          ticket_count:      curr,
          prev_window_count: prev,
          curr_window_count: curr,
          trend:             calcTrend(curr, prev),
          example_tickets:   filteredExamples,
        };
      });

    return NextResponse.json(
      { clusters: result, timestamp: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[/api/clusters]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
