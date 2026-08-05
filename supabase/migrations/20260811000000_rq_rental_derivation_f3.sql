-- RFC-004 F3 — El arriendo se pide desde el Requerimiento, sin reimplementarlo
--
-- El flujo de arriendos ya está completo (SOLPED-ARR → cotización por IA →
-- comparador → adjudicación → OC → calendario de ciclos → equipo materializado
-- como activo). El RQ NO lo reemplaza: es la puerta por la que se pide y el
-- lugar donde viven los datos que ese flujo no tiene (CeCo, partida, urgencia y
-- el motivo de la urgencia).
--
-- Las tres reglas que evitan que esto se convierta en "dos documentos para lo
-- mismo" —el defecto que ya se corrigió en el módulo super-admin—:
--
--   1. UN SOLO CÓDIGO. La solicitud de arriendo derivada NO emite un correlativo
--      propio: hereda el del requerimiento (MDS-RQ-0012). Un número desde que se
--      pide hasta la OC. Los arriendos ya emitidos conservan su SOLPED-ARR
--      (Artículo 2: corte limpio, igual que se hizo con PRQ → RQ).
--   2. UN SOLO ESTADO. El requerimiento derivado no tiene máquina de estados
--      propia: la bandeja PROYECTA la etapa de la solicitud de arriendo. No hay
--      columna espejo que sincronizar, así que no hay drift posible.
--   3. UNA SOLA AUTORIZACIÓN. El gate del ADC se queda en el arriendo, que es
--      donde vive el flujo. El requerimiento derivado sale de la pestaña de
--      Compra para que el ADC no vea el mismo pedido dos veces.
--
-- Y el costo lo emite el calendario de arriendos, nunca el requerimiento: un
-- derivado no llega jamás a una OC de compra. Es la regla de "un solo emisor"
-- que ya mordió tres veces en este proyecto.

-- ── Enlace al flujo de arriendos ─────────────────────────────────────────────
-- CASCADE: un requerimiento derivado no significa nada sin su solicitud de
-- arriendo — no es un hecho económico propio, es la puerta de entrada de uno.
-- Si se borra el arriendo, la puerta se va con él en vez de quedar apuntando al
-- vacío y mostrando una etapa que ya no existe.
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS rental_request_id uuid
  REFERENCES public.rental_requests(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS purchase_requests_rental_request_idx
  ON public.purchase_requests (rental_request_id)
  WHERE rental_request_id IS NOT NULL;

-- ── El subtipo 'arriendo' ya es válido ───────────────────────────────────────
-- Hasta F2 el dominio lo rechazaba a propósito, para que nadie creara un
-- arriendo que el módulo de Arriendos no conociera. Ahora sí lo conoce, pero
-- sólo si viene enlazado: un 'arriendo' suelto seguiría siendo ese fantasma.
--
-- Ojo con la forma de escribir el CHECK: la versión anterior no rechazaba nada
-- porque evaluaba a NULL, y Postgres sólo rechaza cuando evalúa a FALSE. De ahí
-- los `IS NOT NULL` explícitos y el `IS DISTINCT FROM`.
ALTER TABLE public.purchase_requests
  DROP CONSTRAINT IF EXISTS purchase_requests_service_kind_check;

ALTER TABLE public.purchase_requests
  ADD CONSTRAINT purchase_requests_service_kind_check
  CHECK (
    (
      request_type = 'servicio'
      AND service_kind IS NOT NULL
      AND service_kind IN ('mantencion', 'otro', 'arriendo')
      -- Un arriendo sólo existe como derivación de una solicitud de arriendo.
      AND (service_kind <> 'arriendo' OR rental_request_id IS NOT NULL)
    )
    OR (request_type IS DISTINCT FROM 'servicio' AND service_kind IS NULL)
  ) NOT VALID;

ALTER TABLE public.purchase_requests
  VALIDATE CONSTRAINT purchase_requests_service_kind_check;

-- Y al revés: sólo un requerimiento de arriendo puede llevar el enlace.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requests_rental_link_check') THEN
    ALTER TABLE public.purchase_requests
      ADD CONSTRAINT purchase_requests_rental_link_check
      CHECK (rental_request_id IS NULL OR service_kind = 'arriendo') NOT VALID;
    ALTER TABLE public.purchase_requests VALIDATE CONSTRAINT purchase_requests_rental_link_check;
  END IF;
END $$;

COMMENT ON COLUMN public.purchase_requests.rental_request_id IS
  'Solicitud de arriendo derivada de este requerimiento. Comparten el código del RQ; el estado se proyecta desde la solicitud de arriendo (no se copia) y el costo lo emite el calendario de arriendos, nunca el requerimiento.';
