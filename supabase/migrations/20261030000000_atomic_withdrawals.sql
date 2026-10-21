-- Control de Activos · Fase 2 — Retiros y devoluciones ATÓMICOS.
--
-- POR QUÉ: aprobar, anular o devolver eran una secuencia de 5-8 llamadas desde el navegador
-- (ficha, desglose por contrato, kardex, estado del retiro). Si algo fallaba a mitad de camino, quedaba
-- medio retiro descontado; y dos personas a la vez se pisaban porque el stock se leía, se calculaba en el
-- navegador y se escribía. La Fase 1 lo mitigó (compare-and-set + deshacer a mano) pero no puede ser una
-- transacción. Esto sí: cada operación es UNA transacción con las filas bloqueadas; o queda todo, o nada.
--
-- Funciones públicas (las que llama la aplicación):
--   approve_material_request(p_request)                aprobar el despacho de un retiro (descuenta stock)
--   cancel_approved_material_request(p_request, p_reason)  deshacer un despacho aprobado que nadie retiró
--   complete_return_request(p_return, p_status, p_condition, p_evidence)  resolver una devolución
--   deliver_directly(...)                              entrega directa en ventanilla (retiro + descuento)
--   return_directly(...)                               devolución directa en ventanilla (devolución + reingreso)
--
-- Seguridad: SECURITY DEFINER con `auth.uid()` y la empresa del llamante verificados DENTRO (mismo patrón
-- que `receive_expected_purchase`); cada consulta filtra por esa empresa. Los permisos por rol/clase los
-- sigue exigiendo la aplicación (`can()`, que respeta los roles propios de cada empresa y no existe en
-- SQL): una persona de la empresa podía ya escribir estas tablas por REST, así que esto no abre nada nuevo,
-- sólo la hace atómica. Los ayudantes `_…` no se pueden llamar desde fuera.
--
-- Errores de negocio: texto en español pensado para la persona; la aplicación lo muestra tal cual.
-- Si esta migración aún no está aplicada, la aplicación sigue con el camino de la Fase 1.

-- ── Ayudantes ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._class_rank(p_class text)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_class WHEN 'A' THEN 3 WHEN 'B' THEN 2 ELSE 1 END;
$$;

-- Suma `p_qty` a una fila del desglose (contrato × pañol; NULL = pool / sin pañol).
CREATE OR REPLACE FUNCTION public._ledger_add(
  p_tenant uuid, p_material uuid, p_contract uuid, p_warehouse uuid, p_qty numeric
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN RETURN; END IF;
  INSERT INTO public.material_stocks (tenant_id, material_id, contract_id, warehouse_id, qty)
  VALUES (p_tenant, p_material, p_contract, p_warehouse, p_qty)
  ON CONFLICT (tenant_id, material_id, contract_id, warehouse_id)
  DO UPDATE SET qty = public.material_stocks.qty + EXCLUDED.qty;
END;
$$;

-- Agrega (contrato, cantidad) a la lista de orígenes, juntando los del mismo contrato.
CREATE OR REPLACE FUNCTION public._src_add(p_src jsonb, p_contract uuid, p_qty numeric)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(p_src) e WHERE (e->>'contract_id') IS NOT DISTINCT FROM p_contract::text)
    THEN (SELECT jsonb_agg(CASE WHEN (e->>'contract_id') IS NOT DISTINCT FROM p_contract::text
                                THEN jsonb_set(e, '{qty}', to_jsonb((e->>'qty')::numeric + p_qty)) ELSE e END)
            FROM jsonb_array_elements(p_src) e)
    ELSE p_src || jsonb_build_array(jsonb_build_object('contract_id', p_contract, 'qty', p_qty))
  END;
$$;

-- Descuenta del desglose en cascada: 1) el contrato pedido, 2) el pool central, 3) otros contratos (de
-- mayor a menor existencia); dentro de cada nivel, primero las filas del pañol indicado. Devuelve de dónde
-- salió: [{contract_id, qty}]. Si el desglose quedó corto (deriva histórica), lo que falta se atribuye al
-- contrato pedido para que la suma no quede por sobre el stock real (igual que la versión de la aplicación).
CREATE OR REPLACE FUNCTION public._ledger_consume(
  p_tenant uuid, p_material uuid, p_contract uuid, p_warehouse uuid, p_qty numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_remaining numeric := p_qty;
  v_src jsonb := '[]'::jsonb;
  v_row record;
  v_take numeric;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN RETURN v_src; END IF;
  FOR v_row IN
    SELECT id, contract_id, qty
      FROM public.material_stocks
     WHERE tenant_id = p_tenant AND material_id = p_material AND qty > 0
     ORDER BY CASE WHEN contract_id IS NOT DISTINCT FROM p_contract THEN 0 WHEN contract_id IS NULL THEN 1 ELSE 2 END,
              CASE WHEN p_warehouse IS NOT NULL AND warehouse_id = p_warehouse THEN 0 ELSE 1 END,
              qty DESC
       FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_row.qty, v_remaining);
    UPDATE public.material_stocks SET qty = qty - v_take WHERE id = v_row.id;
    v_remaining := v_remaining - v_take;
    v_src := public._src_add(v_src, v_row.contract_id, v_take);
  END LOOP;
  IF v_remaining > 0 THEN
    v_src := public._src_add(v_src, p_contract, v_remaining);
  END IF;
  RETURN v_src;
END;
$$;

-- «Incluye 2 de pool central, 1 de Contrato X»: lo que salió de un lugar distinto al pedido.
CREATE OR REPLACE FUNCTION public._src_note(p_src jsonb, p_requested uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN count(*) = 0 THEN NULL
    ELSE 'Incluye ' || string_agg(trim_scale(s.q)::text || ' de ' || s.label, ', ') END
    FROM (
      SELECT (e->>'qty')::numeric AS q,
             CASE WHEN e->>'contract_id' IS NULL THEN 'pool central'
                  ELSE COALESCE((SELECT c.name FROM public.contracts c WHERE c.id = (e->>'contract_id')::uuid), 'otro contrato') END AS label
        FROM jsonb_array_elements(p_src) e
       WHERE (e->>'contract_id') IS DISTINCT FROM p_requested::text
    ) s;
$$;

-- Saca `p_qty` de un material: ficha (stock, in_use, estado), desglose y kardex. `p_max_class` (opcional)
-- rechaza un material más exigente que lo que se puede entregar sin aprobación previa.
CREATE OR REPLACE FUNCTION public._withdraw_item(
  p_tenant uuid, p_material uuid, p_qty numeric, p_contract uuid, p_contract_name text, p_warehouse uuid,
  p_related text, p_justification text, p_user uuid, p_user_name text, p_max_class text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  m public.materials%ROWTYPE;
  v_asset boolean; v_new_stock numeric; v_new_in_use numeric; v_status text; v_src jsonb; v_note text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_material::text, 0));
  SELECT * INTO m FROM public.materials WHERE id = p_material AND tenant_id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material % no existe.', p_material; END IF;
  IF COALESCE(m.stock, 0) < p_qty THEN RAISE EXCEPTION 'Stock insuficiente para %.', m.name; END IF;
  IF p_max_class IS NOT NULL AND public._class_rank(m.criticality) > public._class_rank(p_max_class) THEN
    RAISE EXCEPTION '% es clase %: requiere aprobación antes de entregarse.', m.name, COALESCE(m.criticality, 'C');
  END IF;

  v_asset := m.usage_type IS DISTINCT FROM 'Consumible';
  v_new_stock := m.stock - p_qty;
  v_new_in_use := COALESCE(m.in_use, 0) + CASE WHEN v_asset THEN p_qty ELSE 0 END;
  v_status := m.status;
  IF v_asset THEN
    IF v_new_in_use > 0 THEN v_status := 'En Uso'; ELSIF v_new_stock > 0 THEN v_status := 'Disponible'; END IF;
  END IF;
  UPDATE public.materials SET stock = v_new_stock, in_use = v_new_in_use, status = v_status WHERE id = m.id;

  v_src := public._ledger_consume(p_tenant, m.id, p_contract, p_warehouse, p_qty);
  v_note := public._src_note(v_src, p_contract);

  INSERT INTO public.stock_movements (
    material_id, material_name, quantity_change, new_stock, type, date, justification,
    user_id, user_name, related_request_id, contract_id, contract_name, warehouse_id, tenant_id
  ) VALUES (
    m.id, m.name, -p_qty, v_new_stock, 'request-delivery', now(), p_justification || COALESCE(' — ' || v_note, ''),
    p_user, p_user_name, p_related, p_contract, p_contract_name, p_warehouse, p_tenant
  );

  RETURN jsonb_build_object('material_id', m.id, 'name', m.name, 'usage_type', m.usage_type, 'unit_cost', m.unit_cost,
                            'class', COALESCE(m.criticality, 'C'), 'qty', p_qty, 'sources', v_src);
END;
$$;

-- Devuelve `p_qty` a un material: ficha, desglose y kardex. `p_mode`: 'return' (una devolución: con falla va
-- a mantenimiento) o 'cancel' (se anula un despacho que nunca salió a terreno: no hay «falla» posible).
-- Un consumible vuelve donde se recibió y al contrato indicado; un activo rastreable, al pool central y a la
-- oficina central (o, si no hay, donde se recibió).
CREATE OR REPLACE FUNCTION public._restock_item(
  p_tenant uuid, p_material uuid, p_qty numeric, p_contract uuid, p_contract_name text, p_warehouse uuid,
  p_related text, p_justification text, p_user uuid, p_user_name text, p_mode text, p_condition text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  m public.materials%ROWTYPE;
  v_asset boolean; v_new_stock numeric; v_new_in_use numeric; v_status text;
  v_place_contract uuid; v_place_wh uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_material::text, 0));
  SELECT * INTO m FROM public.materials WHERE id = p_material AND tenant_id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Uno de los materiales ya no existe: no se puede reingresar.'; END IF;

  v_asset := m.usage_type IS DISTINCT FROM 'Consumible';
  v_new_stock := COALESCE(m.stock, 0) + p_qty;
  v_new_in_use := GREATEST(0, COALESCE(m.in_use, 0) - p_qty);
  v_status := m.status;
  IF v_asset THEN
    IF p_mode = 'return' THEN
      v_status := CASE WHEN p_condition IS DISTINCT FROM 'OK' THEN 'En Mantenimiento'
                       WHEN v_new_in_use > 0 THEN 'En Uso' ELSE 'Disponible' END;
    ELSE
      v_status := CASE WHEN v_new_in_use > 0 THEN 'En Uso' WHEN m.status = 'En Uso' THEN 'Disponible' ELSE m.status END;
    END IF;
  END IF;
  UPDATE public.materials SET stock = v_new_stock, in_use = v_new_in_use, status = v_status WHERE id = m.id;

  IF public.api_is_trackable(m.usage_type) THEN
    v_place_contract := NULL;
    v_place_wh := COALESCE((SELECT w.id FROM public.warehouses w WHERE w.tenant_id = p_tenant AND w.is_central AND w.status = 'active' LIMIT 1), p_warehouse);
  ELSE
    v_place_contract := p_contract;
    v_place_wh := p_warehouse;
  END IF;
  PERFORM public._ledger_add(p_tenant, m.id, v_place_contract, v_place_wh, p_qty);

  INSERT INTO public.stock_movements (
    material_id, material_name, quantity_change, new_stock, type, date, justification,
    user_id, user_name, related_request_id, contract_id, contract_name, warehouse_id, tenant_id
  ) VALUES (
    m.id, m.name, p_qty, v_new_stock, 'return-reentry', now(), p_justification,
    p_user, p_user_name, p_related, p_contract, p_contract_name, v_place_wh, p_tenant
  );

  RETURN jsonb_build_object('material_id', m.id, 'name', m.name, 'usage_type', m.usage_type, 'asset', v_asset,
                            'condition', p_condition, 'qty', p_qty);
END;
$$;

-- Los ítems de un retiro, juntando los materiales repetidos y en orden estable (el orden evita bloqueos
-- cruzados entre dos operaciones simultáneas).
CREATE OR REPLACE FUNCTION public._merge_items(p_items jsonb)
RETURNS TABLE (material_id uuid, qty numeric) LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Debes indicar al menos un material.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e WHERE COALESCE((e->>'quantity')::numeric, 0) <= 0) THEN
    RAISE EXCEPTION 'Las cantidades deben ser mayores que cero.';
  END IF;
  RETURN QUERY
    SELECT (e->>'materialId')::uuid, sum((e->>'quantity')::numeric)
      FROM jsonb_array_elements(p_items) e
     GROUP BY 1 ORDER BY 1;
END;
$$;

-- ── Aprobar el despacho de un retiro ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.approve_material_request(p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_me uuid := auth.uid();
  v_tenant uuid := public.get_my_tenant_id();
  v_name text;
  r public.material_requests%ROWTYPE;
  v_it record; v_out jsonb; v_items jsonb := '[]'::jsonb; v_class text := 'C';
BEGIN
  IF v_me IS NULL OR v_tenant IS NULL THEN RAISE EXCEPTION 'No autenticado o sin inquilino.'; END IF;
  SELECT name INTO v_name FROM public.profiles WHERE id = v_me;

  SELECT * INTO r FROM public.material_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La solicitud no existe.'; END IF;
  IF r.tenant_id IS DISTINCT FROM v_tenant THEN RAISE EXCEPTION 'No tienes permiso para modificar esta solicitud.'; END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'Esta solicitud ya fue %.', CASE r.status WHEN 'approved' THEN 'aprobada' ELSE 'rechazada' END;
  END IF;
  IF r.adc_authorized_at IS NULL THEN
    RAISE EXCEPTION 'Esta solicitud aún no ha sido autorizada por el ADC. No puede aprobarse en el pañol.';
  END IF;

  FOR v_it IN SELECT * FROM public._merge_items(r.items) LOOP
    v_out := public._withdraw_item(
      v_tenant, v_it.material_id, v_it.qty, r.contract_id, r.contract_name, NULL,
      p_request::text, 'Entrega para solicitud ' || COALESCE(r.internal_code, p_request::text),
      r.supervisor_id, r.supervisor_name
    );
    v_items := v_items || jsonb_build_array(v_out);
    IF public._class_rank(v_out->>'class') > public._class_rank(v_class) THEN v_class := v_out->>'class'; END IF;
  END LOOP;

  -- La clase REAL (de los materiales) queda guardada: corrige un retiro viejo que nació como clase A.
  UPDATE public.material_requests
     SET status = 'approved', approval_date = now(), approver_id = v_me, approver_name = v_name, highest_class = v_class
   WHERE id = p_request;

  RETURN jsonb_build_object('code', r.internal_code, 'contract_id', r.contract_id, 'contract_name', r.contract_name,
                            'class', v_class, 'items', v_items);
END;
$$;

-- ── Anular un despacho aprobado que nadie retiró ─────────────────────────────

CREATE OR REPLACE FUNCTION public.cancel_approved_material_request(p_request uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_me uuid := auth.uid();
  v_tenant uuid := public.get_my_tenant_id();
  v_name text;
  v_why text := btrim(COALESCE(p_reason, ''));
  r public.material_requests%ROWTYPE;
  v_it record; v_items jsonb := '[]'::jsonb;
BEGIN
  IF v_me IS NULL OR v_tenant IS NULL THEN RAISE EXCEPTION 'No autenticado o sin inquilino.'; END IF;
  IF v_why = '' THEN RAISE EXCEPTION 'Indica el motivo de la anulación.'; END IF;
  SELECT name INTO v_name FROM public.profiles WHERE id = v_me;

  SELECT * INTO r FROM public.material_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La solicitud no existe.'; END IF;
  IF r.tenant_id IS DISTINCT FROM v_tenant THEN RAISE EXCEPTION 'No tienes permiso para modificar esta solicitud.'; END IF;
  IF r.delivery_date IS NOT NULL THEN
    RAISE EXCEPTION 'Este despacho ya fue entregado: no se puede anular. Si el trabajador lo devuelve, regístralo como devolución.';
  END IF;
  IF r.status <> 'approved' THEN RAISE EXCEPTION 'Sólo se puede anular un despacho que está aprobado.'; END IF;

  FOR v_it IN SELECT * FROM public._merge_items(r.items) LOOP
    v_items := v_items || jsonb_build_array(public._restock_item(
      v_tenant, v_it.material_id, v_it.qty, r.contract_id, r.contract_name, NULL,
      p_request::text, 'Anulación de despacho aprobado (' || COALESCE(r.internal_code, p_request::text) || '): ' || v_why,
      v_me, v_name, 'cancel', NULL
    ));
  END LOOP;

  -- Vuelve a «por aprobar» (sigue autorizado por el ADC).
  UPDATE public.material_requests
     SET status = 'pending', approval_date = NULL, approver_id = NULL, approver_name = NULL
   WHERE id = p_request;

  RETURN jsonb_build_object('code', r.internal_code, 'items', v_items);
END;
$$;

-- ── Resolver una devolución pendiente ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.complete_return_request(
  p_return uuid, p_status text, p_condition text DEFAULT NULL, p_evidence text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_me uuid := auth.uid();
  v_tenant uuid := public.get_my_tenant_id();
  v_name text;
  r public.return_requests%ROWTYPE;
  v_out jsonb;
BEGIN
  IF v_me IS NULL OR v_tenant IS NULL THEN RAISE EXCEPTION 'No autenticado o sin inquilino.'; END IF;
  IF p_status NOT IN ('completed', 'rejected') THEN RAISE EXCEPTION 'Estado de devolución no válido.'; END IF;
  SELECT name INTO v_name FROM public.profiles WHERE id = v_me;

  SELECT * INTO r FROM public.return_requests WHERE id = p_return FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La solicitud de devolución no existe.'; END IF;
  IF r.tenant_id IS DISTINCT FROM v_tenant THEN RAISE EXCEPTION 'No tienes permiso para modificar esta devolución.'; END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'Esta devolución ya fue %.', CASE r.status WHEN 'completed' THEN 'completada' ELSE 'rechazada' END;
  END IF;

  UPDATE public.return_requests
     SET status = p_status, completion_date = now(), handler_id = v_me, handler_name = v_name,
         return_condition = p_condition, evidence_url = p_evidence
   WHERE id = p_return;

  IF p_status = 'completed' THEN
    v_out := public._restock_item(
      v_tenant, r.material_id, r.quantity, r.contract_id, r.contract_name, NULL,
      p_return::text, 'Devolución de solicitud ' || COALESCE(r.internal_code, p_return::text),
      r.supervisor_id, r.supervisor_name, 'return', p_condition
    );
  END IF;

  RETURN jsonb_build_object('code', r.internal_code, 'notes', r.notes, 'restocked', v_out);
END;
$$;

-- ── Entrega directa en ventanilla: retiro + descuento, juntos ────────────────

CREATE OR REPLACE FUNCTION public.deliver_directly(
  p_code text, p_items jsonb, p_area text, p_contract_id uuid, p_contract_name text, p_supervisor uuid,
  p_warehouse uuid, p_contract_url text, p_requires_review boolean, p_max_class text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_me uuid := auth.uid();
  v_tenant uuid := public.get_my_tenant_id();
  v_my_name text; v_sup_name text; v_reviewer uuid;
  v_it record; v_out jsonb; v_items jsonb := '[]'::jsonb; v_class text := 'C'; v_id uuid;
  v_merged jsonb := '[]'::jsonb;
BEGIN
  IF v_me IS NULL OR v_tenant IS NULL THEN RAISE EXCEPTION 'No autenticado o sin inquilino.'; END IF;
  SELECT name INTO v_my_name FROM public.profiles WHERE id = v_me;
  SELECT name INTO v_sup_name FROM public.profiles WHERE id = p_supervisor AND tenant_id = v_tenant;
  v_sup_name := COALESCE(v_sup_name, 'Usuario');
  IF COALESCE(p_requires_review, false) THEN
    SELECT responsible_supervisor_id INTO v_reviewer FROM public.profiles WHERE id = p_supervisor AND tenant_id = v_tenant;
  END IF;

  FOR v_it IN SELECT * FROM public._merge_items(p_items) LOOP
    v_out := public._withdraw_item(
      v_tenant, v_it.material_id, v_it.qty, p_contract_id, p_contract_name, p_warehouse,
      p_code, 'Entrega inmediata en Pañol' || CASE WHEN COALESCE(p_requires_review, false) THEN ' con revisión posterior' ELSE '' END || ' (TX: ' || p_code || ')',
      p_supervisor, v_sup_name, p_max_class
    );
    v_items := v_items || jsonb_build_array(v_out);
    v_merged := v_merged || jsonb_build_array(jsonb_build_object('materialId', v_it.material_id, 'quantity', v_it.qty));
    IF public._class_rank(v_out->>'class') > public._class_rank(v_class) THEN v_class := v_out->>'class'; END IF;
  END LOOP;

  INSERT INTO public.material_requests (
    internal_code, items, area, contract_id, contract_name, supervisor_id, supervisor_name, highest_class, status,
    tenant_id, approval_date, delivery_date, approver_id, approver_name, adc_authorized_at, adc_authorized_by,
    contract_url, delivery_mode, received_by_user_id, received_by_user_name, requires_review, reviewer_supervisor_id, created_at
  ) VALUES (
    p_code, v_merged, p_area, p_contract_id, p_contract_name, p_supervisor, v_sup_name, v_class, 'approved',
    v_tenant, now(), now(), v_me, v_my_name, now(), v_me,
    p_contract_url, 'self', p_supervisor, v_sup_name, COALESCE(p_requires_review, false), v_reviewer, now()
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('request_id', v_id, 'code', p_code, 'class', v_class, 'items', v_items);
END;
$$;

-- ── Devolución directa en ventanilla: devolución + reingreso, juntos ─────────

CREATE OR REPLACE FUNCTION public.return_directly(
  p_code text, p_material uuid, p_quantity numeric, p_material_name text, p_unit text, p_condition text,
  p_notes text, p_evidence text, p_worker uuid, p_worker_name text, p_contract_id uuid, p_contract_name text,
  p_warehouse uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_me uuid := auth.uid();
  v_tenant uuid := public.get_my_tenant_id();
  v_my_name text; v_out jsonb;
BEGIN
  IF v_me IS NULL OR v_tenant IS NULL THEN RAISE EXCEPTION 'No autenticado o sin inquilino.'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'Las cantidades deben ser mayores que cero.'; END IF;
  SELECT name INTO v_my_name FROM public.profiles WHERE id = v_me;

  INSERT INTO public.return_requests (
    internal_code, supervisor_id, supervisor_name, material_id, material_name, quantity, unit, status, completion_date,
    notes, tenant_id, handler_id, handler_name, return_condition, evidence_url, contract_id, contract_name, created_at, items
  ) VALUES (
    p_code, p_worker, p_worker_name, p_material, p_material_name, p_quantity, p_unit, 'completed', now(),
    COALESCE(p_notes, ''), v_tenant, v_me, v_my_name, p_condition, p_evidence, p_contract_id, p_contract_name, now(),
    jsonb_build_array(jsonb_build_object('materialId', p_material, 'quantity', p_quantity, 'condition', p_condition))
  );

  v_out := public._restock_item(
    v_tenant, p_material, p_quantity, p_contract_id, p_contract_name, p_warehouse,
    p_code, 'Devolución inmediata en Pañol (TX: ' || p_code || ')', p_worker, p_worker_name, 'return', p_condition
  );

  RETURN jsonb_build_object('code', p_code, 'restocked', v_out);
END;
$$;

-- ── Permisos ─────────────────────────────────────────────────────────────────
-- Los ayudantes no se llaman desde fuera; las cinco funciones públicas, sólo con sesión.
REVOKE ALL ON FUNCTION public._class_rank(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ledger_add(uuid, uuid, uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._src_add(jsonb, uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ledger_consume(uuid, uuid, uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._src_note(jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._withdraw_item(uuid, uuid, numeric, uuid, text, uuid, text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._restock_item(uuid, uuid, numeric, uuid, text, uuid, text, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._merge_items(jsonb) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.approve_material_request(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_approved_material_request(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_return_request(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.deliver_directly(text, jsonb, text, uuid, text, uuid, uuid, text, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.return_directly(text, uuid, numeric, text, text, text, text, text, uuid, text, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_material_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_approved_material_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_return_request(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deliver_directly(text, jsonb, text, uuid, text, uuid, uuid, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_directly(text, uuid, numeric, text, text, text, text, text, uuid, text, uuid, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
