-- ════════════════════════════════════════════════════════════════════════════
-- Compras esperadas · corregir una recepción equivocada
--
-- Si el pañolero aceptó algo que NO venía (o de más), tiene que poder corregirlo. La recepción
-- original NO se edita (es un hecho que respalda lo que pasó ese día): la corrección es un
-- hecho NUEVO que quita una cantidad, con motivo, quién y cuándo.
--
--   · Lo recibido NETO de una línea = lo recibido − lo corregido. De ahí salen el estado
--     (una línea «recibida» vuelve a «parcial» o «esperada») y lo que todavía se puede recibir.
--   · La numeración de las unidades NO se reutiliza: una unidad corregida conserva su referencia
--     (`…:unidad:3`) y la próxima recepción sigue en la 4.
--   · Revertir el stock es estricto, como el reverso de la API: un EQUIPO se da de baja sólo si
--     sigue intacto en el pañol (no se entregó, ni se movió, ni cambió de estado); un CONSUMIBLE
--     sólo si esa cantidad sigue en el pañol. Si no, se rechaza con el motivo y se ajusta en
--     Control de Activos: nunca deja el stock inconsistente.
--   · Avisa a Valar con `compra.recepcion_corregida`.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.expected_purchase_receipt_corrections (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  receipt_line_id    uuid NOT NULL REFERENCES public.expected_purchase_receipt_lines(id) ON DELETE CASCADE,
  qty_removed        numeric NOT NULL CHECK (qty_removed > 0),
  -- Cantidad esperada de la línea AL CORREGIR (copia, como en la recepción).
  expected_qty       numeric,
  reason             text NOT NULL CHECK (length(btrim(reason)) >= 5),
  corrected_by       uuid NOT NULL,
  corrected_by_name  text NOT NULL,
  -- Qué se revirtió: [{ tipo: 'activo' | 'movimiento', id, external_ref }]
  removed_refs       jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_receipt_corrections_line ON public.expected_purchase_receipt_corrections (receipt_line_id);

ALTER TABLE public.expected_purchase_receipt_corrections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "expected_purchase_receipt_corrections_select" ON public.expected_purchase_receipt_corrections;
CREATE POLICY "expected_purchase_receipt_corrections_select" ON public.expected_purchase_receipt_corrections
  FOR SELECT USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id());
GRANT SELECT ON public.expected_purchase_receipt_corrections TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.expected_purchase_receipt_corrections FROM authenticated;

-- ── Lo recibido NETO de una línea ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expected_line_received(p_line uuid)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public, extensions AS $$
  SELECT COALESCE((SELECT sum(rl.qty) FROM public.expected_purchase_receipt_lines rl WHERE rl.line_id = p_line), 0)
       - COALESCE((SELECT sum(c.qty_removed)
                     FROM public.expected_purchase_receipt_corrections c
                     JOIN public.expected_purchase_receipt_lines rl ON rl.id = c.receipt_line_id
                    WHERE rl.line_id = p_line), 0);
$$;
REVOKE EXECUTE ON FUNCTION public.expected_line_received(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.expected_purchase_open_lines(p_tenant uuid)
RETURNS integer LANGUAGE sql STABLE SET search_path = public, extensions AS $$
  SELECT count(*)::int
  FROM public.expected_purchase_lines l
  JOIN public.expected_purchases p ON p.id = l.purchase_id
  WHERE l.tenant_id = p_tenant AND l.canceled_at IS NULL AND p.canceled_at IS NULL
    AND l.expected_qty > public.expected_line_received(l.id);
$$;
REVOKE EXECUTE ON FUNCTION public.expected_purchase_open_lines(uuid) FROM PUBLIC, anon, authenticated;

-- ── Recibir (reemplaza la anterior: el exceso se mide contra lo NETO; la numeración, contra lo bruto) ──
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
  v_prev   numeric;   -- bruto: cuántas unidades se han numerado ya
  v_net    numeric;   -- neto: lo que de verdad quedó recibido
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
    v_net := public.expected_line_received(v_line.id);
    IF v_net + v_qty > v_line.expected_qty THEN
      RAISE EXCEPTION '"%": se esperaban %, ya se recibieron % y sólo faltan %. Lo que sobra se resuelve en el sistema de compras.',
        v_mat.name, v_line.expected_qty, v_net, GREATEST(v_line.expected_qty - v_net, 0);
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

    PERFORM public.webhook_emit(v_prof.tenant_id, 'compra.recibida', v_rl);
  END LOOP;

  UPDATE public.expected_purchases SET updated_at = now() WHERE id = p_purchase;
  RETURN v_rcpt;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.receive_expected_purchase(uuid, text, date, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_expected_purchase(uuid, text, date, text, jsonb) TO authenticated;

-- ── Corregir una recepción ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.correct_expected_receipt(
  p_receipt_line uuid,
  p_qty          numeric,
  p_reason       text
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
  v_rl     public.expected_purchase_receipt_lines%ROWTYPE;
  v_rc     public.expected_purchase_receipts%ROWTYPE;
  v_p      public.expected_purchases%ROWTYPE;
  v_line   public.expected_purchase_lines%ROWTYPE;
  v_mat    public.materials%ROWTYPE;
  v_asset  public.materials%ROWTYPE;
  v_ms     public.material_stocks%ROWTYPE;
  v_mgr    uuid;
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_net    numeric;
  v_removed jsonb := '[]'::jsonb;
  r        record;
  v_ref    text;
  v_n      int;
  v_corr   uuid;
  v_stock  numeric;
BEGIN
  IF v_me IS NULL OR NOT public.can_receive_expected_purchases() THEN
    RAISE EXCEPTION 'No tienes permiso para corregir recepciones.' USING ERRCODE = '42501';
  END IF;
  SELECT id, name, tenant_id, role INTO v_prof
    FROM public.profiles WHERE id = v_me AND deleted_at IS NULL AND is_active IS NOT FALSE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No tienes permiso para corregir recepciones.' USING ERRCODE = '42501'; END IF;

  SELECT receiving_mode INTO v_mode FROM public.tenants WHERE id = v_prof.tenant_id;
  IF v_mode IS DISTINCT FROM 'pagnol' THEN
    RAISE EXCEPTION 'Tu empresa recibe en su sistema de compras: aquí no se corrigen recepciones.';
  END IF;

  SELECT * INTO v_rl FROM public.expected_purchase_receipt_lines WHERE id = p_receipt_line AND tenant_id = v_prof.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró esa recepción.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_rc FROM public.expected_purchase_receipts WHERE id = v_rl.receipt_id;
  SELECT * INTO v_p FROM public.expected_purchases WHERE id = v_rc.purchase_id FOR UPDATE;
  SELECT * INTO v_line FROM public.expected_purchase_lines WHERE id = v_rl.line_id;
  SELECT * INTO v_mat FROM public.materials WHERE id = v_line.material_id;

  SELECT manager_id INTO v_mgr FROM public.warehouses WHERE id = v_rc.warehouse_id;
  IF v_mgr IS NOT NULL AND v_mgr IS DISTINCT FROM v_me AND v_prof.role NOT IN ('super-admin', 'administrador', 'soporte-pagnol') THEN
    RAISE EXCEPTION 'Esa recepción fue a un pañol que atiende otra persona.' USING ERRCODE = '42501';
  END IF;

  IF length(v_reason) < 5 THEN RAISE EXCEPTION 'Explica por qué se corrige (mínimo 5 letras): queda registrado.'; END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'Indica cuántas unidades se quitan.'; END IF;
  IF public.api_is_trackable(v_mat.usage_type) AND p_qty <> trunc(p_qty) THEN
    RAISE EXCEPTION '"%" es un equipo: la cantidad debe ser un número entero.', v_mat.name;
  END IF;

  v_net := v_rl.qty - COALESCE((SELECT sum(qty_removed) FROM public.expected_purchase_receipt_corrections WHERE receipt_line_id = v_rl.id), 0);
  IF p_qty > v_net THEN
    RAISE EXCEPTION '"%": de esa recepción quedan % por corregir; no se pueden quitar %.', v_mat.name, v_net, p_qty;
  END IF;

  IF public.api_is_trackable(v_mat.usage_type) THEN
    -- Se dan de baja las ÚLTIMAS unidades de esa recepción que sigan en pie. Cada una tiene que seguir intacta.
    FOR r IN
      SELECT t.e AS e
        FROM jsonb_array_elements(v_rl.created_refs) WITH ORDINALITY AS t(e, ord)
       WHERE t.e->>'id' NOT IN (
         SELECT x->>'id' FROM public.expected_purchase_receipt_corrections c, jsonb_array_elements(c.removed_refs) x
          WHERE c.receipt_line_id = v_rl.id)
       ORDER BY t.ord DESC
       LIMIT p_qty::int
    LOOP
      SELECT * INTO v_asset FROM public.materials WHERE id = (r.e->>'id')::uuid AND tenant_id = v_prof.tenant_id FOR UPDATE;
      IF NOT FOUND
         OR COALESCE(v_asset.archived, false)
         OR COALESCE(v_asset.stock, 0) <> 1
         OR COALESCE(v_asset.in_use, 0) <> 0
         OR COALESCE(v_asset.status, 'Disponible') <> 'Disponible'
         OR EXISTS (SELECT 1 FROM public.stock_movements sm WHERE sm.material_id = v_asset.id AND sm.external_ref IS DISTINCT FROM (r.e->>'external_ref'))
         OR NOT EXISTS (SELECT 1 FROM public.material_stocks ms WHERE ms.material_id = v_asset.id AND ms.contract_id IS NULL
                          AND ms.warehouse_id IS NOT DISTINCT FROM v_rc.warehouse_id AND ms.qty = 1)
      THEN
        RAISE EXCEPTION 'La unidad % (%) ya no está intacta en el pañol (se entregó, se movió o cambió de estado): no se puede quitar. Ajústala en Control de Activos.',
          r.e->>'external_ref', COALESCE(v_asset.internal_code, '?');
      END IF;

      UPDATE public.material_stocks SET qty = 0, updated_at = now()
       WHERE material_id = v_asset.id AND contract_id IS NULL AND warehouse_id IS NOT DISTINCT FROM v_rc.warehouse_id;
      UPDATE public.materials SET stock = 0, archived = true, status = 'Para Baja' WHERE id = v_asset.id;
      INSERT INTO public.stock_movements (
        tenant_id, material_id, material_name, quantity_change, new_stock, type, date,
        justification, user_id, user_name, warehouse_id, external_ref
      ) VALUES (
        v_prof.tenant_id, v_asset.id, v_asset.name, -1, 0, 'adjustment', now(),
        'Corrección de recepción (guía ' || v_rc.guide_number || '): ' || v_reason, v_me, v_prof.name, v_rc.warehouse_id,
        (r.e->>'external_ref') || ':correccion'
      );
      v_removed := v_removed || jsonb_build_array(r.e);
    END LOOP;
    IF jsonb_array_length(v_removed) <> p_qty::int THEN
      RAISE EXCEPTION 'No quedan % unidades de esa recepción para quitar.', p_qty;
    END IF;
  ELSE
    SELECT * INTO v_mat FROM public.materials WHERE id = v_line.material_id FOR UPDATE;
    SELECT * INTO v_ms FROM public.material_stocks
     WHERE tenant_id = v_prof.tenant_id AND material_id = v_mat.id AND contract_id IS NULL
       AND warehouse_id IS NOT DISTINCT FROM v_rc.warehouse_id FOR UPDATE;
    IF NOT FOUND OR v_ms.qty < p_qty OR COALESCE(v_mat.stock, 0) < p_qty THEN
      RAISE EXCEPTION 'No se puede quitar: parte de lo recibido ya se entregó o se movió de lugar (en el pañol quedan %). Ajústalo en Control de Activos.',
        COALESCE(v_ms.qty, 0);
    END IF;
    UPDATE public.material_stocks SET qty = qty - p_qty, updated_at = now() WHERE id = v_ms.id;
    v_stock := COALESCE(v_mat.stock, 0) - p_qty;
    UPDATE public.materials SET stock = v_stock WHERE id = v_mat.id;
    SELECT count(*) INTO v_n
      FROM public.expected_purchase_receipt_corrections c
      JOIN public.expected_purchase_receipt_lines x ON x.id = c.receipt_line_id
     WHERE x.line_id = v_line.id;
    v_ref := v_line.external_ref || ':correccion:' || (v_n + 1);
    INSERT INTO public.stock_movements (
      tenant_id, material_id, material_name, quantity_change, new_stock, type, date,
      justification, user_id, user_name, warehouse_id, external_ref
    ) VALUES (
      v_prof.tenant_id, v_mat.id, v_mat.name, -p_qty, v_stock, 'adjustment', now(),
      'Corrección de recepción (guía ' || v_rc.guide_number || '): ' || v_reason, v_me, v_prof.name, v_rc.warehouse_id, v_ref
    ) RETURNING id INTO v_corr;
    v_removed := jsonb_build_array(jsonb_build_object('tipo', 'movimiento', 'id', v_corr, 'external_ref', v_ref));
  END IF;

  INSERT INTO public.expected_purchase_receipt_corrections (
    tenant_id, receipt_line_id, qty_removed, expected_qty, reason, corrected_by, corrected_by_name, removed_refs
  ) VALUES (
    v_prof.tenant_id, v_rl.id, p_qty, v_line.expected_qty, v_reason, v_me, v_prof.name, v_removed
  ) RETURNING id INTO v_corr;

  PERFORM public.webhook_emit(v_prof.tenant_id, 'compra.recepcion_corregida', v_corr);
  UPDATE public.expected_purchases SET updated_at = now() WHERE id = v_p.id;
  RETURN v_corr;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.correct_expected_receipt(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_expected_receipt(uuid, numeric, text) TO authenticated;

-- ── Corregir la cantidad de una línea (API): se mide contra lo NETO recibido ─
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
        SELECT public.expected_line_received(el.id) INTO v_rec
          FROM public.expected_purchase_lines el
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
REVOKE EXECUTE ON FUNCTION public.api_patch_expected_purchase(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_patch_expected_purchase(uuid, uuid, jsonb) TO service_role;

-- ── Evento nuevo ─────────────────────────────────────────────────────────────
ALTER TABLE public.webhook_subscriptions DROP CONSTRAINT IF EXISTS webhook_subscriptions_events_valid;
ALTER TABLE public.webhook_subscriptions ADD CONSTRAINT webhook_subscriptions_events_valid CHECK (
  cardinality(events) > 0
  AND events <@ ARRAY[
    'material.creado', 'material.actualizado',
    'proveedor.creado', 'proveedor.actualizado',
    'activo.creado', 'activo.actualizado', 'activo.dado_de_baja',
    'stock.bajo_minimo',
    'compra.recibida', 'compra.recepcion_corregida'
  ]::text[]
);

NOTIFY pgrst, 'reload schema';
