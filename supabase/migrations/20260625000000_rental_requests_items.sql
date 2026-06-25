-- =============================================================================
-- Solicitudes de Arriendo: carrito multi-ítem
--
-- Añade `items` (jsonb) a rental_requests para que un solo pedido pueda incluir
-- varios equipos (p.ej. 2 contenedores oficina + 1 baño + 1 generador), igual que
-- la solicitud de compra/material. Las columnas legacy equipment_name/category/
-- quantity se conservan como ESPEJO del primer ítem (compat + NOT NULL de
-- equipment_name) y siguen poblándose desde la mutación.
--
-- Forma de cada elemento de items[]:
--   { "name": text, "category": text, "quantity": int }
--
-- Idempotente: seguro de re-ejecutar. Migra filas existentes (mono-ítem) a items[].
-- =============================================================================

ALTER TABLE public.rental_requests
  ADD COLUMN IF NOT EXISTS items jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill: filas previas (mono-ítem) → items[] con su único equipo.
UPDATE public.rental_requests
SET items = jsonb_build_array(
      jsonb_build_object(
        'name', equipment_name,
        'category', COALESCE(category, 'other'),
        'quantity', COALESCE(quantity, 1)
      )
    )
WHERE (items IS NULL OR jsonb_array_length(items) = 0)
  AND equipment_name IS NOT NULL;
