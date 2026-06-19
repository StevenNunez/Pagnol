-- =============================================================================
-- F1 — Proveedores 360°
-- Extiende `suppliers` con datos estructurados (contactos, documentos,
-- evaluaciones) y vínculo opcional a centro de costo. Crea un bucket privado
-- para los documentos del proveedor, aislado por tenant (primer segmento del
-- path = tenant_id), siguiendo el patrón de `work-report-photos`.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS contacts        jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS documents       jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS evaluations     jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cost_center_id  uuid,
  ADD COLUMN IF NOT EXISTS notes           text;

-- ---------------------------------------------------------------------------
-- Bucket privado para documentos del proveedor (PDF / Excel / imágenes).
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'supplier-documents',
  'supplier-documents',
  false,
  20971520, -- 20 MB
  ARRAY[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
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
      AND policyname LIKE 'supplier_documents_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY supplier_documents_select ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'supplier-documents'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
);

CREATE POLICY supplier_documents_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'supplier-documents'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
);

CREATE POLICY supplier_documents_update ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'supplier-documents'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
)
WITH CHECK (
  bucket_id = 'supplier-documents'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
);

CREATE POLICY supplier_documents_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'supplier-documents'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
);
