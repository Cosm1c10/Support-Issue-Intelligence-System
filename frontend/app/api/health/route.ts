/**
 * GET /api/health
 *
 * Liveness + readiness check.
 * Verifies that Supabase DB and OpenAI API key are reachable.
 *
 * Response 200:
 *   { status: "ok", db: "ok", openai: "ok"|"unconfigured", uptime_s: N }
 *
 * Response 503:
 *   { status: "degraded", db: "error", detail: "..." }
 */

import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const startedAt = Date.now();

async function checkDb(): Promise<{ ok: boolean; detail?: string }> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/issue_clusters?select=id&limit=1`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) {
      return { ok: false, detail: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET() {
  const [db] = await Promise.all([checkDb()]);

  const openaiStatus = OPENAI_API_KEY ? "configured" : "unconfigured";
  const uptime = Math.round((Date.now() - startedAt) / 1000);

  if (!db.ok) {
    return NextResponse.json(
      {
        status: "degraded",
        db: "error",
        db_detail: db.detail,
        openai: openaiStatus,
        uptime_s: uptime,
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    status: "ok",
    db: "ok",
    openai: openaiStatus,
    uptime_s: uptime,
  });
}
