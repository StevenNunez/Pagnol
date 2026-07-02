-- =============================================================================
-- profiles: permitir que un ADMIN del tenant actualice perfiles de OTROS usuarios
-- de su mismo tenant.
--
-- Cierra el gap donde updateUser()/updateUserPermissions() (cliente anon) hacían
-- UPDATE sobre profiles ajenos y la única policy existente (profiles_update_own:
-- auth.uid() = id OR is_super_admin()) los filtraba: el UPDATE afectaba 0 filas
-- SIN lanzar error (RLS no matchea), así que:
--   * enrolar biometría a un usuario existente no persistía ("como si nada"),
--   * delegar granted_permissions no se guardaba,
--   * editar datos de RRHH de otro trabajador tampoco.
--
-- El trigger trg_prevent_profile_escalation NO estorba: solo aplica cuando el
-- usuario edita su PROPIA fila (auth.uid() = OLD.id). Un admin editando a otro
-- pasa sin problema.
--
-- is_tenant_admin() = super-admin | administrador | director-faena | soporte-pagnol.
-- Las policies permisivas se combinan con OR, así que esta se suma a las previas.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

DROP POLICY IF EXISTS "profiles_update_tenant_admin" ON public.profiles;
CREATE POLICY "profiles_update_tenant_admin" ON public.profiles
  FOR UPDATE
  USING (public.is_tenant_admin() AND tenant_id = public.get_my_tenant_id())
  WITH CHECK (public.is_tenant_admin() AND tenant_id = public.get_my_tenant_id());
