-- RFC-004 F2 — Servicios: gasto que no entra al pañol
--
-- Un servicio (una mantención, un flete, una calibración) genera gasto pero NO
-- genera inventario. Hasta ahora el módulo sólo sabía pedir cosas que se
-- guardan: recibir un servicio por ese camino crearía un `Material` con stock 1
-- ("mantención de compresor") que además entraría en la valorización del
-- inventario y rompería el invariante `sum(material_stocks) == materials.stock`.
--
-- Decisión de Steven: el servicio recorre el MISMO flujo que un producto
-- (requerimiento → autorización → OC → recepción), para que el compromiso
-- exista antes del gasto y quede enlazado a su factura. Lo único que cambia es
-- que la recepción NO toca el pañol y el costo se imputa a la categoría
-- `services` del ledger financiero en vez de `materials`.

-- ── Subtipo de servicio ──────────────────────────────────────────────────────
-- 'arriendo' NO se acepta todavía: el arriendo tiene su propio flujo completo
-- (SOLPED-ARR, cotización por IA, comparador, calendario de ciclos y
-- materialización del equipo como activo) y el RQ debe DERIVAR hacia él, no
-- reimplementarlo. Eso es F3; hasta entonces el dominio no lo admite, para que
-- nadie cree por accidente un arriendo que el módulo de Arriendos no conoce.
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS service_kind text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requests_service_kind_check') THEN
    ALTER TABLE public.purchase_requests
      ADD CONSTRAINT purchase_requests_service_kind_check
      CHECK (
        -- Un producto no tiene subtipo de servicio; un servicio sí, siempre.
        (request_type = 'servicio' AND service_kind IN ('mantencion', 'otro'))
        OR (request_type <> 'servicio' AND service_kind IS NULL)
      ) NOT VALID;
    ALTER TABLE public.purchase_requests VALIDATE CONSTRAINT purchase_requests_service_kind_check;
  END IF;
END $$;

-- ── Tipo de la orden de compra ───────────────────────────────────────────────
-- Se guarda en la OC en vez de reconstruirlo desde sus solicitudes: la
-- recepción tiene que saber sin ambigüedad si debe tocar el pañol, y algunas OC
-- calzan sus ítems por NOMBRE (generatePurchaseOrder agrupa sin id). Un dato
-- guardado no depende de que ese calce salga bien.
--
-- Las OC ya emitidas quedan como 'producto', que es lo que son: el default hace
-- explícito un hecho existente (Artículo 2), no reescribe ninguna.
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'producto';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_order_type_check') THEN
    ALTER TABLE public.purchase_orders
      ADD CONSTRAINT purchase_orders_order_type_check
      CHECK (order_type IN ('producto', 'servicio')) NOT VALID;
    ALTER TABLE public.purchase_orders VALIDATE CONSTRAINT purchase_orders_order_type_check;
  END IF;
END $$;

COMMENT ON COLUMN public.purchase_requests.service_kind IS
  'Subtipo cuando request_type = servicio: mantencion | otro. El arriendo llega en F3 (deriva a SOLPED-ARR, no se reimplementa).';
COMMENT ON COLUMN public.purchase_orders.order_type IS
  'producto | servicio. Una OC de servicio NO ingresa stock al recibirse y devenga en la categoría `services` del ledger. No se permite mezclar tipos en una misma OC.';

-- ── Partidas de servicio (RFC-004 D6) ────────────────────────────────────────
-- Las partidas de servicio se suman a las categorías que cada empresa ya usa,
-- que es donde viven sus partidas reales. Se siembran sólo si la empresa no
-- tiene ya una con ese nombre, para no pisar la nomenclatura de nadie.
INSERT INTO public.material_categories (tenant_id, name)
SELECT t.id, c.name
FROM public.tenants t
CROSS JOIN (VALUES ('Mantención'), ('Servicios Generales'), ('Fletes y Transporte')) AS c(name)
WHERE NOT EXISTS (
  SELECT 1 FROM public.material_categories mc
  WHERE mc.tenant_id = t.id AND lower(btrim(mc.name)) = lower(c.name)
);
