-- RFC-004 F1.1 — Si es para mañana, hay que decir por qué
--
-- La urgencia sólo significa algo mientras cueste algo declararla. Sin un
-- motivo obligatorio, "alta" se vuelve el valor por defecto de todos en un mes
-- y la bandeja de Abastecimiento vuelve a ordenarse por nada.
--
-- El motivo se exige en la BASE y no sólo en el formulario: es el único lugar
-- donde la regla vale también para el MCP, el asistente de IA y cualquier
-- emisor futuro del requerimiento.

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS urgency_reason text;

-- Obligatorio SÓLO para urgencia alta. Las filas históricas tienen `urgency`
-- en NULL y pasan sin tocarse (Artículo 2): no se les inventa un motivo.
-- Verificado antes de crear la restricción que no existe ninguna fila con
-- urgencia alta, así que VALIDATE no puede fallar sobre datos ya emitidos.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requests_urgency_reason_check') THEN
    ALTER TABLE public.purchase_requests
      ADD CONSTRAINT purchase_requests_urgency_reason_check
      CHECK (
        urgency IS DISTINCT FROM 'alta'
        OR (urgency_reason IS NOT NULL AND length(btrim(urgency_reason)) >= 10)
      ) NOT VALID;
    ALTER TABLE public.purchase_requests VALIDATE CONSTRAINT purchase_requests_urgency_reason_check;
  END IF;
END $$;

COMMENT ON COLUMN public.purchase_requests.urgency_reason IS
  'Por qué se necesita para mañana. Obligatorio (mín. 10 caracteres) cuando urgency = alta; el CHECK lo exige en la base, no sólo en el formulario.';
