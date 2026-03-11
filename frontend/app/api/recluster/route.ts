/**
 * POST /api/recluster
 *
 * Triggers a full K-Means re-clustering of all tickets.
 * Runs `python scripts/add_tickets.py` (which re-clusters without adding
 * new tickets when called with no args, or use a dedicated recluster script).
 *
 * Logs the job run to the `job_runs` table so the UI can track progress.
 *
 * Optional header:  x-sync-secret: <SYNC_SECRET env var>
 *
 * Response:
 *   { success: true, job_id, log }
 *   { success: false, error, log }
 */

import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { timingSafeEqual } from "crypto";
import path from "path";

const execFileAsync = promisify(execFile);

function getPythonExec(): string {
  return process.platform === "win32" ? "py" : "python3";
}

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const BACKEND_DIR =
  process.env.BACKEND_DIR ?? path.join(process.cwd(), "..", "backend");

function safeCompare(a: string, b: string): boolean {
  if (Buffer.byteLength(a) !== Buffer.byteLength(b)) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

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

async function createJobRun(jobType: string): Promise<string | null> {
  try {
    const res = await supabaseFetch("job_runs", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ job_type: jobType, status: "running" }),
    });
    if (!res.ok) return null;
    const [row] = await res.json();
    return row?.id ?? null;
  } catch {
    return null;
  }
}

async function updateJobRun(
  jobId: string,
  status: "success" | "failed",
  ticketsProcessed = 0,
  errorMessage?: string
) {
  try {
    await supabaseFetch(`job_runs?id=eq.${jobId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status,
        tickets_processed: ticketsProcessed,
        error_message: errorMessage ?? null,
        finished_at: new Date().toISOString(),
      }),
    });
  } catch {
    // Non-fatal; best-effort logging
  }
}

export async function POST(request: Request) {
  // Optional shared secret guard
  const syncSecret = process.env.SYNC_SECRET;
  if (syncSecret) {
    const provided = request.headers.get("x-sync-secret");
    if (!provided || !safeCompare(provided, syncSecret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const jobId = await createJobRun("recluster");

  try {
    const scriptPath = path.join(BACKEND_DIR, "scripts", "add_tickets.py");
    const python = getPythonExec();
    const { stdout: log } = await execFileAsync(python, [scriptPath], {
      cwd: BACKEND_DIR,
      timeout: 5 * 60 * 1000, // 5 min hard limit
      maxBuffer: 5 * 1024 * 1024,
    });

    // Parse ticket count from script stdout
    const match = log.match(/(\d+)\s+tickets?\s+(?:re-?clustered|processed)/i);
    const ticketsProcessed = match ? parseInt(match[1], 10) : 0;

    if (jobId) await updateJobRun(jobId, "success", ticketsProcessed);

    return NextResponse.json({
      success: true,
      job_id: jobId,
      tickets_processed: ticketsProcessed,
      log,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/recluster]", message);

    if (jobId) await updateJobRun(jobId, "failed", 0, message);

    return NextResponse.json(
      { success: false, error: message, job_id: jobId },
      { status: 500 }
    );
  }
}
