-- =============================================================================
-- Modulo Reportes de Trabajo - OTs del dia + matriz HH (Fase modelo de datos 1)
-- Anade la columna daily_ots (OTs trabajadas en el reporte → columnas de la
-- matriz de horas). La columna `labor` (jsonb) cambia de formato: hours pasa de
-- numero escalar a objeto {otId: horas}; no requiere cambio de columna.
-- Idempotente.
-- =============================================================================

ALTER TABLE public.work_reports
  ADD COLUMN IF NOT EXISTS daily_ots jsonb NOT NULL DEFAULT '[]'::jsonb;
