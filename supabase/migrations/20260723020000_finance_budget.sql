-- =============================================================================
-- Dominio Financiero F3 (RFC-002-F3-Plan / ADR-005): presupuesto de costo
--
-- Tabla append-only de líneas de presupuesto por contrato × categoría:
-- línea inicial + modificaciones (aumentos/rebajas con motivo); el presupuesto
-- VIGENTE es la suma. Art. 2: sin UPDATE/DELETE — el historial de
-- modificaciones presupuestarias es la propia tabla.
--
-- NO es un hecho económico: jamás entra a finance_entries (el presupuesto es
-- intención; el ledger registra realidad).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.finance_budget_entries (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    contract_id     uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
    -- Solo categorías de COSTO (el presupuesto de venta ya vive en el WBS).
    category        text NOT NULL CHECK (category IN
                      ('materials', 'labor', 'equipment', 'subcontract', 'rental', 'services', 'indirect')),
    -- Partida (nullable): evolución futura, cuando los hechos se imputen a partida.
    work_item_id    text,
    -- CLP entero (ADR-005 §2: solo CLP en v1). Negativo = rebaja presupuestaria.
    amount_net      numeric NOT NULL,
    -- Motivo SIEMPRE (línea inicial o modificación): es el historial auditable.
    reason          text NOT NULL,
    created_by      uuid,
    created_by_name text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finance_budget_tenant_contract
    ON public.finance_budget_entries (tenant_id, contract_id);

ALTER TABLE public.finance_budget_entries ENABLE ROW LEVEL SECURITY;

-- El presupuesto revela estructura de costos: misma visibilidad cerrada que el
-- ledger (administrador / soporte-pagnol / super-admin).
DROP POLICY IF EXISTS "finance_budget_select" ON public.finance_budget_entries;
CREATE POLICY "finance_budget_select" ON public.finance_budget_entries FOR SELECT TO authenticated
USING (public.is_super_admin() OR (tenant_id = public.get_my_tenant_id() AND public.is_finance_viewer()));

DROP POLICY IF EXISTS "finance_budget_insert" ON public.finance_budget_entries;
CREATE POLICY "finance_budget_insert" ON public.finance_budget_entries FOR INSERT TO authenticated
WITH CHECK (
    (public.is_super_admin() OR (tenant_id = public.get_my_tenant_id() AND public.is_finance_viewer()))
);

-- Art. 2: sin políticas ni GRANT de UPDATE/DELETE.
GRANT SELECT, INSERT ON public.finance_budget_entries TO authenticated;

NOTIFY pgrst, 'reload schema';
