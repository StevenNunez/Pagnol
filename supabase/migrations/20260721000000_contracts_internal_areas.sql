-- =============================================================================
-- ÁREAS INTERNAS — estructura propia de la empresa (caso Valar)
-- =============================================================================
-- PROBLEMA: hoy "personal/stock de planta" y "dato que falta asignar" son el
-- MISMO estado. Un trabajador de Administración simplemente no tiene fila en
-- `contract_workers`, igual que un operario que alguien olvidó asignar; y el
-- casco que se le entrega cae al pool central (`material_stocks.contract_id
-- IS NULL`), que la migración 20260701010000 definió explícitamente como
-- LIMBO ("se reparte después con la acción de transferencia"), no como una
-- unidad organizacional real.
--
-- MODELO: un Área Interna (Administración, Finanzas, Abastecimiento, Gerencia…)
-- es una fila de `contracts` con kind='internal' y client_id NULL. Todo el
-- sistema ya pivotea sobre contract_id (contract_workers, material_stocks,
-- warehouse_contracts, kardex, asistencia, las 3 solicitudes), así que un área
-- interna hereda gratis personas, stock, pañoles, imputación y reportes.
--
-- Efecto colateral deseado: `contract_id IS NULL` recupera su significado real
-- —limbo— y "sin asignar" pasa a ser una alerta de calidad de dato accionable.
--
-- El presupuesto de compras sigue viviendo en `cost_centers`; se enlaza con un
-- FK opcional (contracts.cost_center_id) en vez de duplicar la dimensión.
--
-- NO HAY BACKFILL — deliberado:
--   · El pool central actual contiene TODO el stock histórico backfilleado.
--     Moverlo a un área declararía en silencio que ese inventario es suyo.
--   · Tampoco se auto-asigna a planta al personal sin contrato: puede ser
--     planta O un olvido, y solo el usuario sabe cuál.
--   Ambas cosas se resuelven a mano (transferencia de stock ya existente /
--   asignación desde el panel de usuario).
--
-- NO SE SIEMBRAN ÁREAS AQUÍ: Pagnol es multi-tenant y un INSERT en esta
-- migración se las inyectaría a TODOS los tenants. Se crean desde la UI
-- (Configuración → Clientes y Contratos), por tenant.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

-- ── 1) Naturaleza del contrato + enlace a centro de costo ────────────────────
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'client',
  ADD COLUMN IF NOT EXISTS cost_center_id uuid
    REFERENCES public.cost_centers(id) ON DELETE SET NULL;

-- DEFAULT 'client' deja todos los contratos existentes exactamente como están.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_kind_check') THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_kind_check
      CHECK (kind IN ('client', 'internal'));
  END IF;

  -- Un área interna no tiene mandante: es estructura propia de la empresa.
  -- (client_name es legacy de solo-lectura; se cubre también para no dejar
  --  un nombre de cliente huérfano en un área.)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_internal_has_no_client') THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_internal_has_no_client
      CHECK (kind = 'client' OR (client_id IS NULL AND client_name IS NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS contracts_kind_idx ON public.contracts (tenant_id, kind);
CREATE INDEX IF NOT EXISTS contracts_cost_center_idx ON public.contracts (cost_center_id);

-- ── 2) Subcontratistas: columnas que el código ya esperaba ───────────────────
-- La UI (contract-form-dialog) y el tipo Contract ya declaraban estos campos,
-- pero no existían en la tabla: el bloque "subcontratista" no persistía nada.
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS is_subcontractor      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parent_contract_id    uuid REFERENCES public.contracts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subcontractor_company text,
  ADD COLUMN IF NOT EXISTS subcontractor_rut     text;

CREATE INDEX IF NOT EXISTS contracts_parent_idx ON public.contracts (parent_contract_id);

NOTIFY pgrst, 'reload schema';
