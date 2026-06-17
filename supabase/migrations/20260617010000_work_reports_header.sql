-- =============================================================================
-- Modulo Reportes de Trabajo - Cabecera SQM (Fase modelo de datos 2)
-- Campos del encabezado del formato (meta + jornada) que el modelo aun no tenia.
-- Idempotente.
-- =============================================================================

ALTER TABLE public.work_reports
  ADD COLUMN IF NOT EXISTS obra              text,
  ADD COLUMN IF NOT EXISTS contract_number   text,
  ADD COLUMN IF NOT EXISTS addendum_number   text,
  ADD COLUMN IF NOT EXISTS shift             text,
  ADD COLUMN IF NOT EXISTS specialty         text,
  ADD COLUMN IF NOT EXISTS emitted_by        text,
  ADD COLUMN IF NOT EXISTS emitted_by_role   text,
  ADD COLUMN IF NOT EXISTS work_schedule     text,
  ADD COLUMN IF NOT EXISTS day_night         text,
  ADD COLUMN IF NOT EXISTS lunch_start       time,
  ADD COLUMN IF NOT EXISTS restart_time      time;
