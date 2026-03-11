/**
 * POST /api/upload-csv
 *
 * Accepts a multipart/form-data upload with a single "file" field (.csv).
 * Parses the CSV in Node.js, embeds all tickets via OpenAI in batches,
 * assigns each to the nearest cluster by cosine similarity, and inserts
 * them into Supabase — no Python subprocess required (works on Vercel).
 *
 * Expected CSV columns (case-insensitive, extras ignored):
 *   subject*, description, date, priority, ticket_type, product_area
 *   (* required)
 */

import { NextResponse } from "next/server";

export const maxDuration = 300;

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const EMBED_BATCH = 100; // OpenAI allows up to 2048 inputs per request

// ── Supabase fetch helper ──────────────────────────────────────
async function supabaseFetch(path: string, options: RequestInit = {}) {
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

// ── Cosine similarity ─────────────────────────────────────────
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

function parseEmbedding(v: number[] | string | null): number[] | null {
  if (!v) return null;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } }
  return v;
}

// ── Simple CSV parser (handles quoted fields, CRLF/LF) ────────
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return [];

  const splitRow = (line: string): string[] => {
    const fields: string[] = [];
    let cur = "", inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuote = !inQuote; }
      } else if (ch === ',' && !inQuote) {
        fields.push(cur.trim()); cur = "";
      } else {
        cur += ch;
      }
    }
    fields.push(cur.trim());
    return fields;
  };

  // Normalise column names to canonical field names
  const ALIASES: Record<string, string> = {
    "ticket subject": "subject",
    "ticket description": "description",
    "date of purchase": "date",
    "ticket priority": "priority",
    "ticket type": "ticket_type",
    "product purchased": "product_area",
    "product area": "product_area",
  };
  const rawHeaders = splitRow(lines[0]).map((h) => h.toLowerCase().replace(/^"|"$/g, ""));
  const headers = rawHeaders.map((h) => ALIASES[h] ?? h);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = splitRow(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = (vals[idx] ?? "").replace(/^"|"$/g, ""); });
    rows.push(row);
  }
  return rows;
}

// ── Embed a batch of strings via OpenAI ───────────────────────
async function embedBatch(inputs: string[]): Promise<number[][]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: inputs }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`OpenAI ${res.status}: ${detail}`);
  }
  const data = await res.json();
  // data.data is sorted by index
  return (data.data as { index: number; embedding: number[] }[])
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

// ── Main handler ───────────────────────────────────────────────
export async function POST(request: Request) {
  // Parse multipart form
  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "No file provided. Send a multipart/form-data request with a 'file' field." },
      { status: 400 }
    );
  }
  if (!file.name.toLowerCase().endsWith(".csv")) {
    return NextResponse.json({ error: "File must be a .csv file." }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large (max 10 MB, got ${(file.size / 1024 / 1024).toFixed(1)} MB).` },
      { status: 413 }
    );
  }

  // Parse CSV
  const text = await file.text();
  const rows = parseCSV(text);
  const validRows = rows.filter((r) => r.subject?.trim());

  if (validRows.length === 0) {
    return NextResponse.json(
      { error: "No valid rows found. CSV must have a 'subject' column with at least one non-empty value." },
      { status: 400 }
    );
  }

  // Embed all tickets in batches
  const inputs = validRows.map((r) =>
    `${r.subject.trim()}. ${(r.description ?? "").trim()}`.trim()
  );
  const embeddings: number[][] = [];
  try {
    for (let i = 0; i < inputs.length; i += EMBED_BATCH) {
      const batch = await embedBatch(inputs.slice(i, i + EMBED_BATCH));
      embeddings.push(...batch);
    }
  } catch (err) {
    return NextResponse.json(
      { error: "Embedding failed", detail: String(err) },
      { status: 502 }
    );
  }

  // Fetch all cluster centroids once
  const clustersRes = await supabaseFetch(
    "issue_clusters?select=id,name,ticket_count,curr_window_count,centroid_embedding"
  );
  if (!clustersRes.ok) {
    return NextResponse.json(
      { error: "Failed to fetch clusters", detail: await clustersRes.text() },
      { status: 502 }
    );
  }
  const clusters: {
    id: string; name: string;
    ticket_count: number; curr_window_count: number;
    centroid_embedding: number[] | string | null;
  }[] = await clustersRes.json();

  // Assign each ticket to its nearest cluster
  const assignments = embeddings.map((emb) => {
    let bestId: string | null = null, bestName: string | null = null, bestScore = -Infinity;
    for (const c of clusters) {
      const centroid = parseEmbedding(c.centroid_embedding);
      if (!centroid) continue;
      const score = cosineSimilarity(emb, centroid);
      if (score > bestScore) { bestScore = score; bestId = c.id; bestName = c.name; }
    }
    return { clusterId: bestId, clusterName: bestName, score: isFinite(bestScore) ? bestScore : null };
  });

  // Insert tickets and cluster_members sequentially (avoids duplicate ticket_id races)
  let inserted = 0;
  const clusterDelta = new Map<string, number>(); // clusterId → count added

  for (let i = 0; i < validRows.length; i++) {
    const row = validRows[i];
    const { clusterId, clusterName, score } = assignments[i];
    const ticketId = `CSV-${Date.now()}-${i}`;

    const ticketRes = await supabaseFetch("tickets", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        ticket_id:    ticketId,
        subject:      row.subject.trim(),
        description:  (row.description ?? row.subject).trim(),
        priority:     row.priority     || "Medium",
        ticket_type:  row.ticket_type  || "Support Request",
        product_area: row.product_area || clusterName || "General",
        status:       "Open",
        source:       "csv",
        created_at:   row.date ? new Date(row.date).toISOString() : new Date().toISOString(),
        embedding:    embeddings[i],
      }),
    });

    if (!ticketRes.ok) continue; // skip bad rows, keep going
    const [ticket] = await ticketRes.json();
    inserted++;

    if (clusterId && ticket?.id) {
      await supabaseFetch("cluster_members", {
        method: "POST",
        body: JSON.stringify({
          ticket_id:        ticket.id,
          cluster_id:       clusterId,
          similarity_score: score !== null ? parseFloat(score.toFixed(6)) : null,
        }),
      });
      clusterDelta.set(clusterId, (clusterDelta.get(clusterId) ?? 0) + 1);
    }
  }

  // Batch-update cluster counts (one PATCH per affected cluster)
  const clusterMap = new Map(clusters.map((c) => [c.id, c]));
  await Promise.all(
    Array.from(clusterDelta.entries()).map(async ([cid, delta]) => {
      const c = clusterMap.get(cid);
      if (!c) return;
      await supabaseFetch(`issue_clusters?id=eq.${cid}`, {
        method: "PATCH",
        body: JSON.stringify({
          ticket_count:      (c.ticket_count ?? 0) + delta,
          curr_window_count: (c.curr_window_count ?? 0) + delta,
          updated_at:        new Date().toISOString(),
        }),
      });
    })
  );

  return NextResponse.json({ success: true, inserted, total: validRows.length });
}
