/**
 * POST /api/upload-csv
 *
 * Accepts a multipart/form-data upload with a single "file" field
 * (must be a .csv). Saves it to a temp file, runs process_csv.py,
 * and returns the number of tickets inserted.
 *
 * Expected CSV columns (case-insensitive):
 *   subject, description, date (optional), priority (optional),
 *   ticket_type (optional), product_area (optional)
 */

import { NextResponse } from "next/server";
import { writeFile, unlink } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { join, resolve } from "path";
import { tmpdir } from "os";

// Allow up to 5 minutes — embedding large CSVs takes time
export const maxDuration = 300;

const execFileAsync = promisify(execFile);
const BACKEND_DIR = resolve(process.cwd(), "..", "backend");
const SCRIPT_PATH = join(BACKEND_DIR, "scripts", "process_csv.py");

function getPythonExec(): string {
  return process.platform === "win32" ? "py" : "python3";
}

export async function POST(request: Request) {
  let tempPath: string | null = null;

  try {
    // ── Parse multipart form ──────────────────────────────────
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "No file provided. Send a multipart/form-data request with a 'file' field." },
        { status: 400 }
      );
    }

    if (!file.name.toLowerCase().endsWith(".csv")) {
      return NextResponse.json(
        { error: "File must be a .csv file." },
        { status: 400 }
      );
    }

    // ── Write to temp file ───────────────────────────────────
    const bytes = await file.arrayBuffer();
    tempPath = join(tmpdir(), `kreo_csv_${Date.now()}.csv`);
    await writeFile(tempPath, Buffer.from(bytes));

    // ── Execute Python processing script ─────────────────────
    const python = getPythonExec();
    const { stdout, stderr } = await execFileAsync(
      python,
      [SCRIPT_PATH, "--file", tempPath],
      {
        cwd: BACKEND_DIR,
        timeout: 280_000,
        maxBuffer: 5 * 1024 * 1024,
      }
    );

    // Script prints "INSERTED:N" as its last output line
    const match = stdout.match(/INSERTED:(\d+)/);
    const inserted = match ? parseInt(match[1]) : 0;

    return NextResponse.json({ success: true, inserted, log: stdout.trim() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Processing failed";
    const stderr = (err as { stderr?: string }).stderr ?? "";

    // Return the last meaningful stderr line as the user-facing error
    const userError =
      stderr
        .split("\n")
        .filter((l) => l.trim() && !l.startsWith("WARNING") && !l.startsWith("Traceback"))
        .pop() ?? message;

    console.error("[/api/upload-csv]", message, "\nSTDERR:", stderr);
    return NextResponse.json({ error: userError }, { status: 500 });
  } finally {
    // Always clean up the temp file
    if (tempPath) {
      await unlink(tempPath).catch(() => {});
    }
  }
}
