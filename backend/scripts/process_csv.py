"""
process_csv.py
==============
Reads a CSV of historical support tickets, generates OpenAI embeddings,
assigns each ticket to the nearest existing cluster centroid, and upserts
the rows into the `tickets` table with source = 'support'.

Expected CSV columns (case-insensitive, extra columns are ignored):
  subject      — ticket title          (required if no description)
  description  — ticket body           (required if no subject)
  date         — ISO 8601 date string  (optional — defaults to NOW())
  priority     — Low/Medium/High/Critical (optional — defaults to Medium)
  ticket_type  — (optional)
  product_area — (optional)

Idempotent: ticket_id = "CSV-<md5(subject|description)>", upserted on conflict.

Usage:
  py scripts/process_csv.py --file /path/to/tickets.csv

Output (last line, parsed by the Next.js API route):
  INSERTED:N
"""

import os
import sys
import csv
import time
import json
import hashlib
import argparse
from datetime import datetime, timezone

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from dotenv import load_dotenv
from openai import OpenAI
from supabase import create_client, Client
import numpy as np

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

# ──────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
OPENAI_KEY   = os.environ["OPENAI_API_KEY"]

EMBEDDING_MODEL  = "text-embedding-3-small"
BATCH_SIZE       = 20
VALID_PRIORITIES = {"Low", "Medium", "High", "Critical"}

openai_client    = OpenAI(api_key=OPENAI_KEY)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


# ──────────────────────────────────────────────────────────────
# Argument parsing
# ──────────────────────────────────────────────────────────────
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Process a CSV of support tickets")
    parser.add_argument("--file", required=True, help="Absolute path to the CSV file")
    return parser.parse_args()


# ──────────────────────────────────────────────────────────────
# CSV reading & validation
# ──────────────────────────────────────────────────────────────
def read_csv(path: str) -> list[dict]:
    """
    Read CSV and normalise each row.
    Raises ValueError with a user-friendly message on schema errors.
    """
    if not os.path.isfile(path):
        raise ValueError(f"File not found: {path}")

    rows = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)

        if reader.fieldnames is None:
            raise ValueError("CSV file appears to be empty or has no header row.")

        norm_fields = [h.strip().lower() for h in reader.fieldnames]
        has_subject     = "subject"     in norm_fields
        has_description = "description" in norm_fields

        if not has_subject and not has_description:
            raise ValueError(
                "CSV must contain at least a 'subject' or 'description' column. "
                f"Columns found: {', '.join(norm_fields)}"
            )

        for line_num, raw_row in enumerate(reader, start=2):
            # Normalise all keys to lowercase + strip whitespace from values
            row = {k.strip().lower(): (v or "").strip() for k, v in raw_row.items()}

            subject     = row.get("subject", "")
            description = row.get("description", "")

            if not subject and not description:
                print(f"   Line {line_num}: skipped (subject and description both empty).",
                      file=sys.stderr)
                continue

            # Fill missing field from the other
            if not subject:
                subject = description[:80] + ("..." if len(description) > 80 else "")
            if not description:
                description = subject

            rows.append({
                "subject":      subject,
                "description":  description,
                "date":         row.get("date") or None,
                "priority":     row.get("priority", "Medium") or "Medium",
                "ticket_type":  row.get("ticket_type") or "Support Request",
                "product_area": row.get("product_area") or "General",
            })

    return rows


# ──────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────
def stable_ticket_id(subject: str, description: str) -> str:
    """Deterministic ID so re-running never duplicates tickets."""
    digest = hashlib.md5(f"{subject}|{description}".encode("utf-8")).hexdigest()[:16]
    return f"CSV-{digest}"


def validate_priority(p: str) -> str:
    return p if p in VALID_PRIORITIES else "Medium"


def embed_texts(texts: list[str]) -> list[list[float]]:
    embeddings = []
    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i : i + BATCH_SIZE]
        response = openai_client.embeddings.create(model=EMBEDDING_MODEL, input=batch)
        embeddings.extend([d.embedding for d in response.data])
        print(f"   Embedded {min(i + BATCH_SIZE, len(texts))}/{len(texts)}")
        if i + BATCH_SIZE < len(texts):
            time.sleep(0.3)
    return embeddings


def parse_embedding(value) -> list[float]:
    return json.loads(value) if isinstance(value, str) else value


def cosine_similarity(a: list[float], b: list[float]) -> float:
    va = np.array(a, dtype=np.float32)
    vb = np.array(b, dtype=np.float32)
    denom = float(np.linalg.norm(va) * np.linalg.norm(vb))
    return float(np.dot(va, vb) / denom) if denom > 0 else 0.0


# ──────────────────────────────────────────────────────────────
# Supabase operations
# ──────────────────────────────────────────────────────────────
def fetch_cluster_centroids() -> list[dict]:
    result = supabase.table("issue_clusters").select(
        "id, name, centroid_embedding"
    ).execute()
    return [c for c in (result.data or []) if c.get("centroid_embedding")]


def assign_to_cluster(
    embedding: list[float],
    clusters: list[dict],
) -> tuple[str | None, float]:
    """Return (cluster_id, score) for the nearest centroid."""
    best_id, best_score = None, -float("inf")
    for c in clusters:
        centroid = parse_embedding(c["centroid_embedding"])
        if len(centroid) != len(embedding):
            continue
        score = cosine_similarity(embedding, centroid)
        if score > best_score:
            best_score, best_id = score, c["id"]
    return best_id, best_score


def upsert_tickets(ticket_rows: list[dict]) -> dict[str, str]:
    """Upsert ticket_rows and return a map of ticket_id → db UUID."""
    id_map: dict[str, str] = {}
    for i in range(0, len(ticket_rows), BATCH_SIZE):
        batch = ticket_rows[i : i + BATCH_SIZE]
        result = supabase.table("tickets").upsert(
            batch, on_conflict="ticket_id"
        ).execute()
        for rec in result.data or []:
            id_map[rec["ticket_id"]] = rec["id"]
        print(f"   Upserted {min(i + BATCH_SIZE, len(ticket_rows))}/{len(ticket_rows)} tickets")
    return id_map


def upsert_cluster_members(member_rows: list[dict]) -> None:
    for i in range(0, len(member_rows), BATCH_SIZE):
        batch = member_rows[i : i + BATCH_SIZE]
        supabase.table("cluster_members").upsert(
            batch, on_conflict="ticket_id,cluster_id"
        ).execute()


# ──────────────────────────────────────────────────────────────
# Main pipeline
# ──────────────────────────────────────────────────────────────
def main() -> None:
    args = parse_args()

    print(f"[1/4] Reading CSV: {args.file}")
    rows = read_csv(args.file)
    if not rows:
        print("   No valid rows to process.")
        print("INSERTED:0")
        return
    print(f"   {len(rows)} valid rows found.")

    print(f"\n[2/4] Generating embeddings for {len(rows)} rows …")
    texts = [f"{r['subject']}. {r['description']}" for r in rows]
    embeddings = embed_texts(texts)

    print("\n[3/4] Fetching cluster centroids …")
    clusters = fetch_cluster_centroids()
    if not clusters:
        print("   Warning: no clusters in DB — tickets will be inserted without cluster assignment.",
              file=sys.stderr)

    # Build DB rows
    ticket_rows = []
    pair_list   = []   # [(ticket_row, embedding), ...]

    for row, emb in zip(rows, embeddings):
        tid = stable_ticket_id(row["subject"], row["description"])
        ticket = {
            "ticket_id":    tid,
            "subject":      row["subject"],
            "description":  row["description"],
            "priority":     validate_priority(row["priority"]),
            "ticket_type":  row["ticket_type"],
            "product_area": row["product_area"],
            "status":       "Open",
            "source":       "support",
            "embedding":    emb,
        }
        if row.get("date"):
            ticket["created_at"] = row["date"]

        ticket_rows.append(ticket)
        pair_list.append((tid, emb))

    print(f"\n[4/4] Upserting {len(ticket_rows)} tickets …")
    id_map = upsert_tickets(ticket_rows)
    inserted = len(id_map)

    # Assign to nearest cluster
    if clusters:
        member_rows = []
        for (tid, emb) in pair_list:
            db_id = id_map.get(tid)
            if not db_id:
                continue
            cluster_id, score = assign_to_cluster(emb, clusters)
            if cluster_id:
                member_rows.append({
                    "ticket_id":       db_id,
                    "cluster_id":      cluster_id,
                    "similarity_score": round(score, 6),
                })
        upsert_cluster_members(member_rows)
        print(f"   Assigned {len(member_rows)} tickets to clusters.")

    # This line is parsed by the Next.js upload-csv route — do not remove
    print(f"INSERTED:{inserted}")


if __name__ == "__main__":
    main()
