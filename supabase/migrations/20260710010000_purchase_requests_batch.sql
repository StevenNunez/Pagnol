-- purchase_requests venía sin `internal_code` ni `requester_name` — el código
-- de la app (addPurchaseRequest, receivePurchaseRequest) asumía que existían
-- (probado en vivo el 2026-07-10: el insert fallaba SIEMPRE con "Could not
-- find the 'requester_name'/'internal_code' column of 'purchase_requests'").
-- Peor aún: el `id` de esta tabla es `uuid` (autogenerado), pero el código
-- intentaba usar el código legible de nextInternalCode() ("PAG-PRQ-0007")
-- como valor de `id` → fallaba con "invalid input syntax for type uuid".
-- O sea: crear una Solicitud de Compra estaba 100% roto contra este proyecto
-- Supabase antes de esta sesión. El fix de código deja que `id` sea el uuid
-- real de Postgres; esta migración agrega el código legible como columna
-- aparte, igual que ya tienen material_requests/return_requests.
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS internal_code text,
  ADD COLUMN IF NOT EXISTS requester_name text;

CREATE INDEX IF NOT EXISTS idx_purchase_requests_internal_code
  ON public.purchase_requests (internal_code)
  WHERE internal_code IS NOT NULL;

-- El carrito de "Solicitud de Compra" inserta una fila purchase_requests por
-- ítem (no hay items[] como en material_requests), así que un pedido de 5
-- ítems queda como 5 filas sin nada que las una. batch_id correlaciona las
-- filas nacidas del MISMO envío para que el historial las agrupe como un solo
-- pedido — sin crear una tabla de "órdenes" nueva ni tocar el ciclo de vida
-- individual de cada ítem (cada fila sigue aprobándose/rechazándose/recibiéndose
-- por su cuenta, ver updatePurchaseRequestStatus).
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS batch_id uuid;

COMMENT ON COLUMN public.purchase_requests.batch_id IS
  'Correlaciona ítems enviados juntos desde el mismo carrito (NULL = solicitud suelta, incluye todo el historial previo a esta columna).';

CREATE INDEX IF NOT EXISTS idx_purchase_requests_batch_id
  ON public.purchase_requests (batch_id)
  WHERE batch_id IS NOT NULL;
