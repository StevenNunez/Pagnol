-- =============================================================================
-- Reparación de drift #6 — salary_advances (módulo Wallet)
--
-- Descubierto al aplicar la migración de F3 (2026-07-29). El código de
-- producción escribe y lee CUATRO columnas que no existen en la base:
--
--   paymentMutations.requestSalaryAdvance  → worker_id, worker_name
--   paymentMutations.approveSalaryAdvance  → approver_name
--   paymentMutations.rejectSalaryAdvance   → approver_name, rejection_reason
--   mappers.ts                             → lee worker_id (siempre undefined)
--
-- Esquema real: id, tenant_id, user_id, amount, reason, status, approver_id,
--               requested_at, processed_at
--
-- Consecuencia: pedir, aprobar y rechazar un anticipo fallaban con PGRST204.
-- El módulo Wallet NUNCA funcionó — `salary_advances` tenía 0 filas en los
-- cuatro tenants, incluido el de producción. Sexto caso del mismo patrón de
-- drift en este proyecto.
--
-- Criterio de reparación:
--   · La CLAVE la manda la base: se mantiene `user_id` y se adapta el código.
--     Es el nombre que usa el resto del esquema (profiles.id, payroll_lines) y
--     renombrarla habría dejado inconsistente lo nuevo con lo viejo.
--   · Los NOMBRES CONGELADOS sí se agregan: son convención del proyecto
--     (contract_name, supplier_name, created_by_name…) y tienen valor real —si el
--     perfil cambia después, el anticipo aprobado no debe mentir sobre quién lo
--     pidió ni quién lo autorizó.
--
-- Seguro de aplicar: la tabla está vacía, así que no hay backfill que hacer.
-- =============================================================================

ALTER TABLE public.salary_advances
    ADD COLUMN IF NOT EXISTS worker_name      text,
    ADD COLUMN IF NOT EXISTS approver_name    text,
    ADD COLUMN IF NOT EXISTS rejection_reason text;

COMMENT ON COLUMN public.salary_advances.worker_name IS
    'Nombre congelado del solicitante al momento de pedir el anticipo.';
COMMENT ON COLUMN public.salary_advances.approver_name IS
    'Nombre congelado de quien aprobó o rechazó (Art. 5: autoría explícita).';
COMMENT ON COLUMN public.salary_advances.rejection_reason IS
    'Motivo del rechazo. La columna `reason` preexistente es el motivo de la SOLICITUD.';

NOTIFY pgrst, 'reload schema';
