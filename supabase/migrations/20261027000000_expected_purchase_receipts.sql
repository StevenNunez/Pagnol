-- ════════════════════════════════════════════════════════════════════════════
-- Compras esperadas (Fase 5 · B): el pañolero recibe en Pagnol
--
-- Contrato: docs/integracion-pagnol-valar.md § Fase 5 (acordado con Valar el 2026-10-21).
--
--   · Una RECEPCIÓN es un hecho inmutable (cabecera: guía, fecha, quién; líneas: cuánto).
--     Lo recibido por línea y su estado (esperada / parcial / recibida) se DERIVAN de ellas.
--   · Al recibir, en UNA transacción: se crea el activo por unidad (ítem rastreable) o el
--     ingreso de stock (consumible) con la referencia acordada —`<base de la línea>:unidad:<n>` /
--     `<base>:recepcion:<k>`—, se anota la recepción y se avisa a Valar (`compra.recibida`).
--     Lo que entra no genera gasto en Pagnol.
--   · No se acepta recibir más de lo esperado. La guía es obligatoria y única por (proveedor, número).
--   · Sólo funciona si la empresa recibe en Pagnol (`tenants.receiving_mode = 'pagnol'`).
-- ════════════════════════════════════════════════════════════════════════════

-- ── Valor unitario opcional por línea (se copia al activo como valor de compra) ──
ALTER TABLE public.expected_purchase_lines
  ADD COLUMN IF NOT EXISTS unit_value numeric;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expected_purchase_lines_unit_value_check') THEN
    ALTER TABLE public.expected_purchase_lines
      ADD CONSTRAINT expected_purchase_lines_unit_value_check CHECK (unit_value IS NULL OR unit_value >= 0);
  END IF;
END $$;

-- ── Recepciones ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.expected_purchase_receipts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  purchase_id      uuid NOT NULL REFERENCES public.expected_purchases(id) ON DELETE CASCADE,
  -- Copias del día: el proveedor y el pañol de la compra pueden cambiar después.
  supplier_id      uuid,
  warehouse_id     uuid NOT NULL,
  guide_number     text NOT NULL CHECK (length(btrim(guide_number)) > 0),
  received_on      date NOT NULL,
  received_by      uuid NOT NULL,
  received_by_name text NOT NULL,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
-- Única por (proveedor, número): el mismo número de proveedores distintos es válido.
CREATE UNIQUE INDEX IF NOT EXISTS uq_expected_purchase_receipts_guide
  ON public.expected_purchase_receipts (tenant_id, COALESCE(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(guide_number)));
CREATE INDEX IF NOT EXISTS idx_expected_purchase_receipts_purchase ON public.expected_purchase_receipts (purchase_id);

CREATE TABLE IF NOT EXISTS public.expected_purchase_receipt_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  receipt_id   uuid NOT NULL REFERENCES public.expected_purchase_receipts(id) ON DELETE CASCADE,
  line_id      uuid NOT NULL REFERENCES public.expected_purchase_lines(id) ON DELETE CASCADE,
  qty          numeric NOT NULL CHECK (qty > 0),
  -- Lo que se creó: [{ tipo: 'activo' | 'movimiento', id, external_ref }]
  created_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expected_purchase_receipt_lines_line ON public.expected_purchase_receipt_lines (line_id);
CREATE INDEX IF NOT EXISTS idx_expected_purchase_receipt_lines_receipt ON public.expected_purchase_receipt_lines (receipt_id);

ALTER TABLE public.expected_purchase_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expected_purchase_receipt_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "expected_purchase_receipts_select" ON public.expected_purchase_receipts;
CREATE POLICY "expected_purchase_receipts_select" ON public.expected_purchase_receipts
  FOR SELECT USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id());
DROP POLICY IF EXISTS "expected_purchase_receipt_lines_select" ON public.expected_purchase_receipt_lines;
CREATE POLICY "expected_purchase_receipt_lines_select" ON public.expected_purchase_receipt_lines
  FOR SELECT USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id());
GRANT SELECT ON public.expected_purchase_receipts, public.expected_purchase_receipt_lines TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.expected_purchase_receipts, public.expected_purchase_receipt_lines FROM authenticated;

-- ── ¿Hay líneas abiertas? Ahora descuenta lo ya recibido por completo ───────
CREATE OR REPLACE FUNCTION public.expected_purchase_open_lines(p_tenant uuid)
RETURNS integer LANGUAGE sql STABLE SET search_path = public, extensions AS $$
  SELECT count(*)::int
  FROM public.expected_purchase_lines l
  JOIN public.expected_purchases p ON p.id = l.purchase_id
  WHERE l.tenant_id = p_tenant AND l.canceled_at IS NULL AND p.canceled_at IS NULL
    AND l.expected_qty > COALESCE((SELECT sum(rl.qty) FROM public.expected_purchase_receipt_lines rl WHERE rl.line_id = l.id), 0);
$$;
REVOKE EXECUTE ON FUNCTION public.expected_purchase_open_lines(uuid) FROM PUBLIC, anon, authenticated;

-- ── Quién puede recibir ──────────────────────────────────────────────────────
-- Mismo patrón que los demás permisos de acción: rol de la lista, permiso otorgado a la
-- persona, o permiso de la fila de rol de su empresa (`stock:receive_order`).
CREATE OR REPLACE FUNCTION public.can_receive_expected_purchases()
RETURNS boolean AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.roles r ON r.id = p.role AND r.tenant_id = p.tenant_id
    WHERE p.id = auth.uid()
      AND (
            p.role IN ('super-admin', 'administrador', 'soporte-pagnol', 'panolero', 'jefe-mantencion', 'abastecimiento')
         OR to_jsonb(p.granted_permissions) ? 'stock:receive_order'
         OR to_jsonb(r.permissions)         ? 'stock:receive_order'
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;
ALTER FUNCTION public.can_receive_expected_purchases() SET search_path = public, extensions;
GRANT EXECUTE ON FUNCTION public.can_receive_expected_purchases() TO authenticated;

-- ── Crear compra (reemplaza la de la fase A: ahora acepta valor_unitario por línea) ──
CREATE OR REPLACE FUNCTION public.api_create_expected_purchase(
  p_tenant_id     uuid,
  p_actor         text,
  p_external_ref  text,
  p_supplier_id   uuid,
  p_warehouse_id  uuid,
  p_date          date,
  p_contract_ref  text,
  p_lines         jsonb          -- [{ external_ref, material_id, cantidad, valor_unitario? }]
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
  v_val  numeric;
BEGIN
  SELECT receiving_mode INTO v_mode FROM public.tenants WHERE id = p_tenant_id;
  IF v_mode IS DISTINCT FROM 'pagnol' THEN
    RAISE EXCEPTION 'api_error:conflict:Esta empresa recibe en su sistema de compras (recepcion = externa); las compras esperadas sólo se anuncian cuando la recepción es en Pagnol.';
  END IF;

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

  FOR l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := (l->>'cantidad')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'api_error:validation_error:La cantidad de la línea "%" debe ser mayor que cero.', l->>'external_ref';
    END IF;
    v_val := NULLIF(l->>'valor_unitario', '')::numeric;
    IF v_val IS NOT NULL AND v_val < 0 THEN
      RAISE EXCEPTION 'api_error:validation_error:El valor_unitario de la línea "%" no puede ser negativo.', l->>'external_ref';
    END IF;
    SELECT * INTO v_mat FROM public.materials
     WHERE id = (l->>'material_id')::uuid AND tenant_id = p_tenant_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'api_error:not_found:El material_id de la línea "%" no existe en esta empresa.', l->>'external_ref';
    END IF;
    IF v_mat.catalog_material_id IS NOT NULL OR v_mat.ownership IS DISTINCT FROM 'propio' OR COALESCE(v_mat.archived, false) THEN
      RAISE EXCEPTION 'api_error:validation_error:"%" no es un ítem comprable del catálogo (es una unidad ya creada, un equipo arrendado o un ítem archivado).', v_mat.name;
    END IF;
    IF public.api_is_trackable(v_mat.usage_type) AND v_qty <> trunc(v_qty) THEN
      RAISE EXCEPTION 'api_error:validation_error:"%" es rastreable: la cantidad debe ser un número entero de unidades.', v_mat.name;
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

  INSERT INTO public.expected_purchase_lines (tenant_id, purchase_id, external_ref, material_id, expected_qty, unit_value)
  SELECT p_tenant_id, v_id, e->>'external_ref', (e->>'material_id')::uuid, (e->>'cantidad')::numeric, NULLIF(e->>'valor_unitario', '')::numeric
  FROM jsonb_array_elements(p_lines) e;

  RETURN QUERY SELECT v_id, true;
END;
$$;

-- ── Corregir o cancelar (reemplaza la de la fase A: con recepciones hay reglas) ──
--   · una línea con recepciones nunca baja de lo ya recibido; subirla sí;
--   · el pañol de una compra con recepciones no se cambia;
--   · cancelar conserva lo ya recibido (no se revierte).
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
  v_p    public.expected_purchases%ROWTYPE;
  l      jsonb;
  v_qty  numeric;
  v_rec  numeric;
  n      int;
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
    IF (p_patch->>'panol_id')::uuid IS DISTINCT FROM v_p.warehouse_id
       AND EXISTS (SELECT 1 FROM public.expected_purchase_receipts WHERE purchase_id = p_id) THEN
      RAISE EXCEPTION 'api_error:conflict:La compra ya tiene recepciones: no se puede cambiar su pañol.';
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
        SELECT COALESCE(sum(rl.qty), 0) INTO v_rec
          FROM public.expected_purchase_receipt_lines rl
          JOIN public.expected_purchase_lines el ON el.id = rl.line_id
         WHERE el.purchase_id = p_id AND el.external_ref = l->>'external_ref';
        IF v_qty < v_rec THEN
          RAISE EXCEPTION 'api_error:conflict:La línea "%" ya recibió % unidades: no puede quedar en %.', l->>'external_ref', v_rec, v_qty;
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

-- ── Recibir (lo ejecuta el pañolero con su sesión) ───────────────────────────
--   p_lines: [{ line_id, cantidad }]
CREATE OR REPLACE FUNCTION public.receive_expected_purchase(
  p_purchase uuid,
  p_guide    text,
  p_date     date,
  p_note     text,
  p_lines    jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_me     uuid := auth.uid();
  v_prof   record;
  v_mode   text;
  v_p      public.expected_purchases%ROWTYPE;
  v_mgr    uuid;
  v_guide  text := btrim(COALESCE(p_guide, ''));
  v_rcpt   uuid;
  l        jsonb;
  v_line   public.expected_purchase_lines%ROWTYPE;
  v_mat    public.materials%ROWTYPE;
  v_qty    numeric;
  v_prev   numeric;
  v_k      int;
  v_refs   jsonb;
  v_ref    text;
  v_id     uuid;
  v_new    boolean;
  v_rl     uuid;
  i        int;
BEGIN
  IF v_me IS NULL OR NOT public.can_receive_expected_purchases() THEN
    RAISE EXCEPTION 'No tienes permiso para recibir compras.' USING ERRCODE = '42501';
  END IF;
  SELECT id, name, tenant_id, role INTO v_prof
    FROM public.profiles WHERE id = v_me AND deleted_at IS NULL AND is_active IS NOT FALSE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No tienes permiso para recibir compras.' USING ERRCODE = '42501'; END IF;

  SELECT receiving_mode INTO v_mode FROM public.tenants WHERE id = v_prof.tenant_id;
  IF v_mode IS DISTINCT FROM 'pagnol' THEN
    RAISE EXCEPTION 'Tu empresa recibe en su sistema de compras: aquí no se registran recepciones.';
  END IF;

  SELECT * INTO v_p FROM public.expected_purchases WHERE id = p_purchase AND tenant_id = v_prof.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró la compra.' USING ERRCODE = 'P0002'; END IF;
  IF v_p.canceled_at IS NOT NULL THEN RAISE EXCEPTION 'La compra está cancelada: no se puede recibir.'; END IF;

  -- Cada pañolero recibe en SU pañol. Un pañol sin encargado lo recibe cualquiera con permiso.
  SELECT manager_id INTO v_mgr FROM public.warehouses WHERE id = v_p.warehouse_id;
  IF v_mgr IS NOT NULL AND v_mgr IS DISTINCT FROM v_me AND v_prof.role NOT IN ('super-admin', 'administrador', 'soporte-pagnol') THEN
    RAISE EXCEPTION 'Esta compra viene a un pañol que atiende otra persona.' USING ERRCODE = '42501';
  END IF;

  IF v_guide = '' THEN RAISE EXCEPTION 'La guía de despacho es obligatoria.'; END IF;
  IF p_date IS NULL OR p_date > current_date THEN RAISE EXCEPTION 'La fecha de recepción no puede ser futura.'; END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Indica qué se recibió.';
  END IF;
  IF (SELECT count(DISTINCT e->>'line_id') FROM jsonb_array_elements(p_lines) e) <> jsonb_array_length(p_lines) THEN
    RAISE EXCEPTION 'Una línea no puede repetirse en la misma recepción.';
  END IF;

  -- Todo se valida ANTES de escribir nada.
  FOR l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_line FROM public.expected_purchase_lines
     WHERE id = (l->>'line_id')::uuid AND purchase_id = p_purchase AND tenant_id = v_prof.tenant_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Una de las líneas no pertenece a esta compra.'; END IF;
    IF v_line.canceled_at IS NOT NULL THEN RAISE EXCEPTION 'Una de las líneas está cancelada.'; END IF;
    v_qty := (l->>'cantidad')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Las cantidades deben ser mayores que cero.'; END IF;
    SELECT * INTO v_mat FROM public.materials WHERE id = v_line.material_id;
    IF public.api_is_trackable(v_mat.usage_type) AND v_qty <> trunc(v_qty) THEN
      RAISE EXCEPTION '"%" es un equipo: la cantidad debe ser un número entero.', v_mat.name;
    END IF;
    SELECT COALESCE(sum(qty), 0) INTO v_prev FROM public.expected_purchase_receipt_lines WHERE line_id = v_line.id;
    IF v_prev + v_qty > v_line.expected_qty THEN
      RAISE EXCEPTION '"%": se esperaban %, ya se recibieron % y sólo faltan %. Lo que sobra se resuelve en el sistema de compras.',
        v_mat.name, v_line.expected_qty, v_prev, GREATEST(v_line.expected_qty - v_prev, 0);
    END IF;
  END LOOP;

  BEGIN
    INSERT INTO public.expected_purchase_receipts (
      tenant_id, purchase_id, supplier_id, warehouse_id, guide_number, received_on, received_by, received_by_name, note
    ) VALUES (
      v_prof.tenant_id, p_purchase, v_p.supplier_id, v_p.warehouse_id, v_guide, p_date, v_me, v_prof.name, NULLIF(btrim(p_note), '')
    ) RETURNING id INTO v_rcpt;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'La guía "%" ya se registró para este proveedor.', v_guide USING ERRCODE = '23505';
  END;

  FOR l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_line FROM public.expected_purchase_lines WHERE id = (l->>'line_id')::uuid;
    SELECT * INTO v_mat FROM public.materials WHERE id = v_line.material_id;
    v_qty := (l->>'cantidad')::numeric;
    SELECT COALESCE(sum(qty), 0), count(*) INTO v_prev, v_k FROM public.expected_purchase_receipt_lines WHERE line_id = v_line.id;
    v_refs := '[]'::jsonb;

    IF public.api_is_trackable(v_mat.usage_type) THEN
      FOR i IN 1..v_qty::int LOOP
        v_ref := v_line.external_ref || ':unidad:' || (v_prev::int + i);
        SELECT a.asset_id, a.created INTO v_id, v_new FROM public.api_create_asset(
          v_prof.tenant_id, v_prof.name, v_mat.id, NULL, v_p.supplier_id, v_line.unit_value, p_date, NULL, v_p.warehouse_id, v_ref
        ) a;
        IF NOT v_new THEN
          RAISE EXCEPTION 'La referencia "%" ya existe: esa unidad ya se informó por la integración.', v_ref;
        END IF;
        UPDATE public.stock_movements
           SET user_id = v_me, user_name = v_prof.name,
               justification = 'Recepción en Pagnol (guía ' || v_guide || ') · ' || v_ref
         WHERE tenant_id = v_prof.tenant_id AND external_ref = v_ref;
        v_refs := v_refs || jsonb_build_array(jsonb_build_object('tipo', 'activo', 'id', v_id, 'external_ref', v_ref));
      END LOOP;
    ELSE
      v_ref := v_line.external_ref || ':recepcion:' || (v_k + 1);
      SELECT s.movement_id, s.created INTO v_id, v_new FROM public.api_stock_entry(
        v_prof.tenant_id, v_prof.name, 'ingreso', v_mat.id, v_qty, p_date::timestamptz, v_p.warehouse_id, v_ref
      ) s;
      IF NOT v_new THEN
        RAISE EXCEPTION 'La referencia "%" ya existe: ese ingreso ya se informó por la integración.', v_ref;
      END IF;
      UPDATE public.stock_movements
         SET user_id = v_me, user_name = v_prof.name,
             justification = 'Recepción en Pagnol (guía ' || v_guide || ') · ' || v_ref
       WHERE tenant_id = v_prof.tenant_id AND external_ref = v_ref;
      v_refs := jsonb_build_array(jsonb_build_object('tipo', 'movimiento', 'id', v_id, 'external_ref', v_ref));
    END IF;

    INSERT INTO public.expected_purchase_receipt_lines (tenant_id, receipt_id, line_id, qty, created_refs)
    VALUES (v_prof.tenant_id, v_rcpt, v_line.id, v_qty, v_refs)
    RETURNING id INTO v_rl;

    -- Una notificación por línea recibida. Cada una es su propio recurso: no se agrupan.
    PERFORM public.webhook_emit(v_prof.tenant_id, 'compra.recibida', v_rl);
  END LOOP;

  UPDATE public.expected_purchases SET updated_at = now() WHERE id = p_purchase;
  RETURN v_rcpt;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.receive_expected_purchase(uuid, text, date, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_expected_purchase(uuid, text, date, text, jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.api_create_expected_purchase(uuid, text, text, uuid, uuid, date, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.api_patch_expected_purchase(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_create_expected_purchase(uuid, text, text, uuid, uuid, date, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.api_patch_expected_purchase(uuid, uuid, jsonb) TO service_role;

-- ── Evento nuevo para las suscripciones ──────────────────────────────────────
ALTER TABLE public.webhook_subscriptions DROP CONSTRAINT IF EXISTS webhook_subscriptions_events_valid;
ALTER TABLE public.webhook_subscriptions ADD CONSTRAINT webhook_subscriptions_events_valid CHECK (
  cardinality(events) > 0
  AND events <@ ARRAY[
    'material.creado', 'material.actualizado',
    'proveedor.creado', 'proveedor.actualizado',
    'activo.creado', 'activo.actualizado', 'activo.dado_de_baja',
    'stock.bajo_minimo',
    'compra.recibida'
  ]::text[]
);

NOTIFY pgrst, 'reload schema';
