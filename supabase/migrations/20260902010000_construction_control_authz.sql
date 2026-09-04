-- =============================================================================
-- Control de Obras: la aprobación se hace valer en la BASE, no solo en el cliente
--
-- PROBLEMA: aprobar o rechazar una partida (y un protocolo de calidad) es LA
-- decisión de control del módulo, y hasta ahora no había ninguna barrera del
-- lado del servidor. Las políticas RLS de `work_items` y `protocols` son
-- tenant-scoped y CIEGAS AL ROL: cualquiera con sesión en la empresa podía
-- aprobar su propia partida con un PATCH directo a la API REST.
--
-- Las validaciones que se agregaron en las mutaciones (2026-09-02) cubren el
-- camino de la aplicación y dan un mensaje claro, pero NO son un límite de
-- seguridad: se saltan llamando a la API sin pasar por la pantalla. Este es el
-- límite de verdad.
--
-- PATRÓN: el mismo de `can_manage_advances()` (migración 20260804000000) para
-- los anticipos, y el de `prevent_profile_privilege_escalation()` (20260612000000)
-- para el trigger. No se inventa nada nuevo.
--
-- POR QUÉ UN TRIGGER Y NO UNA POLÍTICA: `work_items` recibe escrituras legítimas
-- de todo el mundo (registrar avance, editar la estructura, mover fechas en el
-- cronograma). Lo que hay que restringir no es la tabla, es UNA TRANSICIÓN de
-- estado — y una política `WITH CHECK` solo ve la fila nueva, no la anterior,
-- así que no puede distinguir "pasó a aprobada" de "ya estaba aprobada". El
-- trigger sí ve las dos.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

-- ── 1. ¿Quién puede aprobar en Control de Obras? ─────────────────────────────
-- Resuelve igual que `can()` en la aplicación, con una diferencia que hay que
-- dejar escrita: SQL no puede leer los permisos por defecto que viven en el
-- código (`ROLES` en src/modules/core/lib/permissions.ts). Los roles que
-- aprueban por defecto y NO tienen fila en `roles` se enumeran explícitamente
-- abajo; sin ellos, un Jefe de Oficina Técnica o un Jefe de Terreno quedarían
-- viendo el botón y fallando al usarlo.
--
-- Medido contra la base viva antes de escribir esto:
--   · aprueban por código  : director-faena, jefe-oficina-tecnica, jefe-terreno, quality
--   · aprueban por empresa : director-faena, jefe-operaciones, quality (+ admins)
--   · sin fila de empresa  : jefe-oficina-tecnica, jefe-terreno  ← los que se caían
CREATE OR REPLACE FUNCTION public.can_review_construction()
RETURNS boolean AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.roles r
      ON r.id = p.role AND r.tenant_id = p.tenant_id
    WHERE p.id = auth.uid()
      AND (
            -- Control total de la plataforma / del inquilino (decisión de producto).
            p.role IN ('super-admin', 'administrador', 'soporte-pagnol')
            -- Permiso concedido a la persona en particular.
         OR to_jsonb(p.granted_permissions) ? 'construction_control:review_protocols'
            -- Permiso del rol, personalizado por la empresa en Gestión de Permisos.
         OR to_jsonb(r.permissions)         ? 'construction_control:review_protocols'
            -- Roles que aprueban por defecto en el código y no tienen fila propia.
         OR (r.id IS NULL AND p.role IN ('director-faena', 'jefe-oficina-tecnica', 'jefe-terreno', 'quality'))
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

ALTER FUNCTION public.can_review_construction() SET search_path = public, extensions;
GRANT EXECUTE ON FUNCTION public.can_review_construction() TO authenticated;

-- ── 2. Partidas: solo Calidad puede aprobar o rechazar ───────────────────────
-- El guard es QUIRÚRGICO: solo se activa cuando el `status` CAMBIA hacia
-- 'completed' o 'rejected'. Registrar avance, editar la estructura, mover fechas
-- o enviar a revisión no se tocan. Tampoco afecta al service role (auth.uid()
-- es NULL ahí), que es como corren las migraciones y los scripts de siembra.
CREATE OR REPLACE FUNCTION public.enforce_work_item_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('completed', 'rejected')
     AND NOT public.can_review_construction()
  THEN
    RAISE EXCEPTION 'No autorizado: aprobar o rechazar una partida requiere el permiso de revisión de calidad.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_work_item_review ON public.work_items;
CREATE TRIGGER trg_enforce_work_item_review
  BEFORE UPDATE ON public.work_items
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_work_item_review();

-- ── 3. Protocolos de calidad: misma regla ────────────────────────────────────
-- Un protocolo aprobado lleva la firma del responsable de calidad: que otro
-- pueda ponerlo en 'aprobado' por la API vacía de sentido la firma.
CREATE OR REPLACE FUNCTION public.enforce_protocol_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('aprobado', 'rechazado')
     AND NOT public.can_review_construction()
  THEN
    RAISE EXCEPTION 'No autorizado: aprobar o rechazar un protocolo requiere el permiso de revisión de calidad.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_protocol_review ON public.protocols;
CREATE TRIGGER trg_enforce_protocol_review
  BEFORE UPDATE ON public.protocols
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_protocol_review();

-- ── 4. Un protocolo firmado no se borra ──────────────────────────────────────
-- Es el registro de que la revisión de calidad ocurrió; borrarlo deja la partida
-- aprobada sin respaldo. La aplicación ya lo impide, pero por la API se podía.
-- Solo los borradores se eliminan.
CREATE OR REPLACE FUNCTION public.enforce_protocol_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND OLD.status IS DISTINCT FROM 'borrador' THEN
    RAISE EXCEPTION 'No autorizado: solo se pueden eliminar protocolos en borrador; los enviados o revisados son el registro firmado de la revisión.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_protocol_delete ON public.protocols;
CREATE TRIGGER trg_enforce_protocol_delete
  BEFORE DELETE ON public.protocols
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_protocol_delete();

NOTIFY pgrst, 'reload schema';
