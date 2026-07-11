-- =============================================================================
-- Suministros del cliente (caso Valar ↔ Novandino)
--
-- Cuando el tenant no tiene o no consigue un material, el CLIENTE del contrato
-- lo proporciona. Se reutiliza el pipeline de solicitudes de compra con un
-- destino distinto (request_target='client'): el supervisor solicita, el ADC
-- autoriza, el supervisor la envía por correo al cliente (PDF "Solicitud de
-- Suministro"), y al recibirse los ítems se materializan como activos con
-- ownership='cliente' — NUNCA mezclados con el stock propio, porque al cierre
-- del contrato hay que devolvérselos al cliente (comodato).
--
-- 1) purchase_requests.request_target: 'supplier' (histórico, compra normal)
--    | 'client' (suministro del cliente). + client_id/client_name (derivados
--    del contrato al crear) y sent_to_client_at (cuándo se envió el correo).
--
-- 2) materials.client_id: dueño del activo cuando ownership='cliente'
--    (patrón de rental_contract_id para los arrendados). `ownership` no tiene
--    CHECK (texto libre con default 'propio'); valores en uso:
--    'propio' | 'arrendado' | 'cliente' | 'subcontrato' (reservado, sin UI).
-- =============================================================================

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS request_target text NOT NULL DEFAULT 'supplier',
  ADD COLUMN IF NOT EXISTS client_id uuid,
  ADD COLUMN IF NOT EXISTS client_name text,
  ADD COLUMN IF NOT EXISTS sent_to_client_at timestamptz;

ALTER TABLE public.purchase_requests
  DROP CONSTRAINT IF EXISTS purchase_requests_request_target_check;
ALTER TABLE public.purchase_requests
  ADD CONSTRAINT purchase_requests_request_target_check
  CHECK (request_target IN ('supplier', 'client'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requests_client_id_fkey'
  ) THEN
    ALTER TABLE public.purchase_requests
      ADD CONSTRAINT purchase_requests_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS client_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'materials_client_id_fkey'
  ) THEN
    ALTER TABLE public.materials
      ADD CONSTRAINT materials_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
