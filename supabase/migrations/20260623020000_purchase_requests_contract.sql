-- Asocia cada solicitud de COMPRA a un contrato/obra específico (igual que material_requests).
-- contract_id: FK al contrato (ON DELETE SET NULL para no perder la solicitud si se elimina).
-- contract_name: nombre denormalizado para historial/OC aunque el contrato cambie o se borre.

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS contract_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contract_name text;

CREATE INDEX IF NOT EXISTS idx_purchase_requests_contract_id
  ON public.purchase_requests (contract_id);
