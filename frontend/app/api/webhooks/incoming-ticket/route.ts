/**
 * POST /api/webhooks/incoming-ticket
 *
 * Accepts a JSON payload mimicking a Gorgias / Zendesk webhook.
 * On receipt it:
 *   1. Embeds the ticket with OpenAI text-embedding-3-small
 *   2. Fetches all cluster centroids from Supabase
 *   3. Assigns the ticket to the nearest cluster (cosine similarity)
 *   4. Inserts the ticket row into `tickets`
 *   5. Inserts a row into `cluster_members`
 *   6. Increments the cluster's ticket_count + curr_window_count
 *
 * The Supabase Realtime subscription on `issue_clusters` in the
 * dashboard will pick up the ticket_count update automatically,
 * so the UI refreshes without polling.
 *
 * Example payload:
 *   {
 *     "id": "GRG-10042",
 *     "subject": "Broken scroll wheel after 2 weeks",
 *     "description": "The scroll wheel on my Swarm65 stopped clicking...",
 *     "customer_email": "alice@example.com",
 *     "priority": "High",          // optional
 *     "ticket_type": "Bug Report", // optional
 *     "product_area": "Hardware"   // optional
 *   }
 */

import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

function safeCompare(a: string, b: string): boolean {
  if (Buffer.byteLength(a) !== Buffer.byteLength(b)) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

interface WebhookPayload {
  id: string;
  subject: string;
  description?: string;
  customer_email?: string;
  priority?: string;
  ticket_type?: string;
  product_area?: string;
}

interface ClusterRow {
  id: string;
  name: string;
  ticket_count: number;
  curr_window_count: number;
  centroid_embedding: number[] | string | null;
}

// ── Cosine similarity between two equal-length vectors ────────
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// Supabase returns pgvector columns as a JSON string on some clients
function parseEmbedding(value: number[] | string | null): number[] | null {
  if (!value) return null;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

// ── Shared Supabase fetch helper ───────────────────────────────
async function supabaseFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      ...(options.headers ?? {}),
    },
  });
}

// ── Main handler ───────────────────────────────────────────────
export async function POST(request: Request) {
  // Verify optional shared secret to prevent unauthorized calls.
  // Set WEBHOOK_SECRET in your environment to enable this check.
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (webhookSecret) {
    const provided = request.headers.get("x-webhook-secret");
    if (!provided || !safeCompare(provided, webhookSecret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Parse body
  let body: WebhookPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    id,
    subject,
    description = "",
    priority,
    ticket_type,
    product_area,
  } = body;

  if (!id || !subject) {
    return NextResponse.json(
      { error: "`id` and `subject` are required" },
      { status: 400 }
    );
  }

  // ── 1. Embed the incoming ticket ─────────────────────────────
  const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: `${subject}. ${description}`.trim(),
    }),
  });

  if (!embedRes.ok) {
    const detail = await embedRes.text();
    console.error("[webhook] OpenAI embedding error:", detail);
    return NextResponse.json(
      { error: "Embedding failed", detail },
      { status: 502 }
    );
  }

  const embedData = await embedRes.json();
  const embedding: number[] | undefined = embedData?.data?.[0]?.embedding;
  if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
    console.error("[webhook] Unexpected embedding response shape:", embedData);
    return NextResponse.json({ error: "Unexpected embedding response" }, { status: 502 });
  }

  // ── 2. Fetch all cluster centroids ───────────────────────────
  const clustersRes = await supabaseFetch(
    "issue_clusters?select=id,name,ticket_count,curr_window_count,centroid_embedding"
  );

  if (!clustersRes.ok) {
    const detail = await clustersRes.text();
    console.error("[webhook] Supabase clusters fetch error:", detail);
    return NextResponse.json(
      { error: "Failed to fetch clusters", detail },
      { status: 502 }
    );
  }

  const clusters: ClusterRow[] = await clustersRes.json();

  // ── 3. Find the closest cluster by cosine similarity ─────────
  let bestClusterId: string | null = null;
  let bestClusterName: string | null = null;
  let bestCluster: ClusterRow | null = null;
  let bestScore = -Infinity;

  for (const cluster of clusters) {
    const centroid = parseEmbedding(cluster.centroid_embedding);
    if (!centroid) continue;
    const score = cosineSimilarity(embedding, centroid);
    if (score > bestScore) {
      bestScore = score;
      bestClusterId = cluster.id;
      bestClusterName = cluster.name;
      bestCluster = cluster;
    }
  }

  // ── 4. Insert ticket ─────────────────────────────────────────
  const ticketId = `WH-${id}`;

  const ticketRes = await supabaseFetch("tickets", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      ticket_id:    ticketId,
      subject,
      description:  description || subject,
      priority:     priority    ?? "Medium",
      ticket_type:  ticket_type ?? "Support Request",
      product_area: product_area ?? (bestClusterName ?? "General"),
      status:       "Open",
      source:       "webhook",
      created_at:   new Date().toISOString(),
      embedding,
    }),
  });

  if (!ticketRes.ok) {
    const detail = await ticketRes.text();
    console.error("[webhook] Supabase ticket insert error:", detail);
    return NextResponse.json(
      { error: "Ticket insert failed", detail },
      { status: 502 }
    );
  }

  const [ticket] = await ticketRes.json();

  // ── 5. Link ticket to best cluster ───────────────────────────
  if (bestClusterId && ticket?.id) {
    // cluster_members row
    const memberRes = await supabaseFetch("cluster_members", {
      method: "POST",
      body: JSON.stringify({
        ticket_id:        ticket.id,
        cluster_id:       bestClusterId,
        similarity_score: isFinite(bestScore) ? parseFloat(bestScore.toFixed(6)) : null,
      }),
    });
    if (!memberRes.ok) {
      const detail = await memberRes.text();
      // Non-fatal: ticket is already saved — log and continue
      console.error("[webhook] cluster_members insert error:", detail);
    }

    // ── 6. Increment ticket_count + curr_window_count
    // Re-fetch the current row immediately before patching to minimise the
    // race window under concurrent webhooks. For high-throughput scenarios,
    // replace with an atomic DB increment function (e.g. a Supabase RPC).
    if (bestCluster) {
      const freshRes = await supabaseFetch(
        `issue_clusters?id=eq.${bestClusterId}&select=ticket_count,curr_window_count`
      );
      const freshCounts = freshRes.ok
        ? ((await freshRes.json()) as { ticket_count: number; curr_window_count: number }[])[0]
        : null;
      const base = freshCounts ?? bestCluster;
      await supabaseFetch(`issue_clusters?id=eq.${bestClusterId}`, {
        method: "PATCH",
        body: JSON.stringify({
          ticket_count:      (base.ticket_count ?? 0) + 1,
          curr_window_count: (base.curr_window_count ?? 0) + 1,
          updated_at:        new Date().toISOString(),
        }),
      });
    }
  }

  return NextResponse.json({
    success:            true,
    ticket_id:          ticketId,
    db_id:              ticket?.id ?? null,
    assigned_cluster:   bestClusterName,
    assigned_cluster_id: bestClusterId,
    // bestScore stays -Infinity when no cluster had a valid centroid; use null instead
    similarity_score:   isFinite(bestScore) ? parseFloat(bestScore.toFixed(6)) : null,
  });
}
