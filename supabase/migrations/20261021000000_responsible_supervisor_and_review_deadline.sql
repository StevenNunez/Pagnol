-- ════════════════════════════════════════════════════════════════════════════
-- Retiro con revisión posterior: supervisor responsable + plazo de revisión
--
-- Pedido de la reunión del 2026-10-20:
--   · cada trabajador tiene un supervisor responsable;
--   · un supervisor sólo valida retiros de trabajadores que están a su cargo;
--   · las validaciones pendientes tienen un plazo configurable y, vencido,
--     se avisa al Jefe de Operaciones (sin frenar el trabajo de la bodega).
--
-- El supervisor responsable se COPIA al retiro en el momento de la entrega
-- (material_requests.reviewer_supervisor_id): si después el trabajador cambia
-- de supervisor, los retiros ya hechos siguen con quien les correspondía.
-- Un retiro sin supervisor responsable conserva la regla anterior (supervisores
-- del contrato, o administración).
-- ════════════════════════════════════════════════════════════════════════════

-- ── Supervisor responsable del trabajador ────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS responsible_supervisor_id uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_responsible_supervisor_not_self'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_responsible_supervisor_not_self
      CHECK (responsible_supervisor_id IS NULL OR responsible_supervisor_id <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_responsible_supervisor
  ON public.profiles (tenant_id, responsible_supervisor_id)
  WHERE responsible_supervisor_id IS NOT NULL;

-- Nadie se elige a sí mismo el supervisor que lo valida: la columna sólo la
-- cambian administración / RR.HH. (por la API con service role, donde auth.uid()
-- es NULL, o por la policy de administrador sobre filas ajenas).
CREATE OR REPLACE FUNCTION public.guard_responsible_supervisor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.responsible_supervisor_id IS DISTINCT FROM OLD.responsible_supervisor_id
     AND auth.uid() = OLD.id
     AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'No autorizado: no puedes cambiar tu propio supervisor responsable.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_responsible_supervisor ON public.profiles;
CREATE TRIGGER trg_guard_responsible_supervisor
  BEFORE UPDATE OF responsible_supervisor_id ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_responsible_supervisor();

-- ── Copia en el retiro ───────────────────────────────────────────────────────
ALTER TABLE public.material_requests
  ADD COLUMN IF NOT EXISTS reviewer_supervisor_id uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ── Plazo de revisión, por empresa ───────────────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS withdrawal_review_deadline_hours integer NOT NULL DEFAULT 48;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_withdrawal_review_deadline_check'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_withdrawal_review_deadline_check
      CHECK (withdrawal_review_deadline_hours BETWEEN 1 AND 720);
  END IF;
END $$;

-- ── Quién puede revisar un retiro ajeno a su cuadrilla ───────────────────────
-- Administración y el Jefe de Operaciones supervisan la operación completa.
CREATE OR REPLACE FUNCTION public.can_review_any_withdrawal()
RETURNS boolean AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('super-admin', 'administrador', 'soporte-pagnol', 'jefe-operaciones')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

ALTER FUNCTION public.can_review_any_withdrawal() SET search_path = public, extensions;
GRANT EXECUTE ON FUNCTION public.can_review_any_withdrawal() TO authenticated;

-- ── La base manda: sólo el supervisor responsable (o la jefatura) revisa ─────
-- Reemplaza la política de 20261007010000. Si el retiro no trae supervisor
-- responsable (anteriores a esta migración, o trabajador sin asignar) queda la
-- regla de siempre: cualquiera con permiso, menos el propio retiro.
DROP POLICY IF EXISTS "withdrawal_reviews_insert" ON public.withdrawal_reviews;
CREATE POLICY "withdrawal_reviews_insert" ON public.withdrawal_reviews
  FOR INSERT WITH CHECK (
    tenant_id = public.get_my_tenant_id()
    AND reviewer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.material_requests mr
      WHERE mr.id = request_id
        AND mr.tenant_id = withdrawal_reviews.tenant_id
        AND mr.requires_review
        -- En las entregas directas `supervisor_id` es quien retiró.
        AND mr.supervisor_id::text IS DISTINCT FROM auth.uid()::text
        AND (
              mr.reviewer_supervisor_id IS NULL
           OR mr.reviewer_supervisor_id = auth.uid()
           OR public.can_review_any_withdrawal()
        )
    )
  );
