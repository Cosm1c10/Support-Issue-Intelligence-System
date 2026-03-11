/**
 * GET /api/similar-tickets?text=<query>&threshold=0.6&limit=10
 *
 * Semantic search over all tickets using cosine similarity via pgvector.
 * 1. Embeds the query text with OpenAI text-embedding-3-small
 * 2. Calls the Supabase RPC `find_similar_tickets`
 * 3. Returns matched tickets sorted by similarity descending
 *
 * Query params:
 *   text       — (required) free-text search query
 *   threshold  — cosine similarity cut-off, default 0.60
 *   limit      — max results, default 10, max 50
 *
 * Response:
 *   { tickets: SimilarTicket[], query: string, count: number }
 */

import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

interface SimilarTicket {
  id: string;
  ticket_id: string;
  subject: string;
  description: string;
  priority: string;
  ticket_type: string;
  product_area: string;
  created_at: string;
  similarity: number;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const text = searchParams.get("text")?.trim();
  const threshold = Math.min(
    Math.max(parseFloat(searchParams.get("threshold") ?? "0.6"), 0),
    1
  );
  const limit = Math.min(
    parseInt(searchParams.get("limit") ?? "10", 10),
    50
  );

  if (!text) {
    return NextResponse.json(
      { error: "`text` query parameter is required" },
      { status: 400 }
    );
  }

  if (!OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured" },
      { status: 503 }
    );
  }

  // ── 1. Embed the query ────────────────────────────────────────
  let embedding: number[];
  try {
    const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!embedRes.ok) {
      const detail = await embedRes.text();
      console.error("[/api/similar-tickets] OpenAI error:", detail);
      return NextResponse.json(
        { error: "Embedding failed", detail },
        { status: 502 }
      );
    }

    const embedData = await embedRes.json();
    embedding = embedData?.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      return NextResponse.json(
        { error: "Unexpected embedding response shape" },
        { status: 502 }
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // ── 2. Vector search via Supabase RPC ────────────────────────
  try {
    const rpcRes = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/find_similar_tickets`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({
          query_embedding: embedding,
          match_threshold: threshold,
          match_count: limit,
        }),
      }
    );

    if (!rpcRes.ok) {
      const detail = await rpcRes.text();
      console.error("[/api/similar-tickets] Supabase RPC error:", detail);
      return NextResponse.json(
        { error: "Vector search failed", detail },
        { status: 502 }
      );
    }

    const tickets: SimilarTicket[] = await rpcRes.json();

    return NextResponse.json({
      tickets,
      query: text,
      count: tickets.length,
    });
  } catch (err) {
    console.error("[/api/similar-tickets]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
