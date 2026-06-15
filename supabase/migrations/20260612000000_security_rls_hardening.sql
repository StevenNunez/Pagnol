-- =============================================================================
-- S2 — Endurecimiento de RLS (auditoría de seguridad 2026-06)
--
-- Cierra dos vulnerabilidades CRÍTICAS:
--   S-3: un usuario podía auto-promoverse a super-admin actualizando su propia
--        fila de profiles (la policy profiles_update_own no restringe columnas).
--   S-5: la policy invitations_read_by_token (SELECT USING true) exponía todas
--        las invitaciones (token + email + role) a cualquiera, incl. anónimos.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

-- ── Helper: is_super_admin() (se recrea por si el entorno no lo tiene) ────────
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'super-admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── S-3: Bloquear escalada de privilegios vía auto-update en profiles ─────────
-- El guard es QUIRÚRGICO: solo aplica cuando el usuario edita SU PROPIA fila
-- (auth.uid() = OLD.id). No afecta:
--   * la edición de OTROS usuarios por administradores (gobernada por RLS),
--   * operaciones del service role (auth.uid() es NULL en ese contexto),
--   * super-admins.
-- Así, un usuario normal nunca puede cambiar su propio role / tenant_id /
-- granted_permissions, pero los flujos legítimos siguen funcionando.
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() = OLD.id AND NOT public.is_super_admin() THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'No autorizado: no puedes cambiar tu propio rol.';
    END IF;
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'No autorizado: no puedes cambiar tu tenant.';
    END IF;
    IF NEW.granted_permissions IS DISTINCT FROM OLD.granted_permissions THEN
      RAISE EXCEPTION 'No autorizado: no puedes cambiar tus propios permisos.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_profile_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_privilege_escalation();

-- ── S-5: Eliminar lectura pública de invitaciones ────────────────────────────
-- El flujo de aceptar invitación valida el token server-side con el service
-- role (/api/invite/accept/[token]), por lo que esta policy es innecesaria y
-- peligrosa. La policy invitations_tenant (acceso por tenant) se mantiene.
DROP POLICY IF EXISTS "invitations_read_by_token" ON public.invitations;
