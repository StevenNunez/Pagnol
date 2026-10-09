-- RFC-006 F2 — corrección: al proponer desde una RFQ, `quote_requests.request_ids`
-- es jsonb (no uuid[]) y la asignación directa fallaba con "malformed array
-- literal". Lo encontró la prueba de punta a punta. Se reemplaza sólo la función;
-- el trigger que la usa no cambia.

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
