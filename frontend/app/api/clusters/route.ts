import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get("source"); // 'support' | 'marketplace' | null

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
        next: { revalidate: 30 },
      }
    );

    if (!rpcRes.ok) {
      const text = await rpcRes.text();
      return NextResponse.json(
        { error: "Supabase error", detail: text },
        { status: rpcRes.status }
      );
    }

    const allClusters = await rpcRes.json();

    // ── No source filter → return everything ────────────────────
    if (!source || source === "all") {
      return NextResponse.json(
        { clusters: allClusters, timestamp: new Date().toISOString() },
        { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } }
      );
    }

    // ── Filter clusters by source of their member tickets ───────
    // Uses @supabase/supabase-js which handles large IN lists via POST body
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Get ticket IDs matching the requested source
    let ticketQuery = supabase.from("tickets").select("id");
    if (source === "marketplace") {
      ticketQuery = ticketQuery.eq("source", "amazon");
    } else {
      // support: source is null (pre-migration rows), manual, webhook, csv, or 'support'
      ticketQuery = ticketQuery.or(
        "source.is.null,source.eq.manual,source.eq.webhook,source.eq.support,source.eq.csv"
      );
    }

    const { data: tickets, error: ticketErr } = await ticketQuery;
    if (ticketErr) {
      console.error("[/api/clusters] ticket query error:", ticketErr);
      return NextResponse.json(
        { error: "Failed to filter by source" },
        { status: 502 }
      );
    }

    const ticketIds = (tickets ?? []).map((t) => t.id);

    if (ticketIds.length === 0) {
      return NextResponse.json(
        { clusters: [], timestamp: new Date().toISOString() },
        { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } }
      );
    }

    // Get the cluster IDs those tickets belong to
    const { data: members, error: memberErr } = await supabase
      .from("cluster_members")
      .select("cluster_id")
      .in("ticket_id", ticketIds);

    if (memberErr) {
      console.error("[/api/clusters] member query error:", memberErr);
      return NextResponse.json(
        { error: "Failed to fetch cluster memberships" },
        { status: 502 }
      );
    }

    const clusterIdSet = new Set((members ?? []).map((m) => m.cluster_id));

    const filtered = (allClusters as { id: string }[]).filter((c) =>
      clusterIdSet.has(c.id)
    );

    return NextResponse.json(
      { clusters: filtered, timestamp: new Date().toISOString() },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } }
    );
  } catch (err) {
    console.error("[/api/clusters]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
