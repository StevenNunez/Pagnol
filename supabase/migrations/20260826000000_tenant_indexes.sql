-- =============================================================================
-- Índices por tenant en las tablas más leídas
-- =============================================================================
--
-- CONTEXTO
--
-- Toda consulta de la app filtra por `tenant_id` — es el patrón canónico de RLS
-- (`tenant_id = public.get_my_tenant_id()`) y además el `.eq('tenant_id', ...)`
-- explícito de `useSupabaseCollection`. Aun así, las tablas más grandes y más
-- pedidas no tenían ningún índice sobre esa columna: el planner resolvía cada
-- carga de página con un seq scan.
--
-- Con los volúmenes de hoy (5.528 materials, 5.343 stock_movements) eso es
-- gratis y no se nota. El problema es hacia dónde va: `stock_movements` es un
-- kardex append-only que sólo crece, y `attendance_logs` suma ~2 filas por
-- trabajador por día. Con 200 trabajadores son ~300.000 filas al año, y para
-- entonces cada carga de página cuesta un scan completo — multiplicado por
-- cuantos usuarios estén entrando a la vez, contra una instancia de plan Free
-- con 500 MB de RAM y CPU compartida.
--
-- Se aplica ahora, con las tablas chicas, justamente porque ahora es barato:
-- crear estos índices sobre una tabla de 5.000 filas es instantáneo; sobre una
-- de 300.000 y en caliente, no.
--
-- CRITERIOS
--
-- 1. Índice PARCIAL donde hay borrado lógico (`materials`, `profiles`). El hook
--    siempre agrega `deleted_at IS NULL`, así que el índice sólo necesita las
--    filas vivas: más chico, y el planner lo puede usar igual.
-- 2. Índice COMPUESTO `(tenant_id, <columna de orden> DESC)` donde la colección
--    se pide ordenada. Así el mismo índice resuelve el filtro y el ORDER BY, y
--    Postgres se ahorra el sort.
-- 3. `attendance_logs` NO está: ya tiene `idx_attendance_logs_tenant_date`
--    (migración 20260723000000).
--
-- Los nombres de tabla y columna fueron sondeados por REST contra la base viva
-- antes de escribir esto, no derivados de los tipos de TypeScript — el drift de
-- esquema ya mordió siete veces en este proyecto.
--
-- Idempotente: `IF NOT EXISTS` en todos. Seguro de re-ejecutar.
--
-- ⚠️ NO se usa `CREATE INDEX CONCURRENTLY`: no corre dentro de un bloque
-- transaccional, y el editor SQL de Supabase envuelve el script en una. Con
-- estos volúmenes el lock es de milisegundos. Si algún día se re-aplica sobre
-- tablas grandes y en producción, hay que correr cada línea por separado y con
-- CONCURRENTLY.
-- =============================================================================

-- ── Tablas con borrado lógico: índice parcial sobre las filas vivas ──────────
CREATE INDEX IF NOT EXISTS idx_materials_tenant
  ON public.materials (tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_tenant
  ON public.profiles (tenant_id)
  WHERE deleted_at IS NULL;

-- ── Kardex: crece sin techo y siempre se pide ordenado por fecha ─────────────
CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant_date
  ON public.stock_movements (tenant_id, date DESC);

-- ── Bandejas: filtro por tenant + orden por fecha de creación ────────────────
CREATE INDEX IF NOT EXISTS idx_material_requests_tenant_created
  ON public.material_requests (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_return_requests_tenant_created
  ON public.return_requests (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_purchase_requests_tenant_created
  ON public.purchase_requests (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_tenant_created
  ON public.purchase_orders (tenant_id, created_at DESC);

-- ── Ledger de stock por contrato/pañol ───────────────────────────────────────
-- Ya tiene índices compuestos `(tenant_id, material_id)`, `(tenant_id,
-- contract_id)` y `(tenant_id, warehouse_id)` de la migración 20260701010000.
-- Un `(tenant_id)` suelto sería redundante: el compuesto por material ya sirve
-- de prefijo para el filtro por tenant. No se agrega nada acá a propósito.
