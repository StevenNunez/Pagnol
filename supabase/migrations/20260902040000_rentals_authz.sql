-- =============================================================================
-- Arriendos: confirmar una OC y pagar una cuota se hacen valer en la BASE
--
-- PROBLEMA: las 19 mutaciones del módulo no validaban permisos. La pantalla sí
-- gatea sus botones (`rentals:manage_contracts` / `rentals:manage_payments`),
-- pero las políticas de la base sólo separan empresas, así que por la API
-- quedaba todo abierto.
--
-- Las dos transiciones que mueven plata:
--   · Confirmar la OC de arriendo → materializa los equipos como activos y
--     compromete el gasto en el ledger financiero.
--   · Marcar una cuota como pagada → es el desembolso.
--
-- PATRÓN: el mismo de `can_manage_advances()` (20260804000000), Control de Obras
-- (20260902010000), Pagos (20260902020000) y Reportabilidad (20260902030000).
--
-- MEDIDO CONTRA LA BASE VIVA antes de escribir esto:
--   · `rentals:manage_contracts` y `rentals:manage_payments` por código:
--     abastecimiento (+ los admins). Ninguna empresa los personalizó.
--   · El rol `adc` entra a Arriendos por configuración de empresa y NO tiene
--     ninguno de los dos — pero la pantalla YA le esconde esos botones
--     (`canManageContracts` / `canManagePayments` en contracts/[id]), así que
--     esto no le quita nada que hoy use: sólo cierra el camino por la API.
--     Su rol en arriendos es autorizar solicitudes (`rentals:authorize`), que
--     es otro flujo y no se toca.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

-- ── 1. Quién gestiona contratos de arriendo ──────────────────────────────────
-- Los roles por defecto van enumerados porque SQL no puede leer los valores del
-- código, y una empresa nueva no tiene ninguna fila en `roles`.
CREATE OR REPLACE FUNCTION public.can_manage_rental_contracts()
RETURNS boolean AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.roles r ON r.id = p.role AND r.tenant_id = p.tenant_id
    WHERE p.id = auth.uid()
      AND (
            p.role IN ('super-admin', 'administrador', 'soporte-pagnol')
         OR to_jsonb(p.granted_permissions) ? 'rentals:manage_contracts'
         OR to_jsonb(r.permissions)         ? 'rentals:manage_contracts'
         OR (r.id IS NULL AND p.role = 'abastecimiento')
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── 2. Quién paga cuotas de arriendo ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_manage_rental_payments()
RETURNS boolean AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.roles r ON r.id = p.role AND r.tenant_id = p.tenant_id
    WHERE p.id = auth.uid()
      AND (
            p.role IN ('super-admin', 'administrador', 'soporte-pagnol')
         OR to_jsonb(p.granted_permissions) ? 'rentals:manage_payments'
         OR to_jsonb(r.permissions)         ? 'rentals:manage_payments'
         OR (r.id IS NULL AND p.role = 'abastecimiento')
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

ALTER FUNCTION public.can_manage_rental_contracts() SET search_path = public, extensions;
ALTER FUNCTION public.can_manage_rental_payments()  SET search_path = public, extensions;
GRANT EXECUTE ON FUNCTION public.can_manage_rental_contracts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_rental_payments()  TO authenticated;

-- ── 3. Confirmar la OC del arriendo ──────────────────────────────────────────
-- Quirúrgico: sólo el paso de la OC a 'confirmed'. Editar el contrato, cambiar
-- fechas o dejar notas no se tocan. El service role tampoco (auth.uid() NULL).
CREATE OR REPLACE FUNCTION public.enforce_rental_oc_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NEW.oc_status IS DISTINCT FROM OLD.oc_status
     AND NEW.oc_status = 'confirmed'
     AND NOT public.can_manage_rental_contracts()
  THEN
    RAISE EXCEPTION 'No autorizado: confirmar la OC de un arriendo requiere el permiso de gestión de contratos de arriendo.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_rental_oc_confirm ON public.rental_contracts;
CREATE TRIGGER trg_enforce_rental_oc_confirm
  BEFORE UPDATE ON public.rental_contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_rental_oc_confirm();

-- ── 4. Pagar una cuota de arriendo ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_rental_payment_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status = 'paid'
     AND NOT public.can_manage_rental_payments()
  THEN
    RAISE EXCEPTION 'No autorizado: marcar una cuota de arriendo como pagada requiere el permiso de pagos de arriendo.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_rental_payment_paid ON public.rental_payments;
CREATE TRIGGER trg_enforce_rental_payment_paid
  BEFORE UPDATE ON public.rental_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_rental_payment_paid();

-- ── 5. Una cuota ya pagada no se borra por la API ────────────────────────────
-- Su desembolso ya viajó al ledger; el reverso lo hace la aplicación.
CREATE OR REPLACE FUNCTION public.enforce_rental_payment_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND OLD.status = 'paid'
     AND NOT public.can_manage_rental_payments()
  THEN
    RAISE EXCEPTION 'No autorizado: eliminar una cuota ya pagada requiere el permiso de pagos de arriendo.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_rental_payment_delete ON public.rental_payments;
CREATE TRIGGER trg_enforce_rental_payment_delete
  BEFORE DELETE ON public.rental_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_rental_payment_delete();

NOTIFY pgrst, 'reload schema';
