-- =============================================================================
-- S10 — Seed de categorías por defecto en el servidor (trigger)
--
-- Antes: el DataProvider sembraba las categorías por defecto desde el CLIENTE
-- en el primer acceso (lógica de negocio en la UI, dependiente de permisos y
-- flags de sesión). Ahora un trigger en INSERT de `tenants` las crea para CADA
-- tenant nuevo, sin importar por qué ruta se creó (register, oauth, addTenant).
--
-- Solo afecta a tenants NUEVOS; los existentes ya tienen sus categorías.
-- Idempotente.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.seed_default_categories()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.material_categories (name, tenant_id)
  SELECT cat, NEW.id
  FROM unnest(ARRAY[
    'EPP (Elementos de Protección Personal)',
    'Herramientas Manuales',
    'Herramientas Eléctricas / Neumáticas',
    'Equipos de Medición y Control',
    'Activos TI',
    'Activos Mayores (Maquinaria)',
    'Materiales e Insumos',
    'Otros Activos'
  ]) AS cat;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_default_categories ON public.tenants;
CREATE TRIGGER trg_seed_default_categories
  AFTER INSERT ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_default_categories();
