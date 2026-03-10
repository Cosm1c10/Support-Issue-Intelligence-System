-- ============================================================
-- Migration: Add `source` column to tickets table
-- Run this in your Supabase SQL Editor BEFORE running
-- sync_amazon.py or using the /api/webhooks/incoming-ticket route.
-- ============================================================

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';

-- Optional: index for filtering by source
CREATE INDEX IF NOT EXISTS tickets_source_idx ON tickets (source);
