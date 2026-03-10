"""
sync_amazon.py
==============
Pulls Amazon reviews for the Kreo Swarm65 keyboard via an Apify actor,
filters to 3-star and below (dissatisfied customers = support signal),
embeds each review with OpenAI, and upserts them into the `tickets` table
with source = 'amazon'.

Pre-requisites:
  1. Run `backend/scripts/add_source_column.sql` in your Supabase SQL Editor.
  2. Add APIFY_API_TOKEN to backend/.env (see .env.example).
  3. Replace ACTOR_ID and PRODUCT_ASIN below with your real values.

Usage:
  pip install -r requirements.txt
  python scripts/sync_amazon.py

Idempotent: uses ticket_id = "AMZ-<review_id>" with upsert on_conflict,
so re-running never creates duplicates.
"""

import os
import sys
import re
import time
import json
import hashlib
from datetime import datetime, timezone

# Force UTF-8 on Windows terminals
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from dotenv import load_dotenv
from apify_client import ApifyClient
from openai import OpenAI
from supabase import create_client, Client

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

# ──────────────────────────────────────────────────────────────
# Config — replace placeholders with real values
# ──────────────────────────────────────────────────────────────

# Apify actor that scrapes Amazon reviews.
# The official Apify Store actor for Amazon reviews:
#   https://apify.com/junglee/amazon-reviews-scraper
# Replace with the actor ID from your Apify console.
ACTOR_ID = "junglee/amazon-reviews-scraper"  # ← replace if using a different actor

# ASIN of the Kreo Swarm65 keyboard on Amazon India / Amazon.com
# Find it in the product URL: amazon.in/dp/<ASIN>
PRODUCT_ASIN = "B0BZDCPBYH"  # Kreo Swarm65 Mechanical Keyboard — amazon.in

# Only ingest reviews at or below this star rating (dissatisfied customers)
MAX_STARS = 3

EMBEDDING_MODEL = "text-embedding-3-small"

# ──────────────────────────────────────────────────────────────
# Clients
# ──────────────────────────────────────────────────────────────
APIFY_TOKEN    = os.environ["APIFY_API_TOKEN"]
SUPABASE_URL   = os.environ["SUPABASE_URL"]
SUPABASE_KEY   = os.environ["SUPABASE_SERVICE_KEY"]
OPENAI_KEY     = os.environ["OPENAI_API_KEY"]

apify_client   = ApifyClient(APIFY_TOKEN)
openai_client  = OpenAI(api_key=OPENAI_KEY)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


# ──────────────────────────────────────────────────────────────
# Step 1 – Trigger Apify actor run and wait for results
# ──────────────────────────────────────────────────────────────

def fetch_amazon_reviews() -> list[dict]:
    """
    Trigger the Apify Amazon Reviews Scraper actor for the target ASIN
    and return raw review items once the run completes.

    Actor input schema (junglee/amazon-reviews-scraper):
      https://apify.com/junglee/amazon-reviews-scraper/input-schema
    """
    print(f"\n[1/4] Starting Apify actor run for ASIN: {PRODUCT_ASIN} …")

    actor_input = {
        "productUrls": [
            {"url": f"https://www.amazon.in/dp/{PRODUCT_ASIN}"}
        ],
        # Maximum reviews to scrape
        "maxReviews": 100,
        # Sort by most recent so we catch new complaints quickly
        "sort": "recent",
    }

    # .call() starts the actor and blocks until the run finishes
    run = apify_client.actor(ACTOR_ID).call(run_input=actor_input)

    print(f"   Run finished — status: {run['status']}  id: {run['id']}")

    if run.get("status") != "SUCCEEDED":
        raise RuntimeError(
            f"Apify actor run did not succeed (status={run.get('status')!r}, "
            f"id={run.get('id')!r}). Check the Apify console for details."
        )

    # Retrieve items from the default dataset
    items = list(
        apify_client.dataset(run["defaultDatasetId"]).iterate_items()
    )
    print(f"   Total reviews scraped: {len(items)}")
    return items


# ──────────────────────────────────────────────────────────────
# Step 2 – Filter & normalise
# ──────────────────────────────────────────────────────────────

def normalise_star_rating(item: dict) -> int | None:
    """
    Extract star rating from an Apify Amazon review item.
    Different actor versions use different field names; we handle both.
    Returns an integer 1-5 or None if not parseable.
    """
    for field in ("stars", "starRating", "rating", "ratingScore"):
        raw = item.get(field)
        if raw is None:
            continue
        try:
            return int(float(str(raw).split()[0]))  # e.g. "4.0 out of 5" → 4
        except (ValueError, IndexError):
            continue
    return None


def _parse_review_date(raw: str | None) -> str | None:
    """Parse a review date string into ISO-8601 format for Supabase.
    Returns None if the value is absent or unparseable (Supabase will use NOW()).
    """
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%B %d, %Y", "%d %B %Y", "%m/%d/%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(raw.strip(), fmt).replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            continue
    # Handle strings like "Reviewed in India on January 15, 2023"
    match = re.search(r"(\w+ \d{1,2}, \d{4})", raw)
    if match:
        try:
            return datetime.strptime(match.group(1), "%B %d, %Y").replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            pass
    print(f"   Warning: could not parse date {raw!r} — using Supabase default NOW().",
          file=sys.stderr)
    return None


def filter_negative_reviews(items: list[dict]) -> list[dict]:
    """Keep only reviews with star rating ≤ MAX_STARS."""
    negative = []
    for item in items:
        stars = normalise_star_rating(item)
        if stars is not None and stars <= MAX_STARS:
            negative.append({**item, "_stars": stars})
    print(f"\n[2/4] Filtered to {len(negative)} reviews with ≤ {MAX_STARS} stars.")
    return negative


# ──────────────────────────────────────────────────────────────
# Step 3 – Map to ticket schema
# ──────────────────────────────────────────────────────────────

def map_review_to_ticket(item: dict) -> dict | None:
    """
    Convert an Apify Amazon review item to a ticket row.
    Returns None if the review lacks the minimum required fields.
    """
    # Review ID — used to build a stable, unique ticket_id.
    # uuid4() is intentionally avoided: a random fallback would break idempotency
    # by generating a new ID on every run for the same review.
    review_id = (
        item.get("id")
        or item.get("reviewId")
        or item.get("asin_id")
    )
    if not review_id:
        content = f"{item.get('title', '')}{item.get('text', '')}{item.get('date', '')}"
        review_id = hashlib.md5(content.encode("utf-8")).hexdigest()[:16]

    # Title / subject
    subject = (
        item.get("title")
        or item.get("reviewTitle")
        or item.get("headline")
        or ""
    ).strip()

    # Body / description
    description = (
        item.get("text")
        or item.get("reviewText")
        or item.get("body")
        or ""
    ).strip()

    if not subject and not description:
        return None  # skip empty reviews

    if not subject:
        # Fall back to first 80 chars of description as subject
        subject = description[:80] + ("…" if len(description) > 80 else "")

    stars = item.get("_stars", 3)

    # Map stars → priority
    if stars == 1:
        priority = "Critical"
    elif stars == 2:
        priority = "High"
    else:
        priority = "Medium"

    # Parse and validate date — Supabase requires ISO-8601
    raw_date = item.get("date") or item.get("reviewDate") or item.get("publishedDate")
    review_date = _parse_review_date(raw_date)

    return {
        "ticket_id":    f"AMZ-{review_id}",
        "subject":      subject,
        "description":  description or subject,
        "priority":     priority,
        "ticket_type":  "Product Review",
        "product_area": "Product Quality",
        "status":       "Open",
        "source":       "amazon",
        "created_at":   review_date,   # None → Supabase default NOW()
    }


# ──────────────────────────────────────────────────────────────
# Step 4 – Embed and upsert
# ──────────────────────────────────────────────────────────────

def embed_texts(texts: list[str]) -> list[list[float]]:
    """Batch-embed texts using OpenAI text-embedding-3-small."""
    print(f"   Generating embeddings for {len(texts)} texts …")
    embeddings = []
    batch_size = 20

    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        response = openai_client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=batch,
        )
        embeddings.extend([d.embedding for d in response.data])
        print(f"   Embedded {min(i + batch_size, len(texts))}/{len(texts)}")
        if i + batch_size < len(texts):
            time.sleep(0.3)

    return embeddings


def upsert_tickets(tickets: list[dict]) -> int:
    """Embed and upsert ticket rows into Supabase. Returns count inserted."""
    if not tickets:
        print("\n[4/4] No tickets to upsert.")
        return 0

    print(f"\n[4/4] Embedding and upserting {len(tickets)} tickets …")

    embed_inputs = [f"{t['subject']}. {t['description']}" for t in tickets]
    embeddings   = embed_texts(embed_inputs)

    # Attach embeddings and clean up None created_at
    rows = []
    for ticket, emb in zip(tickets, embeddings):
        row = {**ticket, "embedding": emb}
        if row.get("created_at") is None:
            del row["created_at"]   # let Supabase use DEFAULT NOW()
        rows.append(row)

    # Upsert in batches of 20
    inserted = 0
    batch_size = 20
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        result = supabase.table("tickets").upsert(
            batch, on_conflict="ticket_id"
        ).execute()
        inserted += len(result.data)
        print(f"   Upserted {min(i + batch_size, len(rows))}/{len(rows)}")

    print(f"   ✓ {inserted} Amazon review tickets upserted.")
    return inserted


# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  Kreo Swarm65 — Amazon Review Sync")
    print("=" * 60)

    raw_reviews   = fetch_amazon_reviews()
    negative      = filter_negative_reviews(raw_reviews)

    print("\n[3/4] Mapping reviews to ticket schema …")
    tickets = [t for item in negative if (t := map_review_to_ticket(item))]
    print(f"   Mapped {len(tickets)} valid tickets.")

    upsert_tickets(tickets)

    print("\n" + "=" * 60)
    print(f"  Done! {len(tickets)} Amazon reviews ingested into Supabase.")
    print("  Re-run clustering (seed_tickets.py --skip-truncate) to")
    print("  incorporate new tickets into the dashboard clusters.")
    print("=" * 60)


if __name__ == "__main__":
    main()
