-- =============================================================================
-- Pagos: marcar una factura como pagada se hace valer en la BASE
--
-- PROBLEMA: los cinco permisos de Pagos (`payments:create`, `payments:view`,
-- `payments:mark_as_paid`, `payments:edit`, `payments:delete`) están definidos
-- desde hace tiempo y **no se usan en ninguna parte**: cero referencias en toda
-- la aplicación. Se pueden activar y desactivar en Gestión de Permisos, y no
-- hacen nada. La puerta real es sólo `module_payments:view`, así que cualquiera
-- que entre a Pagos puede marcar facturas como pagadas y borrarlas.
--
-- Marcar pagada no es un cambio cosmético: apaga la obligación de caja y emite
-- el hecho de costo `paid` en el ledger financiero. Es plata que sale.
--
-- PATRÓN: idéntico a `can_manage_advances()` (20260804000000) y al trigger de
-- Control de Obras (20260902010000). No se inventa nada nuevo.
--
-- MEDIDO CONTRA LA BASE VIVA antes de escribir esto (para no romper a nadie):
--   · `payments:mark_as_paid` por código : finance, abastecimiento (+ los admins)
--   · por configuración de empresa       : sólo administrador y soporte-pagnol,
--     que ya pasan por el bypass de control total
--   · roles que ENTRAN a Pagos y no tendrían el permiso: ninguno
--   ⇒ exigirlo no le quita el acceso a nadie que hoy lo tenga.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

-- ── 1. ¿Quién puede marcar una factura como pagada? ──────────────────────────
-- SQL no puede leer los permisos por defecto del código
-- (`ROLES` en src/modules/core/lib/permissions.ts), así que los roles que lo
-- tienen por defecto y NO tienen fila en `roles` van enumerados. Sin eso, un
-- usuario de Finanzas o de Abastecimiento vería el botón y fallaría al usarlo.
CREATE OR REPLACE FUNCTION public.can_mark_payments_paid()
RETURNS boolean AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.roles r
      ON r.id = p.role AND r.tenant_id = p.tenant_id
    WHERE p.id = auth.uid()
      AND (
            p.role IN ('super-admin', 'administrador', 'soporte-pagnol')
         OR to_jsonb(p.granted_permissions) ? 'payments:mark_as_paid'
         OR to_jsonb(r.permissions)         ? 'payments:mark_as_paid'
            -- Roles que lo tienen por defecto en el código y no tienen fila propia.
         OR (r.id IS NULL AND p.role IN ('finance', 'abastecimiento'))
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

ALTER FUNCTION public.can_mark_payments_paid() SET search_path = public, extensions;
GRANT EXECUTE ON FUNCTION public.can_mark_payments_paid() TO authenticated;

-- ── 2. Sólo esa gente puede pasar una factura a pagada ───────────────────────
-- Quirúrgico: se activa únicamente cuando el estado CAMBIA a 'paid'. Ingresar
-- una factura, corregirle el monto o adjuntarle un documento no se tocan. El
-- service role (migraciones, scripts, rutas del servidor) tampoco: ahí
-- auth.uid() es NULL.
CREATE OR REPLACE FUNCTION public.enforce_payment_mark_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status = 'paid'
     AND NOT public.can_mark_payments_paid()
  THEN
    RAISE EXCEPTION 'No autorizado: marcar una factura como pagada requiere el permiso correspondiente.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_payment_mark_paid ON public.supplier_payments;
CREATE TRIGGER trg_enforce_payment_mark_paid
  BEFORE UPDATE ON public.supplier_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_payment_mark_paid();

-- ── 3. Una factura ya pagada no se borra ─────────────────────────────────────
-- Su pago ya viajó al ledger financiero. Borrarla obliga a reversar, y ese
-- reverso lo hace la aplicación (deleteSupplierPayment); por la API quedaría el
-- hecho colgando sin su documento. Las pendientes sí se pueden eliminar.
CREATE OR REPLACE FUNCTION public.enforce_payment_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND OLD.status = 'paid'
     AND NOT public.can_mark_payments_paid()
  THEN
    RAISE EXCEPTION 'No autorizado: eliminar una factura ya pagada requiere el permiso de pagos.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_payment_delete ON public.supplier_payments;
CREATE TRIGGER trg_enforce_payment_delete
  BEFORE DELETE ON public.supplier_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_payment_delete();

NOTIFY pgrst, 'reload schema';
