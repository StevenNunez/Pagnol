-- =============================================================================
-- Bucket `tenant-logos` (consolidado e idempotente)
--
-- Las migraciones 20260611000000 (creación) y 20260612000002 (aislamiento por
-- tenant) no se habían aplicado en este proyecto → "Bucket not found" al subir
-- el logo desde Configuración / Perfil. Esta migración deja el bucket y las
-- policies en su estado final de una sola pasada, sin depender del orden.
--
-- • Bucket PÚBLICO (los logos se embeben en PDFs y cabeceras).
-- • Escritura/actualización/borrado SOLO en la carpeta del propio tenant
--   (la app sube a `${tenant.id}/logo.ext`). Requiere public.get_my_tenant_id().
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('tenant-logos', 'tenant-logos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "tenant_logos_insert" ON storage.objects;
DROP POLICY IF EXISTS "tenant_logos_update" ON storage.objects;
DROP POLICY IF EXISTS "tenant_logos_delete" ON storage.objects;
DROP POLICY IF EXISTS "tenant_logos_select" ON storage.objects;

-- INSERT: solo en la carpeta `<mi_tenant>/...`
CREATE POLICY "tenant_logos_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'tenant-logos'
  AND (storage.foldername(name))[1] = public.get_my_tenant_id()::text
);

-- UPDATE: solo objetos de la carpeta del propio tenant
CREATE POLICY "tenant_logos_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'tenant-logos'
  AND (storage.foldername(name))[1] = public.get_my_tenant_id()::text
)
WITH CHECK (
  bucket_id = 'tenant-logos'
  AND (storage.foldername(name))[1] = public.get_my_tenant_id()::text
);

-- DELETE: solo objetos de la carpeta del propio tenant
CREATE POLICY "tenant_logos_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'tenant-logos'
  AND (storage.foldername(name))[1] = public.get_my_tenant_id()::text
);

-- SELECT: lectura pública (los logos van embebidos en PDFs / cabeceras).
CREATE POLICY "tenant_logos_select"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'tenant-logos');
