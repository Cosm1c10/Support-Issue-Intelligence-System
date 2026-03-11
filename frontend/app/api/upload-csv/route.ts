/**
 * POST /api/upload-csv
 *
 * Accepts a multipart/form-data upload with a single "file" field (.csv).
 * Parses the CSV in Node.js, embeds all tickets via OpenAI, upserts them
 * into Supabase, then re-clusters ALL tickets using K-Means — matching the
 * behaviour of the Python `process_csv.py` script.  Works on Vercel (no
 * Python subprocess required).
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
const EMBED_BATCH = 100;
const CLUSTER_MIN = 7;
const CLUSTER_MAX = 20;
const TICKETS_PER_CLUSTER = 12;

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

// ── Math helpers ───────────────────────────────────────────────
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

function parseEmbedding(v: number[] | string | null): number[] | null {
  if (!v) return null;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } }
  return v;
}

function calcTrend(curr: number, prev: number): "Increasing" | "Decreasing" | "Stable" {
  if (prev === 0) return curr > 0 ? "Increasing" : "Stable";
  if (curr > prev * 1.25) return "Increasing";
  if (curr < prev * 0.75) return "Decreasing";
  return "Stable";
}

// ── K-Means (cosine distance, k-means++ init) ─────────────────
function kMeansCluster(
  embeddings: number[][],
  k: number,
  maxIter = 20,
): { labels: number[]; centroids: number[][] } {
  const n = embeddings.length;
  const dim = embeddings[0].length;

  // K-Means++ initialisation
  const centroids: number[][] = [[...embeddings[Math.floor(Math.random() * n)]]];
  while (centroids.length < k) {
    const dists = embeddings.map(emb => {
      let minD = Infinity;
      for (const c of centroids) { const d = 1 - cosineSimilarity(emb, c); if (d < minD) minD = d; }
      return minD * minD;
    });
    const total = dists.reduce((s, d) => s + d, 0);
    let r = Math.random() * total, chosen = 0;
    for (let i = 0; i < n; i++) { r -= dists[i]; if (r <= 0) { chosen = i; break; } }
    centroids.push([...embeddings[chosen]]);
  }

  let labels = new Array<number>(n).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    const next = embeddings.map(emb => {
      let best = 0, bestS = -Infinity;
      for (let c = 0; c < k; c++) { const s = cosineSimilarity(emb, centroids[c]); if (s > bestS) { bestS = s; best = c; } }
      return best;
    });
    const converged = next.every((l, i) => l === labels[i]);
    labels = next;
    if (converged) break;
    for (let c = 0; c < k; c++) {
      const members = embeddings.filter((_, i) => labels[i] === c);
      if (!members.length) continue;
      const nc = new Array<number>(dim).fill(0);
      for (const emb of members) for (let j = 0; j < dim; j++) nc[j] += emb[j];
      for (let j = 0; j < dim; j++) nc[j] /= members.length;
      centroids[c] = nc;
    }
  }
  return { labels, centroids };
}

// ── Name a cluster with GPT-4o-mini ───────────────────────────
async function nameCluster(subjects: string[]): Promise<{ name: string; description: string }> {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{
          role: "user",
          content:
            "You are an expert at categorizing customer support tickets.\n" +
            "Given the following support ticket subjects from a single issue cluster, provide:\n" +
            "1. A short, clear issue name (3-5 words, title case, no punctuation)\n" +
            "2. A one-sentence description of the underlying problem\n\n" +
            `Ticket subjects:\n${subjects.slice(0, 6).map(s => `- ${s}`).join("\n")}\n\n` +
            "Respond in JSON with keys 'name' and 'description' only.",
        }],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { name: "General Issues", description: "Miscellaneous support tickets." };
    const data = await res.json();
    const parsed = JSON.parse(data.choices[0].message.content);
    return { name: parsed.name ?? "General Issues", description: parsed.description ?? "" };
  } catch {
    return { name: "General Issues", description: "Miscellaneous support tickets." };
  }
}

// ── Full re-cluster (mirrors recluster_all_tickets in process_csv.py) ──
async function reclusterAll(): Promise<void> {
  // Fetch all tickets with embeddings (paginated)
  type DBTicket = { id: string; subject: string; created_at: string; embedding: number[] | string | null };
  const allTickets: DBTicket[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const res = await supabaseFetch(
      `tickets?select=id,subject,created_at,embedding&limit=${PAGE}&offset=${offset}`
    );
    if (!res.ok) break;
    const page: DBTicket[] = await res.json();
    allTickets.push(...page);
    if (page.length < PAGE) break;
  }

  type ValidTicket = { id: string; subject: string; created_at: string; embedding: number[] };
  const valid: ValidTicket[] = allTickets
    .map(t => ({ ...t, embedding: parseEmbedding(t.embedding) }))
    .filter((t): t is ValidTicket => t.embedding !== null && t.embedding.length > 0);

  if (valid.length < CLUSTER_MIN) return; // not enough data to cluster

  const k = Math.max(CLUSTER_MIN, Math.min(CLUSTER_MAX, Math.floor(valid.length / TICKETS_PER_CLUSTER)));
  const { labels, centroids } = kMeansCluster(valid.map(t => t.embedding), k);

  // Group tickets by cluster index
  const groups = new Map<number, ValidTicket[]>();
  for (let i = 0; i < k; i++) groups.set(i, []);
  valid.forEach((t, i) => groups.get(labels[i])!.push(t));

  // Wipe old clusters + memberships (same pattern as the Python script)
  await supabaseFetch(
    "cluster_members?ticket_id=neq.00000000-0000-0000-0000-000000000000",
    { method: "DELETE" }
  );
  await supabaseFetch(
    "issue_clusters?id=neq.00000000-0000-0000-0000-000000000000",
    { method: "DELETE" }
  );

  const now = Date.now();
  const MS_30 = 30 * 24 * 60 * 60 * 1000;

  for (let c = 0; c < k; c++) {
    const members = groups.get(c) ?? [];
    if (!members.length) continue;

    const { name, description } = await nameCluster(members.map(t => t.subject));

    const curr = members.filter(t => { const ts = new Date(t.created_at).getTime(); return ts >= now - MS_30 && ts <= now; }).length;
    const prev = members.filter(t => { const ts = new Date(t.created_at).getTime(); return ts >= now - 2 * MS_30 && ts < now - MS_30; }).length;

    const clusterRes = await supabaseFetch("issue_clusters", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        name,
        description,
        ticket_count:       members.length,
        prev_window_count:  prev,
        curr_window_count:  curr,
        trend:              calcTrend(curr, prev),
        centroid_embedding: centroids[c],
        updated_at:         new Date(now).toISOString(),
      }),
    });
    if (!clusterRes.ok) continue;
    const [cluster] = await clusterRes.json();
    if (!cluster?.id) continue;

    // Batch-insert members (50 per request)
    for (let i = 0; i < members.length; i += 50) {
      await supabaseFetch("cluster_members", {
        method: "POST",
        body: JSON.stringify(
          members.slice(i, i + 50).map(t => ({
            ticket_id:        t.id,
            cluster_id:       cluster.id,
            similarity_score: 1.0,
          }))
        ),
      });
    }
  }
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

  const ALIASES: Record<string, string> = {
    "ticket subject": "subject",
    "ticket description": "description",
    "date of purchase": "date",
    "ticket priority": "priority",
    "ticket type": "ticket_type",
    "product purchased": "product_area",
    "product area": "product_area",
  };
  const rawHeaders = splitRow(lines[0]).map(h => h.toLowerCase().replace(/^[\s"]+|[\s"]+$/g, "").trim());
  const headers = rawHeaders.map(h => ALIASES[h] ?? h);
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
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: inputs }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.data as { index: number; embedding: number[] }[])
    .sort((a, b) => a.index - b.index)
    .map(d => d.embedding);
}

// ── Main handler ───────────────────────────────────────────────
export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File))
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".csv"))
    return NextResponse.json({ error: "File must be a .csv file." }, { status: 400 });
  if (file.size > MAX_FILE_SIZE)
    return NextResponse.json(
      { error: `File too large (max 10 MB, got ${(file.size / 1024 / 1024).toFixed(1)} MB).` },
      { status: 413 }
    );

  const rawText = await file.text();
  const rows = parseCSV(rawText.replace(/^\uFEFF/, ""));
  const validRows = rows.filter(r => r.subject?.trim());

  if (validRows.length === 0) {
    const sampleHeaders = rows.length > 0 ? Object.keys(rows[0]).join(", ") : "(no rows)";
    return NextResponse.json(
      { error: "No valid rows found. The CSV must have a 'subject' column (or 'Ticket Subject').", detected_columns: sampleHeaders },
      { status: 400 }
    );
  }

  // Embed all tickets
  const inputs = validRows.map(r => `${r.subject.trim()}. ${(r.description ?? "").trim()}`.trim());
  const embeddings: number[][] = [];
  try {
    for (let i = 0; i < inputs.length; i += EMBED_BATCH)
      embeddings.push(...await embedBatch(inputs.slice(i, i + EMBED_BATCH)));
  } catch (err) {
    return NextResponse.json({ error: "Embedding failed", detail: String(err) }, { status: 502 });
  }

  // Insert tickets (return=minimal — we don't need the row back; reclusterAll re-fetches all)
  let inserted = 0;
  for (let i = 0; i < validRows.length; i++) {
    const row = validRows[i];
    const ticketId = `CSV-${Date.now()}-${i}`;
    const res = await supabaseFetch("tickets", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        ticket_id:    ticketId,
        subject:      row.subject.trim(),
        description:  (row.description ?? row.subject).trim(),
        priority:     row.priority     || "Medium",
        ticket_type:  row.ticket_type  || "Support Request",
        product_area: row.product_area || "General",
        status:       "Open",
        created_at:   row.date ? new Date(row.date).toISOString() : new Date().toISOString(),
        embedding:    embeddings[i],
      }),
    });
    if (res.ok) inserted++;
  }

  if (inserted === 0)
    return NextResponse.json(
      { error: "No tickets could be inserted. Check Supabase permissions and table schema." },
      { status: 502 }
    );

  // Re-cluster ALL tickets in the DB (K-Means in JS — mirrors recluster_all_tickets in process_csv.py)
  await reclusterAll();

  return NextResponse.json({ success: true, inserted, total: validRows.length });
}
