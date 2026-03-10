"""
seed_real_data.py
=================
Seeds Supabase with 500 real support tickets from the Kaggle
"Customer Support Ticket Dataset" (suraj520/customer-support-ticket-dataset).

Pipeline:
  1. Load & stratify-sample 500 tickets (≈31 per subject) from the CSV
  2. Substitute {product_purchased} placeholder in every description
  3. Assign synthetic created_at timestamps with trend bias:
       Network problem / Software bug / Account access  → INCREASING
       Refund request  / Cancellation request / Hardware issue → DECREASING
       Everything else                                         → STABLE
  4. Generate OpenAI text-embedding-3-small embeddings
  5. Run K-Means (k=7) on L2-normalised embeddings
  6. Name each cluster with GPT-4o-mini
  7. Calculate prev/curr 30-day window counts → trend label
  8. Store everything to Supabase (truncates first by default)

Usage:
  py scripts/seed_real_data.py
  py scripts/seed_real_data.py --skip-truncate
  py scripts/seed_real_data.py --n 300          # custom sample size
  py scripts/seed_real_data.py --k 8            # custom cluster count
  py scripts/seed_real_data.py --dataset /path/to/customer_support_tickets.csv
"""

import os
import sys
import csv
import json
import time
import random
import argparse
from collections import defaultdict
from datetime import datetime, timedelta, timezone

# Force UTF-8 on Windows terminals
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import numpy as np
from openai import OpenAI
from supabase import create_client, Client
from sklearn.cluster import KMeans
from sklearn.preprocessing import normalize
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

# ──────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
OPENAI_KEY   = os.environ["OPENAI_API_KEY"]

DEFAULT_DATASET = (
    r"C:\Users\heman\.cache\kagglehub\datasets"
    r"\suraj520\customer-support-ticket-dataset\versions\1"
    r"\customer_support_tickets.csv"
)
DEFAULT_N        = 500     # tickets to sample
DEFAULT_K        = 7       # K-Means clusters
EMBED_BATCH_SIZE = 20      # items per OpenAI embedding request
EMBED_MODEL      = "text-embedding-3-small"
CHAT_MODEL       = "gpt-4o-mini"
WINDOW_DAYS      = 30
TREND_THRESHOLD  = 0.25    # >±25% change → Increasing / Decreasing
RANDOM_SEED      = 42

random.seed(RANDOM_SEED)
np.random.seed(RANDOM_SEED)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
openai_client    = OpenAI(api_key=OPENAI_KEY)

# ──────────────────────────────────────────────────────────────
# Trend bias table
# Controls what fraction of each subject's tickets fall in the
# *current* 30-day window (higher → cluster trends Increasing).
# ──────────────────────────────────────────────────────────────
RECENT_PROB: dict[str, float] = {
    # INCREASING — recent spike in these subjects
    "Network problem":       0.76,
    "Software bug":          0.72,
    "Account access":        0.70,
    # DECREASING — these subjects are winding down
    "Refund request":        0.26,
    "Cancellation request":  0.24,
    "Hardware issue":        0.28,
    # Everything else → roughly 50/50 = Stable
}
DEFAULT_RECENT_PROB = 0.50

STATUS_MAP = {
    "Pending Customer Response": "Open",
    "Open":   "Open",
    "Closed": "Closed",
}


# ──────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────

def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def synthetic_timestamp(subject: str) -> str:
    """
    Return an ISO-8601 UTC timestamp with a bias that produces natural
    Increasing / Stable / Decreasing trends after clustering.
    """
    p = RECENT_PROB.get(subject, DEFAULT_RECENT_PROB)
    if random.random() < p:
        days = random.uniform(0, 29)
    else:
        days = random.uniform(30, 60)
    jitter = random.uniform(-3, 3)   # ±3 h jitter
    return (now_utc() - timedelta(days=days, hours=jitter)).isoformat()


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Batch-embed texts with text-embedding-3-small, rate-limited."""
    print(f"  Generating embeddings for {len(texts)} texts …")
    embeddings: list[list[float]] = []
    for i in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = texts[i : i + EMBED_BATCH_SIZE]
        response = openai_client.embeddings.create(model=EMBED_MODEL, input=batch)
        embeddings.extend(item.embedding for item in response.data)
        print(f"    Embedded {min(i + EMBED_BATCH_SIZE, len(texts)):>4d}/{len(texts)}")
        if i + EMBED_BATCH_SIZE < len(texts):
            time.sleep(0.3)
    return embeddings


def name_cluster(subjects: list[str]) -> tuple[str, str]:
    """Ask GPT-4o-mini for a cluster name + one-sentence description."""
    subjects_text = "\n".join(f"- {s}" for s in subjects[:10])
    prompt = (
        "You are an expert at categorizing customer support tickets.\n"
        "Given the following support ticket subjects from a single issue cluster, provide:\n"
        "1. A short, clear issue name (3–6 words, title case, no punctuation)\n"
        "2. A one-sentence description of the underlying problem pattern\n\n"
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


def calculate_trend(prev: int, curr: int) -> str:
    if prev == 0:
        return "Increasing" if curr > 0 else "Stable"
    ratio = (curr - prev) / prev
    if ratio > TREND_THRESHOLD:
        return "Increasing"
    if ratio < -TREND_THRESHOLD:
        return "Decreasing"
    return "Stable"


def parse_embedding(value) -> list[float]:
    """Supabase may return vector columns as a JSON string; normalise to list."""
    if isinstance(value, str):
        return json.loads(value)
    return value


# ──────────────────────────────────────────────────────────────
# Pipeline steps
# ──────────────────────────────────────────────────────────────

def load_and_sample(dataset_path: str, n: int) -> list[dict]:
    """Load the Kaggle CSV and return n tickets stratified by Ticket Subject."""
    print(f"\n[1/6] Loading dataset from:\n      {dataset_path}")
    with open(dataset_path, encoding="utf-8") as f:
        all_rows = list(csv.DictReader(f))
    print(f"      Loaded {len(all_rows):,} total rows.")

    # Stratify by subject so every subject is represented
    by_subject: dict[str, list] = defaultdict(list)
    for row in all_rows:
        by_subject[row["Ticket Subject"]].append(row)

    per_subject = (n // len(by_subject)) + 1
    sampled: list[dict] = []
    for rows in by_subject.values():
        shuffled = rows[:]
        random.shuffle(shuffled)
        sampled.extend(shuffled[:per_subject])

    sampled = sampled[:n]
    random.shuffle(sampled)
    print(f"      Sampled {len(sampled)} tickets across {len(by_subject)} subjects.")
    return sampled


def build_ticket_records(raw_rows: list[dict]) -> list[dict]:
    """Clean and transform raw CSV rows into Supabase-ready dicts."""
    records = []
    for row in raw_rows:
        product = row["Product Purchased"]
        subject = row["Ticket Subject"]
        desc    = row["Ticket Description"].replace("{product_purchased}", product)

        records.append({
            "ticket_id":    f"KT-{row['Ticket ID'].zfill(5)}",
            "subject":      subject,
            "description":  desc,
            "priority":     row["Ticket Priority"],      # Low/Medium/High/Critical — matches schema
            "ticket_type":  row["Ticket Type"],
            "product_area": product,
            "status":       STATUS_MAP.get(row["Ticket Status"], "Open"),
            "created_at":   synthetic_timestamp(subject),
        })
    return records


def truncate_tables() -> None:
    print("\n  Truncating existing data …")
    NULL_UUID = "00000000-0000-0000-0000-000000000000"
    supabase.table("cluster_members").delete().neq("ticket_id",  NULL_UUID).execute()
    supabase.table("issue_clusters") .delete().neq("id",         NULL_UUID).execute()
    supabase.table("tickets")        .delete().neq("id",         NULL_UUID).execute()
    print("  Done.")


def insert_tickets(records: list[dict], embeddings: list[list[float]]) -> list[dict]:
    """Upsert all ticket rows (with embeddings) and return the inserted data."""
    print(f"\n[3/6] Upserting {len(records)} tickets to Supabase …")
    batch_size = 20
    inserted: list[dict] = []

    for i in range(0, len(records), batch_size):
        batch_recs  = records[i : i + batch_size]
        batch_embs  = embeddings[i : i + batch_size]
        rows = [
            {**rec, "embedding": emb}
            for rec, emb in zip(batch_recs, batch_embs)
        ]
        result = supabase.table("tickets").upsert(rows, on_conflict="ticket_id").execute()
        inserted.extend(result.data)
        print(f"   Upserted {min(i + batch_size, len(records)):>4d}/{len(records)}")

    print(f"   ✓ {len(inserted)} tickets in Supabase.")
    return inserted


def fetch_tickets_for_clustering() -> tuple[list[dict], np.ndarray]:
    """Pull all tickets + embeddings from Supabase."""
    print("\n[4/6] Fetching embeddings from Supabase for clustering …")
    result = supabase.table("tickets").select(
        "id, ticket_id, subject, priority, product_area, created_at, embedding"
    ).execute()
    tickets = result.data
    matrix  = np.array(
        [parse_embedding(t["embedding"]) for t in tickets], dtype=np.float32
    )
    print(f"   Fetched {len(tickets)} tickets — matrix {matrix.shape}")
    return tickets, matrix


def run_kmeans(tickets: list[dict], matrix: np.ndarray, k: int):
    """Cluster normalised embeddings with K-Means; return cluster_map + centroids."""
    print(f"\n[5/6] Running K-Means (k={k}) …")
    normalised = normalize(matrix, norm="l2")
    km = KMeans(n_clusters=k, init="k-means++", n_init=10, random_state=RANDOM_SEED)
    labels    = km.fit_predict(normalised)
    centroids = km.cluster_centers_

    cluster_map: dict[int, list[dict]] = {i: [] for i in range(k)}
    for ticket, label in zip(tickets, labels):
        ticket["_label"] = int(label)
        cluster_map[int(label)].append(ticket)

    for lbl, members in cluster_map.items():
        print(f"   Cluster {lbl}: {len(members):>3d} tickets")

    return cluster_map, centroids


def build_and_store_clusters(
    cluster_map: dict[int, list[dict]],
    centroids: np.ndarray,
) -> None:
    print(f"\n[6/6] Naming clusters, computing trends, storing …")
    cutoff = now_utc() - timedelta(days=WINDOW_DAYS)   # boundary = 30 days ago

    for label, members in cluster_map.items():
        subjects = [m["subject"] for m in members]
        name, description = name_cluster(subjects)

        prev_count = sum(
            1 for m in members
            if datetime.fromisoformat(m["created_at"]) < cutoff
        )
        curr_count = len(members) - prev_count
        trend = calculate_trend(prev_count, curr_count)
        arrow = {"Increasing": "↑", "Decreasing": "↓", "Stable": "→"}[trend]
        print(f"   [{arrow} {trend:11s}] {name!r}  ({len(members)} tickets  prev={prev_count} curr={curr_count})")

        cluster_result = supabase.table("issue_clusters").insert({
            "name":               name,
            "description":        description,
            "ticket_count":       len(members),
            "prev_window_count":  prev_count,
            "curr_window_count":  curr_count,
            "trend":              trend,
            "centroid_embedding": centroids[label].tolist(),
            "updated_at":         now_utc().isoformat(),
        }).execute()
        cluster_id = cluster_result.data[0]["id"]

        member_rows = [
            {"ticket_id": m["id"], "cluster_id": cluster_id, "similarity_score": 1.0}
            for m in members
        ]
        supabase.table("cluster_members").insert(member_rows).execute()
        time.sleep(0.5)   # gentle rate-limit buffer

    print(f"   ✓ {len(cluster_map)} clusters stored.")


def print_summary() -> None:
    result = supabase.rpc("get_clusters_with_tickets").execute()
    print()
    print("=" * 60)
    print("  Final cluster summary")
    print("=" * 60)
    for c in result.data:
        arrow = {"Increasing": "⬆", "Decreasing": "⬇", "Stable": "→"}.get(c["trend"], "→")
        print(
            f"  {arrow} {c['name']:<40s} "
            f"{c['ticket_count']:>3d} tickets  "
            f"prev={c['prev_window_count']} curr={c['curr_window_count']}  "
            f"{c['trend']}"
        )
    print()


# ──────────────────────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed Supabase with real Kaggle support ticket data"
    )
    parser.add_argument("--dataset",       default=DEFAULT_DATASET,
                        help="Path to customer_support_tickets.csv")
    parser.add_argument("--n",   type=int, default=DEFAULT_N,
                        help=f"Number of tickets to sample (default {DEFAULT_N})")
    parser.add_argument("--k",   type=int, default=DEFAULT_K,
                        help=f"Number of K-Means clusters (default {DEFAULT_K})")
    parser.add_argument("--skip-truncate", action="store_true",
                        help="Append without truncating existing data")
    args = parser.parse_args()

    print("=" * 60)
    print("  Support Intelligence — Real-Data Seeder")
    print(f"  n={args.n} tickets  k={args.k} clusters")
    print("=" * 60)

    # 1. Load & sample
    raw_rows = load_and_sample(args.dataset, args.n)

    # 2. Build ticket records
    records = build_ticket_records(raw_rows)

    # 2b. Embed (done before truncate so we don't wipe data on embed failure)
    print(f"\n[2/6] Generating embeddings …")
    texts      = [f"{r['subject']}: {r['description']}" for r in records]
    embeddings = embed_texts(texts)

    # 3. Truncate (unless skipped) then insert
    if not args.skip_truncate:
        truncate_tables()
    inserted = insert_tickets(records, embeddings)

    # 4–5. Fetch back + cluster
    tickets, matrix = fetch_tickets_for_clustering()
    cluster_map, centroids = run_kmeans(tickets, matrix, args.k)

    # 6. Name, trend-detect, store
    build_and_store_clusters(cluster_map, centroids)

    print_summary()
    print("  Seeding complete! Run `npm run dev` in frontend/ to see the dashboard.")
    print("=" * 60)


if __name__ == "__main__":
    main()
