-- =============================================================================
-- Reparación de drift: attendance_logs (descubierto por el E2E de F1, 2026-07-16)
--
-- La tabla viva nació con el esquema antiguo y nunca se migró a la forma que el
-- código usa hoy. Consecuencia: TODO registro de asistencia estaba roto en este
-- proyecto Supabase (mismo patrón que compras, reparado en 20260722010000):
--   - El INSERT del scan QR / registro manual / import Excel falla con PGRST204
--     (escriben `date`, `registrar_id`, `registrar_name` que no existen).
--   - updateAttendanceLog falla igual (`original_timestamp`, `modified_at`,
--     `modified_by`).
--   - Las 140 filas legacy (siembra demo de abril) usan type 'check-in'/
--     'check-out' y method 'QR'; el código lee type 'in'/'out' — esas marcas
--     son invisibles para asistencia, reportes y el costo de MO (F1).
-- =============================================================================

-- ── 1. Columnas que el código escribe y no existían ──────────────────────────
ALTER TABLE public.attendance_logs ADD COLUMN IF NOT EXISTS date date;
ALTER TABLE public.attendance_logs ADD COLUMN IF NOT EXISTS registrar_id uuid;
ALTER TABLE public.attendance_logs ADD COLUMN IF NOT EXISTS registrar_name text;
ALTER TABLE public.attendance_logs ADD COLUMN IF NOT EXISTS original_timestamp timestamptz;
ALTER TABLE public.attendance_logs ADD COLUMN IF NOT EXISTS modified_at timestamptz;
ALTER TABLE public.attendance_logs ADD COLUMN IF NOT EXISTS modified_by uuid;

-- ── 2. Normalización de datos legacy ──────────────────────────────────────────
UPDATE public.attendance_logs SET type = 'in'  WHERE type = 'check-in';
UPDATE public.attendance_logs SET type = 'out' WHERE type = 'check-out';
UPDATE public.attendance_logs SET method = lower(method) WHERE method <> lower(method);

-- Fecha laboral desde el timestamp: el día se define en hora de Chile
-- (misma convención que el materializador de MO y el cron labor-cost).
UPDATE public.attendance_logs
SET date = (timestamp AT TIME ZONE 'America/Santiago')::date
WHERE date IS NULL AND timestamp IS NOT NULL;

-- ── 3. Índice para las consultas por tenant + día ─────────────────────────────
-- (reporte de asistencia, y la ventana de reconciliación de labor-cost)
CREATE INDEX IF NOT EXISTS idx_attendance_logs_tenant_date
  ON public.attendance_logs (tenant_id, date);

NOTIFY pgrst, 'reload schema';
