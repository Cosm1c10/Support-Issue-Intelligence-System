-- ============================================================
-- Migration: Add job_runs table
-- Tracks status of async background jobs (CSV upload,
-- Amazon sync, re-cluster) so the UI can show progress.
-- Run this in your Supabase SQL Editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS job_runs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type          TEXT        NOT NULL
                    CHECK (job_type IN ('recluster', 'csv_upload', 'amazon_sync', 'webhook')),
  status            TEXT        NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'success', 'failed')),
  tickets_processed INTEGER     DEFAULT 0,
  error_message     TEXT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at       TIMESTAMPTZ
);

-- Index for quick "latest job of type" lookups
CREATE INDEX IF NOT EXISTS job_runs_type_started_idx
  ON job_runs (job_type, started_at DESC);

-- RLS
ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dev_allow_all_job_runs" ON job_runs;
CREATE POLICY "dev_allow_all_job_runs"
  ON job_runs FOR ALL USING (true) WITH CHECK (true);

-- Realtime (optional — lets dashboard subscribe to job status changes)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'job_runs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE job_runs;
  END IF;
END $$;
