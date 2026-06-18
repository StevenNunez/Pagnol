-- =============================================================================
-- Reporte Diario consolidador (cascada, Fase 2)
-- Anade consolidated_order_ids (jsonb): IDs de las OT (work_orders) que este
-- Reporte Diario consolida. El personal/equipos/materiales/actividades del PDF
-- se derivan de esas OT (decision: 100% desde las OT). Idempotente.
-- =============================================================================

ALTER TABLE public.work_reports
  ADD COLUMN IF NOT EXISTS consolidated_order_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
