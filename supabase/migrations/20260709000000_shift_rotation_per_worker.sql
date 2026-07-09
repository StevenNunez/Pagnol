-- =============================================================================
-- Turnos acorde a asistencia — ancla de ciclo POR TRABAJADOR
--
-- El turno (shift_schedules) define el PATRÓN (14x14, horario, nocturno) y su
-- rotation_reference_date era el único ancla del ciclo: todos los asignados
-- rotaban igual. En faena real hay grupos desfasados (A sube cuando B baja),
-- lo que obligaba a duplicar turnos idénticos con distinta fecha.
--
-- rotation_start_date en contract_workers = "día 1 del ciclo DE ESTE trabajador"
-- (su fecha de subida). NULL = hereda rotation_reference_date del turno
-- (retrocompatible con todas las asignaciones existentes).
--
-- RLS: cubierta por la policy canónica FOR ALL de contract_workers
-- (20260612000001) — no requiere policies nuevas.
-- =============================================================================

alter table public.contract_workers
  add column if not exists rotation_start_date date;

comment on column public.contract_workers.rotation_start_date is
  'Día 1 del ciclo de rotación de este trabajador (fecha de subida). NULL = usa rotation_reference_date del turno.';
