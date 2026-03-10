"""
add_tickets.py
==============
Simulates incoming support tickets arriving AFTER the initial seed.
Demonstrates Requirement #5: "Updating Results when new tickets are processed."

What it does:
  1. Inserts N new tickets into the `tickets` table (with embeddings)
  2. Re-runs the full clustering pipeline on ALL tickets
  3. Updates issue_clusters and cluster_members tables
  4. The Next.js dashboard will update in real-time via Supabase Realtime

Usage:
  python scripts/add_tickets.py             # add 10 default new tickets
  python scripts/add_tickets.py --count 5   # add 5 new tickets

The new tickets intentionally spike the 'network_connectivity' and
'login_auth' categories to demonstrate trend changes on the dashboard.
"""

import os
import time
import json
import argparse
import random
from datetime import datetime, timedelta, timezone

import numpy as np
from openai import OpenAI
from supabase import create_client, Client
from sklearn.cluster import KMeans
from sklearn.preprocessing import normalize
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

SUPABASE_URL    = os.environ["SUPABASE_URL"]
SUPABASE_KEY    = os.environ["SUPABASE_SERVICE_KEY"]
OPENAI_KEY      = os.environ["OPENAI_API_KEY"]
EMBEDDING_MODEL = "text-embedding-3-small"
CHAT_MODEL      = "gpt-4o-mini"
N_CLUSTERS      = 7
WINDOW_DAYS     = 30
TREND_THRESHOLD = 0.25

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
openai_client    = OpenAI(api_key=OPENAI_KEY)


NEW_TICKET_POOL = [
    {"subject": "Platform completely inaccessible — network error",
     "description": "Getting a 'Failed to fetch' network error on all API calls. Platform has been down for our entire team for the past 2 hours. Revenue impact is severe.",
     "priority": "Critical", "ticket_type": "Outage", "product_area": "Connectivity"},

    {"subject": "Cannot log in after password change",
     "description": "Changed password successfully (got confirmation email) but now can't log in with the new password. Old password also rejected. Completely locked out.",
     "priority": "Critical", "ticket_type": "Access Issue", "product_area": "Authentication"},

    {"subject": "WiFi-to-cellular handoff breaks platform connection",
     "description": "When my device switches from WiFi to cellular (commuting) the platform connection drops and never recovers. Have to force-close and reopen the app.",
     "priority": "High", "ticket_type": "Technical Issue", "product_area": "Connectivity"},

    {"subject": "MFA app changed phone — locked out",
     "description": "Got a new phone and my MFA codes no longer work. The account recovery option asks to send a code to the old phone I no longer have. Need emergency access.",
     "priority": "Critical", "ticket_type": "Access Issue", "product_area": "Authentication"},

    {"subject": "DNS resolution failing for platform domain",
     "description": "Our corporate DNS resolver is returning NXDOMAIN for the platform domain. Other companies on the same ISP are also affected. Seems like a DNS zone issue on your end.",
     "priority": "Critical", "ticket_type": "Technical Issue", "product_area": "Connectivity"},

    {"subject": "Overcharged after plan upgrade",
     "description": "Upgraded from Starter to Pro mid-cycle. Was charged the full Pro amount for the month instead of the prorated amount for the remaining days.",
     "priority": "High", "ticket_type": "Billing Issue", "product_area": "Billing"},

    {"subject": "JWT tokens expiring immediately after issue",
     "description": "Authentication tokens are expiring immediately (within seconds) instead of the configured 1-hour expiry. All API requests fail with 401 after initial auth.",
     "priority": "Critical", "ticket_type": "Access Issue", "product_area": "Authentication"},

    {"subject": "Firewall blocking platform after IP change",
     "description": "Your platform's IP address changed overnight and now our corporate firewall blocks it. What is the new IP range we need to whitelist?",
     "priority": "High", "ticket_type": "Technical Issue", "product_area": "Connectivity"},

    {"subject": "Report export hangs at 99%",
     "description": "Export progress bar reaches 99% and then hangs indefinitely. The report file is never delivered. Tried 5 times over 2 days — same result.",
     "priority": "High", "ticket_type": "Performance Issue", "product_area": "Reporting"},

    {"subject": "Cross-region replication lag causing stale reads",
     "description": "Users in APAC are reading stale data that is 15–20 minutes behind. Our SLA requires < 1 minute replication lag. This is a data consistency violation.",
     "priority": "Critical", "ticket_type": "Technical Issue", "product_area": "Connectivity"},
]


def now_utc():
    return datetime.now(timezone.utc)


def parse_embedding(value):
    if isinstance(value, str):
        return json.loads(value)
    return value


def embed_texts(texts):
    response = openai_client.embeddings.create(model=EMBEDDING_MODEL, input=texts)
    return [item.embedding for item in response.data]


def name_cluster(subjects):
    subjects_text = "\n".join(f"- {s}" for s in subjects[:6])
    prompt = (
        "You are an expert at categorizing customer support tickets.\n"
        "Given the following support ticket subjects from a single issue cluster, provide:\n"
        "1. A short, clear issue name (3–5 words, title case, no punctuation)\n"
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


def calculate_trend(prev, curr):
    if prev == 0:
        return "Increasing" if curr > 0 else "Stable"
    ratio = (curr - prev) / prev
    if ratio > TREND_THRESHOLD:
        return "Increasing"
    elif ratio < -TREND_THRESHOLD:
        return "Decreasing"
    return "Stable"


def insert_new_tickets(count):
    pool = random.sample(NEW_TICKET_POOL, min(count, len(NEW_TICKET_POOL)))
    print(f"\n  Inserting {len(pool)} new tickets …")

    embed_inputs = [f"{t['subject']}. {t['description']}" for t in pool]
    embeddings = embed_texts(embed_inputs)

    # Determine next ticket_id number
    existing = supabase.table("tickets").select("ticket_id").execute()
    existing_ids = [int(r["ticket_id"].replace("TKT-", "")) for r in existing.data if r["ticket_id"].startswith("TKT-")]
    next_id = max(existing_ids, default=1999) + 1

    rows = []
    for i, ticket in enumerate(pool):
        rows.append({
            "ticket_id":    f"TKT-{next_id + i}",
            "subject":      ticket["subject"],
            "description":  ticket["description"],
            "priority":     ticket["priority"],
            "ticket_type":  ticket["ticket_type"],
            "product_area": ticket["product_area"],
            "status":       "Open",
            "created_at":   now_utc().isoformat(),
            "embedding":    embeddings[i],
        })

    result = supabase.table("tickets").insert(rows).execute()
    print(f"  ✓ Inserted {len(result.data)} new tickets.")
    return result.data


def recluster_all():
    print("\n  Fetching all tickets for re-clustering …")
    result = supabase.table("tickets").select("id, ticket_id, subject, description, priority, product_area, created_at, embedding").execute()
    tickets = result.data
    matrix = np.array([parse_embedding(t["embedding"]) for t in tickets], dtype=np.float32)
    print(f"  Total tickets: {len(tickets)}")

    # Clear old clusters
    supabase.table("cluster_members").delete().neq("ticket_id", "00000000-0000-0000-0000-000000000000").execute()
    supabase.table("issue_clusters").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()

    # K-Means
    normalised = normalize(matrix, norm="l2")
    km = KMeans(n_clusters=N_CLUSTERS, init="k-means++", n_init=10, random_state=42)
    labels = km.fit_predict(normalised)
    centroids = km.cluster_centers_

    cluster_map = {i: [] for i in range(N_CLUSTERS)}
    for ticket, label in zip(tickets, labels):
        ticket["_cluster_label"] = int(label)
        cluster_map[int(label)].append(ticket)

    cutoff = now_utc()
    window_mid = cutoff - timedelta(days=WINDOW_DAYS)

    for label, members in cluster_map.items():
        subjects = [m["subject"] for m in members]
        name, description = name_cluster(subjects)

        prev_count = sum(1 for m in members if datetime.fromisoformat(m["created_at"]) < window_mid)
        curr_count = sum(1 for m in members if datetime.fromisoformat(m["created_at"]) >= window_mid)
        trend = calculate_trend(prev_count, curr_count)

        cluster_result = supabase.table("issue_clusters").insert({
            "name":               name,
            "description":        description,
            "ticket_count":       len(members),
            "prev_window_count":  prev_count,
            "curr_window_count":  curr_count,
            "trend":              trend,
            "centroid_embedding": centroids[label].tolist(),
            "updated_at":         cutoff.isoformat(),
        }).execute()
        cluster_id = cluster_result.data[0]["id"]

        supabase.table("cluster_members").insert([
            {"ticket_id": m["id"], "cluster_id": cluster_id, "similarity_score": 1.0}
            for m in members
        ]).execute()

        print(f"  Cluster: \"{name}\" | {len(members)} tickets | {trend}")
        time.sleep(0.5)

    print("\n  ✓ Re-clustering complete. Dashboard will update via Realtime.")


def main():
    parser = argparse.ArgumentParser(description="Add new tickets and re-cluster")
    parser.add_argument("--count", type=int, default=10, help="Number of new tickets to add (max 10)")
    args = parser.parse_args()

    print("=" * 60)
    print("  Adding New Tickets + Re-Clustering")
    print("=" * 60)

    insert_new_tickets(args.count)
    recluster_all()

    print("=" * 60)
    print("  Done. Check the dashboard for updated clusters and trends.")
    print("=" * 60)


if __name__ == "__main__":
    main()
