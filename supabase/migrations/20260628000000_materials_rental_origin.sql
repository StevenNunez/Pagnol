-- Materializa los equipos arrendados como activos del módulo Pagnol (tabla `materials`).
--
-- Hasta ahora un equipo arrendado vivía SOLO en `rental_assets` (ligado al contrato,
-- para lo financiero) y nunca aparecía en el módulo Pagnol, por lo que no tenía acceso
-- a la trazabilidad que cuelga de `materials` (movimientos quién retira/entrega,
-- mantenimiento/OT, ficha técnica, QR, jerarquía ISO 55001).
--
-- Solución: al CONFIRMAR la OC del arriendo se crea un `material` espejo por cada
-- `rental_asset`, marcado con ownership='arrendado' + referencias al contrato y al
-- activo de arriendo. Estas columnas permiten ese enlace e idempotencia (no duplicar).

ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS ownership text NOT NULL DEFAULT 'propio',
  ADD COLUMN IF NOT EXISTS rental_contract_id uuid,
  ADD COLUMN IF NOT EXISTS rental_asset_id uuid;

-- FKs sueltas (ON DELETE SET NULL): si se borra el contrato/activo de arriendo, el
-- material persiste con su historial de trazabilidad, solo pierde el vínculo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'materials_rental_contract_id_fkey'
  ) THEN
    ALTER TABLE public.materials
      ADD CONSTRAINT materials_rental_contract_id_fkey
      FOREIGN KEY (rental_contract_id) REFERENCES public.rental_contracts(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'materials_rental_asset_id_fkey'
  ) THEN
    ALTER TABLE public.materials
      ADD CONSTRAINT materials_rental_asset_id_fkey
      FOREIGN KEY (rental_asset_id) REFERENCES public.rental_assets(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Un material espejo por activo de arriendo (idempotencia del materializado).
CREATE UNIQUE INDEX IF NOT EXISTS materials_rental_asset_id_uidx
  ON public.materials(rental_asset_id)
  WHERE rental_asset_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
