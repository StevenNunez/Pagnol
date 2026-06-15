-- =============================================================================
-- Modulo Reportes de Trabajo / Informes de Terreno
-- Tabla multi-tenant con secciones dinamicas en JSONB para operacion mobile-first.
-- Idempotente y alineada al patron RLS por tenant del proyecto.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.work_reports (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL,
  internal_code           text NOT NULL,
  status                  text NOT NULL DEFAULT 'draft',
  work_item_id            uuid,
  ot_number               text NOT NULL DEFAULT '',
  client                  text NOT NULL DEFAULT '',
  faena                   text NOT NULL DEFAULT '',
  area                    text NOT NULL DEFAULT '',
  supervisor_id           uuid,
  supervisor_name         text NOT NULL DEFAULT '',
  work_date               date NOT NULL DEFAULT CURRENT_DATE,
  start_time              time,
  end_time                time,
  location                text,
  activities              text NOT NULL DEFAULT '',
  labor                   jsonb NOT NULL DEFAULT '[]'::jsonb,
  equipment               jsonb NOT NULL DEFAULT '[]'::jsonb,
  materials               jsonb NOT NULL DEFAULT '[]'::jsonb,
  photos                  jsonb NOT NULL DEFAULT '[]'::jsonb,
  progress_percent        integer NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
  execution_status        text NOT NULL DEFAULT 'not_started',
  progress_observations   text,
  progress_history        jsonb NOT NULL DEFAULT '[]'::jsonb,
  signatures              jsonb NOT NULL DEFAULT '[]'::jsonb,
  audit_log               jsonb NOT NULL DEFAULT '[]'::jsonb,
  rejection_reason        text,
  sent_to                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by              uuid,
  created_by_name         text NOT NULL DEFAULT '',
  updated_by              uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  submitted_at            timestamptz,
  operations_approved_at  timestamptz,
  final_approved_at       timestamptz,
  UNIQUE (tenant_id, internal_code)
);

CREATE INDEX IF NOT EXISTS idx_work_reports_tenant ON public.work_reports(tenant_id);
CREATE INDEX IF NOT EXISTS idx_work_reports_status ON public.work_reports(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_work_reports_work_date ON public.work_reports(tenant_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_work_reports_work_item ON public.work_reports(work_item_id);
CREATE INDEX IF NOT EXISTS idx_work_reports_created_by ON public.work_reports(created_by);

CREATE OR REPLACE FUNCTION public.set_work_reports_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_work_reports_updated_at ON public.work_reports;
CREATE TRIGGER trg_work_reports_updated_at
BEFORE UPDATE ON public.work_reports
FOR EACH ROW
EXECUTE FUNCTION public.set_work_reports_updated_at();

ALTER TABLE public.work_reports ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'work_reports'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.work_reports', pol.policyname);
  END LOOP;

  EXECUTE $policy$
    CREATE POLICY work_reports_tenant ON public.work_reports
    FOR ALL
    USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
    WITH CHECK (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
  $policy$;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_reports TO authenticated;

-- Storage para evidencia fotografica. Las politicas filtran por el primer
-- segmento del path, que debe ser tenant_id.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'work-report-photos',
  'work-report-photos',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
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
      AND policyname LIKE 'work_report_photos_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY work_report_photos_select ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'work-report-photos'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
);

CREATE POLICY work_report_photos_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'work-report-photos'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
);

CREATE POLICY work_report_photos_update ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'work-report-photos'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
)
WITH CHECK (
  bucket_id = 'work-report-photos'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
);

CREATE POLICY work_report_photos_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'work-report-photos'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
);
