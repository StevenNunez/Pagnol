-- Asocia cada solicitud de material a un contrato/obra específico.
-- contract_id: FK al contrato (ON DELETE SET NULL para no perder la solicitud si se elimina el contrato).
-- contract_name: nombre denormalizado para historial/PDF aunque el contrato cambie o se borre.

ALTER TABLE public.material_requests
  ADD COLUMN IF NOT EXISTS contract_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contract_name text;

CREATE INDEX IF NOT EXISTS idx_material_requests_contract_id
  ON public.material_requests (contract_id);
