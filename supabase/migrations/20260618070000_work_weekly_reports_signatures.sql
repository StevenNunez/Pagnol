-- =============================================================================
-- Reporte Semanal - Firmas (cascada, Fase 3)
-- Anade `signatures` (jsonb): firmas del Reporte Semanal (supervisor / jefe de
-- operaciones), cada una con imagen (data URI PNG), nombre, cargo, fecha.
-- Idempotente.
-- =============================================================================

ALTER TABLE public.work_weekly_reports
  ADD COLUMN IF NOT EXISTS signatures jsonb NOT NULL DEFAULT '[]'::jsonb;
