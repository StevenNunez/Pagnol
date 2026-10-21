-- ════════════════════════════════════════════════════════════════════════════
-- Desvinculación de trabajadores (por contrato o de la empresa)
--
-- Pedido de la reunión del 2026-10-20. Una desvinculación NO borra a la persona
-- ni su historial: es un HECHO (Artículo 2 del manifiesto) que cambia el estado
-- de su vínculo y corta lo que corresponde:
--
--   scope 'company'  → sale de la empresa: employment_status = 'terminated',
--                      is_active = false (la sesión se cierra y las políticas la
--                      dejan fuera, ver 20260903000000) y se cierran todas sus
--                      asignaciones a contratos.
--   scope 'contract' → sale de UN contrato (fin de obra, traslado de faena):
--                      se cierra su asignación en ese contrato (end_date) y sigue
--                      activo en la empresa y en sus otros contratos.
--
-- No son lo mismo que el cambio de supervisor (profiles.responsible_supervisor_id)
-- ni que sumar a alguien a otro contrato: cada uno es su propio proceso.
--
-- La reincorporación es otro hecho (kind = 'reinstatement'), nunca un UPDATE
-- sobre el anterior. Todo se escribe por funciones: nadie inserta a mano.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.worker_separations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Sin ON DELETE: la persona no se borra; si algún día se purga, que falle a la vista.
  worker_id     uuid NOT NULL REFERENCES public.profiles(id),
  -- Copias del día del hecho: si el perfil cambia, el registro conserva lo que valía.
  worker_name   text NOT NULL,
  worker_rut    text,
  kind          text NOT NULL DEFAULT 'separation' CHECK (kind IN ('separation', 'reinstatement')),
  scope         text NOT NULL CHECK (scope IN ('company', 'contract')),
  contract_id   uuid,
  contract_name text,
  effective_date date NOT NULL,
  reason_kind   text CHECK (reason_kind IN ('renuncia', 'despido', 'termino_contrato', 'termino_obra', 'traslado', 'otro')),
  reason        text NOT NULL CHECK (length(btrim(reason)) > 0),
  -- Herramientas / equipos que tenía en su poder al irse: [{materialId, name, since}].
  pending_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by      uuid NOT NULL REFERENCES public.profiles(id),
  created_by_name text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT worker_separations_contract_matches_scope
    CHECK ((scope = 'contract') = (contract_id IS NOT NULL)),
  CONSTRAINT worker_separations_kind_reason
    CHECK (kind = 'reinstatement' OR reason_kind IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_worker_separations_tenant
  ON public.worker_separations (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_separations_worker
  ON public.worker_separations (worker_id, created_at DESC);

ALTER TABLE public.worker_separations ENABLE ROW LEVEL SECURITY;

-- El motivo de una desvinculación es dato laboral sensible: lo ve quien gestiona
-- RR.HH. Los demás se enteran por los avisos (qué falta devolver), no por el motivo.
DROP POLICY IF EXISTS "worker_separations_select" ON public.worker_separations;
CREATE POLICY "worker_separations_select" ON public.worker_separations
  FOR SELECT USING (
    tenant_id = public.get_my_tenant_id() AND public.can_manage_hr()
  );

GRANT SELECT ON public.worker_separations TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.worker_separations FROM authenticated;

-- ── Desvincular ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.separate_worker(
  p_worker       uuid,
  p_scope        text,
  p_contract     uuid,
  p_effective    date,
  p_reason_kind  text,
  p_reason       text,
  p_pending      jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_me     uuid := auth.uid();
  v_actor  record;
  w        record;
  v_cname  text;
  v_id     uuid;
BEGIN
  IF v_me IS NULL OR NOT public.can_manage_hr() THEN
    RAISE EXCEPTION 'No autorizado: no puedes desvincular trabajadores.' USING ERRCODE = '42501';
  END IF;
  SELECT id, name, tenant_id INTO v_actor FROM public.profiles WHERE id = v_me;

  SELECT id, name, rut, tenant_id, role, employment_status INTO w
  FROM public.profiles WHERE id = p_worker AND deleted_at IS NULL;
  IF NOT FOUND OR (w.tenant_id IS DISTINCT FROM v_actor.tenant_id AND NOT public.is_super_admin()) THEN
    RAISE EXCEPTION 'No se encontró al trabajador.' USING ERRCODE = 'P0002';
  END IF;
  IF w.id = v_me THEN
    RAISE EXCEPTION 'No puedes desvincularte a ti mismo.' USING ERRCODE = '42501';
  END IF;
  IF w.role = 'super-admin' THEN
    RAISE EXCEPTION 'No se puede desvincular a un super-administrador.' USING ERRCODE = '42501';
  END IF;
  IF p_scope NOT IN ('company', 'contract') THEN
    RAISE EXCEPTION 'Indica si es una desvinculación del contrato o de la empresa.';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Escribe el motivo de la desvinculación.';
  END IF;
  IF p_effective IS NULL OR p_effective > current_date THEN
    -- Una fecha futura dejaría a la persona operando hoy con la baja ya registrada.
    RAISE EXCEPTION 'La fecha de desvinculación no puede ser futura.';
  END IF;
  IF w.employment_status = 'terminated' THEN
    RAISE EXCEPTION 'Esta persona ya está desvinculada de la empresa.';
  END IF;

  IF p_scope = 'contract' THEN
    IF p_contract IS NULL THEN
      RAISE EXCEPTION 'Elige el contrato del que se desvincula.';
    END IF;
    SELECT c.name INTO v_cname
    FROM public.contract_workers cw
    JOIN public.contracts c ON c.id = cw.contract_id
    WHERE cw.contract_id = p_contract AND cw.user_id = p_worker
      AND cw.tenant_id = w.tenant_id AND cw.end_date IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Esta persona no tiene una asignación vigente en ese contrato.';
    END IF;
    UPDATE public.contract_workers SET end_date = p_effective
    WHERE contract_id = p_contract AND user_id = p_worker AND end_date IS NULL;
  ELSE
    p_contract := NULL;
    UPDATE public.contract_workers SET end_date = p_effective
    WHERE user_id = p_worker AND tenant_id = w.tenant_id AND end_date IS NULL;
    UPDATE public.profiles
    SET employment_status = 'terminated', is_active = false
    WHERE id = p_worker;
  END IF;

  INSERT INTO public.worker_separations (
    tenant_id, worker_id, worker_name, worker_rut, kind, scope, contract_id, contract_name,
    effective_date, reason_kind, reason, pending_items, created_by, created_by_name
  ) VALUES (
    w.tenant_id, w.id, w.name, w.rut, 'separation', p_scope, p_contract, v_cname,
    p_effective, p_reason_kind, btrim(p_reason), COALESCE(p_pending, '[]'::jsonb), v_actor.id, v_actor.name
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ── Reincorporar ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reinstate_worker(
  p_worker     uuid,
  p_scope      text,
  p_contract   uuid,
  p_effective  date,
  p_reason     text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_me     uuid := auth.uid();
  v_actor  record;
  w        record;
  v_cname  text;
  v_id     uuid;
BEGIN
  IF v_me IS NULL OR NOT public.can_manage_hr() THEN
    RAISE EXCEPTION 'No autorizado: no puedes reincorporar trabajadores.' USING ERRCODE = '42501';
  END IF;
  SELECT id, name, tenant_id INTO v_actor FROM public.profiles WHERE id = v_me;

  SELECT id, name, rut, tenant_id, employment_status INTO w
  FROM public.profiles WHERE id = p_worker AND deleted_at IS NULL;
  IF NOT FOUND OR (w.tenant_id IS DISTINCT FROM v_actor.tenant_id AND NOT public.is_super_admin()) THEN
    RAISE EXCEPTION 'No se encontró al trabajador.' USING ERRCODE = 'P0002';
  END IF;
  IF p_scope NOT IN ('company', 'contract') THEN
    RAISE EXCEPTION 'Indica si es una reincorporación al contrato o a la empresa.';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Escribe el motivo de la reincorporación.';
  END IF;
  IF p_effective IS NULL OR p_effective > current_date THEN
    RAISE EXCEPTION 'La fecha no puede ser futura.';
  END IF;

  IF p_scope = 'company' THEN
    IF w.employment_status IS DISTINCT FROM 'terminated' THEN
      RAISE EXCEPTION 'Esta persona no está desvinculada de la empresa.';
    END IF;
    UPDATE public.profiles SET employment_status = 'active', is_active = true WHERE id = p_worker;
    p_contract := NULL;
  ELSE
    IF p_contract IS NULL THEN
      RAISE EXCEPTION 'Elige el contrato al que se reincorpora.';
    END IF;
    IF w.employment_status = 'terminated' THEN
      RAISE EXCEPTION 'Primero reincorpórala a la empresa.';
    END IF;
    SELECT c.name INTO v_cname
    FROM public.contract_workers cw JOIN public.contracts c ON c.id = cw.contract_id
    WHERE cw.contract_id = p_contract AND cw.user_id = p_worker
      AND cw.tenant_id = w.tenant_id AND cw.end_date IS NOT NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Esa asignación no está cerrada.';
    END IF;
    UPDATE public.contract_workers SET end_date = NULL
    WHERE contract_id = p_contract AND user_id = p_worker;
  END IF;

  INSERT INTO public.worker_separations (
    tenant_id, worker_id, worker_name, worker_rut, kind, scope, contract_id, contract_name,
    effective_date, reason_kind, reason, pending_items, created_by, created_by_name
  ) VALUES (
    w.tenant_id, w.id, w.name, w.rut, 'reinstatement', p_scope, p_contract, v_cname,
    p_effective, NULL, btrim(p_reason), '[]'::jsonb, v_actor.id, v_actor.name
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.separate_worker(uuid, text, uuid, date, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reinstate_worker(uuid, text, uuid, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.separate_worker(uuid, text, uuid, date, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reinstate_worker(uuid, text, uuid, date, text) TO authenticated;

-- ── Nadie desvinculado retira nada ───────────────────────────────────────────
-- La base manda, no la pantalla. Se mira a quien pide, al beneficiario y a quien
-- recibe. Bloquea el ALTA de un retiro y también el momento en que una solicitud
-- ya existente pasa a entregada (si no, bastaría pedirla antes de la baja y
-- retirarla después). Las devoluciones siguen funcionando: lo que tenía en su
-- poder tiene que poder volver.
--   · desvinculado de la empresa → no retira nada, en ningún contrato;
--   · desvinculado de ESE contrato → no retira imputando a ese contrato.
CREATE OR REPLACE FUNCTION public.material_requests_block_separated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ids  text[] := ARRAY[NEW.supervisor_id::text, NEW.beneficiary_id::text, NEW.received_by_user_id::text];
  v_name text;
BEGIN
  -- En un UPDATE sólo importa el paso a «aprobada» (entregada); el resto de las
  -- ediciones de la solicitud no entrega nada.
  IF TG_OP = 'UPDATE' AND NOT (NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved') THEN
    RETURN NEW;
  END IF;

  SELECT p.name INTO v_name
  FROM public.profiles p
  WHERE p.id::text = ANY (v_ids) AND p.employment_status = 'terminated'
  LIMIT 1;
  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION '% fue desvinculado/a de la empresa y no puede retirar materiales ni herramientas.', v_name
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.contract_id IS NOT NULL THEN
    SELECT p.name INTO v_name
    FROM public.contract_workers cw
    JOIN public.profiles p ON p.id = cw.user_id
    WHERE cw.contract_id::text = NEW.contract_id::text
      AND cw.user_id::text = ANY (v_ids)
      AND cw.end_date IS NOT NULL AND cw.end_date <= current_date
      -- Si volvió a ser asignado, hay otra fila vigente: no se bloquea.
      AND NOT EXISTS (
        SELECT 1 FROM public.contract_workers cw2
        WHERE cw2.contract_id = cw.contract_id AND cw2.user_id = cw.user_id AND cw2.end_date IS NULL
      )
    LIMIT 1;
    IF v_name IS NOT NULL THEN
      RAISE EXCEPTION '% fue desvinculado/a de este contrato y no puede retirar para él.', v_name
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_material_requests_block_separated ON public.material_requests;
CREATE TRIGGER trg_material_requests_block_separated
  BEFORE INSERT OR UPDATE OF status ON public.material_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.material_requests_block_separated();

NOTIFY pgrst, 'reload schema';
