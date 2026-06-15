-- =============================================================================
-- Reconciliación de drift de esquema en el módulo de seguridad (CPHS)
--
-- Hallazgo (2026-06-12, verificado con queries reales a Postgres): el código
-- (mappers + mutations) lee/escribe columnas que NO existen en estas tablas,
-- por lo que los INSERT de charlas diarias, checklists, inspecciones y
-- observaciones FALLABAN en runtime. Las 5 tablas estaban VACÍAS (0 filas),
-- así que no hay datos que migrar.
--
-- Estrategia: hacer que la BD coincida con el código (internamente consistente:
-- mapper y mutation usan los mismos nombres). Se AÑADEN las columnas que el
-- código usa y se RELAJA el NOT NULL de columnas legacy que el código no
-- escribe (que también bloqueaban el INSERT). Las columnas legacy huérfanas
-- (topic, content, name, responses, observed_user_id, etc.) se dejan nullable;
-- una limpieza futura podría eliminarlas.
--
-- protocols / protocol_templates NO tienen drift (su esquema ya coincide).
-- Idempotente.
-- =============================================================================

-- ── daily_talks ──────────────────────────────────────────────────────────────
ALTER TABLE public.daily_talks
  ADD COLUMN IF NOT EXISTS obra  text,
  ADD COLUMN IF NOT EXISTS fecha date;
ALTER TABLE public.daily_talks ALTER COLUMN topic DROP NOT NULL;

-- ── assigned_checklists ──────────────────────────────────────────────────────
ALTER TABLE public.assigned_checklists
  ADD COLUMN IF NOT EXISTS template_title text,
  ADD COLUMN IF NOT EXISTS supervisor_id  uuid,
  ADD COLUMN IF NOT EXISTS assigner_id    uuid,
  ADD COLUMN IF NOT EXISTS assigner_name  text,
  ADD COLUMN IF NOT EXISTS items          jsonb;

-- ── safety_inspections ───────────────────────────────────────────────────────
ALTER TABLE public.safety_inspections
  ADD COLUMN IF NOT EXISTS inspector_name text,
  ADD COLUMN IF NOT EXISTS inspector_role text,
  ADD COLUMN IF NOT EXISTS date           timestamptz,
  ADD COLUMN IF NOT EXISTS description    text,
  ADD COLUMN IF NOT EXISTS risk_level     text,
  ADD COLUMN IF NOT EXISTS assigned_to    uuid;
ALTER TABLE public.safety_inspections ALTER COLUMN items DROP NOT NULL;

-- ── behavior_observations ────────────────────────────────────────────────────
ALTER TABLE public.behavior_observations
  ADD COLUMN IF NOT EXISTS worker_id   uuid,
  ADD COLUMN IF NOT EXISTS worker_name text;

-- ── checklist_templates ──────────────────────────────────────────────────────
ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS title      text,
  ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.checklist_templates ALTER COLUMN name DROP NOT NULL;
