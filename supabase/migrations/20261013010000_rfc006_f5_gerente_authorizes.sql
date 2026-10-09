-- RFC-006 F5 (corrección) — el Gerente General puede levantar la autorización.
--
-- La F5 le dio a gerente-general el permiso de autorizar retiros sobre el tope
-- parcheando su fila en `roles`, pero NINGUNA empresa tiene esa fila: el rol
-- cae en los valores por defecto, y la puerta de la base
-- (`can_authorize_spend`, migración 20260904000000) por defecto sólo deja a
-- director-faena y adc. Resultado medido en el demo: el Gerente no podía firmar
-- un retiro de $508.130 ("requiere el permiso del Administrador de Contratos").
--
-- Se agrega gerente-general a esa lista por defecto. Quién firma qué retiro lo
-- sigue decidiendo `material_requests_check_authorizer` (por valor y contrato).
--
-- Idempotente: seguro de re-ejecutar.

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
         OR (r.id IS NULL AND p.role IN ('director-faena', 'adc', 'gerente-general'))
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

ALTER FUNCTION public.can_authorize_spend() SET search_path = public, extensions;
GRANT EXECUTE ON FUNCTION public.can_authorize_spend() TO authenticated;
