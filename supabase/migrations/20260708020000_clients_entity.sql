-- =============================================================================
-- Entidad CLIENTE — jerarquía Valar: Empresa (tenant) → Cliente → Contratos
--
-- Hasta ahora el cliente era un string suelto (`contracts.client_name`), así
-- que no se podía filtrar por cliente ni colgar varios contratos del mismo
-- cliente de forma estructurada. Esta migración:
--   1) Crea la tabla `clients` (por tenant).
--   2) Añade `contracts.client_id` (FK, ON DELETE SET NULL).
--   3) BACKFILL: crea un cliente por cada `client_name` distinto ya existente
--      y enlaza sus contratos (no se pierde nada; client_name se conserva
--      como columna legacy de solo-lectura).
--   4) RLS por tenant + GRANTs + Realtime (mismo patrón que warehouses).
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

-- ── 1) Tabla clients ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  name          text NOT NULL,
  rut           text,
  contact_name  text,
  contact_email text,
  contact_phone text,
  notes         text,
  status        text NOT NULL DEFAULT 'active',  -- active | inactive
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS clients_tenant_idx ON public.clients (tenant_id);

-- ── 2) contracts.client_id ───────────────────────────────────────────────────
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS contracts_client_idx ON public.contracts (client_id);

-- ── 3) Backfill desde client_name ────────────────────────────────────────────
-- Un cliente por cada (tenant, client_name) distinto no vacío.
INSERT INTO public.clients (tenant_id, name)
SELECT DISTINCT c.tenant_id, trim(c.client_name)
FROM public.contracts c
WHERE c.client_name IS NOT NULL
  AND trim(c.client_name) <> ''
ON CONFLICT (tenant_id, name) DO NOTHING;

-- Enlazar los contratos existentes a su cliente.
UPDATE public.contracts c
SET client_id = cl.id
FROM public.clients cl
WHERE c.client_id IS NULL
  AND c.client_name IS NOT NULL
  AND trim(c.client_name) <> ''
  AND cl.tenant_id = c.tenant_id
  AND cl.name = trim(c.client_name);

-- ── 4) RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clients_tenant ON public.clients;
CREATE POLICY clients_tenant ON public.clients
  FOR ALL
  USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
  WITH CHECK (public.is_super_admin() OR tenant_id = public.get_my_tenant_id());

-- ── 5) GRANTs (Data API) ─────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;

-- ── 6) Realtime ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER TABLE public.clients REPLICA IDENTITY FULL;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.clients;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;
