-- RFC-006 F2 — Propuesta de compra y firma por monto ANTES de la OC.
--
-- "Si tengo que hacer la OC para que me autoricen, no me sirve" (Steven). La
-- firma va sobre una PROPUESTA (proveedor elegido + precios + total con IVA) y
-- recién con la propuesta firmada se emite UNA OC, la definitiva.
--
-- Lo que esta migración deja en la BASE (no sólo en la pantalla), porque hay
-- tres caminos que crean una OC y un cliente puede llamarlos directo:
--   1. Quién firma lo calcula la base al crear la propuesta (tramos de la
--      empresa + ADC de cada contrato). La pantalla sólo muestra una vista previa.
--   2. Las firmas son hechos inmutables con autor; sólo firma quien corresponde.
--   3. Ninguna OC nace sin una propuesta firmada, del mismo proveedor, por un
--      monto que no pase lo firmado, y una propuesta sirve para UNA OC.
--
-- El estado de una propuesta (pendiente / firmada / rechazada / retirada) NO se
-- guarda: se DERIVA de las firmas (approval_proposal_state). La misma regla
-- vive en TS (approvalMath.deriveProposalState): si cambias una, cambia la otra.

-- ── Propuestas ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.approval_proposals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  internal_code     text,
  kind              text NOT NULL CHECK (kind IS NOT NULL AND kind IN ('purchase', 'rental', 'withdrawal')),
  source_type       text NOT NULL CHECK (source_type IS NOT NULL AND source_type IN ('rfq', 'lot')),
  source_id         uuid,
  quote_id          text,
  request_ids       uuid[] NOT NULL DEFAULT '{}',
  supplier_id       uuid,
  supplier_name     text,
  -- [{ requestId?, name, unit, quantity, unitPrice? }]
  items             jsonb NOT NULL DEFAULT '[]'::jsonb,
  net_total         numeric NOT NULL CHECK (net_total IS NOT NULL AND net_total > 0),
  vat_rate          numeric NOT NULL,
  gross_total       numeric NOT NULL,
  tier              text NOT NULL CHECK (tier IS NOT NULL AND tier IN ('adc', 'gerente')),
  escalated         boolean NOT NULL DEFAULT false,
  escalation_reason text,
  -- [{ kind:'adc', contractId, contractName, userId } | { kind:'gerente' }] — lo fija el trigger.
  required_signers  jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Foto de las demás ofertas al momento de proponer (para que el firmante compare).
  comparison        jsonb,
  -- RFC-006 F3 (urgencias): comprar ya, firmar después.
  urgent            boolean NOT NULL DEFAULT false,
  urgency_reason    text,
  created_by        uuid NOT NULL,
  created_by_name   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  withdrawn_at      timestamptz,
  withdrawn_by      uuid,
  withdrawn_reason  text,
  CONSTRAINT approval_proposals_escalation_reason CHECK (
    escalated = false OR (escalation_reason IS NOT NULL AND length(trim(escalation_reason)) >= 5)
  ),
  CONSTRAINT approval_proposals_urgency_reason CHECK (
    urgent = false OR (urgency_reason IS NOT NULL AND length(trim(urgency_reason)) >= 5)
  )
);

CREATE INDEX IF NOT EXISTS approval_proposals_tenant_idx ON public.approval_proposals (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS approval_proposals_source_idx ON public.approval_proposals (tenant_id, source_type, source_id);

COMMENT ON TABLE public.approval_proposals IS
  'RFC-006 F2: propuesta de compra (proveedor + precios + total con IVA) que se firma ANTES de emitir la OC. '
  'Inmutable salvo el retiro. Su estado se deriva de approval_signatures (approval_proposal_state).';

-- ── Firmas (hechos inmutables) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.approval_signatures (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  proposal_id  uuid NOT NULL REFERENCES public.approval_proposals(id) ON DELETE CASCADE,
  slot_kind    text NOT NULL CHECK (slot_kind IS NOT NULL AND slot_kind IN ('adc', 'gerente')),
  contract_id  uuid,
  signer_id    uuid NOT NULL,
  signer_name  text,
  decision     text NOT NULL CHECK (decision IS NOT NULL AND decision IN ('approved', 'rejected')),
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Rechazar se explica: Abastecimiento y el supervisor lo van a leer.
  CONSTRAINT approval_signatures_reject_note CHECK (
    decision = 'approved' OR (note IS NOT NULL AND length(trim(note)) >= 5)
  ),
  -- Cada puesto de firma se firma una sola vez.
  CONSTRAINT approval_signatures_one_per_slot UNIQUE NULLS NOT DISTINCT (proposal_id, slot_kind, contract_id)
);

CREATE INDEX IF NOT EXISTS approval_signatures_proposal_idx ON public.approval_signatures (proposal_id);

COMMENT ON TABLE public.approval_signatures IS
  'RFC-006 F2: firmas de las propuestas. Hechos inmutables (sin UPDATE ni DELETE). '
  'El trigger fija signer_id = auth.uid() y verifica que quien firma sea quien corresponde.';

-- ── Estado derivado ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approval_proposal_state(p_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p.withdrawn_at IS NOT NULL THEN 'withdrawn'
    WHEN EXISTS (SELECT 1 FROM public.approval_signatures s
                  WHERE s.proposal_id = p.id AND s.decision = 'rejected') THEN 'rejected'
    WHEN jsonb_array_length(p.required_signers) > 0 AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p.required_signers) AS slot
       WHERE NOT EXISTS (
         SELECT 1 FROM public.approval_signatures s
          WHERE s.proposal_id = p.id AND s.decision = 'approved'
            AND s.slot_kind = slot->>'kind'
            AND (slot->>'kind' = 'gerente' OR s.contract_id::text = slot->>'contractId')
       )
    ) THEN 'approved'
    ELSE 'pending'
  END
  FROM public.approval_proposals p
  WHERE p.id = p_id;
$$;

REVOKE ALL ON FUNCTION public.approval_proposal_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approval_proposal_state(uuid) TO authenticated, service_role;

-- ── Al crear una propuesta: la base decide quién firma ────────────────────────
CREATE OR REPLACE FUNCTION public.approval_proposals_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_settings  jsonb;
  v_adc_max   numeric;
  v_vat       numeric;
  v_rfq       record;
  v_resp      jsonb;
  v_sum       numeric;
  v_all_priced boolean;
  v_signers   jsonb := '[]'::jsonb;
  v_missing   text;
  v_contracts int;
BEGIN
  IF NEW.kind <> 'purchase' THEN
    RAISE EXCEPTION 'Por ahora sólo se firman propuestas de compra.' USING ERRCODE = 'check_violation';
  END IF;

  -- Autor: quien está conectado (no se acepta uno ajeno).
  IF auth.uid() IS NOT NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  NEW.created_at := now();
  NEW.withdrawn_at := NULL; NEW.withdrawn_by := NULL; NEW.withdrawn_reason := NULL;

  -- Origen RFQ: proveedor, pedidos y monto salen de la cotización guardada,
  -- no de lo que mande la pantalla.
  IF NEW.source_type = 'rfq' THEN
    SELECT * INTO v_rfq FROM public.quote_requests WHERE id = NEW.source_id AND tenant_id = NEW.tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La cotización (RFQ) no existe.' USING ERRCODE = 'foreign_key_violation';
    END IF;
    SELECT r INTO v_resp FROM jsonb_array_elements(COALESCE(v_rfq.responses, '[]'::jsonb)) AS r
     WHERE r->>'id' = NEW.quote_id;
    IF v_resp IS NULL THEN
      RAISE EXCEPTION 'La oferta elegida no está en la RFQ.' USING ERRCODE = 'foreign_key_violation';
    END IF;
    -- quote_requests.request_ids es jsonb (no uuid[]): se convierte elemento a elemento.
    NEW.request_ids   := COALESCE((SELECT array_agg(e::uuid)
                                     FROM jsonb_array_elements_text(to_jsonb(v_rfq.request_ids)) AS e), '{}');
    NEW.supplier_id   := NULLIF(v_resp->>'supplierId', '')::uuid;
    NEW.supplier_name := v_resp->>'supplierName';
    NEW.net_total     := round((v_resp->>'totalPrice')::numeric);
  ELSE
    -- Origen lote: el neto es la suma de las líneas.
    SELECT COALESCE(SUM((i->>'quantity')::numeric * (i->>'unitPrice')::numeric), 0),
           bool_and(COALESCE((i->>'unitPrice')::numeric, 0) > 0 AND COALESCE((i->>'quantity')::numeric, 0) > 0)
      INTO v_sum, v_all_priced
      FROM jsonb_array_elements(NEW.items) AS i;
    IF NOT COALESCE(v_all_priced, false) THEN
      RAISE EXCEPTION 'Todas las líneas necesitan cantidad y precio unitario.' USING ERRCODE = 'check_violation';
    END IF;
    NEW.net_total := round(v_sum);
  END IF;

  IF COALESCE(array_length(NEW.request_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'La propuesta no tiene pedidos de origen.' USING ERRCODE = 'check_violation';
  END IF;

  -- Los pedidos tienen que existir en la empresa y haber pasado las etapas
  -- previas (revisión del Jefe de Operaciones y autorización del ADC).
  IF (SELECT COUNT(*) FROM public.purchase_requests pr
       WHERE pr.id = ANY (NEW.request_ids) AND pr.tenant_id = NEW.tenant_id
         AND pr.adc_authorized_at IS NOT NULL
         AND pr.status NOT IN ('rejected', 'received', 'ordered'))
     <> (SELECT COUNT(DISTINCT x) FROM unnest(NEW.request_ids) AS x) THEN
    RAISE EXCEPTION 'Algún pedido no existe, ya se compró o todavía no pasa la autorización.' USING ERRCODE = 'check_violation';
  END IF;

  -- Las compras urgentes (comprar ya, firmar después) llegan con su regla en la
  -- fase siguiente. Mientras tanto no se aceptan: serían una OC sin firma.
  IF NEW.urgent THEN
    RAISE EXCEPTION 'Las compras urgentes todavía no están habilitadas.' USING ERRCODE = 'check_violation';
  END IF;

  -- Tramos de la empresa (sin configurar = los de Valar).
  SELECT approval_settings INTO v_settings FROM public.tenants WHERE id = NEW.tenant_id;
  v_adc_max := COALESCE(NULLIF(v_settings->>'adcMaxGross', '')::numeric, 500000);
  v_vat     := COALESCE(NULLIF(v_settings->>'vatRate', '')::numeric, 0.19);
  NEW.vat_rate    := v_vat;
  NEW.gross_total := round(NEW.net_total * (1 + v_vat));

  -- Escalar sólo sube: si el monto ya va al Gerente, no queda marcado como escalado.
  IF NEW.gross_total > v_adc_max THEN
    NEW.escalated := false;
    NEW.escalation_reason := NULL;
  END IF;

  IF NEW.gross_total > v_adc_max OR NEW.escalated THEN
    NEW.tier := 'gerente';
    NEW.required_signers := '[{"kind":"gerente"}]'::jsonb;
  ELSE
    NEW.tier := 'adc';
    SELECT COUNT(DISTINCT c.id),
           string_agg(DISTINCT c.name, ', ') FILTER (WHERE c.adc_user_id IS NULL),
           COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
             'kind', 'adc', 'contractId', c.id, 'contractName', c.name, 'userId', c.adc_user_id
           )) FILTER (WHERE c.adc_user_id IS NOT NULL), '[]'::jsonb)
      INTO v_contracts, v_missing, v_signers
      FROM public.purchase_requests pr
      JOIN public.contracts c ON c.id = pr.contract_id
     WHERE pr.id = ANY (NEW.request_ids) AND pr.tenant_id = NEW.tenant_id;

    IF v_contracts = 0 THEN
      RAISE EXCEPTION 'Los pedidos no tienen contrato: no hay ADC a quién pedirle la firma.' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM public.purchase_requests pr
                WHERE pr.id = ANY (NEW.request_ids) AND pr.tenant_id = NEW.tenant_id AND pr.contract_id IS NULL) THEN
      RAISE EXCEPTION 'Hay pedidos sin contrato: asígnales uno para saber qué ADC firma.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION 'Sin ADC asignado: %. Asígnalo en Configuración → Clientes y Contratos.', v_missing
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.required_signers := v_signers;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_approval_proposals_before_insert ON public.approval_proposals;
CREATE TRIGGER trg_approval_proposals_before_insert
  BEFORE INSERT ON public.approval_proposals
  FOR EACH ROW EXECUTE FUNCTION public.approval_proposals_before_insert();

-- Una propuesta no se edita: sólo se puede retirar (una vez).
CREATE OR REPLACE FUNCTION public.approval_proposals_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF OLD.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'La propuesta ya fue retirada.' USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['withdrawn_at', 'withdrawn_by', 'withdrawn_reason'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['withdrawn_at', 'withdrawn_by', 'withdrawn_reason']) THEN
    RAISE EXCEPTION 'Una propuesta no se edita: retírala y crea otra.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.withdrawn_at IS NULL OR NEW.withdrawn_reason IS NULL OR length(trim(NEW.withdrawn_reason)) < 5 THEN
    RAISE EXCEPTION 'Para retirar una propuesta hay que decir por qué.' USING ERRCODE = 'check_violation';
  END IF;
  IF public.approval_proposal_state(OLD.id) = 'approved'
     AND EXISTS (SELECT 1 FROM public.purchase_orders po
                  WHERE po.approval_proposal_id = OLD.id AND COALESCE(po.status, '') <> 'cancelled') THEN
    RAISE EXCEPTION 'Ya hay una OC emitida con esta propuesta: anula la OC primero.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.withdrawn_at := now();
  IF auth.uid() IS NOT NULL THEN NEW.withdrawn_by := auth.uid(); END IF;
  RETURN NEW;
END;
$$;

-- ── Al firmar: sólo quien corresponde, y sólo mientras está pendiente ─────────
CREATE OR REPLACE FUNCTION public.approval_signatures_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_p      record;
  v_role   text;
  v_name   text;
  v_slot   jsonb;
  v_super  boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Una firma necesita a una persona conectada.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.signer_id := auth.uid();
  NEW.created_at := now();

  SELECT role, name INTO v_role, v_name FROM public.profiles WHERE id = auth.uid();
  NEW.signer_name := COALESCE(v_name, NEW.signer_name);
  -- Administración tiene control total de su empresa (decisión de Steven).
  v_super := v_role IN ('administrador', 'soporte-pagnol', 'super-admin');

  SELECT * INTO v_p FROM public.approval_proposals WHERE id = NEW.proposal_id;
  IF NOT FOUND OR v_p.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'La propuesta no existe.' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF public.approval_proposal_state(v_p.id) <> 'pending' THEN
    RAISE EXCEPTION 'Esta propuesta ya no está pendiente de firma.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT slot INTO v_slot FROM jsonb_array_elements(v_p.required_signers) AS slot
   WHERE slot->>'kind' = NEW.slot_kind
     AND (NEW.slot_kind = 'gerente' OR slot->>'contractId' = NEW.contract_id::text);
  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'Esa firma no corresponde a esta propuesta.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.slot_kind = 'gerente' THEN
    NEW.contract_id := NULL;
    IF NOT (v_super OR v_role = 'gerente-general') THEN
      RAISE EXCEPTION 'Esta compra la firma el Gerente General.' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    IF NOT (v_super OR (v_slot->>'userId') = auth.uid()::text) THEN
      RAISE EXCEPTION 'Esta firma es del ADC del contrato %.', v_slot->>'contractName' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_approval_signatures_before_insert ON public.approval_signatures;
CREATE TRIGGER trg_approval_signatures_before_insert
  BEFORE INSERT ON public.approval_signatures
  FOR EACH ROW EXECUTE FUNCTION public.approval_signatures_before_insert();

DROP TRIGGER IF EXISTS trg_approval_proposals_before_update ON public.approval_proposals;
CREATE TRIGGER trg_approval_proposals_before_update
  BEFORE UPDATE ON public.approval_proposals
  FOR EACH ROW EXECUTE FUNCTION public.approval_proposals_before_update();

-- ── RLS: aislamiento por empresa; firmas sin UPDATE ni DELETE ─────────────────
ALTER TABLE public.approval_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_signatures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS approval_proposals_select ON public.approval_proposals;
DROP POLICY IF EXISTS approval_proposals_insert ON public.approval_proposals;
DROP POLICY IF EXISTS approval_proposals_update ON public.approval_proposals;
CREATE POLICY approval_proposals_select ON public.approval_proposals
  FOR SELECT USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id());
CREATE POLICY approval_proposals_insert ON public.approval_proposals
  FOR INSERT WITH CHECK (public.is_super_admin() OR tenant_id = public.get_my_tenant_id());
CREATE POLICY approval_proposals_update ON public.approval_proposals
  FOR UPDATE USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS approval_signatures_select ON public.approval_signatures;
DROP POLICY IF EXISTS approval_signatures_insert ON public.approval_signatures;
CREATE POLICY approval_signatures_select ON public.approval_signatures
  FOR SELECT USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id());
CREATE POLICY approval_signatures_insert ON public.approval_signatures
  FOR INSERT WITH CHECK (public.is_super_admin() OR tenant_id = public.get_my_tenant_id());

GRANT SELECT, INSERT, UPDATE ON public.approval_proposals TO authenticated;
GRANT SELECT, INSERT ON public.approval_signatures TO authenticated;
GRANT ALL ON public.approval_proposals, public.approval_signatures TO service_role;

-- ── La OC necesita una propuesta firmada ──────────────────────────────────────
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS approval_proposal_id uuid REFERENCES public.approval_proposals(id);

COMMENT ON COLUMN public.purchase_orders.approval_proposal_id IS
  'RFC-006 F2: propuesta firmada que autoriza esta OC. Obligatoria para toda OC nueva (trigger).';

CREATE OR REPLACE FUNCTION public.purchase_orders_require_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_p     record;
  v_state text;
BEGIN
  -- Procesos de sistema (service role, sin sesión) no pasan por aquí.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.approval_proposal_id IS DISTINCT FROM OLD.approval_proposal_id THEN
      RAISE EXCEPTION 'La propuesta de una OC no se cambia.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.approval_proposal_id IS NULL OR NEW.total_amount <= OLD.total_amount THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.approval_proposal_id IS NULL THEN
    -- Cada empresa enciende la exigencia cuando está lista (ADC asignados en
    -- sus contratos). Así aplicar esta migración no corta la emisión de OC de
    -- quien todavía trabaja con el flujo anterior.
    IF COALESCE((SELECT (t.approval_settings->>'enforced')::boolean
                   FROM public.tenants t WHERE t.id = NEW.tenant_id), false) THEN
      RAISE EXCEPTION 'Esta compra no tiene una propuesta firmada. Envíala a firma antes de emitir la OC.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO v_p FROM public.approval_proposals WHERE id = NEW.approval_proposal_id;
  IF NOT FOUND OR v_p.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'La propuesta de compra no existe.' USING ERRCODE = 'foreign_key_violation';
  END IF;

  v_state := public.approval_proposal_state(v_p.id);
  IF NOT (v_state = 'approved' OR (v_p.urgent AND v_state = 'pending')) THEN
    RAISE EXCEPTION 'La propuesta % todavía no está firmada.', COALESCE(v_p.internal_code, '')
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_p.supplier_id IS DISTINCT FROM NEW.supplier_id THEN
    RAISE EXCEPTION 'El proveedor de la OC no es el de la propuesta firmada.' USING ERRCODE = 'check_violation';
  END IF;
  IF COALESCE(NEW.total_amount, 0) > v_p.net_total THEN
    RAISE EXCEPTION 'La OC ($%) supera lo firmado ($% neto).', round(NEW.total_amount), round(v_p.net_total)
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1 FROM public.purchase_orders po
     WHERE po.approval_proposal_id = v_p.id AND COALESCE(po.status, '') <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'Ya se emitió una OC con esta propuesta.' USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_orders_require_approval ON public.purchase_orders;
CREATE TRIGGER trg_purchase_orders_require_approval
  BEFORE INSERT OR UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.purchase_orders_require_approval();

-- El DEMO trabaja con la exigencia encendida desde ya (es la vitrina y donde se prueba).
UPDATE public.tenants
   SET approval_settings = COALESCE(approval_settings, '{}'::jsonb) || '{"enforced": true}'::jsonb
 WHERE id = 'bfe96720-e1a8-45a6-83d8-0ec1b60bf947';

-- ── Cuántas firmas me tocan (campana) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.my_pending_signatures(p_tenant_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH me AS (SELECT id, role FROM public.profiles WHERE id = auth.uid())
  SELECT COUNT(*)::integer
    FROM public.approval_proposals p, me
   WHERE p.tenant_id = p_tenant_id
     AND public.approval_proposal_state(p.id) = 'pending'
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(p.required_signers) AS slot
        WHERE NOT EXISTS (
                SELECT 1 FROM public.approval_signatures s
                 WHERE s.proposal_id = p.id AND s.slot_kind = slot->>'kind'
                   AND (slot->>'kind' = 'gerente' OR s.contract_id::text = slot->>'contractId'))
          AND ((slot->>'kind' = 'gerente' AND me.role = 'gerente-general')
               OR (slot->>'kind' = 'adc' AND slot->>'userId' = me.id::text))
     );
$$;

REVOKE ALL ON FUNCTION public.my_pending_signatures(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_pending_signatures(uuid) TO authenticated;

-- ── Realtime ──────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'approval_proposals') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.approval_proposals;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'approval_signatures') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.approval_signatures;
  END IF;
END $$;

-- ── Roles personalizados por empresa ──────────────────────────────────────────
-- Una fila en `roles` congela los permisos de ese rol en esa empresa: los
-- permisos nuevos del código (revisar, firmar) no le llegan solos. Se suman SÓLO
-- los de RFC-006 a las filas que existan; el resto de su configuración queda igual.
UPDATE public.roles
   SET permissions = (SELECT array_agg(DISTINCT x ORDER BY x)
                        FROM unnest(permissions || ARRAY['approvals:sign_adc']) AS x)
 WHERE id = 'adc';

UPDATE public.roles
   SET permissions = (SELECT array_agg(DISTINCT x ORDER BY x)
                        FROM unnest(permissions || ARRAY['approvals:sign_adc',
                          'purchase_requests:review_operations', 'rentals:review_operations']) AS x)
 WHERE id = 'director-faena';

UPDATE public.roles
   SET permissions = (SELECT array_agg(DISTINCT x ORDER BY x)
                        FROM unnest(permissions || ARRAY['module_authorizations:view',
                          'purchase_requests:review_operations', 'purchase_requests:view_all',
                          'rentals:review_operations']) AS x)
 WHERE id = 'jefe-operaciones';

UPDATE public.roles
   SET permissions = (SELECT array_agg(DISTINCT x ORDER BY x)
                        FROM unnest(permissions || ARRAY['module_authorizations:view', 'approvals:sign_gerente']) AS x)
 WHERE id = 'gerente-general';
