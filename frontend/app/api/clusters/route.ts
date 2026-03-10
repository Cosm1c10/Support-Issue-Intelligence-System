import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;

export async function GET() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/get_clusters_with_tickets`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: "{}",
        // Revalidate every 30 s so server-side cache stays fresh
        next: { revalidate: 30 },
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: "Supabase error", detail: text },
        { status: res.status }
      );
    }

    const clusters = await res.json();
    return NextResponse.json(
      { clusters, timestamp: new Date().toISOString() },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      }
    );
  } catch (err) {
    console.error("[/api/clusters]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
