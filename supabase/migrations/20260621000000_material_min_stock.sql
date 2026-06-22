-- Stock crítico (mínimo) por material, para alertas del Panel Ejecutivo de Reportes.
-- Nullable: si está vacío no se evalúa el material para alertas de stock crítico.
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS min_stock numeric;

COMMENT ON COLUMN public.materials.min_stock IS
  'Umbral de stock mínimo (crítico). Si stock <= min_stock el material aparece en alertas. NULL = sin umbral definido.';
