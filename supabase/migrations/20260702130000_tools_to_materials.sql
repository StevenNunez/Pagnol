-- ─────────────────────────────────────────────────────────────────────────────
-- Unificación Herramientas → Activos (tools → materials)  — v2
--
-- v2: corregida contra el ESQUEMA REAL (el código asumía columnas que no
-- existen — drift heredado):
--   tools:     id, tenant_id, name, category, internal_code, serial_number,
--              status, condition, assigned_to, last_maintenance, created_at
--              (NO existe qr_code)
--   tool_logs: id, tenant_id, tool_id, user_id, user_name, checkout_date,
--              expected_return_date, actual_return_date, checkout_condition,
--              return_condition, checkout_notes, return_notes, status
--              (NO existen return_date ni checkout_supervisor_*)
--
-- Cada `tool` se materializa como `material` con:
--   usage_type 'Herramienta Menor', criticality 'C', unidad, cat. 'Herramientas'
--   serial_number = serial real, o internal_code, o un código determinístico
--   'TOOL-XXXXXXXXXX' derivado del id (mismo valor en cada re-ejecución →
--   idempotente). Ese serial es el QR que imprime pagnol/herramientas y que
--   reconoce el escáner de pagnol/movimientos.
--
-- Préstamos activos (tool_logs.actual_return_date IS NULL) → material_requests
-- aprobadas y entregadas al trabajador, para que la devolución fluya por
-- movimientos. (En este proyecto tool_logs está vacío: la sección no inserta
-- nada, pero queda correcta para otros entornos.)
--
-- Las tools 'in-use' SIN registro de préstamo (no hay a quién imputarlas) se
-- migran como Disponibles con nota en la descripción.
--
-- `tools` y `tool_logs` NO se tocan (historial legado). Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────────

-- 0) Categoría 'Herramientas' por tenant que tenga herramientas.
INSERT INTO public.material_categories (name, tenant_id)
SELECT DISTINCT 'Herramientas', t.tenant_id
FROM public.tools t
WHERE NOT EXISTS (
  SELECT 1 FROM public.material_categories c
  WHERE c.tenant_id = t.tenant_id AND c.name = 'Herramientas'
);

-- 1) tools → materials.
WITH open_logs AS (
  SELECT DISTINCT ON (tool_id) tool_id, user_id, user_name, checkout_date
  FROM public.tool_logs
  WHERE actual_return_date IS NULL
  ORDER BY tool_id, checkout_date DESC
),
src AS (
  SELECT
    t.*,
    ol.user_id  AS holder_id,
    ol.user_name AS holder_name,
    COALESCE(
      NULLIF(t.serial_number, ''),
      NULLIF(t.internal_code, ''),
      'TOOL-' || upper(left(replace(t.id::text, '-', ''), 10))
    ) AS serial_code
  FROM public.tools t
  LEFT JOIN open_logs ol ON ol.tool_id = t.id
)
INSERT INTO public.materials
  (name, stock, in_use, unit, category, criticality, usage_type, status,
   serial_number, internal_code, description, ownership, archived,
   failure_probability, failure_impact, tenant_id)
SELECT
  s.name,
  CASE WHEN s.holder_id IS NOT NULL THEN 0 ELSE 1 END,
  CASE WHEN s.holder_id IS NOT NULL THEN 1 ELSE 0 END,
  'unidad',
  'Herramientas',
  'C',
  'Herramienta Menor',
  CASE
    WHEN s.holder_id IS NOT NULL THEN 'En Uso'
    WHEN s.status = 'maintenance' THEN 'En Mantenimiento'
    ELSE 'Disponible'
  END,
  s.serial_code,
  s.serial_code,
  'Herramienta migrada del módulo Herramientas (tools) el ' || to_char(now(), 'YYYY-MM-DD')
    || CASE WHEN s.holder_id IS NULL AND s.status = 'in-use'
            THEN '. Estaba marcada "in-use" sin registro de préstamo; se migra como Disponible.'
            ELSE '' END,
  'propio',
  false,
  1, 1,
  s.tenant_id
FROM src s
WHERE NOT EXISTS (
  SELECT 1 FROM public.materials m
  WHERE m.tenant_id = s.tenant_id AND m.serial_number = s.serial_code
);

-- 2) Ledger (material_stocks): las unidades con stock entran al pool central.
--    Invariante: sum(material_stocks.qty) == materials.stock.
INSERT INTO public.material_stocks (tenant_id, material_id, contract_id, warehouse_id, qty)
SELECT m.tenant_id, m.id, NULL, NULL, m.stock
FROM public.materials m
JOIN public.tools t
  ON t.tenant_id = m.tenant_id
 AND m.serial_number = COALESCE(
      NULLIF(t.serial_number, ''),
      NULLIF(t.internal_code, ''),
      'TOOL-' || upper(left(replace(t.id::text, '-', ''), 10))
    )
WHERE m.usage_type = 'Herramienta Menor'
  AND m.stock > 0
  AND NOT EXISTS (SELECT 1 FROM public.material_stocks s WHERE s.material_id = m.id);

-- 3) Préstamos activos → material_requests aprobadas y entregadas (modo 'self',
--    receptor = el trabajador). La devolución fluye por pagnol/movimientos.
WITH open_logs AS (
  SELECT DISTINCT ON (l.tool_id)
         l.tool_id, l.user_id, l.user_name, l.checkout_date, l.tenant_id
  FROM public.tool_logs l
  WHERE l.actual_return_date IS NULL
  ORDER BY l.tool_id, l.checkout_date DESC
),
src AS (
  SELECT
    ol.*, t.id AS tool_pk,
    COALESCE(
      NULLIF(t.serial_number, ''),
      NULLIF(t.internal_code, ''),
      'TOOL-' || upper(left(replace(t.id::text, '-', ''), 10))
    ) AS serial_code
  FROM open_logs ol
  JOIN public.tools t ON t.id = ol.tool_id
)
INSERT INTO public.material_requests
  (internal_code, items, area, contract_id, contract_name,
   supervisor_id, supervisor_name, highest_class, status, notes, tenant_id,
   approval_date, delivery_date, approver_id, approver_name,
   delivered_by_user_id, delivered_by_user_name,
   adc_authorized_at, adc_authorized_by,
   delivery_mode, received_by_user_id, received_by_user_name, created_at)
SELECT
  'MIG-' || s.serial_code,
  jsonb_build_array(jsonb_build_object('materialId', m.id, 'quantity', 1)),
  'Migración Herramientas',
  NULL, NULL,
  s.user_id, s.user_name,
  'C', 'approved',
  'Préstamo activo migrado desde el módulo Herramientas',
  s.tenant_id,
  s.checkout_date, s.checkout_date,
  s.user_id, 'Migración Herramientas',
  s.user_id, 'Migración Herramientas',
  s.checkout_date, s.user_id,
  'self', s.user_id, s.user_name,
  s.checkout_date
FROM src s
JOIN public.materials m
  ON m.tenant_id = s.tenant_id AND m.serial_number = s.serial_code
WHERE m.usage_type = 'Herramienta Menor'
  AND NOT EXISTS (
    SELECT 1 FROM public.material_requests r
    WHERE r.tenant_id = s.tenant_id AND r.internal_code = 'MIG-' || s.serial_code
  );

-- 4) Kardex de la salida de los préstamos activos (traza).
WITH open_logs AS (
  SELECT DISTINCT ON (l.tool_id)
         l.tool_id, l.user_id, l.user_name, l.checkout_date, l.tenant_id
  FROM public.tool_logs l
  WHERE l.actual_return_date IS NULL
  ORDER BY l.tool_id, l.checkout_date DESC
),
src AS (
  SELECT
    ol.*,
    COALESCE(
      NULLIF(t.serial_number, ''),
      NULLIF(t.internal_code, ''),
      'TOOL-' || upper(left(replace(t.id::text, '-', ''), 10))
    ) AS serial_code
  FROM open_logs ol
  JOIN public.tools t ON t.id = ol.tool_id
)
INSERT INTO public.stock_movements
  (material_id, material_name, quantity_change, new_stock, type, date,
   justification, user_id, user_name, related_request_id, tenant_id)
SELECT
  m.id, m.name, -1, 0, 'request-delivery', s.checkout_date,
  'Préstamo activo migrado desde Herramientas (' || s.serial_code || ')',
  s.user_id, s.user_name,
  'MIG-' || s.serial_code,
  s.tenant_id
FROM src s
JOIN public.materials m
  ON m.tenant_id = s.tenant_id AND m.serial_number = s.serial_code
WHERE m.usage_type = 'Herramienta Menor'
  AND NOT EXISTS (
    SELECT 1 FROM public.stock_movements sm
    WHERE sm.tenant_id = s.tenant_id
      AND sm.related_request_id = 'MIG-' || s.serial_code
  );
