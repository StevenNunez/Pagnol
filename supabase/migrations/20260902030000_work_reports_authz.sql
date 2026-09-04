-- =============================================================================
-- Reportabilidad: las dos firmas de aprobación se hacen valer en la BASE
--
-- PROBLEMA: un Reporte Diario se aprueba con DOS firmas en paralelo — Jefe de
-- Operaciones y Administrador de Contratos. La pantalla las gatea bien
-- (`work_reports:review_operations` / `work_reports:final_approve`), pero ni la
-- función ni la base validan nada: las políticas de `work_reports` sólo separan
-- empresas. Cualquiera con sesión podía firmar las dos aprobaciones de su propio
-- informe con un PATCH directo, y quedaba aprobado sin que nadie lo revisara.
--
-- Una firma que cualquiera puede poner no es una firma.
--
-- PATRÓN: el mismo de `can_manage_advances()` (20260804000000), Control de Obras
-- (20260902010000) y Pagos (20260902020000).
--
-- SE VIGILAN LAS MARCAS DE TIEMPO, NO SÓLO EL ESTADO: el modelo de aprobación es
-- en paralelo, así que firmar puede dejar el estado igual y sólo escribir
-- `operations_approved_at` o `final_approved_at`. Mirar únicamente el `status`
-- dejaría pasar exactamente la mitad de los casos.
--
-- MEDIDO CONTRA LA BASE VIVA antes de escribir esto:
--   · review_operations → director-faena, jefe-operaciones (código y empresas coinciden)
--   · final_approve     → director-faena, adc              (idem)
--   · roles que entran al módulo y NO tendrían el permiso: adc y quality para
--     operaciones; jefe-operaciones y quality para la final. Es correcto: son
--     justamente los que no deben firmar ese paso.
--
-- Los roles por defecto van enumerados igual: una empresa NUEVA no tiene ninguna
-- fila en `roles` y cae por completo en los valores del código, así que sin esa
-- rama nadie podría aprobar en una cuenta recién creada.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

-- ── 1. Quién puede firmar cada paso ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_review_work_reports_ops()
RETURNS boolean AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.roles r ON r.id = p.role AND r.tenant_id = p.tenant_id
    WHERE p.id = auth.uid()
      AND (
            p.role IN ('super-admin', 'administrador', 'soporte-pagnol')
         OR to_jsonb(p.granted_permissions) ? 'work_reports:review_operations'
         OR to_jsonb(r.permissions)         ? 'work_reports:review_operations'
         OR (r.id IS NULL AND p.role IN ('director-faena', 'jefe-operaciones'))
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.can_final_approve_work_reports()
RETURNS boolean AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.roles r ON r.id = p.role AND r.tenant_id = p.tenant_id
    WHERE p.id = auth.uid()
      AND (
            p.role IN ('super-admin', 'administrador', 'soporte-pagnol')
         OR to_jsonb(p.granted_permissions) ? 'work_reports:final_approve'
         OR to_jsonb(r.permissions)         ? 'work_reports:final_approve'
         OR (r.id IS NULL AND p.role IN ('director-faena', 'adc'))
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

ALTER FUNCTION public.can_review_work_reports_ops()     SET search_path = public, extensions;
ALTER FUNCTION public.can_final_approve_work_reports()  SET search_path = public, extensions;
GRANT EXECUTE ON FUNCTION public.can_review_work_reports_ops()    TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_final_approve_work_reports() TO authenticated;

-- ── 2. Nadie firma un paso que no le toca ────────────────────────────────────
-- Quirúrgico: sólo se activa cuando aparece una aprobación que antes no estaba.
-- Crear, editar, subir fotos, enviar a revisión y devolver observado no se
-- tocan. El service role tampoco (auth.uid() es NULL ahí).
--
-- Se permite LIMPIAR las marcas (poner a NULL): es lo que hace el reenvío tras
-- una observación, para que ambos vuelvan a revisar la versión corregida.
CREATE OR REPLACE FUNCTION public.enforce_work_report_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.operations_approved_at IS NOT NULL
     AND OLD.operations_approved_at IS DISTINCT FROM NEW.operations_approved_at
     AND NOT public.can_review_work_reports_ops()
  THEN
    RAISE EXCEPTION 'No autorizado: la revisión de operaciones la firma Jefe de Operaciones.';
  END IF;

  IF NEW.final_approved_at IS NOT NULL
     AND OLD.final_approved_at IS DISTINCT FROM NEW.final_approved_at
     AND NOT public.can_final_approve_work_reports()
  THEN
    RAISE EXCEPTION 'No autorizado: la aprobación final la firma el Administrador de Contratos.';
  END IF;

  -- El estado también, por si alguien lo mueve sin tocar las marcas de tiempo.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status = 'final_approved'
     AND NOT public.can_final_approve_work_reports()
  THEN
    RAISE EXCEPTION 'No autorizado: aprobar un informe requiere el permiso de aprobación final.';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status = 'operations_approved'
     AND NOT (public.can_review_work_reports_ops() OR public.can_final_approve_work_reports())
  THEN
    RAISE EXCEPTION 'No autorizado: aprobar un informe requiere permiso de revisión.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_work_report_approval ON public.work_reports;
CREATE TRIGGER trg_enforce_work_report_approval
  BEFORE UPDATE ON public.work_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_work_report_approval();

-- ── 3. Un informe aprobado no se borra ───────────────────────────────────────
-- Ya tiene las firmas de dos personas y lo consolida el Reporte Semanal. La
-- aplicación lo impide desde hace tiempo (salvo super-admin); por la API no.
CREATE OR REPLACE FUNCTION public.enforce_work_report_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND OLD.status NOT IN ('draft', 'observed')
     AND NOT public.is_super_admin()
  THEN
    RAISE EXCEPTION 'No autorizado: un informe ya enviado a revisión conserva su historial de firmas y no se elimina.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_work_report_delete ON public.work_reports;
CREATE TRIGGER trg_enforce_work_report_delete
  BEFORE DELETE ON public.work_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_work_report_delete();

NOTIFY pgrst, 'reload schema';
