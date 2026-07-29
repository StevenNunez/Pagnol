-- =============================================================================
-- Dominio Financiero — el acceso deja de ser solo-por-rol (addendum a ADR-005)
--
-- Continuación de 20260724000000. Esa migración alineó la ESCRITURA de
-- presupuesto al permiso `finance:manage`, y la verificación mostró que no
-- alcanzaba:
--
--   can_manage_finance()  = true
--   INSERT sin RETURNING  = ✅  (la escritura ya estaba bien)
--   INSERT ... RETURNING  = ❌  (la mutación hace .insert().select())
--   SELECT                = 0 filas
--
-- Causa: LEER seguía exigiendo `is_finance_viewer()`, que solo mira el ROL
-- (administrador / soporte-pagnol / super-admin) e ignora los permisos
-- otorgados. Es decir: todo el dominio financiero estaba cerrado por rol, y los
-- permisos `module_finance:view` / `finance:manage` eran decorativos en la base
-- aunque el cliente los evaluara. Otorgarlos no habilitaba nada.
--
-- Corrección: `is_finance_viewer()` reconoce además el permiso
-- `module_finance:view` — que es literalmente "Acceder a Finanzas (Resultado por
-- Contrato)" en permissions.ts — siguiendo la misma cadena que can(). Se AMPLÍA,
-- nunca se restringe: los tres roles que ya pasaban siguen pasando.
-- Al vivir en una sola función, alinea de una vez el ledger (`finance_entries`)
-- y el presupuesto (`finance_budget_entries`), sin tocar sus políticas.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_finance_viewer()
RETURNS boolean AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.roles r
      ON r.id = p.role AND r.tenant_id = p.tenant_id
    WHERE p.id = auth.uid()
      AND (
            p.role IN ('super-admin', 'administrador', 'soporte-pagnol')
         OR to_jsonb(p.granted_permissions) ? 'module_finance:view'
         OR to_jsonb(r.permissions)         ? 'module_finance:view'
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;
ALTER FUNCTION public.is_finance_viewer() SET search_path = public, extensions;

-- Quien administra el presupuesto tiene que poder verlo: la mutación
-- addBudgetEntry hace .insert().select() y la página lo lista después.
-- (Administrar ⊃ ver; sin este OR, `finance:manage` solo sirve acompañado de
-- `module_finance:view`, un acoplamiento que nadie recordaría al asignar roles.)
DROP POLICY IF EXISTS "finance_budget_select" ON public.finance_budget_entries;
CREATE POLICY "finance_budget_select" ON public.finance_budget_entries FOR SELECT TO authenticated
USING (
    public.is_super_admin()
    OR (tenant_id = public.get_my_tenant_id()
        AND (public.is_finance_viewer() OR public.can_manage_finance()))
);

NOTIFY pgrst, 'reload schema';
