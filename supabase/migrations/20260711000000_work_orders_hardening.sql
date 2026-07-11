-- =============================================================================
-- Endurecimiento de OT / Reportes de Trabajo (work_orders + work_reports)
--
-- 1) work_orders.ot_number_source: distingue si el N° de OT lo generó el
--    correlativo del tenant ('auto', vía next_internal_code con entity_type
--    'OT') o lo asignó el cliente a mano ('manual', el caso histórico). El
--    campo NO cambia cómo se genera el número (eso ya lo cubre la RPC
--    genérica next_internal_code existente) — solo registra el origen para
--    que la UI bloquee la edición del campo cuando es automático.
--
-- 2) work_reports.consolidated_orders_snapshot: copia congelada (jsonb) de
--    las OT consolidadas por un Diario, tomada al enviarlo a revisión. Evita
--    que una edición posterior de la OT altere retroactivamente un Diario ya
--    firmado/aprobado. NULL mientras el Diario está en borrador.
-- =============================================================================

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS ot_number_source text NOT NULL DEFAULT 'manual';

ALTER TABLE public.work_orders
  DROP CONSTRAINT IF EXISTS work_orders_ot_number_source_check;

ALTER TABLE public.work_orders
  ADD CONSTRAINT work_orders_ot_number_source_check
  CHECK (ot_number_source IN ('auto', 'manual'));

ALTER TABLE public.work_reports
  ADD COLUMN IF NOT EXISTS consolidated_orders_snapshot jsonb;

NOTIFY pgrst, 'reload schema';
