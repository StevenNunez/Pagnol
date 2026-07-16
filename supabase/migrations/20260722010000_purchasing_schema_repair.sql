-- =============================================================================
-- REPARACIÓN DE DRIFT: módulo Compras (purchase_orders / purchase_lots /
-- supplier_payments)
--
-- Detectado en el E2E de F0 (Dominio Financiero, 2026-07-16): el esquema vivo
-- de este proyecto (reconstruido post-30-may-2026 desde scripts/schema_complement.sql)
-- nunca recibió las columnas que el código de compras escribe y lee desde hace
-- meses. Generar una cotización/OC fallaba con PGRST204 ("creator_name no
-- existe") y el flujo RFQ no podía asociar proveedor al lote.
--
-- La tabla purchase_orders está VACÍA en todos los tenants (el insert nunca
-- funcionó contra este esquema), por lo que los cambios de tipo van sin
-- backfill.
-- =============================================================================

-- 1) purchase_orders: columnas que el código escribe/lee y no existían.
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS internal_code text;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS supplier_name text NOT NULL DEFAULT '';
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS creator_name text;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS request_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS official_oc_id text;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS processed_at timestamptz;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS processed_by uuid;

-- 2) purchase_orders.id: uuid → text.
--    El generador de cotizaciones asigna códigos correlativos ('MDS-PUR-0002')
--    como id del documento; el flujo RFQ sigue usando el default aleatorio.
--    Misma convención que ya asumió la migración 20260722000000 para
--    supplier_payments.purchase_order_id ("text, no uuid").
DO $$
DECLARE r record;
BEGIN
  -- Suelta cualquier FK que cuelgue de purchase_orders(id) (nombres variables
  -- según cómo se creó el esquema).
  FOR r IN
    SELECT con.conname, rel.relname AS tabla
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_class ref ON ref.oid = con.confrelid
    WHERE con.contype = 'f' AND ref.relname = 'purchase_orders'
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tabla, r.conname);
  END LOOP;
END $$;

ALTER TABLE public.purchase_orders ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.purchase_orders ALTER COLUMN id TYPE text USING id::text;
ALTER TABLE public.purchase_orders ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

-- Columnas que apuntan a purchase_orders.id en otras tablas → text, sin FK
-- (consistente con la decisión de 20260722000000).
ALTER TABLE public.supplier_payments ALTER COLUMN purchase_order_id TYPE text USING purchase_order_id::text;
ALTER TABLE public.purchase_requests ALTER COLUMN purchase_order_id TYPE text USING purchase_order_id::text;
ALTER TABLE public.goods_receipts    ALTER COLUMN purchase_order_id TYPE text USING purchase_order_id::text;

-- 3) purchase_lots.supplier_id: el generador guarda el proveedor elegido en el
--    lote y el flujo RFQ lo exige para emitir la OC firme.
ALTER TABLE public.purchase_lots ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id);

-- 4) supplier_payments: fechas que escribe la página Facturas de Proveedor.
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS issue_date date;
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS payment_date timestamptz;
