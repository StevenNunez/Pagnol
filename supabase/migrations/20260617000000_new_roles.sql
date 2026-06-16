-- =============================================================================
-- Nuevos roles para el flujo de Reportes de Trabajo y cuenta de soporte interno.
--
-- No requiere cambios de esquema (profiles.role es `text` sin CHECK/ENUM), salvo
-- actualizar el helper is_tenant_admin() para que el nuevo rol 'soporte-pagnol'
-- (mismos permisos que 'administrador', ver permissions.ts) tenga el mismo nivel
-- de acceso a datos protegidos (profile_documents / KYC) que un administrador real
-- del tenant.
--
-- Roles nuevos (solo app-level, sin tabla propia): jefe-operaciones, adc,
-- gerente-general, soporte-pagnol.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_tenant_admin()
RETURNS boolean AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('super-admin', 'administrador', 'director-faena', 'soporte-pagnol')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

ALTER FUNCTION public.is_tenant_admin() SET search_path = public, extensions;
