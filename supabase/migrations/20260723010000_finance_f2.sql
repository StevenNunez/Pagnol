-- =============================================================================
-- Dominio Financiero F2 (RFC-002-F2-Plan / ADR-004): ingresos + emisores restantes
--
-- 1) Puente WBS↔contratos (work_items.contract_id en la raíz de la obra).
-- 2) Estado de Pago: reparación de drift #4 (payment_states NO tenía
--    total_value/earned_value — crear EP estaba 100% roto en la BD viva) +
--    máquina de estados (pending → approved → paid | annulled) + delta del
--    período congelado (previous_earned/period_earned) + correlativo.
-- 3) Arriendos: imputación a contrato cliente (client_contract_id).
-- 4) Ledger: categoría 'revenue' para hechos de ingreso.
-- =============================================================================

-- ── 1. Puente WBS ↔ contratos ────────────────────────────────────────────────
-- Solo se usa en la raíz de la obra; los EP lo heredan. FK SET NULL: borrar un
-- contrato no destruye el WBS.
ALTER TABLE public.work_items
    ADD COLUMN IF NOT EXISTS contract_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL;

-- ── 2. Estado de Pago ─────────────────────────────────────────────────────────
-- Reparación drift #4: columnas que addPaymentState ya insertaba y no existían.
ALTER TABLE public.payment_states ADD COLUMN IF NOT EXISTS total_value numeric NOT NULL DEFAULT 0;
ALTER TABLE public.payment_states ADD COLUMN IF NOT EXISTS earned_value numeric NOT NULL DEFAULT 0;
-- Dimensión contrato (heredada de la raíz WBS) + snapshot del nombre.
ALTER TABLE public.payment_states ADD COLUMN IF NOT EXISTS contract_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL;
ALTER TABLE public.payment_states ADD COLUMN IF NOT EXISTS contract_name text;
-- Raíz WBS de origen (para trazar el EP a su obra aunque cambie el puente).
ALTER TABLE public.payment_states ADD COLUMN IF NOT EXISTS work_item_root_id text;
-- Correlativo legible (patrón nextInternalCode, tipo 'EP').
ALTER TABLE public.payment_states ADD COLUMN IF NOT EXISTS internal_code text;
-- Delta del período, congelado al crear (ADR-004 §2): lo ÚNICO que se devenga.
ALTER TABLE public.payment_states ADD COLUMN IF NOT EXISTS previous_earned numeric NOT NULL DEFAULT 0;
ALTER TABLE public.payment_states ADD COLUMN IF NOT EXISTS period_earned numeric NOT NULL DEFAULT 0;
-- Máquina de estados: quién y cuándo.
ALTER TABLE public.payment_states ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.payment_states ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE public.payment_states ADD COLUMN IF NOT EXISTS approved_by_name text;
ALTER TABLE public.payment_states ADD COLUMN IF NOT EXISTS paid_at date;
ALTER TABLE public.payment_states ADD COLUMN IF NOT EXISTS paid_by uuid;
ALTER TABLE public.payment_states ADD COLUMN IF NOT EXISTS annulled_at timestamptz;
ALTER TABLE public.payment_states ADD COLUMN IF NOT EXISTS annulled_by uuid;
ALTER TABLE public.payment_states ADD COLUMN IF NOT EXISTS notes text;

-- Estados honestos (tabla vacía verificada: sin datos que normalizar).
ALTER TABLE public.payment_states DROP CONSTRAINT IF EXISTS payment_states_status_check;
ALTER TABLE public.payment_states
    ADD CONSTRAINT payment_states_status_check
    CHECK (status IN ('pending', 'approved', 'paid', 'annulled'));

CREATE INDEX IF NOT EXISTS idx_payment_states_tenant_contract
    ON public.payment_states (tenant_id, contract_id);

-- ── 3. Arriendos: imputación a contrato cliente ───────────────────────────────
-- Se precarga desde la solicitud de arriendo al adjudicar; editable en la ficha.
ALTER TABLE public.rental_contracts
    ADD COLUMN IF NOT EXISTS client_contract_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL;

-- ── 4. Ledger: categoría de ingreso ───────────────────────────────────────────
ALTER TABLE public.finance_entries DROP CONSTRAINT IF EXISTS finance_entries_category_check;
ALTER TABLE public.finance_entries
    ADD CONSTRAINT finance_entries_category_check
    CHECK (category IN ('materials', 'labor', 'equipment', 'subcontract', 'rental', 'services', 'indirect', 'revenue'));

NOTIFY pgrst, 'reload schema';
