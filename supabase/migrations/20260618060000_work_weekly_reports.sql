-- =============================================================================
-- Reportes de Trabajo - Reporte Semanal (cascada, Fase 3)
-- Tabla `work_weekly_reports`: consolida varios Reportes Diarios (work_reports)
-- en un rango de fechas. Resumen automatico (HH totales, OT, por dia) + entrega
-- de turno / observaciones de la semana. consolidated_report_ids = IDs de los
-- diarios que agrupa. RLS canonico por tenant + GRANT a authenticated. Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.work_weekly_reports (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL,
  title                   text NOT NULL DEFAULT '',
  client                  text NOT NULL DEFAULT '',
  faena                   text NOT NULL DEFAULT '',
  obra                    text,
  contract_number         text,
  area                    text,
  specialty               text,
  supervisor_id           uuid,
  supervisor_name         text NOT NULL DEFAULT '',
  start_date              date NOT NULL DEFAULT current_date,
  end_date                date NOT NULL DEFAULT current_date,
  consolidated_report_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  observations            text,
  shift_handover          text,
  status                  text NOT NULL DEFAULT 'draft', -- draft | ready
  created_by              uuid,
  created_by_name         text,
  updated_by              uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_weekly_reports_tenant ON public.work_weekly_reports(tenant_id);
CREATE INDEX IF NOT EXISTS idx_work_weekly_reports_range  ON public.work_weekly_reports(tenant_id, start_date, end_date);

-- ── RLS: patron canonico por tenant ──────────────────────────────────────────
ALTER TABLE public.work_weekly_reports ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'work_weekly_reports'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.work_weekly_reports', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY work_weekly_reports_tenant ON public.work_weekly_reports
  FOR ALL
  USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
  WITH CHECK (public.is_super_admin() OR tenant_id = public.get_my_tenant_id());

-- ── GRANTs (Data API) ─────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_weekly_reports TO authenticated;
