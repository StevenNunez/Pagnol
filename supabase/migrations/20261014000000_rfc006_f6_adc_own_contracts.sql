-- RFC-006 F6 — El ADC autoriza sólo lo de SUS contratos.
--
-- Después de la revisión del Jefe de Operaciones, los requerimientos de compra y
-- las solicitudes de arriendo pasan por la autorización del ADC
-- (`adc_authorized_at`). Hasta ahora la levantaba CUALQUIER usuario con rol adc,
-- de cualquier contrato. Con la exigencia encendida (approval_settings.enforced)
-- un usuario con rol adc sólo puede autorizar los de los contratos donde él es el
-- ADC asignado (`contracts.adc_user_id`).
--
-- Los demás roles con permiso (director de faena, administración) siguen igual:
-- son quienes cubren un contrato que todavía no tiene ADC asignado. Los retiros
-- del pañol ya tienen su propia regla por valor (F5).
--
-- Al CREAR: si un ADC crea un pedido de un contrato que no es suyo, no queda
-- pre-autorizado (pasa a la bandeja del que corresponde), igual que en F5.
--
-- Idempotente: seguro de re-ejecutar.

CREATE OR REPLACE FUNCTION public.requests_check_adc_contract()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_role     text;
  v_contract record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.adc_authorized_at IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.adc_authorized_at IS NOT NULL THEN RETURN NEW; END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF COALESCE(v_role, '') <> 'adc' THEN RETURN NEW; END IF;

  IF NOT COALESCE((SELECT (t.approval_settings->>'enforced')::boolean
                     FROM public.tenants t WHERE t.id = NEW.tenant_id), false) THEN
    RETURN NEW;
  END IF;

  SELECT id, name, adc_user_id INTO v_contract FROM public.contracts WHERE id = NEW.contract_id;
  IF v_contract.adc_user_id IS NOT NULL AND v_contract.adc_user_id = auth.uid() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.adc_authorized_at := NULL;
    NEW.adc_authorized_by := NULL;
    RETURN NEW;
  END IF;

  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'Este pedido no tiene contrato: lo autoriza administración o el director de faena.'
      USING ERRCODE = 'insufficient_privilege';
  ELSIF v_contract.adc_user_id IS NULL THEN
    RAISE EXCEPTION 'El contrato % no tiene ADC asignado: asígnalo en Clientes y Contratos, o que lo autorice administración.', v_contract.name
      USING ERRCODE = 'insufficient_privilege';
  ELSE
    RAISE EXCEPTION 'Este pedido es del contrato %: lo autoriza su ADC.', v_contract.name
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_requests_check_adc_contract ON public.purchase_requests;
CREATE TRIGGER trg_purchase_requests_check_adc_contract
  BEFORE INSERT OR UPDATE ON public.purchase_requests
  FOR EACH ROW EXECUTE FUNCTION public.requests_check_adc_contract();

DROP TRIGGER IF EXISTS trg_rental_requests_check_adc_contract ON public.rental_requests;
CREATE TRIGGER trg_rental_requests_check_adc_contract
  BEFORE INSERT OR UPDATE ON public.rental_requests
  FOR EACH ROW EXECUTE FUNCTION public.requests_check_adc_contract();
