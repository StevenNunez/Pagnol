-- =============================================================================
-- F4 — Control de Costos: Centros de Costo (entidad propia) + imputación de OC
-- `cost_centers` es una entidad independiente con ciclo de vida y presupuesto
-- propios (NO reutiliza Contract/WorkItem). La imputación del gasto se hace a
-- nivel de Orden de Compra: `purchase_orders.cost_center_id`. El "ejecutado" se
-- deriva sumando el total de las OC imputadas (comprometido) y el de las OC ya
-- recibidas/completadas. Así se compara presupuesto vs. ejecutado sin tocar los
-- módulos legacy.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.cost_centers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  code             text NOT NULL,
  name             text NOT NULL DEFAULT '',
  type             text NOT NULL DEFAULT 'Operaciones', -- Operaciones|Mantención|Ingeniería|TI|Administración|Abastecimiento
  budget           numeric NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'active',      -- active | closed
  responsible_id   uuid,
  responsible_name text,
  start_date       date,
  end_date         date,
  notes            text,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_cost_centers_tenant ON public.cost_centers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cost_centers_status ON public.cost_centers(tenant_id, status);

CREATE OR REPLACE FUNCTION public.set_cost_centers_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cost_centers_updated_at ON public.cost_centers;
CREATE TRIGGER trg_cost_centers_updated_at
BEFORE UPDATE ON public.cost_centers
FOR EACH ROW
EXECUTE FUNCTION public.set_cost_centers_updated_at();

ALTER TABLE public.cost_centers ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cost_centers'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.cost_centers', pol.policyname);
  END LOOP;

  EXECUTE $policy$
    CREATE POLICY cost_centers_tenant ON public.cost_centers
    FOR ALL
    USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
    WITH CHECK (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
  $policy$;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_centers TO authenticated;

-- ---------------------------------------------------------------------------
-- Imputación: la Orden de Compra apunta a un Centro de Costo.
-- ---------------------------------------------------------------------------
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS cost_center_id uuid;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_cost_center
  ON public.purchase_orders(tenant_id, cost_center_id);
