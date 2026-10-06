-- =============================================================================
-- API pública v1 — Fase 2 (escritura + "¿dónde está?")
--
-- Un sistema integrado (primer cliente: Plataforma Valar) compra y es dueño
-- del gasto; Pagnol controla el activo desde que LLEGA. Por eso:
--   * Al recepcionar, el sistema integrado crea en Pagnol una unidad rastreable
--     por llamada (api_create_asset) o ingresa stock de un consumible
--     (api_stock_entry). Nada se crea antes de que llegue.
--   * Estas recepciones NO emiten hechos financieros en Pagnol: el gasto vive
--     en el sistema que compró. Así no se cuenta dos veces.
--   * Cada escritura es UNA transacción: correlativo, stock, desglose por
--     pañol (material_stocks) y kardex quedan juntos o no queda nada. La
--     invariante sum(material_stocks.qty) = materials.stock no puede romperse
--     a mitad de camino como podría pasar encadenando llamadas REST.
--   * Las funciones sólo las ejecuta el servidor (service_role): reciben el
--     tenant como parámetro, así que abiertas a `authenticated` permitirían
--     escribir en cualquier empresa.
-- =============================================================================

-- ── Columnas ────────────────────────────────────────────────────────────────
-- Ítem del catálogo desde el que se creó la unidad (la API lo expone como
-- `material_id` del Activo). Las filas anteriores quedan en NULL.
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS catalog_material_id uuid
  REFERENCES public.materials(id) ON DELETE SET NULL;
-- Referencia del sistema que originó la fila (ej. valar:recepcion:…:unidad:2).
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS external_ref text;
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS external_ref text;

-- Únicas por empresa: repetir una referencia nunca duplica un activo ni un ingreso.
CREATE UNIQUE INDEX IF NOT EXISTS uq_materials_external_ref
  ON public.materials (tenant_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_movements_external_ref
  ON public.stock_movements (tenant_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_materials_catalog
  ON public.materials (tenant_id, catalog_material_id) WHERE catalog_material_id IS NOT NULL;

-- ── Scope nuevo stock:write ─────────────────────────────────────────────────
ALTER TABLE public.api_keys DROP CONSTRAINT IF EXISTS api_keys_scopes_valid;
ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_scopes_valid CHECK (
  cardinality(scopes) > 0
  AND scopes <@ ARRAY[
    'materiales:read', 'productos:read',
    'proveedores:read', 'proveedores:write',
    'activos:read', 'activos:write',
    'stock:write',
    'webhooks:manage'
  ]::text[]
);

-- ── Idempotencia (24 h) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  api_key_id       uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  key              text NOT NULL,
  request_hash     text NOT NULL,
  response_status  integer,          -- NULL = la petición original sigue en curso
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (api_key_id, key)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created ON public.idempotency_keys (created_at);
-- Sin políticas: sólo el servidor (service_role) la toca.
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

-- ── Tipos de uso rastreables (una unidad = una fila con su QR) ──────────────
-- Debe coincidir con ACTIVO_USAGE_TYPES de src/lib/api/mappers.ts.
CREATE OR REPLACE FUNCTION public.api_is_trackable(p_usage_type text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT p_usage_type IN ('Activo Fijo', 'IT Controlado', 'Herramienta Menor', 'Reutilizable Controlado');
$$;

-- Los errores de negocio salen como 'api_error:<code>:<mensaje>'; el servidor
-- los traduce al formato de error del contrato.

-- ── Crear una unidad rastreable ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.api_create_asset(
  p_tenant_id     uuid,
  p_actor         text,          -- nombre de la API key, para el kardex
  p_template_id   uuid,          -- ítem del catálogo del que es instancia
  p_name          text,
  p_supplier_id   uuid,
  p_unit_cost     numeric,
  p_acquired_on   date,
  p_location      text,
  p_warehouse_id  uuid,
  p_external_ref  text
)
RETURNS TABLE (asset_id uuid, created boolean)
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_tpl   public.materials%ROWTYPE;
  v_id    uuid;
  v_code  text;
  v_name  text;
  v_prev  uuid;
BEGIN
  -- Idempotente por referencia: la misma unidad nunca se crea dos veces. Si la
  -- referencia ya se usó para OTRO ítem del catálogo, es un error del cliente.
  SELECT id, catalog_material_id INTO v_id, v_prev FROM public.materials
   WHERE tenant_id = p_tenant_id AND external_ref = p_external_ref;
  IF FOUND THEN
    IF v_prev IS DISTINCT FROM p_template_id THEN
      RAISE EXCEPTION 'api_error:conflict:La external_ref "%" ya se usó para otro activo.', p_external_ref;
    END IF;
    RETURN QUERY SELECT v_id, false; RETURN;
  END IF;

  SELECT * INTO v_tpl FROM public.materials
   WHERE id = p_template_id AND tenant_id = p_tenant_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'api_error:not_found:El material_id no existe en esta empresa.';
  END IF;
  IF NOT public.api_is_trackable(v_tpl.usage_type) THEN
    RAISE EXCEPTION 'api_error:validation_error:El material "%" no es rastreable: su ingreso va por POST /movimientos.', v_tpl.name;
  END IF;

  IF p_supplier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.suppliers
     WHERE id = p_supplier_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'api_error:not_found:El proveedor_id no existe en esta empresa.';
  END IF;

  IF p_warehouse_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.warehouses
     WHERE id = p_warehouse_id AND tenant_id = p_tenant_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'api_error:not_found:El panol_id no existe o no está activo en esta empresa.';
  END IF;

  v_name := COALESCE(NULLIF(trim(p_name), ''), v_tpl.name);
  v_code := public.next_internal_code(p_tenant_id, 'ACT');

  BEGIN
    INSERT INTO public.materials (
      tenant_id, name, internal_code, stock, unit, category, usage_type, criticality,
      description, brand, is_it_asset, requires_maintenance, technical_sheet_url,
      technical_sheet_name, supplier_id, unit_cost, acquisition_date, location,
      status, ownership, archived, catalog_material_id, external_ref
    ) VALUES (
      p_tenant_id, v_name, v_code, 1, v_tpl.unit, v_tpl.category, v_tpl.usage_type, v_tpl.criticality,
      v_tpl.description, v_tpl.brand, v_tpl.is_it_asset, v_tpl.requires_maintenance, v_tpl.technical_sheet_url,
      v_tpl.technical_sheet_name, p_supplier_id, p_unit_cost, p_acquired_on, NULLIF(trim(p_location), ''),
      'Disponible', 'propio', false, v_tpl.id, p_external_ref
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- Otra petición con la misma referencia ganó la carrera.
    SELECT id INTO v_id FROM public.materials
     WHERE tenant_id = p_tenant_id AND external_ref = p_external_ref;
    RETURN QUERY SELECT v_id, false; RETURN;
  END;

  -- Desglose: pool central de la empresa (sin contrato), en el pañol indicado.
  INSERT INTO public.material_stocks (tenant_id, material_id, contract_id, warehouse_id, qty)
  VALUES (p_tenant_id, v_id, NULL, p_warehouse_id, 1);

  INSERT INTO public.stock_movements (
    tenant_id, material_id, material_name, quantity_change, new_stock, type,
    justification, user_id, user_name, warehouse_id, external_ref
  ) VALUES (
    p_tenant_id, v_id, v_name, 1, 1, 'manual-entry',
    'Ingreso por integración: ' || p_external_ref, NULL, 'API: ' || p_actor, p_warehouse_id, p_external_ref
  );

  RETURN QUERY SELECT v_id, true;
END;
$$;

-- ── Ingreso de stock de un consumible, o su reverso ─────────────────────────
-- Un reverso es un movimiento NUEVO que descuenta lo ingresado (nunca se edita
-- ni se borra el original). Sale del mismo lugar al que entró; si esas
-- unidades ya se movieron, el reverso se rechaza y lo decide una persona en Pagnol.
CREATE OR REPLACE FUNCTION public.api_stock_entry(
  p_tenant_id     uuid,
  p_actor         text,
  p_kind          text,          -- 'ingreso' | 'reverso'
  p_material_id   uuid,
  p_qty           numeric,
  p_moved_at      timestamptz,
  p_warehouse_id  uuid,
  p_external_ref  text           -- ingreso: su referencia; reverso: la del ingreso a revertir
)
RETURNS TABLE (movement_id uuid, created boolean, material_id uuid, stock numeric)
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_mat    public.materials%ROWTYPE;
  v_orig   public.stock_movements%ROWTYPE;
  v_ref    text;
  v_mov    uuid;
  v_prev   uuid;
  v_stock  numeric;
  v_qty    numeric;
  v_row    public.material_stocks%ROWTYPE;
BEGIN
  IF p_kind NOT IN ('ingreso', 'reverso') THEN
    RAISE EXCEPTION 'api_error:validation_error:tipo debe ser "ingreso" o "reverso".';
  END IF;

  v_ref := CASE WHEN p_kind = 'reverso' THEN p_external_ref || '#reverso' ELSE p_external_ref END;

  -- Idempotente por referencia. Si la referencia ya se usó para OTRO
  -- material (o es la de un activo), es un error del cliente.
  SELECT sm.id, sm.material_id INTO v_mov, v_prev FROM public.stock_movements sm
   WHERE sm.tenant_id = p_tenant_id AND sm.external_ref = v_ref;
  IF FOUND THEN
    IF p_kind = 'ingreso' AND v_prev IS DISTINCT FROM p_material_id THEN
      RAISE EXCEPTION 'api_error:conflict:La external_ref "%" ya se usó para otro material.', p_external_ref;
    END IF;
    SELECT m.stock INTO v_stock FROM public.materials m WHERE m.id = v_prev;
    RETURN QUERY SELECT v_mov, false, v_prev, v_stock; RETURN;
  END IF;

  IF p_kind = 'reverso' THEN
    SELECT * INTO v_orig FROM public.stock_movements sm
     WHERE sm.tenant_id = p_tenant_id AND sm.external_ref = p_external_ref;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'api_error:not_found:No hay un ingreso con external_ref "%".', p_external_ref;
    END IF;
    IF v_orig.quantity_change <= 0 THEN
      RAISE EXCEPTION 'api_error:validation_error:La external_ref "%" no corresponde a un ingreso.', p_external_ref;
    END IF;
    IF EXISTS (SELECT 1 FROM public.materials m WHERE m.id = v_orig.material_id AND public.api_is_trackable(m.usage_type)) THEN
      RAISE EXCEPTION 'api_error:validation_error:Es un activo rastreable: para darlo de baja usa PATCH /activos/{id} con estado "de_baja".';
    END IF;
    p_material_id := v_orig.material_id;
    p_warehouse_id := v_orig.warehouse_id;
    v_qty := v_orig.quantity_change;
  ELSE
    IF p_qty IS NULL OR p_qty <= 0 THEN
      RAISE EXCEPTION 'api_error:validation_error:cantidad debe ser mayor que 0.';
    END IF;
    v_qty := p_qty;
  END IF;

  -- Bloquea el material: dos ingresos simultáneos no pueden pisarse el total.
  SELECT * INTO v_mat FROM public.materials m
   WHERE m.id = p_material_id AND m.tenant_id = p_tenant_id AND m.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'api_error:not_found:El material_id no existe en esta empresa.';
  END IF;

  IF p_kind = 'ingreso' THEN
    IF public.api_is_trackable(v_mat.usage_type) THEN
      RAISE EXCEPTION 'api_error:validation_error:El material "%" es rastreable: cada unidad se crea con POST /activos.', v_mat.name;
    END IF;
    IF v_mat.ownership IS DISTINCT FROM 'propio' THEN
      RAISE EXCEPTION 'api_error:validation_error:Sólo se puede ingresar stock a materiales propios.';
    END IF;
    IF p_warehouse_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.warehouses w
       WHERE w.id = p_warehouse_id AND w.tenant_id = p_tenant_id AND w.status = 'active'
    ) THEN
      RAISE EXCEPTION 'api_error:not_found:El panol_id no existe o no está activo en esta empresa.';
    END IF;

    INSERT INTO public.material_stocks AS ms (tenant_id, material_id, contract_id, warehouse_id, qty)
    VALUES (p_tenant_id, p_material_id, NULL, p_warehouse_id, v_qty)
    ON CONFLICT (tenant_id, material_id, contract_id, warehouse_id)
    DO UPDATE SET qty = ms.qty + EXCLUDED.qty, updated_at = now();

    v_stock := COALESCE(v_mat.stock, 0) + v_qty;
  ELSE
    -- Reverso estricto: desde la misma fila (pool central del pañol de origen).
    SELECT * INTO v_row FROM public.material_stocks ms
     WHERE ms.tenant_id = p_tenant_id AND ms.material_id = p_material_id
       AND ms.contract_id IS NULL AND ms.warehouse_id IS NOT DISTINCT FROM p_warehouse_id
     FOR UPDATE;
    IF NOT FOUND OR v_row.qty < v_qty OR COALESCE(v_mat.stock, 0) < v_qty THEN
      RAISE EXCEPTION 'api_error:conflict:No se puede revertir: parte de lo ingresado ya se entregó o se movió de lugar. Debe ajustarse en Pagnol.';
    END IF;
    UPDATE public.material_stocks SET qty = qty - v_qty, updated_at = now() WHERE id = v_row.id;
    v_stock := COALESCE(v_mat.stock, 0) - v_qty;
    v_qty := -v_qty;
  END IF;

  UPDATE public.materials SET stock = v_stock WHERE id = p_material_id;

  BEGIN
    INSERT INTO public.stock_movements (
      tenant_id, material_id, material_name, quantity_change, new_stock, type, date,
      justification, user_id, user_name, warehouse_id, external_ref
    ) VALUES (
      p_tenant_id, p_material_id, v_mat.name, v_qty, v_stock,
      CASE WHEN p_kind = 'ingreso' THEN 'manual-entry' ELSE 'adjustment' END,
      COALESCE(p_moved_at, now()),
      CASE WHEN p_kind = 'ingreso' THEN 'Ingreso por integración: ' ELSE 'Reverso de ingreso por integración: ' END || p_external_ref,
      NULL, 'API: ' || p_actor, p_warehouse_id, v_ref
    )
    RETURNING id INTO v_mov;
  EXCEPTION WHEN unique_violation THEN
    -- Carrera con la misma referencia: se deshace todo lo de esta llamada.
    RAISE EXCEPTION 'api_error:conflict:Otra petición con la misma external_ref está en curso.';
  END;

  RETURN QUERY SELECT v_mov, true, p_material_id, v_stock;
END;
$$;

-- ── Quién tiene cada activo ─────────────────────────────────────────────────
-- Misma regla que computeToolHolderMap (src/modules/core/lib/tool-loans.ts):
-- la última entrega aprobada lo deja en poder de quien lo recibió, y una
-- devolución completada lo libera. Si cambia una, cambiar la otra.
CREATE OR REPLACE FUNCTION public.api_asset_holders(p_tenant_id uuid, p_ids uuid[])
RETURNS TABLE (material_id uuid, holder_id text, holder_name text, since timestamptz)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  WITH ev AS (
    SELECT (it->>'materialId')::uuid AS mid,
           COALESCE(mr.approval_date, mr.created_at) AS t,
           'out' AS kind,
           COALESCE(mr.received_by_user_id::text,
                    CASE WHEN mr.delivery_mode = 'directed' THEN mr.beneficiary_id::text END,
                    mr.supervisor_id::text) AS hid,
           COALESCE(mr.received_by_user_name, mr.beneficiary_name, mr.supervisor_name) AS hname
      FROM public.material_requests mr
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(mr.items, '[]'::jsonb)) it
     WHERE mr.tenant_id = p_tenant_id AND mr.status = 'approved'
       AND (it->>'materialId') = ANY (SELECT unnest(p_ids)::text)
    UNION ALL
    SELECT rr.material_id, COALESCE(rr.completion_date, rr.created_at), 'in', NULL, NULL
      FROM public.return_requests rr
     WHERE rr.tenant_id = p_tenant_id AND rr.status = 'completed'
       AND rr.material_id = ANY (p_ids)
  ),
  last_ev AS (
    SELECT DISTINCT ON (mid) mid, t, kind, hid, hname
      FROM ev ORDER BY mid, t DESC
  )
  SELECT l.mid, l.hid, COALESCE(l.hname, p.name, 'Desconocido'), l.t
    FROM last_ev l
    LEFT JOIN public.profiles p ON p.id::text = l.hid
   WHERE l.kind = 'out';
$$;

-- ── Sólo el servidor ────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.api_is_trackable(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.api_create_asset(uuid, text, uuid, text, uuid, numeric, date, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.api_stock_entry(uuid, text, text, uuid, numeric, timestamptz, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.api_asset_holders(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_is_trackable(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.api_create_asset(uuid, text, uuid, text, uuid, numeric, date, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.api_stock_entry(uuid, text, text, uuid, numeric, timestamptz, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.api_asset_holders(uuid, uuid[]) TO service_role;

NOTIFY pgrst, 'reload schema';
