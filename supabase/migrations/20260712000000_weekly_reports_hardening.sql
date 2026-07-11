-- =============================================================================
-- Endurecimiento de Reportes Semanales (work_weekly_reports)
--
-- consolidated_reports_snapshot: copia congelada (jsonb) de los Diarios
-- consolidados por un Semanal, tomada al firmar como supervisor (status ->
-- 'ready'). Evita que el Semanal cambie retroactivamente si alguien reabre y
-- edita un Diario después de que el Semanal ya fue firmado — mismo patrón que
-- work_reports.consolidated_orders_snapshot (migración 20260711000000).
-- =============================================================================

ALTER TABLE public.work_weekly_reports
  ADD COLUMN IF NOT EXISTS consolidated_reports_snapshot jsonb;

NOTIFY pgrst, 'reload schema';
