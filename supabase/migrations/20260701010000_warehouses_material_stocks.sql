-- =============================================================================
-- FASE 0 — Activos por Contrato y Pañol
-- =============================================================================
-- PROBLEMA (caso Valar): el stock de `materials` es un único número global por
-- tenant. Al comprar 10 cascos "para contrato Torres" entran al total de la
-- empresa y se pierde a qué contrato pertenecen; la entrega tampoco descuenta
-- del contrato correcto.
--
-- MODELO:
--   warehouses           → pañoles físicos (un pañol puede atender 1..N contratos)
--   warehouse_contracts  → N:M pañol ↔ contrato
--   material_stocks      → desglose de existencias: material × contrato × pañol.
--                          contract_id NULL  = pool central de la empresa.
--                          warehouse_id NULL = sin pañol asignado (transición).
--                          `materials.stock` sigue siendo el TOTAL (suma del
--                          desglose); las mutaciones de Fase 1 mantienen ambos.
--
-- Además el kardex (`stock_movements`) y las devoluciones (`return_requests`)
-- ganan la dimensión contrato/pañol para trazabilidad ("salió 1 casco de Torres").
--
-- BACKFILL: todo el stock existente queda como pool central (contract_id NULL);
-- se reparte después con la acción de transferencia (Fase 1).
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

-- ── 1) Pañoles ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.warehouses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  name         text NOT NULL,
  location     text,
  manager_id   uuid,          -- encargado (panolero) → profiles.id
  manager_name text,          -- denormalizado para listados
  status       text NOT NULL DEFAULT 'active',  -- active | inactive
  notes        text,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_warehouses_tenant ON public.warehouses(tenant_id);

-- ── 2) Contratos que atiende cada pañol (N:M) ────────────────────────────────
-- Cubre ambos escenarios: "un pañol para dos contratos" y "un pañol por contrato".
CREATE TABLE IF NOT EXISTS public.warehouse_contracts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  contract_id  uuid NOT NULL REFERENCES public.contracts(id)  ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, contract_id)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_contracts_tenant   ON public.warehouse_contracts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_contracts_contract ON public.warehouse_contracts(tenant_id, contract_id);

-- ── 3) Desglose de existencias (ledger) ──────────────────────────────────────
-- Una fila por combinación material × contrato × pañol. La ficha del material
-- sigue siendo única; esto solo dice DÓNDE están sus unidades.
CREATE TABLE IF NOT EXISTS public.material_stocks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  material_id  uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  contract_id  uuid REFERENCES public.contracts(id)  ON DELETE RESTRICT, -- NULL = pool central
  warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE RESTRICT, -- NULL = sin pañol
  qty          numeric NOT NULL DEFAULT 0 CHECK (qty >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
-- ON DELETE RESTRICT es deliberado: para eliminar un contrato/pañol primero hay
-- que transferir sus existencias (evita que stock asignado desaparezca en silencio).

-- Unicidad de la combinación tratando NULL como valor (PG15+): garantiza una
-- sola fila de "pool central" por material y habilita upserts deterministas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_material_stocks_dim
  ON public.material_stocks (tenant_id, material_id, contract_id, warehouse_id)
  NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_material_stocks_material  ON public.material_stocks(tenant_id, material_id);
CREATE INDEX IF NOT EXISTS idx_material_stocks_contract  ON public.material_stocks(tenant_id, contract_id);
CREATE INDEX IF NOT EXISTS idx_material_stocks_warehouse ON public.material_stocks(tenant_id, warehouse_id);

-- ── 4) Dimensión contrato/pañol en kardex y devoluciones ─────────────────────
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS contract_id   uuid,
  ADD COLUMN IF NOT EXISTS contract_name text,
  ADD COLUMN IF NOT EXISTS warehouse_id  uuid;

CREATE INDEX IF NOT EXISTS idx_stock_movements_contract
  ON public.stock_movements(tenant_id, contract_id);

-- La devolución debe reingresar al contrato del que salió.
ALTER TABLE public.return_requests
  ADD COLUMN IF NOT EXISTS contract_id   uuid,
  ADD COLUMN IF NOT EXISTS contract_name text;

-- FKs sueltas (ON DELETE SET NULL): el historial persiste aunque se borre el
-- contrato/pañol; solo pierde el vínculo. Guardadas por nombre (idempotencia).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_contract_id_fkey') THEN
    ALTER TABLE public.stock_movements
      ADD CONSTRAINT stock_movements_contract_id_fkey
      FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_warehouse_id_fkey') THEN
    ALTER TABLE public.stock_movements
      ADD CONSTRAINT stock_movements_warehouse_id_fkey
      FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'return_requests_contract_id_fkey') THEN
    ALTER TABLE public.return_requests
      ADD CONSTRAINT return_requests_contract_id_fkey
      FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 5) updated_at ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_row_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_warehouses_updated_at ON public.warehouses;
CREATE TRIGGER trg_warehouses_updated_at
BEFORE UPDATE ON public.warehouses
FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at();

DROP TRIGGER IF EXISTS trg_material_stocks_updated_at ON public.material_stocks;
CREATE TRIGGER trg_material_stocks_updated_at
BEFORE UPDATE ON public.material_stocks
FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at();

-- ── 6) RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.warehouses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_stocks     ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t   text;
  pol record;
BEGIN
  FOREACH t IN ARRAY ARRAY['warehouses', 'warehouse_contracts', 'material_stocks']
  LOOP
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
      FOR ALL
      USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
      WITH CHECK (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
    $f$, t || '_tenant', t);
  END LOOP;
END $$;

-- ── 7) GRANTs (Data API) ──────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.warehouses, public.warehouse_contracts, public.material_stocks
  TO authenticated;

-- ── 8) Realtime ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['warehouses', 'warehouse_contracts', 'material_stocks']
    LOOP
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
      BEGIN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      EXCEPTION WHEN duplicate_object THEN NULL;
      END;
    END LOOP;
  END IF;
END $$;

-- ── 9) Backfill: stock existente → pool central ───────────────────────────────
-- Cada material con stock queda con UNA fila (contrato NULL, pañol NULL).
-- GREATEST(...,0) por si hubiera stocks negativos históricos (el CHECK los rechazaría).
INSERT INTO public.material_stocks (tenant_id, material_id, contract_id, warehouse_id, qty)
SELECT m.tenant_id, m.id, NULL, NULL, GREATEST(m.stock, 0)
FROM public.materials m
WHERE COALESCE(m.stock, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.material_stocks ms
    WHERE ms.material_id = m.id
      AND ms.contract_id IS NULL
      AND ms.warehouse_id IS NULL
  );

NOTIFY pgrst, 'reload schema';
