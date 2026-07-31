-- =============================================================================
-- Wallet — ciclo de vida del anticipo: "aprobado" ≠ "depositado"
--
-- Hasta ahora un anticipo terminaba en `approved` y ahí se quedaba. La UI le
-- promete al trabajador una transferencia en 24 horas hábiles y no había NINGÚN
-- registro de que hubiera ocurrido: ni fecha, ni medio, ni quién la hizo. Si el
-- trabajador reclamaba, no había con qué responderle.
--
-- Se agrega el estado `pagado` con el mismo respaldo que una factura a proveedor
-- (`markPaymentAsPaid`): fecha de pago + medio + autoría congelada.
--
-- ⚠️ El `status` NO tenía CHECK: cualquier texto entraba. Se cierra la lista
-- ahora que son cuatro estados y no tres.
-- =============================================================================

ALTER TABLE public.salary_advances
    ADD COLUMN IF NOT EXISTS paid_at        timestamptz,
    ADD COLUMN IF NOT EXISTS payment_date   date,
    ADD COLUMN IF NOT EXISTS payment_method text,
    ADD COLUMN IF NOT EXISTS paid_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS paid_by_name   text;

COMMENT ON COLUMN public.salary_advances.payment_date IS
    'Fecha real de la transferencia, no la de aprobación.';
COMMENT ON COLUMN public.salary_advances.paid_by_name IS
    'Nombre congelado de quien registró el pago (Art. 5: autoría explícita).';

ALTER TABLE public.salary_advances
    DROP CONSTRAINT IF EXISTS salary_advances_status_check;
ALTER TABLE public.salary_advances
    ADD CONSTRAINT salary_advances_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'paid'));

-- ── Guarda actualizada ───────────────────────────────────────────────────────
-- Reemplaza a la de 20260804000000. Cambia una sola cosa: `approved → paid` es
-- ahora la única transición válida desde un estado resuelto.
--
-- ⚠️ Un anticipo PAGADO sigue admitiendo que se le escriba `payroll_line_id`:
-- lo normal es pagarlo a mitad de mes y descontarlo al cerrar la planilla, así
-- que bloquear todo cambio sobre `paid` rompería el amarre de `savePayrollDraft`.
-- Lo que queda congelado es el monto, el trabajador, la fecha y el pago mismo.
CREATE OR REPLACE FUNCTION public.salary_advance_guard()
RETURNS trigger AS $$
BEGIN
    IF OLD.status <> 'pending' THEN
        IF NEW.amount IS DISTINCT FROM OLD.amount
           OR NEW.user_id IS DISTINCT FROM OLD.user_id
           OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
            RAISE EXCEPTION 'El anticipo ya está %: no se puede cambiar el monto, el trabajador ni la fecha. Corregirlo es rechazarlo y pedir uno nuevo.', OLD.status;
        END IF;

        IF NEW.status IS DISTINCT FROM OLD.status
           AND NOT (OLD.status = 'approved' AND NEW.status = 'paid') THEN
            RAISE EXCEPTION 'Transición de estado no válida para un anticipo: % → %. Desde aprobado solo se puede pagar.', OLD.status, NEW.status;
        END IF;

        -- Un pago registrado no se reescribe: es el respaldo del trabajador.
        IF OLD.status = 'paid'
           AND (NEW.payment_date IS DISTINCT FROM OLD.payment_date
             OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
             OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
             OR NEW.paid_by IS DISTINCT FROM OLD.paid_by) THEN
            RAISE EXCEPTION 'El pago del anticipo ya quedó registrado: no se puede modificar.';
        END IF;
    END IF;

    -- Un anticipo ya descontado en una planilla solo lo suelta el borrado del
    -- borrador (ON DELETE SET NULL). Reasignarlo a mano lo cobraría dos veces.
    IF OLD.payroll_line_id IS NOT NULL
       AND NEW.payroll_line_id IS NOT NULL
       AND NEW.payroll_line_id <> OLD.payroll_line_id THEN
        RAISE EXCEPTION 'El anticipo ya fue descontado en una liquidación: no se puede reasignar a otra.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION public.salary_advance_guard() SET search_path = public, extensions;

NOTIFY pgrst, 'reload schema';
