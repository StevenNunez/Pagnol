-- =============================================================================
-- Las dos puertas de plata: autorización del ADC y estados de pago
--
-- PROBLEMA: son las dos decisiones que mueven dinero de verdad y ninguna se
-- hacía valer en la base — sólo separación por empresa, ciega al rol.
--
--   · **Autorizar (ADC)** es la puerta PREVIA AL GASTO: levanta
--     `adc_authorized_at` en un requerimiento de compra, de arriendo o de
--     material, y con eso el pedido pasa a Abastecimiento. Quien la levanta
--     autoriza plata que va a salir.
--   · **Aprobar un estado de pago** devenga el INGRESO del contrato, y marcarlo
--     pagado cierra el cobro. Es la contraparte, del lado que entra.
--
-- Las validaciones de la aplicación ya están puestas; esto es el límite de
-- verdad, el que no se salta llamando a la API sin pasar por la pantalla.
--
-- PATRÓN: idéntico a las cinco migraciones anteriores de esta ronda
-- (20260902010000–20260902050000) y a `can_manage_advances()` (20260804000000).
--
-- MEDIDO CONTRA LA BASE VIVA antes de escribir esto:
--   · `*:authorize` (compras, arriendos, materiales) → director-faena y adc por
--     código; adc además por configuración de empresa. Los tres permisos tienen
--     el mismo conjunto de roles, así que comparten una sola función.
--   · `payment_states:approve` y `payment_states:pay` → adc por código, sin
--     configuración de empresa que los otorgue.
--   · Todos los roles involucrados tienen fila propia, pero igual van
--     enumerados: una empresa NUEVA no tiene ninguna fila en `roles` y caería
--     entera en los valores del código.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

-- ── 1. Quién autoriza el gasto (el rol del ADC) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.can_authorize_spend()
RETURNS boolean AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.roles r ON r.id = p.role AND r.tenant_id = p.tenant_id
    WHERE p.id = auth.uid()
      AND (
            p.role IN ('super-admin', 'administrador', 'soporte-pagnol')
         OR to_jsonb(p.granted_permissions) ? 'purchase_requests:authorize'
         OR to_jsonb(r.permissions)         ? 'purchase_requests:authorize'
         OR to_jsonb(p.granted_permissions) ? 'rentals:authorize'
         OR to_jsonb(r.permissions)         ? 'rentals:authorize'
         OR to_jsonb(p.granted_permissions) ? 'material_requests:authorize'
         OR to_jsonb(r.permissions)         ? 'material_requests:authorize'
         OR (r.id IS NULL AND p.role IN ('director-faena', 'adc'))
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── 2. Quién aprueba y cobra un estado de pago ───────────────────────────────
CREATE OR REPLACE FUNCTION public.can_approve_payment_states()
RETURNS boolean AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.roles r ON r.id = p.role AND r.tenant_id = p.tenant_id
    WHERE p.id = auth.uid()
      AND (
            p.role IN ('super-admin', 'administrador', 'soporte-pagnol')
         OR to_jsonb(p.granted_permissions) ? 'payment_states:approve'
         OR to_jsonb(r.permissions)         ? 'payment_states:approve'
         OR to_jsonb(p.granted_permissions) ? 'payment_states:pay'
         OR to_jsonb(r.permissions)         ? 'payment_states:pay'
         OR (r.id IS NULL AND p.role = 'adc')
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

ALTER FUNCTION public.can_authorize_spend()         SET search_path = public, extensions;
ALTER FUNCTION public.can_approve_payment_states()  SET search_path = public, extensions;
GRANT EXECUTE ON FUNCTION public.can_authorize_spend()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_approve_payment_states() TO authenticated;

-- ── 3. Levantar la autorización del ADC ──────────────────────────────────────
-- Quirúrgico: sólo cuando `adc_authorized_at` pasa de vacío a tener fecha.
-- Crear el requerimiento, editarlo, agregarle ítems o cambiarle el estado
-- operativo no se tocan. Quitar la autorización (volver a NULL) tampoco se
-- bloquea: es lo que hace una corrección, y bloquearlo dejaría requerimientos
-- trabados sin forma de devolverlos.
--
-- El mismo disparador sirve para las tres tablas: la columna se llama igual y
-- la decisión es la misma.
CREATE OR REPLACE FUNCTION public.enforce_adc_authorization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NEW.adc_authorized_at IS NOT NULL
     AND OLD.adc_authorized_at IS DISTINCT FROM NEW.adc_authorized_at
     AND NOT public.can_authorize_spend()
  THEN
    RAISE EXCEPTION 'No autorizado: autorizar un requerimiento requiere el permiso del Administrador de Contratos.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_adc_auth_purchase ON public.purchase_requests;
CREATE TRIGGER trg_enforce_adc_auth_purchase
  BEFORE UPDATE ON public.purchase_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_adc_authorization();

DROP TRIGGER IF EXISTS trg_enforce_adc_auth_rental ON public.rental_requests;
CREATE TRIGGER trg_enforce_adc_auth_rental
  BEFORE UPDATE ON public.rental_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_adc_authorization();

DROP TRIGGER IF EXISTS trg_enforce_adc_auth_material ON public.material_requests;
CREATE TRIGGER trg_enforce_adc_auth_material
  BEFORE UPDATE ON public.material_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_adc_authorization();

-- ── 4. Aprobar y cobrar un estado de pago ────────────────────────────────────
-- Crear el estado de pago y corregirle datos no se tocan; sólo el paso a
-- aprobado, pagado o anulado, que son las tres decisiones con consecuencia
-- en el ledger.
CREATE OR REPLACE FUNCTION public.enforce_payment_state_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('approved', 'paid', 'annulled')
     AND NOT public.can_approve_payment_states()
  THEN
    RAISE EXCEPTION 'No autorizado: aprobar, cobrar o anular un estado de pago requiere el permiso correspondiente.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_payment_state_transition ON public.payment_states;
CREATE TRIGGER trg_enforce_payment_state_transition
  BEFORE UPDATE ON public.payment_states
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_payment_state_transition();

NOTIFY pgrst, 'reload schema';
