-- =============================================================================
-- Modulo Reportes de Trabajo - Bucket de PDFs generados (Fase 2)
-- Bucket PRIVADO. El backend (service role) sube el PDF y entrega URL firmada.
-- Politicas tenant-scoped por el primer segmento del path = tenant_id.
-- Idempotente, alineado al patron de work-report-photos.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'work-report-pdfs',
  'work-report-pdfs',
  false,                       -- PRIVADO: solo accesible via URL firmada
  20971520,                    -- 20 MB
  ARRAY['application/pdf']::text[]
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
      AND policyname LIKE 'work_report_pdfs_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY work_report_pdfs_select ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'work-report-pdfs'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
);

CREATE POLICY work_report_pdfs_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'work-report-pdfs'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
);

CREATE POLICY work_report_pdfs_update ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'work-report-pdfs'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
)
WITH CHECK (
  bucket_id = 'work-report-pdfs'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
);

CREATE POLICY work_report_pdfs_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'work-report-pdfs'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
);
