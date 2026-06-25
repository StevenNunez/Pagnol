-- =============================================================================
-- Gate de autorización del Administrador de Contratos (ADC)
--
-- Flujo de negocio: quien solicita materiales / compras / arriendos es el
-- supervisor (terreno), y necesita ser AUTORIZADO por el Administrador de
-- Contratos antes de que Abastecimiento empiece a cotizar/comprar. Si quien
-- crea la solicitud ya tiene permiso de autorizar (ADC o superior), entra
-- pre-autorizada y salta directo a Abastecimiento.
--
-- En vez de inventar un estado nuevo en cada enum (riesgoso: muchos switch/badges
-- asumen los valores actuales), el gate es ADITIVO: dos columnas por tabla.
--   adc_authorized_at IS NULL  → en bandeja del ADC ("por autorizar")
--   adc_authorized_at NOT NULL → ya autorizada, visible para Abastecimiento
--
-- Idempotente. Backfill: las filas EXISTENTES se marcan como autorizadas
-- (= created_at) para no dejar nada atascado en el flujo actual.
-- =============================================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['material_requests', 'purchase_requests', 'rental_requests']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS adc_authorized_at timestamptz', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS adc_authorized_by uuid', t);
    -- Backfill: nada en vuelo debe quedar atascado al activar el gate.
    EXECUTE format('UPDATE public.%I SET adc_authorized_at = created_at WHERE adc_authorized_at IS NULL', t);
  END LOOP;
END $$;
