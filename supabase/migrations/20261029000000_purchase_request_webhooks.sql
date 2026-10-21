-- Fase 5 · C — Avisos de las solicitudes de compra a quien compra (Valar).
--
-- Tres eventos, cada uno UNA vez por solicitud (una solicitud con varias líneas es un solo aviso):
--   solicitud_compra.creada     al crearse (informativo: aún puede ser revisada o rechazada).
--   solicitud_compra.aprobada   cuando ya pasó la revisión del Jefe de Operaciones y la autorización
--                               del ADC en TODAS sus líneas vivas: es la que dispara la compra.
--   solicitud_compra.rechazada  cuando no queda ninguna línea viva.
-- La solicitud es el grupo `batch_id` (o la fila sola si no tiene). Sólo compras a proveedor que
-- no nacen de un arriendo: los suministros del cliente no se compran.
--
-- Cada evento es "a lo más una vez por solicitud": la numeración de líneas de un lote se inserta fila
-- a fila y, sin esa guarda, saldrían tantos avisos como líneas.
--
-- Un fallo al anotar el aviso NUNCA debe impedir crear/autorizar/rechazar la solicitud: se avisa
-- con WARNING y la operación sigue.

CREATE OR REPLACE FUNCTION public.webhook_emit_once(p_tenant uuid, p_type text, p_resource uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.webhook_events e
              WHERE e.tenant_id = p_tenant AND e.type = p_type AND e.resource_id = p_resource) THEN
    RETURN;
  END IF;
  PERFORM public.webhook_emit(p_tenant, p_type, p_resource);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.webhook_emit_once(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.webhook_purchase_requests_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_res    uuid;
  v_live   integer;
  v_open   integer;
  v_auth   integer;
BEGIN
  IF COALESCE(NEW.request_target, 'supplier') = 'client' OR NEW.rental_request_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  v_res := COALESCE(NEW.batch_id, NEW.id);

  BEGIN
    IF TG_OP = 'INSERT' THEN
      PERFORM public.webhook_emit_once(NEW.tenant_id, 'solicitud_compra.creada', v_res);
    END IF;

    IF TG_OP = 'INSERT'
       OR OLD.adc_authorized_at IS DISTINCT FROM NEW.adc_authorized_at
       OR (NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected') THEN
      SELECT count(*) FILTER (WHERE status IS DISTINCT FROM 'rejected'),
             count(*) FILTER (WHERE status IS DISTINCT FROM 'rejected' AND adc_authorized_at IS NULL),
             count(*) FILTER (WHERE status IS DISTINCT FROM 'rejected' AND adc_authorized_at IS NOT NULL)
        INTO v_live, v_open, v_auth
        FROM public.purchase_requests
       WHERE tenant_id = NEW.tenant_id
         AND (id = v_res OR batch_id = v_res)
         AND COALESCE(request_target, 'supplier') <> 'client'
         AND rental_request_id IS NULL;

      IF v_live = 0 THEN
        PERFORM public.webhook_emit_once(NEW.tenant_id, 'solicitud_compra.rechazada', v_res);
      ELSIF v_open = 0 AND v_auth > 0 THEN
        PERFORM public.webhook_emit_once(NEW.tenant_id, 'solicitud_compra.aprobada', v_res);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'webhook solicitud_compra: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_webhook_purchase_requests ON public.purchase_requests;
CREATE TRIGGER trg_webhook_purchase_requests
  AFTER INSERT OR UPDATE OF adc_authorized_at, status ON public.purchase_requests
  FOR EACH ROW EXECUTE FUNCTION public.webhook_purchase_requests_trg();

ALTER TABLE public.webhook_subscriptions DROP CONSTRAINT IF EXISTS webhook_subscriptions_events_valid;
ALTER TABLE public.webhook_subscriptions ADD CONSTRAINT webhook_subscriptions_events_valid CHECK (
  cardinality(events) > 0
  AND events <@ ARRAY[
    'material.creado', 'material.actualizado',
    'proveedor.creado', 'proveedor.actualizado',
    'activo.creado', 'activo.actualizado', 'activo.dado_de_baja',
    'stock.bajo_minimo',
    'compra.recibida', 'compra.recepcion_corregida',
    'solicitud_compra.creada', 'solicitud_compra.aprobada', 'solicitud_compra.rechazada'
  ]::text[]
);

NOTIFY pgrst, 'reload schema';
