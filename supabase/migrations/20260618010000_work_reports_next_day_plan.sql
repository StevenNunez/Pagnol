-- =============================================================================
-- Modulo Reportes de Trabajo - Programacion dia siguiente (Fase modelo 6)
-- Anade next_day_plan (jsonb): filas descripcion/area/equipos/herramienta que
-- alimentan la tabla "Programacion dia siguiente" de la pagina 3 del PDF SQM
-- (hoy se renderiza vacia). Todo texto libre. Idempotente.
-- =============================================================================

ALTER TABLE public.work_reports
  ADD COLUMN IF NOT EXISTS next_day_plan jsonb NOT NULL DEFAULT '[]'::jsonb;
