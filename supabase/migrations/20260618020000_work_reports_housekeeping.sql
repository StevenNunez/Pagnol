-- =============================================================================
-- Modulo Reportes de Trabajo - Housekeeping pagina 4 (Fase modelo 7, ultima)
-- Anade housekeeping (jsonb): checklist de cumplimientos + checklist del jefe +
-- observaciones + 4 fotos de la pagina 4 del PDF SQM. Hoy build-report-data
-- entregaba la plantilla hardcodeada sin marcar. Idempotente.
-- =============================================================================

ALTER TABLE public.work_reports
  ADD COLUMN IF NOT EXISTS housekeeping jsonb;
