-- =============================================================================
-- API pública v1 — Fase 3 (webhooks: Pagnol → sistema integrado)
--
-- Cuando algo cambia en Pagnol, el sistema integrado (primer cliente: Plataforma
-- Valar) se entera sin tener que preguntar. El diseño es un OUTBOX:
--   1. Triggers de Postgres anotan el hecho en `webhook_events` EN LA MISMA
--      transacción del cambio: si el cambio se deshace, el evento también. Sólo
--      anotan "qué pasó y sobre qué" (tipo + id del recurso); el cuerpo completo
--      (el mismo DTO de la API) lo arma el servidor al despachar.
--   2. Un despachador (/api/cron/webhooks) toma los eventos nuevos, arma el
--      cuerpo, crea una entrega por suscripción y las envía firmadas
--      (Standard Webhooks). Cada entrega se reintenta con backoff hasta recibir 2xx.
--
-- Todo queda cerrado a `service_role`: son tablas de infraestructura y
-- `webhook_subscriptions.secret` es el secreto con el que se firma.
-- =============================================================================

-- ── Suscripciones ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webhook_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  api_key_id   uuid REFERENCES public.api_keys(id) ON DELETE SET NULL,  -- quién la registró
  url          text NOT NULL,
  secret       text NOT NULL,           -- whsec_<base64>: hay que guardarlo en claro para poder firmar
  events       text[] NOT NULL,
  description  text,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_subscriptions_events_valid CHECK (
    cardinality(events) > 0
    AND events <@ ARRAY[
      'material.creado', 'material.actualizado',
      'proveedor.creado', 'proveedor.actualizado',
      'activo.creado', 'activo.actualizado', 'activo.dado_de_baja',
      'stock.bajo_minimo'
    ]::text[]
  )
);
-- Una URL por empresa: dos suscripciones a la misma URL entregarían cada evento
-- dos veces con secretos distintos.
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_subscriptions_url ON public.webhook_subscriptions (tenant_id, url);

-- ── Outbox de eventos ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id            text PRIMARY KEY DEFAULT ('evt_' || replace(gen_random_uuid()::text, '-', '')),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type          text NOT NULL,
  resource_id   uuid NOT NULL,
  detail        jsonb,                  -- datos del instante (ej. stock al cruzar el mínimo)
  created_at    timestamptz NOT NULL DEFAULT now(),
  claimed_at    timestamptz,            -- tomado por un despachador (se reintenta si éste muere)
  processed_at  timestamptz,
  payload       jsonb,                  -- sobre ya armado; null si no hubo a quién enviarlo
  note          text
);
CREATE INDEX IF NOT EXISTS idx_webhook_events_pending ON public.webhook_events (created_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed ON public.webhook_events (processed_at) WHERE processed_at IS NOT NULL;

-- ── Entregas (una por evento × suscripción) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id         text NOT NULL REFERENCES public.webhook_events(id) ON DELETE CASCADE,
  subscription_id  uuid NOT NULL REFERENCES public.webhook_subscriptions(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts         integer NOT NULL DEFAULT 0,
  last_status      integer,             -- HTTP de la última respuesta
  last_error       text,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  delivered_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, subscription_id)
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due ON public.webhook_deliveries (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_sub ON public.webhook_deliveries (subscription_id);

ALTER TABLE public.webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries    ENABLE ROW LEVEL SECURITY;
-- Sin políticas, y sin los permisos que otorga por defecto el proyecto a `authenticated`.
REVOKE ALL ON public.webhook_subscriptions, public.webhook_events, public.webhook_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.webhook_subscriptions, public.webhook_events, public.webhook_deliveries TO service_role;

-- ── Anotar un evento ────────────────────────────────────────────────────────
-- Sólo si alguien lo escucha: sin suscripciones, ningún cambio deja rastro aquí.
CREATE OR REPLACE FUNCTION public.webhook_emit(p_tenant uuid, p_type text, p_resource uuid, p_detail jsonb DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  INSERT INTO public.webhook_events (tenant_id, type, resource_id, detail)
  SELECT p_tenant, p_type, p_resource, p_detail
   WHERE EXISTS (
     SELECT 1 FROM public.webhook_subscriptions s
      WHERE s.tenant_id = p_tenant AND s.active AND p_type = ANY (s.events)
   );
$$;
REVOKE EXECUTE ON FUNCTION public.webhook_emit(uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ── materials → material.* / activo.* / stock.bajo_minimo ──────────────────
-- Reparto idéntico al de la API: un ítem propio es "material"; uno rastreable
-- (api_is_trackable) es además "activo", sea propio, arrendado o del cliente.
CREATE OR REPLACE FUNCTION public.webhook_materials_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_track     boolean := public.api_is_trackable(NEW.usage_type);
  v_baja_old  boolean;
  v_baja_new  boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.ownership = 'propio' THEN
      PERFORM public.webhook_emit(NEW.tenant_id, 'material.creado', NEW.id);
    END IF;
    IF v_track THEN
      PERFORM public.webhook_emit(NEW.tenant_id, 'activo.creado', NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: sólo si cambió algo que el DTO público expone.
  IF (OLD.name, OLD.internal_code, OLD.serial_number, OLD.description, OLD.category, OLD.unit, OLD.stock,
      OLD.min_stock, OLD.archived, OLD.deleted_at, OLD.usage_type, OLD.ownership, OLD.supplier_id, OLD.status,
      OLD.location, OLD.unit_cost, OLD.acquisition_date, OLD.catalog_material_id, OLD.external_ref)
     IS NOT DISTINCT FROM
     (NEW.name, NEW.internal_code, NEW.serial_number, NEW.description, NEW.category, NEW.unit, NEW.stock,
      NEW.min_stock, NEW.archived, NEW.deleted_at, NEW.usage_type, NEW.ownership, NEW.supplier_id, NEW.status,
      NEW.location, NEW.unit_cost, NEW.acquisition_date, NEW.catalog_material_id, NEW.external_ref)
  THEN
    RETURN NEW;
  END IF;

  IF NEW.ownership = 'propio' THEN
    PERFORM public.webhook_emit(NEW.tenant_id, 'material.actualizado', NEW.id);
  END IF;

  IF v_track THEN
    v_baja_old := OLD.status IS NOT DISTINCT FROM 'Para Baja' OR COALESCE(OLD.archived, false) OR OLD.deleted_at IS NOT NULL;
    v_baja_new := NEW.status IS NOT DISTINCT FROM 'Para Baja' OR COALESCE(NEW.archived, false) OR NEW.deleted_at IS NOT NULL;
    -- Pasar a baja es SU evento; no se avisa además como "actualizado".
    PERFORM public.webhook_emit(
      NEW.tenant_id,
      CASE WHEN v_baja_new AND NOT v_baja_old THEN 'activo.dado_de_baja' ELSE 'activo.actualizado' END,
      NEW.id);
  ELSIF NEW.ownership = 'propio'
        AND NEW.deleted_at IS NULL AND NOT COALESCE(NEW.archived, false)
        AND COALESCE(NEW.min_stock, 0) > 0
        AND COALESCE(NEW.stock, 0) < NEW.min_stock
        AND NOT (COALESCE(OLD.stock, 0) < COALESCE(OLD.min_stock, 0))
  THEN
    -- Cruzó hacia abajo del mínimo (no cada vez que se mueve estando abajo).
    PERFORM public.webhook_emit(
      NEW.tenant_id, 'stock.bajo_minimo', NEW.id,
      jsonb_build_object('stock_actual', COALESCE(NEW.stock, 0), 'stock_minimo', NEW.min_stock));
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.webhook_materials_trg() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_webhook_materials ON public.materials;
CREATE TRIGGER trg_webhook_materials
  AFTER INSERT OR UPDATE ON public.materials
  FOR EACH ROW EXECUTE FUNCTION public.webhook_materials_trg();

-- ── suppliers → proveedor.* ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.webhook_suppliers_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.webhook_emit(NEW.tenant_id, 'proveedor.creado', NEW.id);
  ELSIF (OLD.rut, OLD.name, OLD.email, OLD.phone, OLD.deleted_at)
        IS DISTINCT FROM (NEW.rut, NEW.name, NEW.email, NEW.phone, NEW.deleted_at) THEN
    PERFORM public.webhook_emit(NEW.tenant_id, 'proveedor.actualizado', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.webhook_suppliers_trg() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_webhook_suppliers ON public.suppliers;
CREATE TRIGGER trg_webhook_suppliers
  AFTER INSERT OR UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.webhook_suppliers_trg();

-- ── Despachador: tomar trabajo sin pisarse ──────────────────────────────────
-- Dos despachadores simultáneos (o uno que murió a medias) no pueden enviar lo
-- mismo dos veces: cada tanda se "toma" con SKIP LOCKED y un plazo (lease).
CREATE OR REPLACE FUNCTION public.webhooks_claim_events(p_limit integer, p_lease_seconds integer DEFAULT 300)
RETURNS SETOF public.webhook_events
LANGUAGE sql
SET search_path = public, extensions
AS $$
  UPDATE public.webhook_events e SET claimed_at = now()
   WHERE e.id IN (
     SELECT id FROM public.webhook_events
      WHERE processed_at IS NULL
        AND (claimed_at IS NULL OR claimed_at < now() - make_interval(secs => p_lease_seconds))
      ORDER BY created_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING e.*;
$$;

-- Entregas vencidas, con lo necesario para enviarlas. El plazo empuja
-- `next_attempt_at` hacia adelante: si el despachador muere, se reintenta sola.
CREATE OR REPLACE FUNCTION public.webhooks_claim_deliveries(p_limit integer, p_lease_seconds integer DEFAULT 120)
RETURNS TABLE (
  id uuid, tenant_id uuid, event_id text, subscription_id uuid, attempts integer, created_at timestamptz,
  url text, secret text, payload jsonb
)
LANGUAGE sql
SET search_path = public, extensions
AS $$
  WITH due AS (
    SELECT d.id FROM public.webhook_deliveries d
     WHERE d.status = 'pending' AND d.next_attempt_at <= now()
     ORDER BY d.next_attempt_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.webhook_deliveries d
       SET next_attempt_at = now() + make_interval(secs => p_lease_seconds)
      FROM due WHERE d.id = due.id
    RETURNING d.id, d.tenant_id, d.event_id, d.subscription_id, d.attempts, d.created_at
  )
  SELECT c.id, c.tenant_id, c.event_id, c.subscription_id, c.attempts, c.created_at,
         s.url, s.secret, e.payload
    FROM claimed c
    JOIN public.webhook_subscriptions s ON s.id = c.subscription_id
    JOIN public.webhook_events e ON e.id = c.event_id;
$$;

-- Limpieza: eventos ya despachados y entregas cerradas de más de 30 días.
CREATE OR REPLACE FUNCTION public.webhooks_purge(p_days integer DEFAULT 30)
RETURNS integer
LANGUAGE sql
SET search_path = public, extensions
AS $$
  WITH gone AS (
    DELETE FROM public.webhook_events e
     WHERE e.processed_at < now() - make_interval(days => p_days)
       AND NOT EXISTS (SELECT 1 FROM public.webhook_deliveries d WHERE d.event_id = e.id AND d.status = 'pending')
    RETURNING 1
  )
  SELECT count(*)::integer FROM gone;
$$;

REVOKE EXECUTE ON FUNCTION public.webhooks_claim_events(integer, integer)     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.webhooks_claim_deliveries(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.webhooks_purge(integer)                     FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.webhooks_claim_events(integer, integer)     TO service_role;
GRANT EXECUTE ON FUNCTION public.webhooks_claim_deliveries(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.webhooks_purge(integer)                     TO service_role;

NOTIFY pgrst, 'reload schema';
