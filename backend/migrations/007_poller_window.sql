-- ==============================================================================
-- O.S.I.S. (Oil Spill Identification System)
-- Migration 007: Poller Stable Window
-- ==============================================================================
-- Description:
--   Adds `window_to_time` to `ingestion_state` to stabilize the discovery window
--   across partial poll cycles when queue saturation occurs.
-- ==============================================================================

ALTER TABLE ingestion_state
ADD COLUMN IF NOT EXISTS regions_state JSONB DEFAULT '{}'::jsonb;
