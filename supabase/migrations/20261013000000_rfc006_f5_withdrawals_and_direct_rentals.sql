-- RFC-006 F5 — Retiros del pañol firmados por valor + arriendos ya contratados.
--
-- 1. RETIROS POR VALOR (decisión de Steven): una solicitud de material que espera
--    autorización la firma el ADC DE SU CONTRATO si su valor (costo × cantidad,
--    con IVA) está bajo el tope de la empresa, o sólo el Gerente General si lo
--    pasa. Antes la autorizaba cualquier ADC. Rige en las empresas con la
--    exigencia encendida (approval_settings.enforced); el resto sigue igual.
--    Los retiros de VENTANILLA (nacen aprobados: clase C, o B con revisión
--    posterior) no pasan por aquí: tienen su propio control.
--
-- 2. ARRIENDO YA CONTRATADO (decisión de Steven): igual que la compra ya
--    realizada (F3), un arriendo contratado por fuera se registra con su
--    respaldo — contrato o factura, arrendador con RUT válido y quién lo
--    contrató — y con eso puede crearse el contrato de arriendo entrante.

-- ══ 1. Retiros por valor ═════════════════════════════════════════════════════

ALTER TABLE public.material_requests
  ADD COLUMN IF NOT EXISTS authorized_value_gross numeric,
  ADD COLUMN IF NOT EXISTS authorized_tier text;

COMMENT ON COLUMN public.material_requests.authorized_value_gross IS
  'RFC-006 F5: valor con IVA del retiro al momento de autorizarlo (costo registrado × cantidad).';

-- Valor NETO de un retiro: Σ cantidad × costo unitario registrado del material.
-- Espejo de approvalMath.withdrawalValueNet.
CREATE OR REPLACE FUNCTION public.withdrawal_value_net(p_items jsonb, p_tenant uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(round(SUM(COALESCE(NULLIF(i->>'quantity', '')::numeric, 0) * COALESCE(m.unit_cost, 0))), 0)
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS i
    JOIN public.materials m ON m.id::text = i->>'materialId' AND m.tenant_id = p_tenant;
$$;

GRANT EXECUTE ON FUNCTION public.withdrawal_value_net(jsonb, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.material_requests_check_authorizer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_settings jsonb;
  v_adc_max  numeric;
  v_vat      numeric;
  v_gross    numeric;
  v_tier     text;
  v_role     text;
  v_contract record;
  v_ok       boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  -- Sólo cuando se levanta la autorización de una solicitud pendiente.
  IF NEW.adc_authorized_at IS NULL OR COALESCE(NEW.status, '') <> 'pending' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.adc_authorized_at IS NOT NULL THEN RETURN NEW; END IF;

  SELECT approval_settings INTO v_settings FROM public.tenants WHERE id = NEW.tenant_id;
  IF NOT COALESCE((v_settings->>'enforced')::boolean, false) THEN RETURN NEW; END IF;

  v_adc_max := COALESCE(NULLIF(v_settings->>'adcMaxGross', '')::numeric, 500000);
  v_vat     := COALESCE(NULLIF(v_settings->>'vatRate', '')::numeric, 0.19);
  v_gross   := round(public.withdrawal_value_net(NEW.items, NEW.tenant_id) * (1 + v_vat));
  v_tier    := CASE WHEN v_gross > v_adc_max THEN 'gerente' ELSE 'adc' END;

  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  SELECT id, name, adc_user_id INTO v_contract FROM public.contracts WHERE id = NEW.contract_id;

  v_ok := v_role IN ('administrador', 'soporte-pagnol', 'super-admin')
       OR (v_tier = 'gerente' AND v_role = 'gerente-general')
       OR (v_tier = 'adc' AND v_contract.adc_user_id IS NOT NULL AND v_contract.adc_user_id = auth.uid());

  IF NOT v_ok THEN
    -- Al CREAR, quien no es el firmante no la pre-autoriza: queda en la bandeja.
    IF TG_OP = 'INSERT' THEN
      NEW.adc_authorized_at := NULL;
      NEW.adc_authorized_by := NULL;
      RETURN NEW;
    END IF;
    IF v_tier = 'gerente' THEN
      RAISE EXCEPTION 'Este retiro vale $% con IVA: lo firma el Gerente General.', to_char(v_gross, 'FM999G999G999')
        USING ERRCODE = 'insufficient_privilege';
    ELSIF v_contract.id IS NULL THEN
      RAISE EXCEPTION 'Este retiro no tiene contrato: lo autoriza administración.' USING ERRCODE = 'insufficient_privilege';
    ELSE
      RAISE EXCEPTION 'Este retiro lo firma el ADC del contrato %.', v_contract.name USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  NEW.adc_authorized_by := auth.uid();
  NEW.authorized_value_gross := v_gross;
  NEW.authorized_tier := v_tier;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_material_requests_check_authorizer ON public.material_requests;
CREATE TRIGGER trg_material_requests_check_authorizer
  BEFORE INSERT OR UPDATE ON public.material_requests
  FOR EACH ROW EXECUTE FUNCTION public.material_requests_check_authorizer();

-- El Gerente General autoriza los retiros sobre el tope.
UPDATE public.roles
   SET permissions = (SELECT array_agg(DISTINCT x ORDER BY x)
                        FROM unnest(permissions || ARRAY['material_requests:authorize', 'material_requests:view_all']) AS x)
 WHERE id = 'gerente-general';

-- ══ 2. Arriendo ya contratado ════════════════════════════════════════════════

ALTER TABLE public.direct_purchases
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'purchase';

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.direct_purchases'::regclass AND contype = 'c'
       AND (pg_get_constraintdef(oid) ILIKE '%doc_type%' OR pg_get_constraintdef(oid) ILIKE '%kind%')
  LOOP
    EXECUTE format('ALTER TABLE public.direct_purchases DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.direct_purchases
  ADD CONSTRAINT direct_purchases_kind_check CHECK (kind IS NOT NULL AND kind IN ('purchase', 'rental')),
  ADD CONSTRAINT direct_purchases_doc_type_check CHECK (doc_type IS NOT NULL AND doc_type IN ('factura', 'boleta', 'contrato'));

COMMENT ON COLUMN public.direct_purchases.kind IS
  'RFC-006 F5: purchase = compra ya realizada (pedidos del lote); rental = arriendo ya contratado (contrato entrante).';

CREATE OR REPLACE FUNCTION public.direct_purchases_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN NEW.created_by := auth.uid(); END IF;
  NEW.created_at := now();
  NEW.supplier_rut := upper(trim(NEW.supplier_rut));
  NEW.doc_number := trim(NEW.doc_number);

  IF NEW.kind = 'rental' THEN
    -- Un arriendo ya contratado no sale de pedidos de compra.
    NEW.request_ids := '{}';
    RETURN NEW;
  END IF;

  IF NEW.doc_type = 'contrato' THEN
    RAISE EXCEPTION 'Una compra se respalda con factura o boleta.' USING ERRCODE = 'check_violation';
  END IF;
  IF COALESCE(array_length(NEW.request_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'No hay pedidos que registrar.' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT COUNT(*) FROM public.purchase_requests pr
       WHERE pr.id = ANY (NEW.request_ids) AND pr.tenant_id = NEW.tenant_id
         AND pr.adc_authorized_at IS NOT NULL
         AND pr.status NOT IN ('rejected', 'received', 'ordered'))
     <> (SELECT COUNT(DISTINCT x) FROM unnest(NEW.request_ids) AS x) THEN
    RAISE EXCEPTION 'Algún pedido no existe, ya se compró o no pasó la autorización.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE public.rental_contracts
  ADD COLUMN IF NOT EXISTS direct_purchase_id uuid REFERENCES public.direct_purchases(id);

COMMENT ON COLUMN public.rental_contracts.direct_purchase_id IS
  'RFC-006 F5: respaldo del arriendo ya contratado por fuera (contrato o factura del arrendador).';

CREATE OR REPLACE FUNCTION public.rental_contracts_require_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_p     record;
  v_d     record;
  v_state text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.approval_proposal_id IS DISTINCT FROM OLD.approval_proposal_id
       OR NEW.direct_purchase_id IS DISTINCT FROM OLD.direct_purchase_id THEN
      RAISE EXCEPTION 'El respaldo de un contrato de arriendo no se cambia.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.direction, '') <> 'incoming' THEN RETURN NEW; END IF;

  -- Arriendo ya contratado por fuera, con su respaldo.
  IF NEW.approval_proposal_id IS NULL AND NEW.direct_purchase_id IS NOT NULL THEN
    SELECT * INTO v_d FROM public.direct_purchases WHERE id = NEW.direct_purchase_id;
    IF NOT FOUND OR v_d.tenant_id <> NEW.tenant_id OR v_d.kind <> 'rental' THEN
      RAISE EXCEPTION 'El respaldo del arriendo no existe.' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM public.rental_contracts rc WHERE rc.direct_purchase_id = v_d.id) THEN
      RAISE EXCEPTION 'Ese documento ya respalda otro arriendo.' USING ERRCODE = 'unique_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.approval_proposal_id IS NULL THEN
    IF COALESCE((SELECT (t.approval_settings->>'enforced')::boolean
                   FROM public.tenants t WHERE t.id = NEW.tenant_id), false) THEN
      RAISE EXCEPTION 'Un arriendo nuevo se adjudica desde Abastecimiento → Arriendos; si ya se contrató, regístralo con su contrato o factura.'
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
