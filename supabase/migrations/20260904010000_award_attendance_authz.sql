-- =============================================================================
-- Adjudicar una cotización y tocar la asistencia se hacen valer en la BASE
--
-- Dos decisiones que hasta ahora no validaba nadie del lado del servidor:
--
--   · **Adjudicar una cotización** es elegir a qué proveedor se le compra:
--     genera la orden de compra y compromete el gasto. La pantalla del
--     comparador lo gatea con `finance:manage_purchase_orders`; la base no.
--   · **Editar o borrar un registro de asistencia** no es administrativo: la
--     asistencia alimenta la planilla, así que cambiar una marca cambia lo que
--     a una persona le pagan. La pantalla lo gatea con `attendance:edit` en
--     cinco lugares; la base tampoco.
--
-- PATRÓN: idéntico a las siete migraciones anteriores de esta ronda.
--
-- MEDIDO CONTRA LA BASE VIVA antes de escribir esto:
--   · `finance:manage_purchase_orders` → finance y abastecimiento por código;
--     ninguna empresa lo personalizó. **Ninguno de los dos tiene fila propia**,
--     así que sin enumerarlos nadie podría adjudicar.
--   · `attendance:edit` → director-faena y recursos-humanos por código;
--     director-faena además por empresa. **recursos-humanos no tiene fila**,
--     mismo caso.
--   · Marcar asistencia con el lector QR (`attendance:register`, de guardia y
--     jefe-turno) **no se toca**: es la operación normal de portería, no una
--     corrección de la planilla. Sólo se restringe editar y borrar.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

-- ── 1. Quién adjudica una compra ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_award_quotes()
RETURNS boolean AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.roles r ON r.id = p.role AND r.tenant_id = p.tenant_id
    WHERE p.id = auth.uid()
      AND (
            p.role IN ('super-admin', 'administrador', 'soporte-pagnol')
         OR to_jsonb(p.granted_permissions) ? 'finance:manage_purchase_orders'
         OR to_jsonb(r.permissions)         ? 'finance:manage_purchase_orders'
         OR (r.id IS NULL AND p.role IN ('finance', 'abastecimiento'))
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── 2. Quién corrige la asistencia ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_edit_attendance()
RETURNS boolean AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.roles r ON r.id = p.role AND r.tenant_id = p.tenant_id
    WHERE p.id = auth.uid()
      AND (
            p.role IN ('super-admin', 'administrador', 'soporte-pagnol')
         OR to_jsonb(p.granted_permissions) ? 'attendance:edit'
         OR to_jsonb(r.permissions)         ? 'attendance:edit'
         OR (r.id IS NULL AND p.role IN ('director-faena', 'recursos-humanos'))
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

ALTER FUNCTION public.can_award_quotes()    SET search_path = public, extensions;
ALTER FUNCTION public.can_edit_attendance() SET search_path = public, extensions;
GRANT EXECUTE ON FUNCTION public.can_award_quotes()    TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_attendance() TO authenticated;

-- ── 3. Adjudicar la cotización ───────────────────────────────────────────────
-- Quirúrgico: sólo el paso a 'awarded' y la escritura del proveedor ganador.
-- Crear la RFQ, invitar proveedores, cargar respuestas y cerrarla para que no
-- lleguen más ofertas siguen abiertos a quien cotiza.
CREATE OR REPLACE FUNCTION public.enforce_quote_award()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status = 'awarded'
     AND NOT public.can_award_quotes()
  THEN
    RAISE EXCEPTION 'No autorizado: adjudicar una cotización requiere el permiso de órdenes de compra.';
  END IF;

  -- También por la vía de escribir el ganador sin mover el estado.
  IF NEW.awarded_supplier_id IS NOT NULL
     AND OLD.awarded_supplier_id IS DISTINCT FROM NEW.awarded_supplier_id
     AND NOT public.can_award_quotes()
  THEN
    RAISE EXCEPTION 'No autorizado: designar el proveedor ganador requiere el permiso de órdenes de compra.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_quote_award ON public.quote_requests;
CREATE TRIGGER trg_enforce_quote_award
  BEFORE UPDATE ON public.quote_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_quote_award();

-- ── 4. Corregir o borrar una marca de asistencia ─────────────────────────────
-- Marcar entrada y salida (el INSERT del lector QR) no se toca: es la operación
-- normal de portería. Lo que se restringe es cambiar o eliminar una marca ya
-- registrada, que es lo que altera la planilla.
CREATE OR REPLACE FUNCTION public.enforce_attendance_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.can_edit_attendance() THEN
    RAISE EXCEPTION 'No autorizado: corregir o eliminar marcas de asistencia requiere el permiso correspondiente (la asistencia alimenta la planilla).';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_attendance_edit ON public.attendance_logs;
CREATE TRIGGER trg_enforce_attendance_edit
  BEFORE UPDATE OR DELETE ON public.attendance_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_attendance_edit();

NOTIFY pgrst, 'reload schema';
