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
import json
import hashlib
import argparse
from datetime import datetime, timezone, timedelta

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from dotenv import load_dotenv
from openai import OpenAI
from supabase import create_client, Client
import numpy as np
from sklearn.cluster import KMeans
from sklearn.preprocessing import normalize

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

# ──────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
OPENAI_KEY   = os.environ["OPENAI_API_KEY"]

EMBEDDING_MODEL  = "text-embedding-3-small"
CHAT_MODEL       = "gpt-4o-mini"
EMBED_BATCH_SIZE = 100   # OpenAI supports up to 2048; 100 keeps payloads reasonable
BATCH_SIZE       = 20    # Supabase upsert batch size
VALID_PRIORITIES = {"Low", "Medium", "High", "Critical"}

# Re-clustering: 1 cluster per ~12 tickets, clamped between 7 and 20
CLUSTER_MIN = 7
CLUSTER_MAX = 20
TICKETS_PER_CLUSTER = 12

# Map alternate / verbose column names → canonical pipeline names.
# Keys must be already lower-cased and stripped.
COLUMN_ALIASES: dict[str, str] = {
    "ticket subject":     "subject",
    "ticket_subject":     "subject",
    "ticket description": "description",
    "ticket_description": "description",
    "ticket type":        "ticket_type",
    "ticket priority":    "priority",
    "date of purchase":   "date",
    "product purchased":  "product_area",
    # Preserve the CSV's native ticket ID so we can make per-month IDs unique
    "ticket id":          "raw_ticket_id",
    "ticket_id":          "raw_ticket_id",
}

openai_client    = OpenAI(api_key=OPENAI_KEY)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


# ──────────────────────────────────────────────────────────────
# Argument parsing
# ──────────────────────────────────────────────────────────────
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Process a CSV of support tickets")
    parser.add_argument("--file", required=True, help="Absolute path to the CSV file")
    parser.add_argument(
        "--month",
        help="Target month in YYYY-MM format. Forces all ticket created_at dates into this month.",
        default=None,
    )
    return parser.parse_args()


def coerce_date_to_month(row_date: str | None, target_month: str) -> str:
    """Return an ISO datetime string guaranteed to fall within target_month.

    If row_date already falls within the month, it is preserved (keeps
    intra-month ordering). Otherwise the 1st of the month is used.
    """
    year, mo = int(target_month[:4]), int(target_month[5:7])
    if row_date:
        try:
            d = datetime.fromisoformat(row_date.strip().replace("Z", "+00:00"))
            if d.year == year and d.month == mo:
                return row_date.strip()
        except (ValueError, AttributeError):
            pass
    return f"{target_month}-01T00:00:00+00:00"


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
        canonical_fields = {COLUMN_ALIASES.get(f, f) for f in norm_fields}
        has_subject     = "subject"     in canonical_fields
        has_description = "description" in canonical_fields

        if not has_subject and not has_description:
            raise ValueError(
                "CSV must contain at least a 'subject' or 'description' column. "
                f"Columns found: {', '.join(norm_fields)}"
            )

        for line_num, raw_row in enumerate(reader, start=2):
            # Normalise all keys to lowercase, strip whitespace, then apply aliases
            row = {
                COLUMN_ALIASES.get(k.strip().lower(), k.strip().lower()): (v or "").strip()
                for k, v in raw_row.items()
            }

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
                "subject":        subject,
                "description":    description,
                "date":           row.get("date") or None,
                "priority":       row.get("priority", "Medium") or "Medium",
                "ticket_type":    row.get("ticket_type") or "Support Request",
                "product_area":   row.get("product_area") or "General",
                "raw_ticket_id":  row.get("raw_ticket_id") or "",
            })

    return rows


# ──────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────
def stable_ticket_id(
    subject: str,
    description: str,
    month: str | None = None,
    raw_id: str | None = None,
) -> str:
    """Deterministic, per-month-unique ticket ID.

    Root cause of the multi-CSV bug: Kaggle and Kreo CSVs repeat identical
    subject+description text across months.  Without the month in the key,
    uploading February data upserts over January records (same hash → same
    ticket_id → same DB row), causing earlier months to silently disappear.

    Key priority:
      1. CSV native ID + month  (e.g. "2026-01|TKT-0100" or "2026-01|42")
      2. subject + description + month  (fallback when no native ID)
      3. subject + description only  (no month provided – legacy behaviour)
    """
    if raw_id:
        key = f"{month}|{raw_id}" if month else raw_id
    else:
        key = f"{month}|{subject}|{description}" if month else f"{subject}|{description}"
    digest = hashlib.md5(key.encode("utf-8")).hexdigest()[:16]
    return f"CSV-{digest}"


def validate_priority(p: str) -> str:
    return p if p in VALID_PRIORITIES else "Medium"


def embed_texts(texts: list[str]) -> list[list[float]]:
    embeddings = []
    for i in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = texts[i : i + EMBED_BATCH_SIZE]
        try:
            response = openai_client.embeddings.create(model=EMBEDDING_MODEL, input=batch)
        except Exception as exc:
            raise RuntimeError(
                f"OpenAI embedding failed for batch {i // EMBED_BATCH_SIZE + 1} "
                f"(texts {i}–{min(i + EMBED_BATCH_SIZE, len(texts)) - 1}): {exc}"
            ) from exc
        embeddings.extend([d.embedding for d in response.data])
        print(f"   Embedded {min(i + EMBED_BATCH_SIZE, len(texts))}/{len(texts)}")
    return embeddings


def parse_embedding(value) -> list[float]:
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (json.JSONDecodeError, ValueError):
            return []
        return parsed if isinstance(parsed, list) else []
    return value if isinstance(value, list) else []


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
    """Upsert ticket_rows and return a map of ticket_id → db UUID.

    Older Supabase Python clients don't support chaining .select() after
    .upsert(), so we upsert first then fetch the UUIDs in a separate query.
    """
    id_map: dict[str, str] = {}
    for i in range(0, len(ticket_rows), BATCH_SIZE):
        batch = ticket_rows[i : i + BATCH_SIZE]
        supabase.table("tickets").upsert(batch, on_conflict="ticket_id").execute()

        # Fetch the db UUIDs for this batch by ticket_id
        batch_tids = [r["ticket_id"] for r in batch]
        fetched = (
            supabase.table("tickets")
            .select("id, ticket_id")
            .in_("ticket_id", batch_tids)
            .execute()
        )
        for rec in fetched.data or []:
            id_map[rec["ticket_id"]] = rec["id"]
        print(f"   Upserted {min(i + BATCH_SIZE, len(ticket_rows))}/{len(ticket_rows)} tickets")
    return id_map


def upsert_cluster_members(member_rows: list[dict]) -> None:
    for i in range(0, len(member_rows), BATCH_SIZE):
        batch = member_rows[i : i + BATCH_SIZE]
        supabase.table("cluster_members").upsert(
            batch, on_conflict="ticket_id,cluster_id"
        ).execute()


WINDOW_DAYS     = 30
TREND_THRESHOLD = 0.25


def _calculate_trend(prev: int, curr: int) -> str:
    if prev == 0:
        return "Increasing" if curr > 0 else "Stable"
    ratio = (curr - prev) / prev
    if ratio > TREND_THRESHOLD:
        return "Increasing"
    if ratio < -TREND_THRESHOLD:
        return "Decreasing"
    return "Stable"


def refresh_cluster_trends() -> None:
    """Recount prev/curr window tickets and update trend for every cluster.

    Uses two flat queries (no joins) to avoid PostgREST ambiguity issues:
      1. Fetch all cluster_members (cluster_id, ticket_id).
      2. Fetch created_at for every referenced ticket in one batch.
    Then compute counts in Python and update all clusters.
    """
    now = datetime.now(timezone.utc)
    curr_start = now - timedelta(days=WINDOW_DAYS)
    prev_start = now - timedelta(days=WINDOW_DAYS * 2)

    # ── 1. All cluster memberships ────────────────────────────
    members_res = supabase.table("cluster_members").select("cluster_id, ticket_id").execute()
    members = members_res.data or []
    if not members:
        return

    # ── 2. Ticket dates (batch to avoid URL length limits) ────
    ticket_ids = list({m["ticket_id"] for m in members})
    ticket_dates: dict[str, datetime] = {}
    for i in range(0, len(ticket_ids), 500):
        chunk = ticket_ids[i : i + 500]
        res = supabase.table("tickets").select("id, created_at").in_("id", chunk).execute()
        for t in res.data or []:
            raw = t.get("created_at")
            if not raw:
                continue
            try:
                ticket_dates[t["id"]] = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                pass

    # ── 3. Count per cluster ──────────────────────────────────
    counts: dict[str, dict[str, int]] = {}
    for m in members:
        cid = m["cluster_id"]
        entry = counts.setdefault(cid, {"total": 0, "prev": 0, "curr": 0})
        entry["total"] += 1                        # all-time member count
        ts = ticket_dates.get(m["ticket_id"])
        if ts is None:
            continue
        if ts >= curr_start:
            entry["curr"] += 1
        elif ts >= prev_start:
            entry["prev"] += 1

    # ── 4. Update each cluster ────────────────────────────────
    for cid, entry in counts.items():
        trend = _calculate_trend(entry["prev"], entry["curr"])
        supabase.table("issue_clusters").update({
            "ticket_count":      entry["total"],
            "prev_window_count": entry["prev"],
            "curr_window_count": entry["curr"],
            "trend":             trend,
            "updated_at":        now.isoformat(),
        }).eq("id", cid).execute()

    print(f"   Trend counts refreshed for {len(counts)} cluster(s).")


# ──────────────────────────────────────────────────────────────
# Full re-clustering (replaces all clusters + memberships)
# ──────────────────────────────────────────────────────────────

def _name_cluster(subjects: list[str]) -> tuple[str, str]:
    """Ask GPT-4o-mini for a cluster name + one-sentence description."""
    subjects_text = "\n".join(f"- {s}" for s in subjects[:6])
    prompt = (
        "You are an expert at categorizing customer support tickets.\n"
        "Given the following support ticket subjects from a single issue cluster, "
        "provide:\n"
        "1. A short, clear issue name (3-5 words, title case, no punctuation)\n"
        "2. A one-sentence description of the underlying problem\n\n"
        f"Ticket subjects:\n{subjects_text}\n\n"
        "Respond in JSON with keys 'name' and 'description' only."
    )
    response = openai_client.chat.completions.create(
        model=CHAT_MODEL,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.2,
    )
    data = json.loads(response.choices[0].message.content)
    return data["name"], data["description"]


def recluster_all_tickets() -> None:
    """
    Re-run K-Means on every ticket in the DB, then rebuild issue_clusters
    and cluster_members from scratch.

    K is chosen dynamically: 1 cluster per TICKETS_PER_CLUSTER tickets,
    clamped to [CLUSTER_MIN, CLUSTER_MAX].
    """
    print("\n[Re-cluster] Fetching all ticket embeddings …")
    result = supabase.table("tickets").select(
        "id, subject, created_at, embedding"
    ).execute()
    all_tickets = result.data or []

    if len(all_tickets) < CLUSTER_MIN:
        print(f"   Only {len(all_tickets)} ticket(s) — skipping re-cluster.")
        return

    k = max(CLUSTER_MIN, min(CLUSTER_MAX, len(all_tickets) // TICKETS_PER_CLUSTER))
    print(f"   {len(all_tickets)} tickets  →  k={k} clusters")

    # Build embedding matrix
    matrix = np.array(
        [parse_embedding(t["embedding"]) for t in all_tickets],
        dtype=np.float32,
    )
    normed = normalize(matrix, norm="l2")

    # Run K-Means
    km = KMeans(n_clusters=k, init="k-means++", n_init=10, random_state=42)
    labels = km.fit_predict(normed)
    centroids = km.cluster_centers_

    # Group tickets by cluster label
    cluster_map: dict[int, list[dict]] = {i: [] for i in range(k)}
    for ticket, label in zip(all_tickets, labels):
        cluster_map[int(label)].append(ticket)

    # Wipe old clusters + memberships
    print("   Clearing old clusters …")
    supabase.table("cluster_members").delete().neq(
        "ticket_id", "00000000-0000-0000-0000-000000000000"
    ).execute()
    supabase.table("issue_clusters").delete().neq(
        "id", "00000000-0000-0000-0000-000000000000"
    ).execute()

    now = datetime.now(timezone.utc)
    curr_start = now - timedelta(days=WINDOW_DAYS)
    prev_start = now - timedelta(days=WINDOW_DAYS * 2)

    print(f"   Naming and storing {k} clusters …")
    for label, members in cluster_map.items():
        subjects = [m["subject"] for m in members]
        name, description = _name_cluster(subjects)

        # Window counts
        prev_count = curr_count = 0
        for m in members:
            raw = m.get("created_at")
            if not raw:
                continue
            try:
                ts = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                continue
            if ts >= curr_start:
                curr_count += 1
            elif ts >= prev_start:
                prev_count += 1

        trend = _calculate_trend(prev_count, curr_count)
        centroid = centroids[label].tolist()

        cluster_result = supabase.table("issue_clusters").insert({
            "name":               name,
            "description":        description,
            "ticket_count":       len(members),
            "prev_window_count":  prev_count,
            "curr_window_count":  curr_count,
            "trend":              trend,
            "centroid_embedding": centroid,
            "updated_at":         now.isoformat(),
        }).execute()
        cluster_id = cluster_result.data[0]["id"]

        member_rows = [
            {"ticket_id": m["id"], "cluster_id": cluster_id, "similarity_score": 1.0}
            for m in members
        ]
        for i in range(0, len(member_rows), BATCH_SIZE):
            supabase.table("cluster_members").insert(
                member_rows[i : i + BATCH_SIZE]
            ).execute()

        print(f"     Cluster {label}: \"{name}\"  ({len(members)} tickets, {trend})")

    print(f"   Re-cluster complete: {k} clusters rebuilt.")


# ──────────────────────────────────────────────────────────────
# Embedding text builder
# ──────────────────────────────────────────────────────────────
def _is_template(text: str) -> bool:
    """Return True if the text looks like an unfilled template placeholder."""
    return "{" in text and "}" in text


def _build_embed_text(row: dict) -> str:
    """
    Build a semantically rich string for embedding.

    The Kaggle customer-support dataset has template descriptions like
    "I'm having an issue with the {product_purchased}. Please assist."
    which are semantically identical across all rows.  When that is detected
    we fall back to a richer combination of subject + ticket_type + product_area
    so that tickets spread across different semantic clusters.
    """
    subject      = row.get("subject", "").strip()
    description  = row.get("description", "").strip()
    ticket_type  = row.get("ticket_type", "").strip()
    product_area = row.get("product_area", "").strip()

    parts = [subject] if subject else []

    # Only include description if it adds genuine signal
    if description and not _is_template(description) and description != subject:
        parts.append(description)

    # Append categorical metadata as natural-language context
    if ticket_type and ticket_type not in ("Support Request", ""):
        parts.append(f"Type: {ticket_type}")
    if product_area and product_area not in ("General", ""):
        parts.append(f"Product: {product_area}")

    return ". ".join(parts) if parts else subject or description


# ──────────────────────────────────────────────────────────────
# Main pipeline
# ──────────────────────────────────────────────────────────────
def main() -> None:
    args = parse_args()
    target_month: str | None = args.month
    if target_month:
        print(f"   Target month: {target_month} (all ticket dates forced into this month)")

    print(f"[1/3] Reading CSV: {args.file}")
    rows = read_csv(args.file)
    if not rows:
        print("   No valid rows to process.")
        print("INSERTED:0")
        return
    print(f"   {len(rows)} valid rows found.")

    print(f"\n[2/3] Generating embeddings for {len(rows)} rows …")
    texts = [_build_embed_text(r) for r in rows]
    embeddings = embed_texts(texts)

    # Build DB rows
    ticket_rows = []
    for row, emb in zip(rows, embeddings):
        tid = stable_ticket_id(
            row["subject"],
            row["description"],
            month=target_month,
            raw_id=row.get("raw_ticket_id") or None,
        )
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
        if target_month:
            ticket["created_at"] = coerce_date_to_month(row.get("date"), target_month)
        elif row.get("date"):
            ticket["created_at"] = row["date"]
        ticket_rows.append(ticket)

    # Deduplicate by ticket_id: rows with identical subject+description produce the
    # same hash, and PostgreSQL rejects a batch upsert that targets the same row twice.
    seen: dict[str, int] = {}
    for i, t in enumerate(ticket_rows):
        seen[t["ticket_id"]] = i          # last occurrence wins
    unique_indices = sorted(seen.values())
    dupes = len(ticket_rows) - len(unique_indices)
    if dupes:
        print(f"   Deduplicated {dupes} row(s) with identical subject+description.")
    ticket_rows = [ticket_rows[i] for i in unique_indices]

    print(f"\n[3/3] Upserting {len(ticket_rows)} tickets …")
    id_map = upsert_tickets(ticket_rows)
    inserted = len(id_map)

    # Re-cluster ALL tickets in the DB (creates new clusters as needed)
    recluster_all_tickets()

    # This line is parsed by the Next.js upload-csv route — do not remove
    print(f"INSERTED:{inserted}")


if __name__ == "__main__":
    main()
