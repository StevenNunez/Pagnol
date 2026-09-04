-- =============================================================================
-- Dar de baja a alguien tiene que cerrarle la puerta
--
-- PROBLEMA: un perfil dado de baja (`deleted_at` con fecha, o `is_active` en
-- false) seguía pudiendo iniciar sesión y operar con su rol y sus permisos
-- intactos. `AuthProvider` no miraba ninguna de las dos columnas, y las
-- políticas de la base tampoco: `get_my_tenant_id()` devolvía su empresa igual
-- que si estuviera activo. Lo mismo con `tenants.is_active`, que estaba anotado
-- desde antes como que "no corta nada".
--
-- Una baja que no cierra la sesión no es una baja.
--
-- POR QUÉ ACÁ Y NO SÓLO EN LA APLICACIÓN: `get_my_tenant_id()` e
-- `is_super_admin()` son las dos funciones sobre las que se apoyan **145 usos**
-- de políticas en todas las tablas del sistema. Endureciéndolas, la puerta se
-- cierra en TODAS a la vez — incluida la API REST directa, que es por donde el
-- arreglo de la aplicación se saltaría. El cambio en `AuthProvider` (que cierra
-- la sesión y avisa) es la mitad amable; ésta es la que manda.
--
-- CRITERIO CON LOS NULOS — medido contra la base viva antes de escribir esto:
-- los 59 perfiles tienen `is_active = true` y `deleted_at` nulo, y las 4
-- empresas están activas; no hay un solo NULL. Aun así la condición se escribe
-- `IS NOT FALSE` y no `= true`: si mañana entra una fila sin ese campo, un
-- `= true` la dejaría fuera y le cerraría la puerta a alguien que sí trabaja.
-- Sólo un `false` explícito o una fecha de baja bloquean.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

-- ── 1. La empresa de quien pregunta… si sigue habilitado ─────────────────────
-- Devuelve NULL para un perfil dado de baja. Como todas las políticas comparan
-- `tenant_id = get_my_tenant_id()`, un NULL hace que la comparación sea NULL y
-- la fila quede fuera: deniega en todas las tablas sin tocar ninguna política.
CREATE OR REPLACE FUNCTION public.get_my_tenant_id()
RETURNS UUID AS $$
  SELECT p.tenant_id
  FROM public.profiles p
  LEFT JOIN public.tenants t ON t.id = p.tenant_id
  WHERE p.id = auth.uid()
    AND p.deleted_at IS NULL
    AND p.is_active IS NOT FALSE
    AND t.is_active IS NOT FALSE
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── 2. Un super-admin dado de baja tampoco pasa ──────────────────────────────
-- Sin esto, el bypass de super-admin seguiría abierto para una cuenta de baja,
-- que es justamente la que más daño puede hacer.
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'super-admin'
      AND deleted_at IS NULL
      AND is_active IS NOT FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

ALTER FUNCTION public.get_my_tenant_id() SET search_path = public, extensions;
ALTER FUNCTION public.is_super_admin()   SET search_path = public, extensions;

-- ── 3. Que pueda leer su propio perfil para enterarse de la baja ─────────────
-- La política `profiles_select_own` (auth.uid() = id) no pasa por
-- get_my_tenant_id(), así que sigue funcionando: la aplicación puede leer su
-- propia fila, ver el `deleted_at` y cerrar la sesión con un mensaje claro en
-- vez de dejar la pantalla vacía sin explicación.

NOTIFY pgrst, 'reload schema';
