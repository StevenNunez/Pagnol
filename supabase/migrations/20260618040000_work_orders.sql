-- =============================================================================
-- Reportes de Trabajo - Entidad OT / Reporte de Trabajo (cascada, Fase 1)
-- Tabla `work_orders`: unidad granular que captura el supervisor por cada OT.
-- Alimenta el Reporte Diario (consolidado). Formulario rápido: info general +
-- descripcion libre + personal(nombre/cargo/horas) + equipos(equipo/horas) +
-- materiales(material/cantidad) + fotos + avance(%programado/%ejecutado).
-- RLS canonico por tenant + GRANT a authenticated. Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.work_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  ot_number         text NOT NULL DEFAULT '',
  client            text NOT NULL DEFAULT '',
  contract_number   text,
  area              text,
  location          text,
  specialty         text,
  milestone         text,
  supervisor_id     uuid,
  supervisor_name   text NOT NULL DEFAULT '',
  shift             text,
  work_schedule     text,
  work_date         date NOT NULL DEFAULT current_date,
  description       text NOT NULL DEFAULT '',
  labor             jsonb NOT NULL DEFAULT '[]'::jsonb,
  equipment         jsonb NOT NULL DEFAULT '[]'::jsonb,
  materials         jsonb NOT NULL DEFAULT '[]'::jsonb,
  photos            jsonb NOT NULL DEFAULT '[]'::jsonb,
  planned_percent   numeric NOT NULL DEFAULT 0,
  executed_percent  numeric NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'draft', -- draft | ready
  created_by        uuid,
  created_by_name   text,
  updated_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_orders_tenant ON public.work_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_date   ON public.work_orders(tenant_id, work_date);

-- ── RLS: patron canonico por tenant ──────────────────────────────────────────
ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'work_orders'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.work_orders', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY work_orders_tenant ON public.work_orders
  FOR ALL
  USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
  WITH CHECK (public.is_super_admin() OR tenant_id = public.get_my_tenant_id());

-- ── GRANTs (Data API) ─────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_orders TO authenticated;
