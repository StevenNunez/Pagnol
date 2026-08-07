-- RFC-005 F1 — Contadores agregados para los badges de la barra superior.
--
-- Antes, `dashboard/layout.tsx` traía OCHO tablas completas al navegador
-- (material_requests, purchase_requests, rental_requests, supplier_payments,
-- suppliers, purchase_orders, goods_receipts, cost_centers) para mostrar nueve
-- números en la campana y el carrito. Esas ocho colecciones las pagaba TODA
-- página del dashboard, y su costo crece con los datos del tenant.
--
-- Esta función devuelve los nueve números en UN viaje, con trabajo de Postgres.
-- Un contador no crece con los datos: es la única pieza del RFC que sigue
-- rindiendo cuando un tenant tenga 50.000 movimientos.
--
-- SECURITY INVOKER a propósito (Artículo 1 — aislamiento entre tenants): la
-- función se ejecuta con los permisos de quien llama, así que la RLS de cada
-- tabla se aplica igual que en una consulta normal. El `p_tenant_id` acota el
-- caso del super-admin (que puede ver varias empresas); NO es lo que garantiza
-- el aislamiento — eso lo sigue haciendo la RLS. Si alguien pasara un tenant
-- ajeno, la RLS devuelve ceros.
--
-- Los umbrales y criterios replican EXACTAMENTE los del cliente para que los
-- números no cambien al migrar. Las tres sutilezas que importan:
--   1. `COALESCE(status,'') <> 'paid'` y no `status <> 'paid'`: en JS un status
--      NULL entra en el filtro (`null !== 'paid'` es true); en SQL `NULL <> 'x'`
--      es NULL y la fila se caería. Sin el COALESCE los números bajarían.
--   2. La fecha de corte se calcula en horario de Chile, no en UTC. Con
--      CURRENT_DATE, entre medianoche y las 03/04 AM el servidor ya está en el
--      día siguiente y un pago "por vencer" se contaría como "vencido".
--   3. La clave de ítem de una OC es `id` si existe y `nombre#índice` si no,
--      porque hay dos generadores de OC y sólo uno pone `id` en el JSONB
--      (generatePurchaseOrder no lo pone; createPurchaseOrder sí).

CREATE OR REPLACE FUNCTION public.dashboard_badges(p_tenant_id uuid)
RETURNS TABLE (
  pending_auth_material      integer,
  pending_auth_purchase      integer,
  pending_auth_rental        integer,
  pending_material_requests  integer,
  pending_purchase_requests  integer,
  overdue_payments           integer,
  due_soon_payments          integer,
  pending_cotizaciones       integer,
  pending_receptions         integer,
  over_budget_cost_centers   integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH
  hoy AS (
    SELECT (now() AT TIME ZONE 'America/Santiago')::date AS d
  ),
  -- Cantidad ya recibida por (OC, ítem).
  recibido AS (
    SELECT gr.purchase_order_id AS po_id,
           it->>'itemId'        AS item_key,
           SUM(COALESCE(NULLIF(it->>'receivedQuantity','')::numeric, 0)) AS qty
    FROM public.goods_receipts gr,
         LATERAL jsonb_array_elements(COALESCE(gr.items, '[]'::jsonb)) AS it
    WHERE gr.tenant_id = p_tenant_id
    GROUP BY 1, 2
  ),
  -- Ítems de las OC todavía abiertas, con la misma clave que usa el cliente.
  -- `ord` de WITH ORDINALITY es 1-based; el índice del array en JS es 0-based.
  oc_abierta AS (
    SELECT po.id AS po_id,
           COALESCE(t.it->>'id', (t.it->>'name') || '#' || (t.ord - 1)) AS item_key,
           COALESCE(NULLIF(t.it->>'totalQuantity','')::numeric, 0)      AS total_qty
    FROM public.purchase_orders po,
         LATERAL jsonb_array_elements(COALESCE(po.items, '[]'::jsonb))
                 WITH ORDINALITY AS t(it, ord)
    WHERE po.tenant_id = p_tenant_id
      AND po.status IN ('generated', 'sent', 'issued')
  )
  SELECT
    -- Bandeja del ADC: pendientes SIN autorizar.
    (SELECT COUNT(*) FROM public.material_requests
      WHERE tenant_id = p_tenant_id AND status = 'pending'
        AND adc_authorized_at IS NULL)::integer,
    (SELECT COUNT(*) FROM public.purchase_requests
      WHERE tenant_id = p_tenant_id AND status = 'pending'
        AND adc_authorized_at IS NULL)::integer,
    (SELECT COUNT(*) FROM public.rental_requests
      WHERE tenant_id = p_tenant_id AND status = 'pending'
        AND adc_authorized_at IS NULL)::integer,

    -- Colas del pañol / Abastecimiento: pendientes YA autorizadas por el ADC.
    (SELECT COUNT(*) FROM public.material_requests
      WHERE tenant_id = p_tenant_id AND status = 'pending'
        AND adc_authorized_at IS NOT NULL)::integer,
    (SELECT COUNT(*) FROM public.purchase_requests
      WHERE tenant_id = p_tenant_id AND status = 'pending'
        AND adc_authorized_at IS NOT NULL)::integer,

    -- Pagos vencidos y por vencer (ventana de 7 días, inclusive).
    (SELECT COUNT(*) FROM public.supplier_payments, hoy
      WHERE tenant_id = p_tenant_id
        AND COALESCE(status, '') <> 'paid'
        AND due_date::date < hoy.d)::integer,
    (SELECT COUNT(*) FROM public.supplier_payments, hoy
      WHERE tenant_id = p_tenant_id
        AND COALESCE(status, '') <> 'paid'
        AND due_date::date >= hoy.d
        AND due_date::date <= hoy.d + 7)::integer,

    -- Cotizaciones por procesar.
    (SELECT COUNT(*) FROM public.purchase_orders
      WHERE tenant_id = p_tenant_id AND status = 'generated')::integer,

    -- OC con al menos un ítem sin recibir por completo.
    (SELECT COUNT(DISTINCT o.po_id)
       FROM oc_abierta o
       LEFT JOIN recibido r ON r.po_id = o.po_id AND r.item_key = o.item_key
      WHERE COALESCE(r.qty, 0) < o.total_qty)::integer,

    -- Centros de costo cuyo comprometido excede el presupuesto.
    (SELECT COUNT(*) FROM public.cost_centers cc
      WHERE cc.tenant_id = p_tenant_id
        AND COALESCE(cc.budget, 0) > 0
        AND (SELECT COALESCE(SUM(po.total_amount), 0)
               FROM public.purchase_orders po
              WHERE po.tenant_id = p_tenant_id
                AND po.cost_center_id = cc.id
                AND COALESCE(po.status, '') <> 'cancelled') > cc.budget)::integer
$$;

-- GRANT explícito: los proyectos Supabase creados después del 30-may-2026 no
-- heredan permisos de ejecución por defecto (ver project_supabase_grants).
REVOKE ALL ON FUNCTION public.dashboard_badges(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_badges(uuid) TO authenticated;

COMMENT ON FUNCTION public.dashboard_badges(uuid) IS
  'RFC-005 F1: contadores de los badges de la barra superior en un solo viaje. '
  'SECURITY INVOKER — el aislamiento entre tenants lo sigue garantizando la RLS.';
