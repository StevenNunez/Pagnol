-- RFC-006 F4 — Arriendos: firma por VALOR MENSUAL antes de adjudicar.
--
-- Decisión de Steven: los arriendos siguen la misma regla de montos que las
-- compras, sobre el valor mensual con IVA. La firma va ANTES de adjudicar (que es
-- cuando nace el contrato de arriendo y su OC).
--
-- Valor mensual de una oferta (neto):
--   mensual = precio por período × (mensual 1 · quincenal 2 · semanal 4 · diario 30)
--   pago único = el precio completo.
--   Si el arriendo dura menos de un mes (el total estimado es menor), se usa el total.
-- La misma regla vive en TS (approvalMath.rentalMonthlyNet): si cambias una, cambia la otra.
--
-- Y se cierra la otra puerta: en las empresas con la exigencia encendida, un
-- contrato de arriendo ENTRANTE (lo que la empresa arrienda a un arrendador) sólo
-- nace con una propuesta de arriendo firmada (o urgente).

-- ── Origen nuevo: cotización de arriendo ─────────────────────────────────────
DO $$
DECLARE c record;
BEGIN
  -- El CHECK de columna se busca por su definición, no por un nombre adivinado.
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.approval_proposals'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%source_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.approval_proposals DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.approval_proposals
  ADD CONSTRAINT approval_proposals_source_type_check
  CHECK (source_type IS NOT NULL AND source_type IN ('rfq', 'lot', 'rental_rfq'));

-- ── Valor mensual de una oferta de arriendo ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.rental_monthly_net(p_price numeric, p_cycle text, p_total numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT round(CASE
    WHEN COALESCE(p_cycle, 'monthly') = 'one_time' THEN COALESCE(p_price, 0)
    ELSE LEAST(
      COALESCE(p_price, 0) * CASE COALESCE(p_cycle, 'monthly')
        WHEN 'daily' THEN 30 WHEN 'weekly' THEN 4 WHEN 'biweekly' THEN 2 ELSE 1 END,
      CASE WHEN COALESCE(p_total, 0) > 0 THEN p_total ELSE 'infinity'::numeric END
    )
  END);
$$;

GRANT EXECUTE ON FUNCTION public.rental_monthly_net(numeric, text, numeric) TO authenticated, service_role;

-- ── Al crear una propuesta: compras (rfq/lote) y arriendos ───────────────────
CREATE OR REPLACE FUNCTION public.approval_proposals_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_settings   jsonb;
  v_adc_max    numeric;
  v_vat        numeric;
  v_rfq        record;
  v_resp       jsonb;
  v_sum        numeric;
  v_all_priced boolean;
  v_signers    jsonb := '[]'::jsonb;
  v_missing    text;
  v_contracts  int;
  v_ok         int;
  v_no_contract int;
BEGIN
  IF NEW.kind NOT IN ('purchase', 'rental') THEN
    RAISE EXCEPTION 'Este tipo de propuesta todavía no se firma.' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.kind = 'rental') <> (NEW.source_type = 'rental_rfq') THEN
    RAISE EXCEPTION 'Un arriendo se propone desde su cotización de arriendo.' USING ERRCODE = 'check_violation';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  NEW.created_at := now();
  NEW.withdrawn_at := NULL; NEW.withdrawn_by := NULL; NEW.withdrawn_reason := NULL;

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

  ELSIF NEW.source_type = 'rental_rfq' THEN
    SELECT * INTO v_rfq FROM public.rental_quote_requests WHERE id = NEW.source_id AND tenant_id = NEW.tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La cotización de arriendo no existe.' USING ERRCODE = 'foreign_key_violation';
    END IF;
    SELECT r INTO v_resp FROM jsonb_array_elements(COALESCE(v_rfq.responses, '[]'::jsonb)) AS r
     WHERE r->>'id' = NEW.quote_id;
    IF v_resp IS NULL THEN
      RAISE EXCEPTION 'La oferta elegida no está en la cotización de arriendo.' USING ERRCODE = 'foreign_key_violation';
    END IF;
    NEW.request_ids   := COALESCE((SELECT array_agg(e::uuid)
                                     FROM jsonb_array_elements_text(to_jsonb(v_rfq.request_ids)) AS e), '{}');
    NEW.supplier_id   := NULLIF(v_resp->>'partyId', '')::uuid;
    NEW.supplier_name := v_resp->>'partyName';
    -- Se firma el valor MENSUAL (decisión de Steven), no el total del período.
    NEW.net_total     := public.rental_monthly_net(
                           NULLIF(v_resp->>'pricePerPeriod', '')::numeric,
                           v_resp->>'billingCycle',
                           NULLIF(v_resp->>'totalEstimate', '')::numeric);

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

  IF COALESCE(NEW.net_total, 0) <= 0 THEN
    RAISE EXCEPTION 'La oferta no tiene un precio válido.' USING ERRCODE = 'check_violation';
  END IF;
  IF COALESCE(array_length(NEW.request_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'La propuesta no tiene pedidos de origen.' USING ERRCODE = 'check_violation';
  END IF;

  -- Los pedidos tienen que existir en la empresa y haber pasado las etapas previas.
  IF NEW.kind = 'rental' THEN
    SELECT COUNT(*) INTO v_ok FROM public.rental_requests rr
     WHERE rr.id = ANY (NEW.request_ids) AND rr.tenant_id = NEW.tenant_id
       AND rr.adc_authorized_at IS NOT NULL
       AND rr.status NOT IN ('rejected', 'fulfilled');
  ELSE
    SELECT COUNT(*) INTO v_ok FROM public.purchase_requests pr
     WHERE pr.id = ANY (NEW.request_ids) AND pr.tenant_id = NEW.tenant_id
       AND pr.adc_authorized_at IS NOT NULL
       AND pr.status NOT IN ('rejected', 'received', 'ordered');
  END IF;
  IF v_ok <> (SELECT COUNT(DISTINCT x) FROM unnest(NEW.request_ids) AS x) THEN
    RAISE EXCEPTION 'Algún pedido no existe, ya se resolvió o todavía no pasa la autorización.' USING ERRCODE = 'check_violation';
  END IF;

  -- RFC-006 F3: urgencia (sólo Abastecimiento o administración, con motivo).
  IF NEW.urgent THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles
                    WHERE id = auth.uid()
                      AND role IN ('abastecimiento', 'administrador', 'soporte-pagnol', 'super-admin')) THEN
      RAISE EXCEPTION 'Sólo Abastecimiento puede marcar una compra como urgente.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.urgency_reason IS NULL OR length(trim(NEW.urgency_reason)) < 10 THEN
      RAISE EXCEPTION 'Una compra urgente necesita el motivo (mínimo 10 caracteres).' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    NEW.urgency_reason := NULL;
  END IF;

  -- Tramos de la empresa (sin configurar = los de Valar).
  SELECT approval_settings INTO v_settings FROM public.tenants WHERE id = NEW.tenant_id;
  v_adc_max := COALESCE(NULLIF(v_settings->>'adcMaxGross', '')::numeric, 500000);
  v_vat     := COALESCE(NULLIF(v_settings->>'vatRate', '')::numeric, 0.19);
  NEW.vat_rate    := v_vat;
  NEW.gross_total := round(NEW.net_total * (1 + v_vat));

  IF NEW.gross_total > v_adc_max THEN
    NEW.escalated := false;
    NEW.escalation_reason := NULL;
  END IF;

  IF NEW.gross_total > v_adc_max OR NEW.escalated THEN
    NEW.tier := 'gerente';
    NEW.required_signers := '[{"kind":"gerente"}]'::jsonb;
  ELSE
    NEW.tier := 'adc';
    -- Contratos de los pedidos de origen (compra o arriendo).
    WITH reqs AS (
      SELECT pr.contract_id FROM public.purchase_requests pr
       WHERE NEW.kind = 'purchase' AND pr.id = ANY (NEW.request_ids) AND pr.tenant_id = NEW.tenant_id
      UNION ALL
      SELECT rr.contract_id FROM public.rental_requests rr
       WHERE NEW.kind = 'rental' AND rr.id = ANY (NEW.request_ids) AND rr.tenant_id = NEW.tenant_id
    )
    SELECT COUNT(*) FILTER (WHERE contract_id IS NULL) INTO v_no_contract FROM reqs;
    IF v_no_contract > 0 THEN
      RAISE EXCEPTION 'Hay pedidos sin contrato: asígnales uno para saber qué ADC firma.' USING ERRCODE = 'check_violation';
    END IF;

    WITH reqs AS (
      SELECT pr.contract_id FROM public.purchase_requests pr
       WHERE NEW.kind = 'purchase' AND pr.id = ANY (NEW.request_ids) AND pr.tenant_id = NEW.tenant_id
      UNION ALL
      SELECT rr.contract_id FROM public.rental_requests rr
       WHERE NEW.kind = 'rental' AND rr.id = ANY (NEW.request_ids) AND rr.tenant_id = NEW.tenant_id
    )
    SELECT COUNT(DISTINCT c.id),
           string_agg(DISTINCT c.name, ', ') FILTER (WHERE c.adc_user_id IS NULL),
           COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
             'kind', 'adc', 'contractId', c.id, 'contractName', c.name, 'userId', c.adc_user_id
           )) FILTER (WHERE c.adc_user_id IS NOT NULL), '[]'::jsonb)
      INTO v_contracts, v_missing, v_signers
      FROM reqs JOIN public.contracts c ON c.id = reqs.contract_id;

    IF v_contracts = 0 THEN
      RAISE EXCEPTION 'Los pedidos no tienen contrato: no hay ADC a quién pedirle la firma.' USING ERRCODE = 'check_violation';
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

-- ── Una propuesta con OC o contrato de arriendo emitido no se retira ─────────
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
  IF EXISTS (SELECT 1 FROM public.purchase_orders po
              WHERE po.approval_proposal_id = OLD.id AND COALESCE(po.status, '') <> 'cancelled')
     OR EXISTS (SELECT 1 FROM public.rental_contracts rc
              WHERE rc.approval_proposal_id = OLD.id AND COALESCE(rc.status, '') <> 'cancelled') THEN
    RAISE EXCEPTION 'Ya se emitió la OC o el contrato con esta propuesta: anúlalo primero.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.withdrawn_at := now();
  IF auth.uid() IS NOT NULL THEN NEW.withdrawn_by := auth.uid(); END IF;
  RETURN NEW;
END;
$$;

-- ── El contrato de arriendo entrante necesita su propuesta firmada ───────────
ALTER TABLE public.rental_contracts
  ADD COLUMN IF NOT EXISTS approval_proposal_id uuid REFERENCES public.approval_proposals(id);

COMMENT ON COLUMN public.rental_contracts.approval_proposal_id IS
  'RFC-006 F4: propuesta de arriendo firmada (valor mensual) que autorizó este contrato entrante.';

CREATE OR REPLACE FUNCTION public.rental_contracts_require_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_p     record;
  v_state text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.approval_proposal_id IS DISTINCT FROM OLD.approval_proposal_id THEN
      RAISE EXCEPTION 'La propuesta de un contrato de arriendo no se cambia.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- Sólo lo que la empresa toma en arriendo (entrante). Lo que arrienda a sus clientes no se firma aquí.
  IF COALESCE(NEW.direction, '') <> 'incoming' THEN RETURN NEW; END IF;

  IF NEW.approval_proposal_id IS NULL THEN
    IF COALESCE((SELECT (t.approval_settings->>'enforced')::boolean
                   FROM public.tenants t WHERE t.id = NEW.tenant_id), false) THEN
      RAISE EXCEPTION 'Los arriendos nuevos se adjudican desde Abastecimiento → Arriendos, con la firma que corresponde.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO v_p FROM public.approval_proposals WHERE id = NEW.approval_proposal_id;
  IF NOT FOUND OR v_p.tenant_id <> NEW.tenant_id OR v_p.kind <> 'rental' THEN
    RAISE EXCEPTION 'La propuesta de arriendo no existe.' USING ERRCODE = 'foreign_key_violation';
  END IF;
  v_state := public.approval_proposal_state(v_p.id);
  IF NOT (v_state = 'approved' OR (v_p.urgent AND v_state = 'pending')) THEN
    RAISE EXCEPTION 'La propuesta % todavía no está firmada.', COALESCE(v_p.internal_code, '') USING ERRCODE = 'check_violation';
  END IF;
  IF v_p.supplier_id IS DISTINCT FROM NEW.party_id THEN
    RAISE EXCEPTION 'El arrendador no es el de la propuesta firmada.' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rental_contracts rc
              WHERE rc.approval_proposal_id = v_p.id AND COALESCE(rc.status, '') <> 'cancelled') THEN
    RAISE EXCEPTION 'Ya se adjudicó un arriendo con esta propuesta.' USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rental_contracts_require_approval ON public.rental_contracts;
CREATE TRIGGER trg_rental_contracts_require_approval
  BEFORE INSERT OR UPDATE ON public.rental_contracts
  FOR EACH ROW EXECUTE FUNCTION public.rental_contracts_require_approval();
