-- =============================================================================
-- Endurecimiento de Control de Obra (work_items / progress_logs)
--
-- Auditoría 2026-07-12 encontró que crear un Contrato/Partida estaba 100%
-- ROTO en producción: `work_items.id` es TEXT PRIMARY KEY sin DEFAULT y el
-- código nunca genera un id en el cliente → INSERT falla con
-- "null value in column id violates not-null constraint" (verificado contra
-- la BD viva). Además `parent_id` no tenía FK (jerarquía sin integridad) y
-- `type`/`status` eran TEXT libre (el Gantt llegó a escribir type='milestone',
-- que no existe en el dominio WorkItem).
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

-- 1. Default para que las partidas/contratos nuevos generen su propio id.
--    No afecta las filas existentes (creadas con ids cortos '1'..'39' por el
--    seed histórico) — solo aplica a INSERTs futuros que no especifiquen id.
ALTER TABLE public.work_items ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

-- 2. Integridad de la jerarquía: parent_id debe apuntar a un work_item real.
--    Limpia cualquier referencia huérfana antes de aplicar la FK (defensivo;
--    no debería haber ninguna en datos sanos).
UPDATE public.work_items
SET parent_id = NULL
WHERE parent_id IS NOT NULL
  AND parent_id NOT IN (SELECT id FROM public.work_items);

ALTER TABLE public.work_items DROP CONSTRAINT IF EXISTS fk_work_items_parent;
ALTER TABLE public.work_items
    ADD CONSTRAINT fk_work_items_parent
    FOREIGN KEY (parent_id) REFERENCES public.work_items(id) ON DELETE RESTRICT;

-- 3. type/status honestos: solo los valores que el dominio WorkItem soporta
--    (evita que el Gantt u otra vía escriba 'milestone' u otros valores que
--    ninguna pantalla sabe interpretar).
UPDATE public.work_items SET type = 'task' WHERE type NOT IN ('project','phase','subphase','activity','task');
ALTER TABLE public.work_items DROP CONSTRAINT IF EXISTS work_items_type_check;
ALTER TABLE public.work_items
    ADD CONSTRAINT work_items_type_check
    CHECK (type IN ('project','phase','subphase','activity','task'));

ALTER TABLE public.work_items DROP CONSTRAINT IF EXISTS work_items_status_check;
ALTER TABLE public.work_items
    ADD CONSTRAINT work_items_status_check
    CHECK (status IN ('in-progress','pending-quality-review','completed','rejected'));

NOTIFY pgrst, 'reload schema';
