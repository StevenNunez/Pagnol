-- Poda: `warehouses.manager_id` y `manager_name` ya no se usan.
--
-- La migración 20261031000000 pasó el encargado único a la lista `manager_ids` (pañoles por turno) y dejó
-- `manager_id` como espejo transitorio del primero, mantenido por un trigger, para no romper lo que aún lo leyera
-- durante el despliegue. Verificado en vivo (el código real guarda y lee la lista; recibir y corregir recepciones
-- exigen ser encargado del pañol), la aplicación ya no lee ni escribe `manager_id` ni `manager_name`, así que el
-- espejo sobra: dos columnas y un trigger que repetían un dato que ya vive en `manager_ids`.
--
-- ORDEN: aplicar DESPUÉS de desplegar la versión que ya no usa `manager_id` (una pestaña con la versión anterior
-- leería `manager_id` como vacío hasta recargar). Aplicarla antes no rompe datos, sólo esa pestaña.
--
-- Nada se pierde: los encargados viven en `manager_ids` desde la migración anterior. Esta migración se detiene si
-- encuentra un pañol cuyo `manager_id` no esté en su lista (no debería: el trigger los mantenía iguales).

DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM public.warehouses
   WHERE manager_id IS NOT NULL AND NOT (manager_id = ANY(manager_ids));
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Hay % pañol(es) con un manager_id que no está en manager_ids: revísalos antes de podar.', v_bad;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_warehouses_sync_managers ON public.warehouses;
DROP FUNCTION IF EXISTS public.warehouses_sync_managers();

ALTER TABLE public.warehouses DROP COLUMN IF EXISTS manager_id;
ALTER TABLE public.warehouses DROP COLUMN IF EXISTS manager_name;

NOTIFY pgrst, 'reload schema';
