-- =============================================================================
-- Modulo Reportes de Trabajo - Actividades estructuradas (Fase modelo de datos 3)
-- Anade structured_activities (jsonb): reemplaza el textarea libre `activities`
-- por filas con descripcion/area/unidad/cantidad/programado/ot/avance que
-- alimentan la tabla de actividades del PDF SQM. La columna `activities` (text)
-- se conserva como fallback para reportes antiguos. Idempotente.
-- =============================================================================

ALTER TABLE public.work_reports
  ADD COLUMN IF NOT EXISTS structured_activities jsonb NOT NULL DEFAULT '[]'::jsonb;
