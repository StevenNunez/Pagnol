-- Pañoles con VARIOS encargados (turnos).
--
-- POR QUÉ: un pañol sólo podía tener UN encargado (`warehouses.manager_id`), pero el pañol trabaja por turnos:
-- en el mismo pañol atienden dos o tres pañoleros, y ahí hay que poder asignarlos a todos. Con uno solo, el
-- segundo pañolero del turno quedaba sin pañol asignado (sus movimientos no se imputaban a ninguno) y no podía
-- recibir lo que llegaba a su pañol.
--
-- Qué hace:
--   1) `warehouses.manager_ids uuid[]`: la lista de encargados. Va en la propia fila (con su RLS y su Realtime),
--      sin tabla aparte; se llena desde `manager_id` para no perder a nadie.
--   2) `manager_id` queda como ESPEJO del primero de la lista (el «principal»), mantenido por un trigger en los dos
--      sentidos para que nunca se desfasen: así lo que aún lea o escriba `manager_id` (una pestaña con la versión
--      anterior durante el despliegue) sigue funcionando. Es transitorio: cuando se confirme que nada lo usa, se
--      elimina junto con el trigger (y `manager_name`, que con varios encargados ya no tiene sentido).
--   3) `receive_expected_purchase` y `correct_expected_receipt`: recibir (y corregir una recepción) en un pañol con
--      encargados sólo se permite a cualquiera de ellos o a administración. Es el MISMO texto de la migración
--      20261028000000 salvo el chequeo del encargado (8 líneas); no cambia nada más.
--
-- No cambia quién PUEDE recibir compras (`can_receive_expected_purchases()`): ser encargado de un pañol acota a qué
-- pañol puede recibir una persona que ya puede recibir, no le da el permiso.

ALTER TABLE public.warehouses ADD COLUMN IF NOT EXISTS manager_ids uuid[] NOT NULL DEFAULT '{}';

UPDATE public.warehouses SET manager_ids = ARRAY[manager_id]
 WHERE manager_id IS NOT NULL AND cardinality(manager_ids) = 0;

-- Sin repetidos ni nulos, conservando el orden (el primero es el principal).
CREATE OR REPLACE FUNCTION public.warehouses_sync_managers()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF cardinality(NEW.manager_ids) = 0 AND NEW.manager_id IS NOT NULL THEN
      NEW.manager_ids := ARRAY[NEW.manager_id];
    END IF;
  ELSIF NEW.manager_ids IS NOT DISTINCT FROM OLD.manager_ids AND NEW.manager_id IS DISTINCT FROM OLD.manager_id THEN
    -- Quien escribió sólo `manager_id` (versión anterior): ese pasa a ser el principal y los demás se conservan.
    NEW.manager_ids := CASE WHEN NEW.manager_id IS NULL THEN '{}'::uuid[]
                            ELSE ARRAY[NEW.manager_id] || array_remove(OLD.manager_ids, NEW.manager_id) END;
  END IF;
  NEW.manager_ids := COALESCE(ARRAY(
    SELECT x FROM unnest(NEW.manager_ids) WITH ORDINALITY t(x, i)
     WHERE x IS NOT NULL GROUP BY x ORDER BY min(i)
  ), '{}'::uuid[]);
  NEW.manager_id := NEW.manager_ids[1];
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_warehouses_sync_managers ON public.warehouses;
CREATE TRIGGER trg_warehouses_sync_managers
  BEFORE INSERT OR UPDATE OF manager_id, manager_ids ON public.warehouses
  FOR EACH ROW EXECUTE FUNCTION public.warehouses_sync_managers();

CREATE INDEX IF NOT EXISTS idx_warehouses_manager_ids ON public.warehouses USING gin (manager_ids);

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
  v_mgrs   uuid[];
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

  SELECT manager_ids INTO v_mgrs FROM public.warehouses WHERE id = v_p.warehouse_id;
  IF cardinality(COALESCE(v_mgrs, '{}')) > 0 AND NOT (v_me = ANY(v_mgrs)) AND v_prof.role NOT IN ('super-admin', 'administrador', 'soporte-pagnol') THEN
    RAISE EXCEPTION 'Esta compra viene a un pañol que atienden otras personas.' USING ERRCODE = '42501';
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
  v_mgrs   uuid[];
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

  SELECT manager_ids INTO v_mgrs FROM public.warehouses WHERE id = v_rc.warehouse_id;
  IF cardinality(COALESCE(v_mgrs, '{}')) > 0 AND NOT (v_me = ANY(v_mgrs)) AND v_prof.role NOT IN ('super-admin', 'administrador', 'soporte-pagnol') THEN
    RAISE EXCEPTION 'Esa recepción fue a un pañol que atienden otras personas.' USING ERRCODE = '42501';
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

NOTIFY pgrst, 'reload schema';
