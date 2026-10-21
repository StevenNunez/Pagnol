-- ════════════════════════════════════════════════════════════════════════════
-- Compras esperadas (Fase 5 · A): lo que el sistema que compra anuncia y viene en camino
--
-- Contrato: docs/integracion-pagnol-valar.md § Fase 5 (propuesta del 2026-10-21).
--
--   · `tenants.receiving_mode` = DÓNDE se recibe: 'externa' (como hasta hoy: el sistema
--     que compra informa la recepción con POST /activos y /movimientos) o 'pagnol'
--     (el pañolero recibe en Pagnol lo que se anunció). NUNCA los dos.
--   · `expected_purchases` + `expected_purchase_lines`: la compra anunciada. No es una
--     orden de compra de Pagnol y NO genera gasto (el gasto vive en quien compró).
--   · El estado de una línea (esperada / parcial / recibida / cancelada) se DERIVA de sus
--     recepciones (llegan en la fase B); acá sólo hay `esperada` y `cancelada`.
--
-- Las escrituras de la API van por funciones (una transacción cada una) que sólo
-- ejecuta service_role y que reciben el tenant de la llave.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Modo de recepción por empresa ────────────────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS receiving_mode text NOT NULL DEFAULT 'externa';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_receiving_mode_check') THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_receiving_mode_check CHECK (receiving_mode IN ('externa', 'pagnol'));
  END IF;
END $$;

-- ── Scopes nuevos de la API ──────────────────────────────────────────────────
ALTER TABLE public.api_keys DROP CONSTRAINT IF EXISTS api_keys_scopes_valid;
ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_scopes_valid CHECK (
  cardinality(scopes) > 0
  AND scopes <@ ARRAY[
    'materiales:read', 'productos:read',
    'proveedores:read', 'proveedores:write',
    'activos:read', 'activos:write',
    'stock:write',
    'compras:read', 'compras:write',
    'webhooks:manage'
  ]::text[]
);

-- ── Tablas ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.expected_purchases (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- La OC del sistema que compra. Única por empresa: repetirla no crea otra compra.
  external_ref   text NOT NULL CHECK (length(btrim(external_ref)) > 0),
  supplier_id    uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  warehouse_id   uuid NOT NULL REFERENCES public.warehouses(id),
  estimated_date date,
  -- Referencia de contrato del sistema que compra: TEXTO libre, no es un contrato de Pagnol.
  contract_ref   text,
  canceled_at    timestamptz,
  -- Nombre de la llave de API que la anunció (queda para auditoría).
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_expected_purchases_ref ON public.expected_purchases (tenant_id, external_ref);
CREATE INDEX IF NOT EXISTS idx_expected_purchases_tenant_updated ON public.expected_purchases (tenant_id, updated_at, id);
CREATE INDEX IF NOT EXISTS idx_expected_purchases_warehouse ON public.expected_purchases (tenant_id, warehouse_id);

CREATE TABLE IF NOT EXISTS public.expected_purchase_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  purchase_id   uuid NOT NULL REFERENCES public.expected_purchases(id) ON DELETE CASCADE,
  -- BASE de la línea en el sistema que compra; de ella salen las referencias de lo que se cree al recibir.
  external_ref  text NOT NULL CHECK (length(btrim(external_ref)) > 0),
  -- Ítem del catálogo (no una unidad ya creada).
  material_id   uuid NOT NULL REFERENCES public.materials(id),
  expected_qty  numeric NOT NULL CHECK (expected_qty > 0),
  canceled_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_expected_purchase_lines_ref ON public.expected_purchase_lines (tenant_id, external_ref);
CREATE INDEX IF NOT EXISTS idx_expected_purchase_lines_purchase ON public.expected_purchase_lines (purchase_id);

DROP TRIGGER IF EXISTS trg_expected_purchases_updated_at ON public.expected_purchases;
CREATE TRIGGER trg_expected_purchases_updated_at
  BEFORE INSERT OR UPDATE ON public.expected_purchases
  FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at();
DROP TRIGGER IF EXISTS trg_expected_purchase_lines_updated_at ON public.expected_purchase_lines;
CREATE TRIGGER trg_expected_purchase_lines_updated_at
  BEFORE INSERT OR UPDATE ON public.expected_purchase_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at();

-- Un cambio en una línea cuenta como cambio de su compra (para el cursor de la API).
CREATE OR REPLACE FUNCTION public.expected_purchase_line_touch_parent()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
BEGIN
  UPDATE public.expected_purchases SET updated_at = now()
   WHERE id = COALESCE(NEW.purchase_id, OLD.purchase_id);
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.expected_purchase_line_touch_parent() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_expected_purchase_lines_touch ON public.expected_purchase_lines;
CREATE TRIGGER trg_expected_purchase_lines_touch
  AFTER INSERT OR UPDATE ON public.expected_purchase_lines
  FOR EACH ROW EXECUTE FUNCTION public.expected_purchase_line_touch_parent();

-- ── RLS: el pañolero las ve (lista «Por recibir»); escribir sólo la API ──────
ALTER TABLE public.expected_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expected_purchase_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expected_purchases_select" ON public.expected_purchases;
CREATE POLICY "expected_purchases_select" ON public.expected_purchases
  FOR SELECT USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id());
DROP POLICY IF EXISTS "expected_purchase_lines_select" ON public.expected_purchase_lines;
CREATE POLICY "expected_purchase_lines_select" ON public.expected_purchase_lines
  FOR SELECT USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id());

GRANT SELECT ON public.expected_purchases, public.expected_purchase_lines TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.expected_purchases, public.expected_purchase_lines FROM authenticated;

-- ── ¿Hay líneas abiertas? (impide cambiar el modo de recepción a mitad de una compra) ──
-- Fase A: toda línea no cancelada de una compra no cancelada está abierta. La fase B la
-- redefine descontando lo ya recibido por completo.
CREATE OR REPLACE FUNCTION public.expected_purchase_open_lines(p_tenant uuid)
RETURNS integer LANGUAGE sql STABLE SET search_path = public, extensions AS $$
  SELECT count(*)::int
  FROM public.expected_purchase_lines l
  JOIN public.expected_purchases p ON p.id = l.purchase_id
  WHERE l.tenant_id = p_tenant AND l.canceled_at IS NULL AND p.canceled_at IS NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.expected_purchase_open_lines(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tenants_guard_receiving_mode()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE n int;
BEGIN
  IF NEW.receiving_mode IS DISTINCT FROM OLD.receiving_mode THEN
    n := public.expected_purchase_open_lines(OLD.id);
    IF n > 0 THEN
      RAISE EXCEPTION 'No se puede cambiar dónde se recibe: hay % línea(s) de compras esperadas sin cerrar. Ciérralas o cancélalas primero.', n
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_tenants_guard_receiving_mode ON public.tenants;
CREATE TRIGGER trg_tenants_guard_receiving_mode
  BEFORE UPDATE OF receiving_mode ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.tenants_guard_receiving_mode();

-- ── Crear una compra esperada (una transacción) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.api_create_expected_purchase(
  p_tenant_id     uuid,
  p_actor         text,
  p_external_ref  text,
  p_supplier_id   uuid,
  p_warehouse_id  uuid,
  p_date          date,
  p_contract_ref  text,
  p_lines         jsonb          -- [{ external_ref, material_id, cantidad }]
)
RETURNS TABLE (purchase_id uuid, created boolean)
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_mode text;
  v_id   uuid;
  l      jsonb;
  v_mat  public.materials%ROWTYPE;
  v_qty  numeric;
BEGIN
  SELECT receiving_mode INTO v_mode FROM public.tenants WHERE id = p_tenant_id;
  IF v_mode IS DISTINCT FROM 'pagnol' THEN
    RAISE EXCEPTION 'api_error:conflict:Esta empresa recibe en su sistema de compras (recepcion = externa); las compras esperadas sólo se anuncian cuando la recepción es en Pagnol.';
  END IF;

  -- Idempotente por referencia: repetirla devuelve la compra existente, sin tocarla.
  -- Para corregirla se usa PATCH.
  SELECT id INTO v_id FROM public.expected_purchases
   WHERE tenant_id = p_tenant_id AND external_ref = p_external_ref;
  IF FOUND THEN
    RETURN QUERY SELECT v_id, false; RETURN;
  END IF;

  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'api_error:validation_error:La compra debe traer al menos una línea.';
  END IF;
  IF (SELECT count(DISTINCT e->>'external_ref') FROM jsonb_array_elements(p_lines) e) <> jsonb_array_length(p_lines) THEN
    RAISE EXCEPTION 'api_error:validation_error:Las líneas no pueden repetir external_ref.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = p_warehouse_id AND tenant_id = p_tenant_id AND status = 'active') THEN
    RAISE EXCEPTION 'api_error:not_found:El panol_id no existe o no está activo en esta empresa.';
  END IF;
  IF p_supplier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.suppliers WHERE id = p_supplier_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'api_error:not_found:El proveedor_id no existe en esta empresa.';
  END IF;

  -- Todo se valida ANTES de escribir nada.
  FOR l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := (l->>'cantidad')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'api_error:validation_error:La cantidad de la línea "%" debe ser mayor que cero.', l->>'external_ref';
    END IF;
    SELECT * INTO v_mat FROM public.materials
     WHERE id = (l->>'material_id')::uuid AND tenant_id = p_tenant_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'api_error:not_found:El material_id de la línea "%" no existe en esta empresa.', l->>'external_ref';
    END IF;
    IF v_mat.catalog_material_id IS NOT NULL OR v_mat.ownership IS DISTINCT FROM 'propio' OR COALESCE(v_mat.archived, false) THEN
      RAISE EXCEPTION 'api_error:validation_error:"%" no es un ítem comprable del catálogo (es una unidad ya creada, un equipo arrendado o un ítem archivado).', v_mat.name;
    END IF;
    IF EXISTS (SELECT 1 FROM public.expected_purchase_lines WHERE tenant_id = p_tenant_id AND external_ref = l->>'external_ref') THEN
      RAISE EXCEPTION 'api_error:conflict:La external_ref de línea "%" ya se usó en otra compra.', l->>'external_ref';
    END IF;
  END LOOP;

  BEGIN
    INSERT INTO public.expected_purchases (tenant_id, external_ref, supplier_id, warehouse_id, estimated_date, contract_ref, created_by)
    VALUES (p_tenant_id, p_external_ref, p_supplier_id, p_warehouse_id, p_date, NULLIF(btrim(p_contract_ref), ''), p_actor)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_id FROM public.expected_purchases WHERE tenant_id = p_tenant_id AND external_ref = p_external_ref;
    RETURN QUERY SELECT v_id, false; RETURN;
  END;

  INSERT INTO public.expected_purchase_lines (tenant_id, purchase_id, external_ref, material_id, expected_qty)
  SELECT p_tenant_id, v_id, e->>'external_ref', (e->>'material_id')::uuid, (e->>'cantidad')::numeric
  FROM jsonb_array_elements(p_lines) e;

  RETURN QUERY SELECT v_id, true;
END;
$$;

-- ── Corregir o cancelar ──────────────────────────────────────────────────────
--   p_patch admite: fecha_estimada, panol_id, contrato_ref, cancelar (true),
--                   lineas: [{ external_ref, cantidad?, cancelar? }]
--   La presencia de la clave decide si se toca (un null explícito borra el valor).
CREATE OR REPLACE FUNCTION public.api_patch_expected_purchase(
  p_tenant_id uuid,
  p_id        uuid,
  p_patch     jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_p   public.expected_purchases%ROWTYPE;
  l     jsonb;
  v_qty numeric;
  n     int;
BEGIN
  SELECT * INTO v_p FROM public.expected_purchases WHERE id = p_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'api_error:not_found:Compra esperada no encontrada.';
  END IF;
  IF v_p.canceled_at IS NOT NULL THEN
    RAISE EXCEPTION 'api_error:conflict:La compra está cancelada; no se puede modificar.';
  END IF;

  IF p_patch ? 'panol_id' THEN
    IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = (p_patch->>'panol_id')::uuid AND tenant_id = p_tenant_id AND status = 'active') THEN
      RAISE EXCEPTION 'api_error:not_found:El panol_id no existe o no está activo en esta empresa.';
    END IF;
    v_p.warehouse_id := (p_patch->>'panol_id')::uuid;
  END IF;
  IF p_patch ? 'fecha_estimada' THEN v_p.estimated_date := NULLIF(p_patch->>'fecha_estimada', '')::date; END IF;
  IF p_patch ? 'contrato_ref' THEN v_p.contract_ref := NULLIF(btrim(p_patch->>'contrato_ref'), ''); END IF;

  UPDATE public.expected_purchases
     SET warehouse_id = v_p.warehouse_id, estimated_date = v_p.estimated_date, contract_ref = v_p.contract_ref
   WHERE id = p_id;

  IF p_patch ? 'lineas' THEN
    FOR l IN SELECT * FROM jsonb_array_elements(p_patch->'lineas') LOOP
      IF NOT EXISTS (SELECT 1 FROM public.expected_purchase_lines
                      WHERE purchase_id = p_id AND external_ref = l->>'external_ref') THEN
        RAISE EXCEPTION 'api_error:not_found:La línea "%" no pertenece a esta compra.', l->>'external_ref';
      END IF;
      IF l ? 'cantidad' THEN
        v_qty := (l->>'cantidad')::numeric;
        IF v_qty IS NULL OR v_qty <= 0 THEN
          RAISE EXCEPTION 'api_error:validation_error:La cantidad de la línea "%" debe ser mayor que cero.', l->>'external_ref';
        END IF;
        UPDATE public.expected_purchase_lines SET expected_qty = v_qty
         WHERE purchase_id = p_id AND external_ref = l->>'external_ref' AND canceled_at IS NULL;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n = 0 THEN
          RAISE EXCEPTION 'api_error:conflict:La línea "%" está cancelada; no se puede cambiar su cantidad.', l->>'external_ref';
        END IF;
      END IF;
      IF COALESCE((l->>'cancelar')::boolean, false) THEN
        UPDATE public.expected_purchase_lines SET canceled_at = COALESCE(canceled_at, now())
         WHERE purchase_id = p_id AND external_ref = l->>'external_ref';
      END IF;
    END LOOP;
  END IF;

  IF COALESCE((p_patch->>'cancelar')::boolean, false) THEN
    UPDATE public.expected_purchase_lines SET canceled_at = COALESCE(canceled_at, now()) WHERE purchase_id = p_id;
    UPDATE public.expected_purchases SET canceled_at = now() WHERE id = p_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.api_create_expected_purchase(uuid, text, text, uuid, uuid, date, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.api_patch_expected_purchase(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_create_expected_purchase(uuid, text, text, uuid, uuid, date, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.api_patch_expected_purchase(uuid, uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
