# Support Issue Intelligence System

A full-stack dashboard that clusters support tickets by semantic similarity, detects trends, and surfaces AI-powered insights. Built as a Kreo internship assignment.

---

## Architecture Overview

```
Browser (Next.js App Router)
  │
  ├── GET  /api/clusters            ← Supabase RPC → cluster grid
  ├── POST /api/webhooks/incoming-ticket  ← embed → assign → insert
  ├── POST /api/upload-csv          ← spawns process_csv.py
  ├── POST /api/recluster           ← spawns add_tickets.py (K-Means)
  ├── POST /api/generate-summary    ← GPT-4o-mini root cause
  ├── POST /api/draft-qa-alert      ← GPT-4o-mini alert email
  ├── GET  /api/similar-tickets     ← OpenAI embed → pgvector search
  └── GET  /api/health              ← liveness check
        │
        ▼
  Supabase (PostgreSQL + pgvector)
  ├── tickets            (embedding vector(1536), HNSW index)
  ├── issue_clusters     (centroid + trend counts)
  ├── cluster_members    (ticket ↔ cluster junction)
  └── job_runs           (async job tracking)
        │
        └── Realtime WebSocket → dashboard auto-refresh
```

**Tech stack:**

| Layer | Technology |
|-------|-----------|
| Database | Supabase (PostgreSQL + pgvector) |
| Embeddings | OpenAI text-embedding-3-small (1536 dims) |
| Clustering | scikit-learn K-Means (k=7, L2-normalised) |
| Cluster naming | GPT-4o-mini |
| Frontend | Next.js 15 App Router + Tailwind CSS |
| UI | shadcn/ui, Lucide icons |
| Real-time | Supabase Realtime (WebSocket) |

---

## Quick Start

### 1. Prerequisites

- Node.js 18+
- Python 3.10+
- A [Supabase](https://supabase.com) project (free tier works)
- An [OpenAI API key](https://platform.openai.com)

### 2. Database setup

Run `backend/scripts/setup_db.sql` in your Supabase SQL Editor, then run the migrations:

```sql
-- Run in Supabase SQL Editor
\i backend/scripts/setup_db.sql
\i backend/scripts/add_job_runs.sql
\i backend/scripts/add_source_column.sql
```

### 3. Backend environment

```bash
cp backend/.env.example backend/.env
# Fill in:
# SUPABASE_URL=https://<project>.supabase.co
# SUPABASE_SERVICE_KEY=<service_role_key>
# OPENAI_API_KEY=sk-...
```

### 4. Seed the database

```bash
cd backend
pip install -r requirements.txt

# Option A - Kreo peripheral support tickets (recommended)
python scripts/seed_kreo_data.py

# Option B - generic mock tickets
python scripts/seed_tickets.py
```

### 5. Frontend

```bash
cd frontend
cp .env.local.example .env.local   # or copy backend/.env values
# SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENAI_API_KEY

npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deploying to Vercel

The frontend deploys to Vercel with zero extra configuration. A `vercel.json` at the repo root points Vercel at the `frontend/` subfolder automatically.

### Steps

1. Push this repo to GitHub.
2. Import the project in [vercel.com/new](https://vercel.com/new). Leave **Root Directory** as the default (the `vercel.json` handles it).
3. Add the three required environment variables in **Settings > Environment Variables**:

| Variable | Where to find it |
|----------|-----------------|
| `SUPABASE_URL` | Supabase dashboard > Settings > API > Project URL |
| `SUPABASE_SERVICE_KEY` | Supabase dashboard > Settings > API > service_role key |
| `OPENAI_API_KEY` | platform.openai.com > API keys |

4. Deploy. The dashboard, AI summaries, semantic search, and real-time updates all work on Vercel.

### What does not work on Vercel

Two endpoints spawn a Python subprocess (K-Means via scikit-learn) and cannot run in a Vercel serverless environment:

- `POST /api/recluster` - returns `503` with a clear message
- `POST /api/upload-csv` - returns `503` with a clear message

To use these, run the scripts locally (`add_tickets.py`, `process_csv.py`) or deploy the Python backend separately (Railway, Render, or Fly.io) and call it from there.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Service role key (bypasses RLS) |
| `OPENAI_API_KEY` | Yes | Used for embeddings + GPT summaries |
| `WEBHOOK_SECRET` | No | Shared secret for webhook endpoint |
| `SYNC_SECRET` | No | Shared secret for sync + recluster endpoints |
| `BACKEND_DIR` | No | Path to backend dir (default: `../backend`) |

---

## Data Ingestion

### Webhook (real-time)

```bash
curl -X POST http://localhost:3000/api/webhooks/incoming-ticket \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: <WEBHOOK_SECRET>" \
  -d '{
    "id": "GRG-10042",
    "subject": "Scroll wheel stopped clicking after 2 weeks",
    "description": "The scroll wheel on my Swarm65...",
    "priority": "High",
    "product_area": "Hardware"
  }'
```

### CSV Upload

Upload via the dashboard UI, or directly:

```bash
curl -X POST http://localhost:3000/api/upload-csv \
  -F "file=@your_tickets.csv"
```

CSV columns: `subject, description, date, priority, ticket_type, product_area`

### Re-clustering (on-demand)

```bash
curl -X POST http://localhost:3000/api/recluster \
  -H "x-sync-secret: <SYNC_SECRET>"
```

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/clusters?month=YYYY-MM\|all` | Fetch clusters (optional month filter) |
| `POST` | `/api/webhooks/incoming-ticket` | Ingest single ticket via webhook |
| `POST` | `/api/upload-csv` | Batch ingest from CSV |
| `POST` | `/api/recluster` | Trigger full K-Means re-cluster |
| `POST` | `/api/generate-summary` | AI root cause summary for a cluster |
| `POST` | `/api/draft-qa-alert` | Draft QA escalation email |
| `GET` | `/api/similar-tickets?text=&threshold=0.6&limit=10` | Semantic search |
| `GET` | `/api/health` | Liveness check (DB + OpenAI status) |

---

## Clustering Design

**Two-tier assignment:**

1. **Real-time** (per ticket): cosine similarity to existing centroids → O(k) assignment
2. **Batch re-cluster** (on-demand): full K-Means on all tickets → new centroids + GPT naming

**Trend detection (30-day windows):**
```
prev_window = tickets in [now-60d, now-30d]
curr_window = tickets in [now-30d, now]

> +25% change → "Increasing"
> -25% change → "Decreasing"
otherwise    → "Stable"
```

---

## Frontend Component Structure

```
frontend/
  app/
    page.tsx              ← Main orchestrator (~260 lines)
    layout.tsx
    globals.css
    api/
      clusters/           ← GET clusters with optional month filter
      health/             ← GET liveness check
      recluster/          ← POST trigger re-clustering
      similar-tickets/    ← GET semantic search
      webhooks/incoming-ticket/
      upload-csv/
      generate-summary/
      draft-qa-alert/
  components/
    types.ts              ← Ticket, Cluster, TrendFilter, Space
    tokens.ts             ← Design tokens (T, PRIORITY)
    utils.ts              ← timeAgo, pctChange helpers
    TrendPill.tsx         ← TrendPill, PriorityDot atoms
    MetricCard.tsx        ← Summary metric cards
    AiRootCause.tsx       ← AI summary section (lazy-loaded)
    QaAlertModal.tsx      ← QA alert email modal
    ClusterCard.tsx       ← Cluster grid card
    DetailPanel.tsx       ← Slide-in cluster detail panel
    SkeletonCard.tsx      ← Loading skeleton
    CsvUploadModal.tsx    ← Drag-and-drop CSV upload modal
```

---

## Database Schema

```sql
tickets          (id, ticket_id UNIQUE, subject, description, priority,
                  ticket_type, product_area, status, source, created_at,
                  embedding vector(1536))

issue_clusters   (id, name, description, ticket_count,
                  prev_window_count, curr_window_count,
                  trend, centroid_embedding vector(1536), updated_at)

cluster_members  (ticket_id FK, cluster_id FK, similarity_score,
                  PRIMARY KEY (ticket_id, cluster_id))

job_runs         (id, job_type, status, tickets_processed,
                  error_message, started_at, finished_at)
```

**RPC functions:**
- `find_similar_tickets(embedding, threshold, count)`: cosine similarity search
- `get_clusters_with_tickets()`: clusters with example tickets as JSONB

---

## Seed Datasets

| Script | Tickets | Description |
|--------|---------|-------------|
| `seed_kreo_data.py` | 270 | Kreo peripheral hardware support (recommended) |
| `seed_tickets.py` | 80 | Generic mock support tickets |
| `seed_real_data.py` | 500 | Real Kaggle customer support dataset |
| `add_tickets.py` | +10 | Simulate new incoming tickets + re-cluster |

---

## Designed Trends (Kreo dataset)

| Cluster | Trend |
|---------|-------|
| Webcam Connectivity Issues | Increasing |
| Keyboard Connectivity Issues | Increasing |
| Software / Firmware / RGB | Stable |
| Shipping / Missing Items | Stable |
| Hardware Defects | Decreasing |
| Mouse / Controller Issues | Stable |
| Returns / Warranty | Decreasing |

---

## Design Decisions & What I'd Improve

**Why K-Means with a fixed k range?**
K-Means on L2-normalised embeddings approximates spherical clustering, which works well for semantically distinct support categories. Dynamic k (1 cluster per ~12 tickets, clamped to 7–20) avoids the need to hand-tune k as ticket volume grows.

**What I'd do differently with more time:**

- **Replace K-Means with HDBSCAN.** K-Means forces every ticket into a cluster and requires specifying k upfront. HDBSCAN discovers cluster count automatically and handles outlier tickets gracefully, which is better for real support queues where issues appear and disappear unpredictably.
- **Finer trend thresholds per cluster.** The current ±25% threshold is global. High-volume clusters need a larger absolute change to be meaningful; low-volume clusters are too sensitive. A per-cluster baseline with statistical significance testing (e.g. z-score on a rolling window) would reduce false trend alerts.
- **Replace spawned Python processes with a persistent job queue.** Currently `upload-csv` and `recluster` spawn subprocesses via `execFile`. Under concurrent requests this races and blocks the Node event loop. A proper queue (BullMQ + Redis, or Supabase Edge Functions) would handle retries, backpressure, and progress streaming cleanly.
- **Incremental re-clustering.** Today every CSV upload triggers a full K-Means pass over all tickets. With thousands of tickets this becomes slow. An incremental approach (assign new tickets to nearest centroid first, only re-cluster when centroid drift exceeds a threshold) would keep uploads fast.
- **Persist cluster identity across re-clusters.** Each re-cluster wipes and rebuilds all clusters, so cluster UUIDs change. This breaks any external references (saved links, alerts). Matching new clusters to old ones by centroid cosine similarity and preserving IDs would give stable cluster identities over time.
