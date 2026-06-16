-- =============================================================================
-- Modulo de Recursos Humanos (RRHH)
--
-- 1) Extiende `profiles` con campos de ficha de empleado que aun no existian
--    (direccion, fecha de nacimiento, contacto de emergencia, estado laboral).
-- 2) Tabla `hr_leave_requests` (vacaciones/licencias) con autoservicio para el
--    propio trabajador y aprobacion para RRHH.
-- 3) Tabla `hr_documents` (documentos y vencimientos) por trabajador.
-- 4) Bucket de storage privado `hr-documents` con politicas por carpeta
--    tenant_id/user_id/..., mismo patron que work-report-photos.
--
-- RLS con el patron canonico del proyecto (bypass super-admin + aislamiento
-- por tenant), igual a 20260614000000_rentals_module.sql. GRANT explicito a
-- `authenticated` requerido en proyectos Supabase creados desde may-2026.
--
-- Idempotente: seguro de re-ejecutar.
-- Requiere las funciones helper public.is_super_admin() y public.get_my_tenant_id().
-- =============================================================================

-- ── Extender profiles ──────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS emergency_contact_name text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text,
  ADD COLUMN IF NOT EXISTS employment_status text NOT NULL DEFAULT 'active';

-- ── Tablas ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hr_leave_requests (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  user_id                uuid NOT NULL,
  user_name              text NOT NULL DEFAULT '',
  type                   text NOT NULL DEFAULT 'vacation', -- vacation|sick_leave|permit|other
  start_date             date NOT NULL,
  end_date               date NOT NULL,
  days_count             integer NOT NULL DEFAULT 1,
  reason                 text,
  status                 text NOT NULL DEFAULT 'pending', -- pending|approved|rejected
  supporting_document_url text,
  reviewed_by            uuid,
  reviewed_by_name       text,
  reviewed_at            timestamptz,
  rejection_reason       text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hr_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  user_id        uuid NOT NULL,
  user_name      text NOT NULL DEFAULT '',
  document_type  text NOT NULL DEFAULT 'other', -- contract|certificate|license|exam|other
  name           text NOT NULL,
  file_url       text,
  file_path      text,
  issue_date     date,
  expiry_date    date,
  notes          text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hr_leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_documents      ENABLE ROW LEVEL SECURITY;

-- ── Indices ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_hr_leave_requests_tenant ON public.hr_leave_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_hr_leave_requests_user   ON public.hr_leave_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_hr_leave_requests_status ON public.hr_leave_requests(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_hr_documents_tenant      ON public.hr_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_hr_documents_user        ON public.hr_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_hr_documents_expiry      ON public.hr_documents(tenant_id, expiry_date);

-- ── RLS: patron canonico por tenant ──────────────────────────────────────────
DO $$
DECLARE
  t   text;
  pol record;
  hr_tables text[] := ARRAY['hr_leave_requests', 'hr_documents'];
BEGIN
  FOREACH t IN ARRAY hr_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
      FOR ALL
      USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
      WITH CHECK (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
    $f$, t || '_tenant', t);
  END LOOP;
END $$;

-- ── GRANTs (Data API) ─────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.hr_leave_requests, public.hr_documents
  TO authenticated;

-- ── Storage: bucket privado para documentos de RRHH ──────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'hr-documents',
  'hr-documents',
  false,
  10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname LIKE 'hr_documents_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY hr_documents_select ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'hr-documents'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
);

CREATE POLICY hr_documents_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'hr-documents'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
);

CREATE POLICY hr_documents_update ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'hr-documents'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
)
WITH CHECK (
  bucket_id = 'hr-documents'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
);

CREATE POLICY hr_documents_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'hr-documents'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
);
