-- "Eliminar" en /dashboard/pagnol/activos es un borrado AUDITADO, no un DELETE
-- real: stock_movements.material_id tiene FK ON DELETE CASCADE hacia materials,
-- así que un DELETE de verdad se llevaría por delante TODO el kardex histórico
-- del activo (entradas/salidas/ajustes previos), no solo el evento de borrado.
-- Mismo patrón ya usado en profiles (deleted_at) + useSupabaseCollection
-- (soporta softDelete: true de fábrica).
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS deletion_reason text;
