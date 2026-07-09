-- Bandera "¿este activo requiere mantenimiento?"
-- Ahora que las herramientas también son activos, no todos necesitan plan de
-- mantenimiento (un martillo no, un generador sí). Esta columna gobierna si el
-- activo muestra la agenda de mantenimiento en Activos y si aparece como
-- candidato en el módulo de Mantenimiento (OT / KPIs de disponibilidad).
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS requires_maintenance boolean NOT NULL DEFAULT false;

-- Backfill: preservar el comportamiento actual. Cualquier activo que ya tuviera
-- una fecha de próximo mantenimiento se marca como que sí lo requiere.
UPDATE public.materials
  SET requires_maintenance = true
  WHERE next_maintenance_date IS NOT NULL
    AND requires_maintenance = false;
