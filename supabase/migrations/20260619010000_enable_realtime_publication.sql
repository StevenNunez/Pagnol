-- =============================================================================
-- Habilitar Realtime (publicación `supabase_realtime`) para todas las colecciones
-- =============================================================================
-- SÍNTOMA: al crear una OT / Reporte Diario / Semanal / etc., el registro no
-- aparece en la UI hasta recargar la página.
--
-- CAUSA RAÍZ: el hook `useSupabaseCollection` se suscribe a `postgres_changes`,
-- pero Supabase sólo emite esos eventos para tablas incluidas en la publicación
-- `supabase_realtime`. En proyectos creados después de may-2026 esa publicación
-- nace VACÍA, así que ninguna tabla emite eventos → hay que recargar.
--
-- FIX: agregar cada tabla tenant-scoped a la publicación. Idempotente: sólo toca
-- las tablas que aún no están publicadas, así no altera lo que ya funciona.
-- También se les pone REPLICA IDENTITY FULL para que los payloads de UPDATE/DELETE
-- traigan la fila completa (el hook hace merge, pero FULL evita payloads parciales).
--
-- >>> PATRÓN PARA TABLAS NUEVAS: cada vez que agregues una colección a
--     `useSupabaseCollection`, añade su nombre al array `tbls` de abajo y
--     re-ejecuta esta migración (es idempotente), o haz tu propio ADD TABLE.
-- =============================================================================

-- 1) Asegurar que la publicación exista (en Supabase ya existe; guard por si acaso).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

-- 2) Publicar cada tabla que aún no esté en la publicación.
DO $$
DECLARE
  t        text;
  added    int := 0;
  tbls     text[] := ARRAY[
    -- bodega / materiales
    'materials', 'tools', 'tool_logs', 'material_requests', 'return_requests',
    'material_categories', 'units', 'stock_movements',
    -- compras / pagos
    'purchase_requests', 'suppliers', 'purchase_lots', 'purchase_orders',
    'quote_requests', 'goods_receipts', 'cost_centers', 'supplier_payments',
    'salary_advances',
    -- asistencia / contratos
    'attendance_logs', 'shift_schedules', 'contracts', 'contract_workers',
    -- seguridad (CPHS)
    'assigned_checklists', 'safety_inspections', 'checklist_templates',
    'behavior_observations', 'daily_talks',
    -- control de obra
    'work_items', 'progress_logs', 'payment_states', 'protocol_templates', 'protocols',
    -- mantenimiento / activos
    'maintenance_orders', 'maintenance_logs', 'ea_documents',
    -- arriendos
    'rental_parties', 'rental_contracts', 'rental_assets', 'rental_payments',
    -- RRHH
    'hr_leave_requests', 'hr_documents',
    -- reportes de trabajo (cascada OT → diario → semanal)
    'work_reports', 'work_orders', 'work_weekly_reports',
    'wr_areas', 'wr_specialties', 'wr_milestones', 'wr_catalogs',
    -- núcleo
    'profiles', 'roles'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    -- sólo si la tabla existe y aún NO está en la publicación
    IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = t
        )
       AND NOT EXISTS (
          SELECT 1 FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
        )
    THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      added := added + 1;
      RAISE NOTICE 'Realtime habilitado para %', t;
    END IF;
  END LOOP;

  RAISE NOTICE 'Tablas agregadas a supabase_realtime: %', added;
END $$;
