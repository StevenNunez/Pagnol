-- =============================================================================
-- Flujo de Orden de Compra (OC) para Arriendos
--
-- Hasta ahora "Adjudicar" generaba de golpe el contrato ACTIVO + el calendario
-- de pagos completo. El negocio necesita un paso intermedio de OC:
--
--   Adjudicar → contrato 'pending' (oc_status='pending', SIN calendario)
--     → Generar OC (PDF)      → oc_status sigue 'pending'
--     → Enviar OC             → oc_status='sent', oc_sent_at
--     → Confirmar OC          → oc_status='confirmed', oc_confirmed_at
--                               contrato pasa a 'active' y RECIÉN AHÍ se genera
--                               el calendario de pagos (corre el tiempo de pago).
--
-- El 1er vencimiento se cuenta desde la confirmación de la OC + payment_terms_days.
-- Los montos se manejan netos y se les aplica tax_rate (IVA 19% por defecto).
--
-- Aditivo + idempotente. Backfill: los contratos EXISTENTES se marcan con la OC
-- ya confirmada (= created_at) para no romper arriendos ya operativos.
-- =============================================================================

ALTER TABLE public.rental_contracts ADD COLUMN IF NOT EXISTS oc_number          text;
ALTER TABLE public.rental_contracts ADD COLUMN IF NOT EXISTS oc_status          text NOT NULL DEFAULT 'pending'; -- pending|sent|confirmed
ALTER TABLE public.rental_contracts ADD COLUMN IF NOT EXISTS oc_sent_at         timestamptz;
ALTER TABLE public.rental_contracts ADD COLUMN IF NOT EXISTS oc_confirmed_at    timestamptz;
ALTER TABLE public.rental_contracts ADD COLUMN IF NOT EXISTS payment_terms_days integer NOT NULL DEFAULT 30;
ALTER TABLE public.rental_contracts ADD COLUMN IF NOT EXISTS tax_rate           numeric NOT NULL DEFAULT 19;

-- Backfill: contratos previos ya estaban operativos (con calendario generado),
-- así que su OC se considera confirmada para no dejarlos atascados en el flujo.
UPDATE public.rental_contracts
   SET oc_status = 'confirmed',
       oc_confirmed_at = COALESCE(oc_confirmed_at, created_at)
 WHERE oc_status = 'pending'
   AND status <> 'pending';
