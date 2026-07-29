-- =============================================================================
-- Dominio Financiero — corrección F3 (addendum a ADR-005)
--
-- Hallazgo del E2E de F3: "disponible = presupuesto − comprometido" asume que
-- todo costo pasa por COMPROMETIDO antes de DEVENGADO. Es falso: hay hechos que
-- NACEN devengados porque no existe compromiso previo que registrar —
--   · labor_day        (costo de mano de obra, F1: el trabajador trabajó, no hay OC)
--   · material_request (consumo de pañol: transferencia de costo a la faena)
--   · stock_transfer   (idem entre contratos)
-- …frente a las cadenas que sí se comprometen primero:
--   · purchase_order → goods_receipt
--   · rental_contract → rental_payment
--
-- Efecto en producción: el costo de MANO DE OBRA — normalmente el mayor de una
-- faena — era invisible para el control presupuestario. La misma fila mostraba
-- "49% ejecutado" y "100% disponible" a la vez.
--
-- Corrección: el RPC ahora expone `source_type`, para que el consumo real del
-- presupuesto se calcule como
--     consumido = comprometido + devengado de las fuentes sin compromiso previo
-- La REGLA de qué fuente compromete vive en TypeScript puro y testeado
-- (`financeMath.budgetConsumption`), no aquí: este RPC solo agrega.
-- =============================================================================

-- ── 1. finance_contract_summary ahora desglosa por origen ────────────────────
-- DROP + CREATE (no CREATE OR REPLACE): cambia el RETURNS TABLE, y Postgres no
-- permite alterar la firma de retorno en un replace.
DROP FUNCTION IF EXISTS public.finance_contract_summary(date, date, uuid);

CREATE FUNCTION public.finance_contract_summary(
    p_from   date,
    p_to     date,
    p_tenant uuid DEFAULT NULL
) RETURNS TABLE (
    contract_id   uuid,
    contract_name text,
    nature        text,
    stage         text,
    category      text,
    source_type   text,
    total_net     numeric,
    entry_count   bigint
)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT fe.contract_id,
         COALESCE(MAX(c.name), MAX(fe.contract_name)) AS contract_name,
         fe.nature,
         fe.stage,
         fe.category,
         fe.source_type,
         SUM(fe.amount_net) AS total_net,
         COUNT(*)           AS entry_count
  FROM public.finance_entries fe
  LEFT JOIN public.contracts c ON c.id = fe.contract_id
  WHERE fe.entry_date >= p_from
    AND fe.entry_date <= p_to
    AND fe.tenant_id = COALESCE(p_tenant, public.get_my_tenant_id())
  GROUP BY fe.contract_id, fe.nature, fe.stage, fe.category, fe.source_type;
$$;

GRANT EXECUTE ON FUNCTION public.finance_contract_summary(date, date, uuid) TO authenticated;

-- ── 2. Administrar presupuesto = permiso finance:manage, no solo el rol ──────
-- La mutación exige `finance:manage` pero la RLS exigía `is_finance_viewer()`
-- (rol administrador/soporte-pagnol): otorgar el permiso granular a otro rol
-- pasaba el guard del cliente y lo rechazaba la base. Este helper replica la
-- cadena real de can(): super-admin → bypass admin/soporte → permiso otorgado
-- en el perfil → fila de rol por tenant.
--
-- `finance:manage` no está en ningún ROLES_DEFAULT de permissions.ts, así que
-- no hay una cuarta rama que replicar (si algún día se agrega a un rol por
-- defecto, esta función debe seguirlo — está anotado en el ADR).
--
-- to_jsonb(...) ? '…' funciona igual si la columna es text[] o jsonb.
CREATE OR REPLACE FUNCTION public.can_manage_finance()
RETURNS boolean AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.roles r
      ON r.id = p.role AND r.tenant_id = p.tenant_id
    WHERE p.id = auth.uid()
      AND (
            p.role IN ('super-admin', 'administrador', 'soporte-pagnol')
         OR to_jsonb(p.granted_permissions) ? 'finance:manage'
         OR to_jsonb(r.permissions)         ? 'finance:manage'
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;
ALTER FUNCTION public.can_manage_finance() SET search_path = public, extensions;

-- Escribir presupuesto exige el permiso; LEERLO sigue siendo is_finance_viewer
-- (el presupuesto revela estructura de costos: misma visibilidad que el ledger).
DROP POLICY IF EXISTS "finance_budget_insert" ON public.finance_budget_entries;
CREATE POLICY "finance_budget_insert" ON public.finance_budget_entries FOR INSERT TO authenticated
WITH CHECK (
    public.is_super_admin()
    OR (tenant_id = public.get_my_tenant_id() AND public.can_manage_finance())
);

-- Art. 2 sigue intacto: sin políticas ni GRANT de UPDATE/DELETE.

NOTIFY pgrst, 'reload schema';
