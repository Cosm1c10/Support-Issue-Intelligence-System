/**
 * POST /api/sync-marketplaces
 *
 * Triggers the backend/scripts/sync_amazon.py script and returns
 * the number of tickets ingested. The UI uses this to show a live
 * "Scraping marketplace data..." loading state.
 */

import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { resolve, join } from "path";

const execFileAsync = promisify(execFile);

// Allow explicit override via env (e.g. for containerised / production deployments)
// Falls back to resolving relative to the Next.js project root in development.
const BACKEND_DIR = process.env.BACKEND_DIR ?? resolve(process.cwd(), "..", "backend");
const SCRIPT_PATH = join(BACKEND_DIR, "scripts", "sync_amazon.py");

function getPythonExec(): string {
  return process.platform === "win32" ? "py" : "python3";
}

export async function POST(request: Request) {
  // Protect this resource-consuming endpoint with an optional shared secret.
  // Set SYNC_SECRET in your environment to enable verification.
  const syncSecret = process.env.SYNC_SECRET;
  if (syncSecret) {
    const provided = request.headers.get("x-sync-secret");
    if (provided !== syncSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const python = getPythonExec();

    const { stdout, stderr } = await execFileAsync(
      python,
      [SCRIPT_PATH],
      {
        cwd: BACKEND_DIR,   // ensures .env is found relative to backend/
        timeout: 240_000,   // 4 min — Apify run can take time
        maxBuffer: 5 * 1024 * 1024,
      }
    );

    // Parse the ingested count from the script's stdout
    const match = stdout.match(/Done! (\d+) Amazon reviews ingested/);
    const ingested = match ? parseInt(match[1]) : 0;

    return NextResponse.json({
      success: true,
      ingested,
      log: stdout.trim(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const stderr = (err as { stderr?: string }).stderr ?? "";
    // Surface the last meaningful line from stderr for a clean error message
    const lastLine =
      stderr.split("\n").filter((l) => l.trim() && !l.startsWith("WARNING")).pop() ??
      message;

    console.error("[/api/sync-marketplaces]", message, stderr);
    return NextResponse.json(
      { error: lastLine },
      { status: 500 }
    );
  }
}
