-- ============================================================
-- Support Ticket Issue Intelligence System
-- Supabase Schema Setup
-- Run this in your Supabase SQL Editor (in order)
-- ============================================================

-- ============================================================
-- STEP 1: Enable pgvector extension
-- ============================================================
CREATE EXTENSION IF NOT EXISTS vector;


-- ============================================================
-- STEP 2: Core Tickets Table
-- Stores ingested support tickets with their vector embeddings
-- created_at is used for trend windowing
-- ============================================================
CREATE TABLE IF NOT EXISTS tickets (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id     TEXT        UNIQUE NOT NULL,
  subject       TEXT        NOT NULL,
  description   TEXT        NOT NULL,
  priority      TEXT        CHECK (priority IN ('Low', 'Medium', 'High', 'Critical')),
  ticket_type   TEXT,
  product_area  TEXT,
  status        TEXT        DEFAULT 'Open',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- OpenAI text-embedding-3-small → 1536 dimensions
  embedding     VECTOR(1536)
);


-- ============================================================
-- STEP 3: Issue Clusters Table
-- Computed by the backend clustering job.
-- Stores cluster metadata + trend window counts.
-- ============================================================
CREATE TABLE IF NOT EXISTS issue_clusters (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT        NOT NULL,
  description         TEXT,
  ticket_count        INTEGER     DEFAULT 0,
  -- Trend: tickets in previous 30-day window vs current 30-day window
  prev_window_count   INTEGER     DEFAULT 0,
  curr_window_count   INTEGER     DEFAULT 0,
  trend               TEXT        CHECK (trend IN ('Increasing', 'Decreasing', 'Stable')) DEFAULT 'Stable',
  -- Centroid embedding (mean of all member ticket embeddings)
  centroid_embedding  VECTOR(1536),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- STEP 4: Cluster Members Junction Table
-- Many-to-many: each ticket belongs to one primary cluster
-- ============================================================
CREATE TABLE IF NOT EXISTS cluster_members (
  ticket_id         UUID    REFERENCES tickets(id) ON DELETE CASCADE,
  cluster_id        UUID    REFERENCES issue_clusters(id) ON DELETE CASCADE,
  similarity_score  FLOAT   DEFAULT 1.0,
  PRIMARY KEY (ticket_id, cluster_id)
);


-- ============================================================
-- STEP 5: HNSW Index for fast cosine similarity search
-- HNSW (Hierarchical Navigable Small World) outperforms IVFFlat
-- on small-to-medium datasets (< 100k rows). No training needed.
-- ============================================================
CREATE INDEX IF NOT EXISTS tickets_embedding_hnsw_idx
  ON tickets USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);


-- ============================================================
-- STEP 6: Helper RPC — vector similarity search
-- Called by the clustering engine to find nearest neighbours
-- ============================================================
CREATE OR REPLACE FUNCTION find_similar_tickets(
  query_embedding   VECTOR(1536),
  match_threshold   FLOAT   DEFAULT 0.60,
  match_count       INT     DEFAULT 10
)
RETURNS TABLE (
  id            UUID,
  ticket_id     TEXT,
  subject       TEXT,
  description   TEXT,
  priority      TEXT,
  ticket_type   TEXT,
  product_area  TEXT,
  created_at    TIMESTAMPTZ,
  similarity    FLOAT
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    t.id,
    t.ticket_id,
    t.subject,
    t.description,
    t.priority,
    t.ticket_type,
    t.product_area,
    t.created_at,
    1 - (t.embedding <=> query_embedding) AS similarity
  FROM tickets t
  WHERE t.embedding IS NOT NULL
    AND 1 - (t.embedding <=> query_embedding) > match_threshold
  ORDER BY t.embedding <=> query_embedding
  LIMIT match_count;
$$;


-- ============================================================
-- STEP 7: RPC — clusters with their associated tickets
-- Used by the Next.js dashboard API route
-- ============================================================
CREATE OR REPLACE FUNCTION get_clusters_with_tickets()
RETURNS TABLE (
  id                  UUID,
  name                TEXT,
  description         TEXT,
  ticket_count        INTEGER,
  prev_window_count   INTEGER,
  curr_window_count   INTEGER,
  trend               TEXT,
  updated_at          TIMESTAMPTZ,
  example_tickets     JSONB
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    ic.id,
    ic.name,
    ic.description,
    ic.ticket_count,
    ic.prev_window_count,
    ic.curr_window_count,
    ic.trend,
    ic.updated_at,
    COALESCE(
      JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'id',           t.id,
          'ticket_id',    t.ticket_id,
          'subject',      t.subject,
          'description',  t.description,
          'priority',     t.priority,
          'product_area', t.product_area,
          'created_at',   t.created_at
        )
        ORDER BY cm.similarity_score DESC
      ) FILTER (WHERE t.id IS NOT NULL),
      '[]'::JSONB
    ) AS example_tickets
  FROM issue_clusters ic
  LEFT JOIN cluster_members cm  ON cm.cluster_id = ic.id
  LEFT JOIN tickets t           ON t.id = cm.ticket_id
  GROUP BY
    ic.id, ic.name, ic.description, ic.ticket_count,
    ic.prev_window_count, ic.curr_window_count, ic.trend, ic.updated_at
  ORDER BY ic.ticket_count DESC;
$$;


-- ============================================================
-- STEP 8: Row Level Security (permissive for development)
-- In production you would scope these policies to authenticated users.
-- ============================================================
ALTER TABLE tickets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_clusters  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cluster_members ENABLE ROW LEVEL SECURITY;

-- Drop existing policies before (re)creating to keep idempotent
DROP POLICY IF EXISTS "dev_allow_all_tickets"          ON tickets;
DROP POLICY IF EXISTS "dev_allow_all_issue_clusters"   ON issue_clusters;
DROP POLICY IF EXISTS "dev_allow_all_cluster_members"  ON cluster_members;

CREATE POLICY "dev_allow_all_tickets"
  ON tickets FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "dev_allow_all_issue_clusters"
  ON issue_clusters FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "dev_allow_all_cluster_members"
  ON cluster_members FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- STEP 9: Enable Supabase Realtime for all tables
-- Allows the Next.js dashboard to subscribe to live changes
-- ============================================================
DO $$
BEGIN
  -- tickets
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'tickets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE tickets;
  END IF;

  -- issue_clusters
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'issue_clusters'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE issue_clusters;
  END IF;

  -- cluster_members
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'cluster_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE cluster_members;
  END IF;
END $$;


-- ============================================================
-- DONE — run `python backend/scripts/seed_tickets.py` next
-- ============================================================
