-- =============================================================================
-- API pública v1 — Fase 1 (lectura)
--
-- 1. `materials.updated_at` pasa a mantenerse solo. Hasta ahora sólo lo
--    escribían la carga masiva y el renombre de categoría: un movimiento de
--    stock no lo tocaba, así que `updated_since` se habría saltado cambios.
-- 2. `suppliers` gana `updated_at` (no existía) y borrado lógico
--    (`deleted_at`/`deleted_by`). Con el borrado físico, un sistema que
--    sincroniza por `updated_since` nunca se entera de que un proveedor se fue;
--    con el lógico, la baja llega como `activo: false`.
-- 3. `api_keys`: llaves de integración por EMPRESA (no por usuario, a
--    diferencia de `api_tokens` del MCP), con scopes. Sólo se guarda el
--    SHA-256; el texto plano se muestra una vez al crearla.
-- =============================================================================

-- ── Función genérica de updated_at ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_row_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_row_updated_at() FROM PUBLIC, anon, authenticated;

-- ── 1. materials ────────────────────────────────────────────────────────────
-- NOT NULL: el cursor ordena por updated_at y una fila con NULL quedaría fuera de toda página.
UPDATE public.materials SET updated_at = COALESCE(created_at, now()) WHERE updated_at IS NULL;
ALTER TABLE public.materials ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.materials ALTER COLUMN updated_at SET NOT NULL;

DROP TRIGGER IF EXISTS trg_materials_updated_at ON public.materials;
CREATE TRIGGER trg_materials_updated_at
  BEFORE INSERT OR UPDATE ON public.materials
  FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at();

-- Paginación por cursor (updated_at, id) dentro de la empresa.
CREATE INDEX IF NOT EXISTS idx_materials_tenant_updated
  ON public.materials (tenant_id, updated_at, id);

-- ── 2. suppliers ────────────────────────────────────────────────────────────
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS deleted_by uuid;

-- Relleno ANTES de crear el trigger (si no, el trigger pisaría el valor con now()).
UPDATE public.suppliers SET updated_at = COALESCE(created_at, now()) WHERE updated_at IS NULL;
ALTER TABLE public.suppliers ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.suppliers ALTER COLUMN updated_at SET NOT NULL;

DROP TRIGGER IF EXISTS trg_suppliers_updated_at ON public.suppliers;
CREATE TRIGGER trg_suppliers_updated_at
  BEFORE INSERT OR UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at();

CREATE INDEX IF NOT EXISTS idx_suppliers_tenant_updated
  ON public.suppliers (tenant_id, updated_at, id);

-- ── 3. api_keys ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  prefix        text NOT NULL,          -- primeros caracteres, para reconocerla en la lista
  key_hash      text NOT NULL UNIQUE,   -- SHA-256 hex del texto plano
  scopes        text[] NOT NULL,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_keys_scopes_valid CHECK (
    cardinality(scopes) > 0
    AND scopes <@ ARRAY[
      'materiales:read', 'productos:read',
      'proveedores:read', 'proveedores:write',
      'activos:read', 'activos:write',
      'webhooks:manage'
    ]::text[]
  )
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON public.api_keys (tenant_id);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- Las llaves son de la empresa: las gestiona su administración (no cualquier
-- usuario, a diferencia de los tokens personales del MCP).
DROP POLICY IF EXISTS "api_keys_select" ON public.api_keys;
CREATE POLICY "api_keys_select" ON public.api_keys FOR SELECT TO authenticated
USING (
  public.is_super_admin()
  OR (tenant_id = public.get_my_tenant_id()
      AND (public.is_tenant_admin()
           OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'soporte-pagnol')))
);

DROP POLICY IF EXISTS "api_keys_insert" ON public.api_keys;
CREATE POLICY "api_keys_insert" ON public.api_keys FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (
    public.is_super_admin()
    OR (tenant_id = public.get_my_tenant_id()
        AND (public.is_tenant_admin()
             OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'soporte-pagnol')))
  )
);

-- Sólo para revocar (revoked_at). No hay DELETE: una llave revocada queda
-- como registro de quién tuvo acceso.
DROP POLICY IF EXISTS "api_keys_update" ON public.api_keys;
CREATE POLICY "api_keys_update" ON public.api_keys FOR UPDATE TO authenticated
USING (
  public.is_super_admin()
  OR (tenant_id = public.get_my_tenant_id()
      AND (public.is_tenant_admin()
           OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'soporte-pagnol')))
);

GRANT SELECT, INSERT ON public.api_keys TO authenticated;
GRANT UPDATE (revoked_at) ON public.api_keys TO authenticated;

NOTIFY pgrst, 'reload schema';
