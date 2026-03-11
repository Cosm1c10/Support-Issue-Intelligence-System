# Support Issue Intelligence System

A full-stack dashboard that clusters support tickets by semantic similarity, detects trends, and surfaces AI-powered insights. Deployable entirely on Vercel with no Python runtime required.

---

## Architecture

```
┌──────────────────────────────────────────┐
│         Browser  (Next.js App Router)    │
│  Dashboard UI · CSV Upload · Charts      │
└────────────┬─────────────────────▲───────┘
             │  HTTP requests      │ Supabase Realtime
             │                     │ (WebSocket auto-refresh)
┌────────────▼─────────────────────┴───────┐
│      Vercel  (Next.js API Routes)        │
│                                          │
│  GET  /api/clusters                      │
│  POST /api/upload-csv                    │
│  POST /api/webhooks/incoming-ticket      │
│  POST /api/generate-summary             │
│  POST /api/draft-qa-alert               │
│  GET  /api/similar-tickets              │
└────────────┬──────────────┬─────────────┘
             │              │
             ▼              ▼
┌─────────────────┐  ┌──────────────────┐
│    Supabase     │  │   OpenAI API     │
│  PostgreSQL +   │  │                  │
│   pgvector      │  │  text-embedding  │
│                 │  │  -3-small        │
│  tickets        │  │  (embeddings)    │
│  issue_clusters │  │                  │
│  cluster_members│  │  gpt-4o-mini     │
│  HNSW index     │  │  (naming,        │
│  Realtime pub.  │  │   summaries)     │
└─────────────────┘  └──────────────────┘
```

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Database | Supabase (PostgreSQL + pgvector) | HNSW index on `embedding vector(1536)` |
| Embeddings | OpenAI `text-embedding-3-small` | 1536 dims, batched 100 at a time |
| Clustering | K-Means++ in JavaScript | Pure Node.js, runs on Vercel (no Python needed) |
| Cluster naming | GPT-4o-mini | Parallel calls, JSON response format |
| AI summaries / alerts | GPT-4o-mini | Root-cause analysis + QA escalation email |
| Frontend | Next.js 15 App Router + Tailwind CSS | |
| UI components | shadcn/ui + Lucide icons + Recharts | Area + pie charts |
| Real-time | Supabase Realtime (WebSocket) | Subscribes to `issue_clusters` |
| Deployment | Vercel (serverless, no Python runtime) | `maxDuration = 300 s` on upload route |

---

## Quick Start

### 1. Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project (free tier works)
- An [OpenAI API key](https://platform.openai.com)

### 2. Database setup

Run the SQL files in order in your Supabase SQL Editor:

```sql
-- 1. Core schema (tables, HNSW index, RPC functions, RLS)
\i backend/scripts/setup_db.sql

-- 2. Additional migrations (run after setup_db)
\i backend/scripts/add_job_runs.sql
\i backend/scripts/add_source_column.sql
```

### 3. Seed the database (optional but recommended)

If you want pre-populated data before uploading a CSV, run one of the Python seed scripts locally:

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env   # fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENAI_API_KEY

# Kreo peripheral hardware tickets (recommended, 270 tickets, 7 clusters)
python scripts/seed_kreo_data.py

# Generic mock tickets (80 tickets)
python scripts/seed_tickets.py
```

> **Note:** Seeding is optional. The CSV upload pipeline will create clusters from scratch automatically if `issue_clusters` is empty.

### 4. Frontend

```bash
cd frontend
cp .env.local.example .env.local
# Set SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENAI_API_KEY

npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deploying to Vercel

1. Push this repo to GitHub.
2. Import the project at [vercel.com/new](https://vercel.com/new).
3. Set **Root Directory** to `frontend` in Vercel project settings.
4. Add environment variables under **Settings → Environment Variables**:

| Variable | Where to find it |
|----------|-----------------|
| `SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `SUPABASE_SERVICE_KEY` | Supabase → Settings → API → `service_role` key |
| `OPENAI_API_KEY` | platform.openai.com → API keys |

5. Deploy. Everything works on Vercel, including CSV upload and K-Means re-clustering.

> **Note:** `POST /api/recluster` still requires a Python backend (it spawns `add_tickets.py`). It returns `503` on Vercel. All other routes are fully serverless.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Service role key (bypasses RLS) |
| `OPENAI_API_KEY` | Yes | Used for embeddings + GPT summaries |
| `WEBHOOK_SECRET` | No | Shared secret for webhook endpoint |
| `SYNC_SECRET` | No | Shared secret for recluster endpoint |
| `BACKEND_DIR` | No | Path to backend dir (default: `../backend`) |

---

## Data Ingestion

### CSV Upload (via dashboard UI)

Drag-and-drop a `.csv` file onto the **Upload CSV** button. The pipeline will:

1. Parse and normalise CSV columns (see aliases below)
2. Embed all tickets via OpenAI in batches of 100
3. Insert tickets into Supabase in parallel batches of 10
4. Re-cluster all tickets in the DB with K-Means (k = 7–20)
5. Name each cluster with GPT-4o-mini (all calls in parallel)
6. Refresh the dashboard automatically

Accepted CSV columns (case-insensitive; aliases supported):

| Canonical name | Also accepts |
|----------------|-------------|
| `subject` | `Ticket Subject`, `ticket_subject` |
| `description` | `Ticket Description`, `ticket_description` |
| `date` | `Date of Purchase` |
| `priority` | `Ticket Priority` |
| `ticket_type` | `Ticket Type` |
| `product_area` | `Product Purchased`, `product_purchased` |

### CSV Upload (via curl)

```bash
curl -X POST https://<your-app>.vercel.app/api/upload-csv \
  -F "file=@your_tickets.csv"
```

### Webhook (real-time single ticket)

```bash
curl -X POST https://<your-app>.vercel.app/api/webhooks/incoming-ticket \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: <WEBHOOK_SECRET>" \
  -d '{
    "id": "TKT-10042",
    "subject": "Scroll wheel stopped clicking after 2 weeks",
    "description": "The scroll wheel on my Swarm65 feels loose...",
    "priority": "High",
    "product_area": "Hardware"
  }'
```

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/clusters?month=YYYY-MM\|all` | Fetch clusters with optional month filter |
| `POST` | `/api/upload-csv` | Batch ingest CSV → embed → K-Means → store |
| `POST` | `/api/webhooks/incoming-ticket` | Ingest single ticket via webhook |
| `POST` | `/api/recluster` | Full K-Means re-cluster (local / non-Vercel only) |
| `POST` | `/api/generate-summary` | AI root-cause summary for a cluster |
| `POST` | `/api/draft-qa-alert` | Draft QA escalation email |
| `GET` | `/api/similar-tickets?text=&threshold=0.6&limit=10` | Semantic similarity search |
| `GET` | `/api/health` | Liveness check (DB + OpenAI connectivity) |

---

## Clustering Design

### K-Means++ (JavaScript)

The upload pipeline runs a full K-Means re-cluster after every CSV import:

- **Initialisation:** K-Means++ (distance-weighted seeding) for faster, more stable convergence
- **Distance metric:** cosine distance on raw embeddings (equivalent to Euclidean on L2-normalised vectors)
- **Iterations:** up to 20, stops early on convergence
- **k selection:** `k = clamp(⌊total_tickets ÷ 12⌋, 7, 20)`

### Trend detection (30-day rolling windows)

```
prev_window = tickets with created_at in [now − 60d,  now − 30d)
curr_window = tickets with created_at in [now − 30d,  now]

curr > prev × 1.25  →  "Increasing"
curr < prev × 0.75  →  "Decreasing"
otherwise           →  "Stable"
```

### Two-tier assignment

| Path | When | How |
|------|------|-----|
| **Webhook** (real-time) | Single new ticket | Cosine similarity to existing centroids, O(k) |
| **CSV upload** (batch) | Any batch import | Full K-Means re-cluster on all tickets in DB |

---

## Database Schema

```sql
tickets          (id UUID PK, ticket_id TEXT UNIQUE NOT NULL,
                  subject TEXT, description TEXT, priority TEXT,
                  ticket_type TEXT, product_area TEXT,
                  status TEXT DEFAULT 'Open', source TEXT,
                  created_at TIMESTAMPTZ, embedding VECTOR(1536))

issue_clusters   (id UUID PK, name TEXT, description TEXT,
                  ticket_count INT, prev_window_count INT,
                  curr_window_count INT, trend TEXT,
                  centroid_embedding VECTOR(1536), updated_at TIMESTAMPTZ)

cluster_members  (ticket_id UUID FK → tickets,
                  cluster_id UUID FK → issue_clusters,
                  similarity_score FLOAT,
                  PRIMARY KEY (ticket_id, cluster_id))

job_runs         (id UUID PK, job_type TEXT, status TEXT,
                  tickets_processed INT, error_message TEXT,
                  started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ)
```

**RPC functions:**
- `find_similar_tickets(embedding, threshold, count)`: cosine similarity search via HNSW
- `get_clusters_with_tickets()`: clusters with all member tickets as JSONB

---

## Frontend Structure

```
frontend/
  app/
    page.tsx                  ← Main dashboard (state, fetch, layout)
    layout.tsx
    globals.css
    api/
      clusters/               ← GET clusters · month filter · trend calc
      upload-csv/             ← POST · embed → K-Means → store (Vercel-compatible)
      webhooks/incoming-ticket/
      recluster/              ← POST · Python subprocess (non-Vercel only)
      generate-summary/
      draft-qa-alert/
      similar-tickets/
      health/
  components/
    ClusterCard.tsx           ← Cluster grid card
    DetailPanel.tsx           ← Slide-in cluster detail panel
    MetricCard.tsx            ← Summary metric cards
    CsvUploadModal.tsx        ← Drag-and-drop upload modal
    QaAlertModal.tsx          ← QA alert email modal
    AiRootCause.tsx           ← AI root-cause section
    ClusterTrendsChart.tsx    ← Area chart (Recharts)
    ClusterPieChart.tsx       ← Pie chart (Recharts)
    TrendPill.tsx             ← Trend badge + priority dot
    SkeletonCard.tsx          ← Loading skeleton
```

---

## Seed Datasets

| Script | Tickets | Description |
|--------|---------|-------------|
| `seed_kreo_data.py` | 270 | Kreo peripheral hardware support tickets (recommended) |
| `seed_tickets.py` | 80 | Generic mock support tickets |
| `seed_real_data.py` | 500 | Real Kaggle customer support dataset |
| `add_tickets.py` | +10 | Simulate new incoming tickets + re-cluster |

---

## Performance

| Operation | Before optimisation | After optimisation |
|-----------|--------------------|--------------------|
| Ticket inserts (80 rows) | 80 sequential POSTs ≈ 16 s | 8 parallel batches of 10 ≈ 1 s |
| GPT cluster naming (k=7) | 7 sequential awaits ≈ 10 s | `Promise.all` × 7 simultaneous ≈ 1.5 s |
| Cluster + member inserts | Sequential per cluster ≈ 5 s | All k in parallel ≈ 0.5 s |
| **Total CSV upload (80 rows)** | **60–90 s** | **~10–15 s** |

---

## Design Decisions & What I'd Improve

**Why K-Means with a dynamic k?**
K-Means on embeddings approximates spherical clustering, which works well for semantically distinct support categories. Dynamic k (1 cluster per ~12 tickets, clamped 7–20) avoids hand-tuning as ticket volume grows. The pure-JavaScript implementation means zero Python dependency on Vercel.

**What I'd do differently with more time:**

- **Replace K-Means with HDBSCAN.** K-Means forces every ticket into a cluster and requires specifying k upfront. HDBSCAN discovers cluster count automatically and handles outlier tickets gracefully, which suits real support queues where issues appear and disappear unpredictably.

- **Finer trend thresholds per cluster.** The current ±25% threshold is global. High-volume clusters need a larger absolute change to be meaningful; low-volume clusters are too sensitive. Per-cluster baselines with statistical significance testing (z-score on a rolling window) would reduce false trend alerts.

- **Incremental re-clustering.** Every CSV upload today triggers a full K-Means pass over all tickets. With thousands of tickets this becomes slow. An incremental approach (assign new tickets to the nearest centroid first, only re-cluster when centroid drift exceeds a threshold) would keep uploads fast regardless of DB size.

- **Persist cluster identity across re-clusters.** Each re-cluster wipes and rebuilds all clusters, so cluster UUIDs change. This breaks external references (saved links, alerts). Matching new clusters to old ones by centroid cosine similarity and preserving IDs would give stable cluster identities over time.

- **Streaming progress for large uploads.** The current API holds the connection open until all work is done. For large CSVs, streaming partial progress (Server-Sent Events or a job-poll endpoint) would make the UX feel much faster.
