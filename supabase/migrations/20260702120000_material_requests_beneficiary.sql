-- ─────────────────────────────────────────────────────────────────────────────
-- Beneficiario en solicitudes de material (Opción 1)
--
-- Separa QUIÉN SOLICITA de QUIÉN RETIRA:
--   delivery_mode:
--     'self'     → retira el mismo solicitante (comportamiento histórico; default)
--     'directed' → dirigida a un trabajador específico (beneficiary_id/_name),
--                  p.ej. el APR pide EPPs para un trabajador
--     'open'     → sin destinatario fijo; quien retira queda registrado al
--                  momento de la entrega (received_by_*)
--   received_by_user_id/_name: receptor REAL verificado (biometría/QR) al
--   momento de la entrega en pagnol/movimientos. Complementa a
--   delivered_by_user_* (el pañolero que entrega).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.material_requests
  ADD COLUMN IF NOT EXISTS delivery_mode text NOT NULL DEFAULT 'self',
  ADD COLUMN IF NOT EXISTS beneficiary_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS beneficiary_name text NULL,
  ADD COLUMN IF NOT EXISTS received_by_user_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS received_by_user_name text NULL;

-- Check constraint idempotente (ADD CONSTRAINT no soporta IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'material_requests_delivery_mode_check'
      AND conrelid = 'public.material_requests'::regclass
  ) THEN
    ALTER TABLE public.material_requests
      ADD CONSTRAINT material_requests_delivery_mode_check
      CHECK (delivery_mode IN ('self', 'directed', 'open'));
  END IF;
END $$;

-- Índice para la consulta del pañol: "entregas pendientes de este trabajador".
CREATE INDEX IF NOT EXISTS idx_material_requests_beneficiary
  ON public.material_requests (tenant_id, beneficiary_id)
  WHERE beneficiary_id IS NOT NULL;

COMMENT ON COLUMN public.material_requests.delivery_mode IS
  'self = retira el solicitante | directed = dirigida a beneficiary_id | open = retiro abierto (receptor se registra al entregar)';
COMMENT ON COLUMN public.material_requests.received_by_user_id IS
  'Receptor real verificado (biometría/QR) al momento de la entrega';
