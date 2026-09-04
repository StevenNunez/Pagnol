-- =============================================================================
-- Prevención de Riesgos: revisar checklists e inspecciones se hace valer en la BASE
--
-- PROBLEMA: revisar (aprobar/rechazar) un checklist de seguridad o una
-- inspección requiere permisos específicos (`safety_checklists:review`,
-- `safety_inspections:review`), pero sólo se gatea en la PANTALLA DE LISTADO —
-- la pantalla de detalle donde ocurre la revisión de verdad no valida nada, y
-- las mutaciones tampoco lo hacían. Cualquiera con sesión podía navegar
-- directo a la URL de un checklist o inspección y aprobar/rechazar el suyo
-- propio, o el de cualquier otro, con un PATCH a la API.
--
-- Una revisión de seguridad que cualquiera puede firmar no es una revisión.
--
-- PATRÓN: el mismo de `can_manage_advances()` (20260804000000), Control de
-- Obras, Pagos, Reportabilidad y Arriendos (20260902010000–20260902040000).
--
-- MEDIDO CONTRA LA BASE VIVA antes de escribir esto:
--   · `safety_checklists:review` / `safety_inspections:review` por código:
--     director-faena, apr, cphs (mismo conjunto para ambos permisos)
--   · por configuración de empresa: sólo director-faena
--   · `apr` y `cphs` sólo lo tienen por el valor por defecto del código —
--     van enumerados, porque una empresa nueva no tiene ninguna fila en
--     `roles` y caería entera en esos valores.
--   · `jefe-operaciones` entra al módulo por configuración de empresa y no
--     tiene el permiso: correcto, no debe revisar seguridad por defecto.
--
-- `safety_observations:review` NO tiene mutación ni pantalla que la use — el
-- permiso está definido y muerto, igual que estaban los de Pagos antes de esta
-- ronda. No se protege nada porque no hay nada que proteger todavía.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

-- ── 1. Quién revisa checklists de seguridad ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_review_safety_checklists()
RETURNS boolean AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.roles r ON r.id = p.role AND r.tenant_id = p.tenant_id
    WHERE p.id = auth.uid()
      AND (
            p.role IN ('super-admin', 'administrador', 'soporte-pagnol')
         OR to_jsonb(p.granted_permissions) ? 'safety_checklists:review'
         OR to_jsonb(r.permissions)         ? 'safety_checklists:review'
         OR (r.id IS NULL AND p.role IN ('director-faena', 'apr', 'cphs'))
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── 2. Quién revisa inspecciones de seguridad ────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_review_safety_inspections()
RETURNS boolean AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.roles r ON r.id = p.role AND r.tenant_id = p.tenant_id
    WHERE p.id = auth.uid()
      AND (
            p.role IN ('super-admin', 'administrador', 'soporte-pagnol')
         OR to_jsonb(p.granted_permissions) ? 'safety_inspections:review'
         OR to_jsonb(r.permissions)         ? 'safety_inspections:review'
         OR (r.id IS NULL AND p.role IN ('director-faena', 'apr', 'cphs'))
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

ALTER FUNCTION public.can_review_safety_checklists()  SET search_path = public, extensions;
ALTER FUNCTION public.can_review_safety_inspections() SET search_path = public, extensions;
GRANT EXECUTE ON FUNCTION public.can_review_safety_checklists()  TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_review_safety_inspections() TO authenticated;

-- ── 3. Sólo esa gente aprueba o rechaza un checklist ─────────────────────────
-- Quirúrgico: sólo el paso a 'approved' o 'rejected'. Completar el checklist
-- (status → 'completed', lo hace quien lo tiene asignado) no se toca. El
-- service role tampoco (auth.uid() es NULL en ese contexto).
CREATE OR REPLACE FUNCTION public.enforce_checklist_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('approved', 'rejected')
     AND NOT public.can_review_safety_checklists()
  THEN
    RAISE EXCEPTION 'No autorizado: revisar un checklist de seguridad requiere el permiso correspondiente.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_checklist_review ON public.assigned_checklists;
CREATE TRIGGER trg_enforce_checklist_review
  BEFORE UPDATE ON public.assigned_checklists
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_checklist_review();

-- ── 4. Sólo esa gente aprueba o rechaza una inspección ───────────────────────
CREATE OR REPLACE FUNCTION public.enforce_inspection_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('approved', 'rejected')
     AND NOT public.can_review_safety_inspections()
  THEN
    RAISE EXCEPTION 'No autorizado: revisar una inspección de seguridad requiere el permiso correspondiente.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_inspection_review ON public.safety_inspections;
CREATE TRIGGER trg_enforce_inspection_review
  BEFORE UPDATE ON public.safety_inspections
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_inspection_review();

NOTIFY pgrst, 'reload schema';
