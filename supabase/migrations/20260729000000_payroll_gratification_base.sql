-- =============================================================================
-- Remuneraciones F2 — Base de la gratificación art. 50 por contrato (ADR-008)
--
-- Decisión 1 de Steven: la base sobre la que se aplica el 25% NO es una regla
-- única del tenant, sino parte de lo pactado en cada contrato laboral. Fijar una
-- sola habría obligado a mentir en la mitad de la dotación.
--
--   'imponible'   → 25% de (sueldo proporcional + horas extra + haberes
--                   imponibles). La gratificación NUNCA entra en su propia base:
--                   sería circular.
--   'sueldo_base' → 25% del sueldo base proporcional, y nada más. Es lo que hace
--                   hoy la calculadora de `attendance/monthly-report`.
--
-- En ambos casos rige el mismo tope: (gratification_cap_imm × IMM) / 12, con el
-- IMM de `payroll_parameters` vigente en el período — no la constante
-- desactualizada del componente.
-- =============================================================================

-- DEFAULT 'imponible' a propósito: es la base MAYOR de las dos. Si el default se
-- equivoca, el error paga de más al trabajador en vez de deberle — que es el
-- lado seguro cuando la consecuencia es legal. Un contrato que pactó la base
-- estrecha lo declara explícitamente.
ALTER TABLE public.employment_contracts
    ADD COLUMN IF NOT EXISTS gratification_base text NOT NULL DEFAULT 'imponible';

-- El CHECK va aparte y con guarda: ADD CONSTRAINT no admite IF NOT EXISTS, y
-- esta migración tiene que poder re-ejecutarse (el editor SQL revierte el lote
-- completo ante cualquier error, así que la idempotencia no es opcional).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'employment_contracts_gratification_base_check'
           AND conrelid = 'public.employment_contracts'::regclass
    ) THEN
        ALTER TABLE public.employment_contracts
            ADD CONSTRAINT employment_contracts_gratification_base_check
            CHECK (gratification_base IN ('imponible', 'sueldo_base'));
    END IF;
END $$;

COMMENT ON COLUMN public.employment_contracts.gratification_base IS
    'Base del 25% del art. 50: imponible (sueldo proporcional + extras + haberes '
    'imponibles, sin incluirse a sí misma) o sueldo_base. ADR-008.';

-- Art. 2 intacto: esto es DDL, no edita ninguna fila. Cambiar la base pactada de
-- un trabajador sigue siendo un anexo (fila nueva con su effective_from), nunca
-- un UPDATE de la vigente.

NOTIFY pgrst, 'reload schema';
