-- =============================================================================
-- RFC-006 F1 — La Obra como entidad (work_projects)
--
-- PROBLEMA: Control de Obras no sabía qué es una obra. Se podían crear varias
-- raíces de EDT (parent_id IS NULL), pero nada las distinguía: el Panel
-- promediaba todas las obras del tenant en un solo "Avance General", el Gantt
-- dibujaba las programaciones encimadas y el EDT apilaba los árboles.
--
-- La columna `work_items.project_id` existía desde el día uno del esquema
-- (scripts/schema_complement.sql:200) y NUNCA se llenó con nada real: hoy
-- guarda el tenant_id (Minera Demo) o el literal '1' (Valar, del seed
-- histórico). El hueco estaba marcado en la tabla antes de que se pidiera.
--
-- QUÉ HACE:
--   1. Crea `work_projects` — la Obra: nombre, mandante (vía contrato),
--      ubicación, fechas, responsable y estado.
--   2. Agrega `work_items.work_project_id` (uuid, FK real).
--   3. Backfill: cada raíz existente se convierte en una Obra y todo su árbol
--      queda imputado a ella. Nadie pierde una partida ni un avance.
--   4. RLS canónica + GRANT + Realtime.
--
-- POR QUÉ `work_project_id` Y NO REUSAR `project_id`: la columna vieja es TEXT
-- y sigue siendo escrita por el código desplegado. Renombrarla o cambiarle el
-- tipo abre una ventana en la que la app en producción inserta un tenant_id en
-- una FK uuid y crear partidas falla. `work_project_id` es además el nombre
-- idiomático del proyecto (work_item_id, contract_id, warehouse_id).
-- `project_id` queda muerta y se elimina en una migración posterior, una vez
-- verificado que ningún código la lee.
--
-- LA OBRA CONSERVA SU RAÍZ EN LA EDT: crear una Obra crea también su
-- work_item raíz (type='project'). Estado de Pago se apoya por completo en esa
-- raíz (estado-pago/page.tsx:31 y :55) y la generación de `path` también. No se
-- reemplaza arquitectura que funciona (manifiesto, peaje 1).
--
-- Sondeado contra la BD viva antes de escribir (no derivado de los archivos):
-- 80 work_items, 5 raíces en 2 tenants, 1 progress_log. Las columnas del script
-- suelto scripts/add_work_items_columns.sql SÍ están aplicadas.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

-- ── 1. La Obra ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.work_projects (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    -- Puente al costo real: por acá entra el gasto del ledger financiero.
    -- Opcional: una obra puede existir antes de que se firme el contrato.
    contract_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL,
    name        text NOT NULL,
    code        text,                       -- correlativo legible (OBRA-0001)
    location    text,
    status      text NOT NULL DEFAULT 'active',
    start_date  date,
    end_date    date,
    manager_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    description text,
    created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- El monto de la obra NO se guarda: se deriva de sum(quantity × unit_price) de
-- las hojas de su EDT. Un número duplicado es un número que se desincroniza.

ALTER TABLE public.work_projects DROP CONSTRAINT IF EXISTS work_projects_status_check;
ALTER TABLE public.work_projects
    ADD CONSTRAINT work_projects_status_check
    CHECK (status IN ('planning', 'active', 'suspended', 'closed'));

CREATE INDEX IF NOT EXISTS idx_work_projects_tenant
    ON public.work_projects (tenant_id);
CREATE INDEX IF NOT EXISTS idx_work_projects_contract
    ON public.work_projects (tenant_id, contract_id);
-- El correlativo es único dentro del tenant (cuando existe).
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_projects_tenant_code
    ON public.work_projects (tenant_id, code) WHERE code IS NOT NULL;

-- ── 2. La partida sabe a qué obra pertenece ──────────────────────────────────
ALTER TABLE public.work_items
    ADD COLUMN IF NOT EXISTS work_project_id uuid
    REFERENCES public.work_projects(id) ON DELETE RESTRICT;

-- Índice del filtro que hará TODA pantalla del módulo de ahora en adelante.
CREATE INDEX IF NOT EXISTS idx_work_items_tenant_project
    ON public.work_items (tenant_id, work_project_id);

-- ── 3. Backfill: cada raíz existente pasa a ser una Obra ─────────────────────
-- Recorre el árbol por parent_id (no por `path`: hay raíces con paths '01'/'02'
-- repetidos entre tenants, y un LIKE sobre path cruzaría obras distintas).
-- El guard `work_project_id IS NULL` lo hace idempotente.
DO $$
DECLARE
    r       RECORD;
    new_id  uuid;
BEGIN
    FOR r IN
        SELECT id, tenant_id, name, contract_id, created_by, assigned_to,
               planned_start_date, planned_end_date
        FROM public.work_items
        WHERE parent_id IS NULL
          AND work_project_id IS NULL
    LOOP
        INSERT INTO public.work_projects
            (tenant_id, contract_id, name, status, manager_id, created_by,
             start_date, end_date)
        VALUES
            (r.tenant_id, r.contract_id, r.name, 'active', r.assigned_to, r.created_by,
             r.planned_start_date::date, r.planned_end_date::date)
        RETURNING id INTO new_id;

        WITH RECURSIVE tree AS (
            SELECT id FROM public.work_items WHERE id = r.id
            UNION ALL
            SELECT w.id FROM public.work_items w JOIN tree t ON w.parent_id = t.id
        )
        UPDATE public.work_items
        SET work_project_id = new_id
        WHERE id IN (SELECT id FROM tree);
    END LOOP;
END $$;

-- Red de seguridad: si el árbol tuviera un nodo colgado de una raíz que no se
-- recorrió (parent_id apuntando fuera del propio árbol), quedaría sin obra y
-- desaparecería de todas las pantallas EN SILENCIO — el peor síntoma posible.
-- Este bloque lo deja escrito en los logs en vez de dejarlo pasar.
DO $$
DECLARE huerfanos int;
BEGIN
    SELECT count(*) INTO huerfanos
    FROM public.work_items WHERE work_project_id IS NULL;
    IF huerfanos > 0 THEN
        RAISE WARNING 'RFC-006 F1: % partida(s) quedaron sin obra asignada. Revisar work_items WHERE work_project_id IS NULL.', huerfanos;
    END IF;
END $$;

-- ── 4. RLS canónica (mismo patrón que el resto de tablas tenant) ─────────────
ALTER TABLE public.work_projects ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
    FOR pol IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'work_projects'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.work_projects', pol.policyname);
    END LOOP;
END $$;

CREATE POLICY "work_projects_tenant" ON public.work_projects
    FOR ALL
    USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
    WITH CHECK (public.is_super_admin() OR tenant_id = public.get_my_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_projects TO authenticated;

-- ── 5. Realtime ──────────────────────────────────────────────────────────────
-- Sin esto, crear una obra no la muestra hasta recargar la página
-- (ver migración 20260619010000).
ALTER TABLE public.work_projects REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public' AND tablename = 'work_projects'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.work_projects;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
