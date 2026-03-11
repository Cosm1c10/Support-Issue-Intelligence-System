-- ============================================================
-- restamp_to_march.sql
-- Run this in the Supabase SQL Editor (one paste, one run).
--
-- What it does:
--   1. Moves every ticket's created_at into March 2026
--      (random spread across Mar 1–10 so the data looks natural
--       and stays within the "current" 30-day window on March 11).
--   2. Recalculates prev_window_count / curr_window_count / trend
--      for every cluster based on the new dates.
-- ============================================================

-- ── Step 1: Restamp all tickets to March 2026 ────────────────
UPDATE tickets
SET created_at =
      '2026-03-01T00:00:00+00:00'::timestamptz
      + (random() * interval '9 days 23 hours 59 minutes');

-- ── Step 2: Recalculate cluster window counts + trend ─────────
-- Window logic mirrors seed_tickets.py:
--   curr  = tickets in the last 30 days  (Feb 9 – Mar 11)
--   prev  = tickets 30–60 days ago       (Jan 10 – Feb 9)
--   trend: >+25% → Increasing, <-25% → Decreasing, else Stable
--          (if prev = 0 and curr > 0 → Increasing)
WITH window_counts AS (
  SELECT
    cm.cluster_id,
    COUNT(*) FILTER (
      WHERE t.created_at >= NOW() - INTERVAL '30 days'
    )::int AS curr,
    COUNT(*) FILTER (
      WHERE t.created_at >= NOW() - INTERVAL '60 days'
        AND t.created_at <  NOW() - INTERVAL '30 days'
    )::int AS prev
  FROM cluster_members cm
  JOIN tickets t ON t.id = cm.ticket_id
  GROUP BY cm.cluster_id
)
UPDATE issue_clusters ic
SET
  curr_window_count = wc.curr,
  prev_window_count = wc.prev,
  trend = CASE
    WHEN wc.prev = 0
      THEN CASE WHEN wc.curr > 0 THEN 'Increasing' ELSE 'Stable' END
    WHEN (wc.curr - wc.prev)::float / wc.prev >  0.25 THEN 'Increasing'
    WHEN (wc.curr - wc.prev)::float / wc.prev < -0.25 THEN 'Decreasing'
    ELSE 'Stable'
  END,
  updated_at = NOW()
FROM window_counts wc
WHERE ic.id = wc.cluster_id;
