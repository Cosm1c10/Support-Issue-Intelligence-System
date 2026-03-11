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
import { randomUUID } from "crypto";
import { join, resolve } from "path";
import { tmpdir } from "os";

// Allow up to 5 minutes — embedding large CSVs takes time
export const maxDuration = 300;

const execFileAsync = promisify(execFile);
// Allow explicit override via env (e.g. for containerised / production deployments)
const BACKEND_DIR = process.env.BACKEND_DIR ?? resolve(process.cwd(), "..", "backend");
const SCRIPT_PATH = join(BACKEND_DIR, "scripts", "process_csv.py");

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

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

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large (max 10 MB, got ${(file.size / 1024 / 1024).toFixed(1)} MB).` },
        { status: 413 }
      );
    }

    // ── Read optional month field ─────────────────────────────
    const monthField = formData.get("month");
    const month = typeof monthField === "string" && /^\d{4}-\d{2}$/.test(monthField)
      ? monthField
      : null;

    // ── Write to temp file ───────────────────────────────────
    // Use a UUID suffix to avoid collisions under concurrent requests
    const bytes = await file.arrayBuffer();
    tempPath = join(tmpdir(), `kreo_csv_${randomUUID()}.csv`);
    await writeFile(tempPath, Buffer.from(bytes));

    // ── Execute Python processing script ─────────────────────
    const python = getPythonExec();
    const scriptArgs = ["--file", tempPath];
    if (month) scriptArgs.push("--month", month);

    const { stdout } = await execFileAsync(
      python,
      [SCRIPT_PATH, ...scriptArgs],
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
    const stdout = (err as { stdout?: string }).stdout ?? "";

    console.error("[/api/upload-csv]", message, "\nSTDOUT:", stdout, "\nSTDERR:", stderr);

    // Surface the last meaningful lines so the UI can display a useful message.
    const detail = (stderr || stdout || message)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-8)
      .join("\n");

    return NextResponse.json(
      { error: "CSV processing failed. Please check your file format and try again.", detail },
      { status: 500 }
    );
  } finally {
    // Always clean up the temp file
    if (tempPath) {
      await unlink(tempPath).catch(() => {});
    }
  }
}
