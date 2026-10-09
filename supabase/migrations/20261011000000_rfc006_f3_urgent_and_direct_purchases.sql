-- RFC-006 F3 — Compras urgentes y registro de compras ya realizadas.
--
-- 1. URGENCIAS (decisión de Steven): Abastecimiento marca "urgente" con motivo,
--    sin tope: la OC se emite al tiro y la firma queda pendiente, a la vista del
--    firmante y en el reporte de urgencias. El trigger de la OC ya aceptaba una
--    propuesta urgente pendiente (F2); acá se habilita crearla.
--
-- 2. COMPRA YA REALIZADA ("Finalizar lote manualmente"): antes marcaba los
--    pedidos como comprados sin OC ni firma y sin dejar rastro. Ahora exige el
--    respaldo (factura o boleta, empresa con RUT válido y quién compró), queda
--    como hecho inmutable y una misma factura no se registra dos veces.

-- ── RUT válido (módulo 11). Mismo cálculo que src/lib/rut.ts ─────────────────
CREATE OR REPLACE FUNCTION public.rut_is_valid(p_rut text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  c    text := regexp_replace(upper(COALESCE(p_rut, '')), '[^0-9K]', '', 'g');
  body text;
  dv   text;
  s    int := 0;
  m    int := 2;
  r    int;
  i    int;
BEGIN
  IF length(c) < 7 THEN RETURN false; END IF;
  body := left(c, length(c) - 1);
  dv := right(c, 1);
  IF body !~ '^[0-9]+$' THEN RETURN false; END IF;
  FOR i IN REVERSE length(body)..1 LOOP
    s := s + substr(body, i, 1)::int * m;
    m := CASE WHEN m = 7 THEN 2 ELSE m + 1 END;
  END LOOP;
  r := 11 - (s % 11);
  RETURN dv = CASE WHEN r = 11 THEN '0' WHEN r = 10 THEN 'K' ELSE r::text END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rut_is_valid(text) TO authenticated, service_role;

-- ── Compras ya realizadas ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.direct_purchases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lot_id          uuid,
  request_ids     uuid[] NOT NULL,
  doc_type        text NOT NULL CHECK (doc_type IS NOT NULL AND doc_type IN ('factura', 'boleta')),
  doc_number      text NOT NULL CHECK (doc_number IS NOT NULL AND length(trim(doc_number)) >= 1),
  supplier_name   text NOT NULL CHECK (supplier_name IS NOT NULL AND length(trim(supplier_name)) >= 2),
  supplier_rut    text NOT NULL CHECK (supplier_rut IS NOT NULL AND public.rut_is_valid(supplier_rut)),
  buyer_id        uuid,
  buyer_name      text NOT NULL CHECK (buyer_name IS NOT NULL AND length(trim(buyer_name)) >= 2),
  created_by      uuid NOT NULL,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- La misma factura/boleta del mismo proveedor no se registra dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS direct_purchases_one_doc
  ON public.direct_purchases (tenant_id, doc_type, regexp_replace(upper(supplier_rut), '[^0-9K]', '', 'g'), upper(trim(doc_number)));

COMMENT ON TABLE public.direct_purchases IS
  'RFC-006 F3: compra ya realizada por fuera del flujo (con su factura o boleta). Hecho inmutable: sin UPDATE ni DELETE.';

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

DROP TRIGGER IF EXISTS trg_direct_purchases_before_insert ON public.direct_purchases;
CREATE TRIGGER trg_direct_purchases_before_insert
  BEFORE INSERT ON public.direct_purchases
  FOR EACH ROW EXECUTE FUNCTION public.direct_purchases_before_insert();

ALTER TABLE public.direct_purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS direct_purchases_select ON public.direct_purchases;
DROP POLICY IF EXISTS direct_purchases_insert ON public.direct_purchases;
CREATE POLICY direct_purchases_select ON public.direct_purchases
  FOR SELECT USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id());
CREATE POLICY direct_purchases_insert ON public.direct_purchases
  FOR INSERT WITH CHECK (public.is_super_admin() OR tenant_id = public.get_my_tenant_id());
GRANT SELECT, INSERT ON public.direct_purchases TO authenticated;
GRANT ALL ON public.direct_purchases TO service_role;

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS direct_purchase_id uuid REFERENCES public.direct_purchases(id);

COMMENT ON COLUMN public.purchase_requests.direct_purchase_id IS
  'RFC-006 F3: compra ya realizada (factura/boleta) con que se dio por comprado este pedido.';

-- ── Urgencias: crear la propuesta ─────────────────────────────────────────────
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

  -- RFC-006 F3: compra urgente (se emite la OC ya y la firma queda pendiente).
  -- Sólo Abastecimiento o administración, y con un motivo que se entienda.
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

-- ── Una propuesta con OC emitida no se retira (urgente o firmada) ────────────
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
              WHERE po.approval_proposal_id = OLD.id AND COALESCE(po.status, '') <> 'cancelled') THEN
    RAISE EXCEPTION 'Ya hay una OC emitida con esta propuesta: anula la OC primero.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.withdrawn_at := now();
  IF auth.uid() IS NOT NULL THEN NEW.withdrawn_by := auth.uid(); END IF;
  RETURN NEW;
END;
$$;
