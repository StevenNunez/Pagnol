-- ============================================================
-- Fix: columnas faltantes en tablas de seguridad (safety)
-- Todas las operaciones usan IF NOT EXISTS — seguro de re-ejecutar
-- ============================================================

-- ---- behavior_observations ----
ALTER TABLE behavior_observations
  ADD COLUMN IF NOT EXISTS feedback            TEXT,
  ADD COLUMN IF NOT EXISTS observer_signature  TEXT,
  ADD COLUMN IF NOT EXISTS worker_signature    TEXT,
  ADD COLUMN IF NOT EXISTS evidence_photo      TEXT,
  ADD COLUMN IF NOT EXISTS observer_id         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS observer_name       TEXT,
  ADD COLUMN IF NOT EXISTS risk_level          TEXT,
  ADD COLUMN IF NOT EXISTS items               JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS worker_rut          TEXT,
  ADD COLUMN IF NOT EXISTS obra                TEXT;

-- ---- assigned_checklists ----
ALTER TABLE assigned_checklists
  ADD COLUMN IF NOT EXISTS area              TEXT,
  ADD COLUMN IF NOT EXISTS observations      TEXT,
  ADD COLUMN IF NOT EXISTS evidence_photos   TEXT[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS performed_by      TEXT,
  ADD COLUMN IF NOT EXISTS completed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by       JSONB,
  ADD COLUMN IF NOT EXISTS rejection_notes   TEXT;

-- ---- safety_inspections ----
ALTER TABLE safety_inspections
  ADD COLUMN IF NOT EXISTS location              TEXT,
  ADD COLUMN IF NOT EXISTS evidence_photo_url    TEXT,
  ADD COLUMN IF NOT EXISTS evidence_photos       TEXT[]     DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS action_plan           TEXT,
  ADD COLUMN IF NOT EXISTS deadline              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completion_notes      TEXT,
  ADD COLUMN IF NOT EXISTS completion_executor   TEXT,
  ADD COLUMN IF NOT EXISTS completion_photos     TEXT[]     DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS completed_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completion_signature  TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by           JSONB,
  ADD COLUMN IF NOT EXISTS rejection_notes       TEXT;

-- ---- daily_talks ----
ALTER TABLE daily_talks
  ADD COLUMN IF NOT EXISTS foto         TEXT,
  ADD COLUMN IF NOT EXISTS asistentes   JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS temas        TEXT,
  ADD COLUMN IF NOT EXISTS firma        TEXT,
  ADD COLUMN IF NOT EXISTS expositor_id UUID,
  ADD COLUMN IF NOT EXISTS expositor_name TEXT;
