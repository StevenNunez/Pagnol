-- =============================================================================
-- Bucket `asset-photos` — fotos de los activos (pagnol/activos)
--
-- Hasta ahora no había forma de subir fotos a un activo (el campo `photos`
-- existía en el modelo pero sin uploader), así que todos mostraban "SIN FOTO".
-- Este bucket almacena las fotos; se muestran vía next/image con getPublicUrl.
--
-- • Bucket PÚBLICO (las fotos se muestran en tarjetas/listas y podrían ir en PDFs).
-- • Escritura/borrado SOLO en la carpeta del propio tenant: la app sube a
--   `${tenant.id}/...`. Requiere public.get_my_tenant_id().
-- Idempotente: seguro de re-ejecutar. Mismo patrón que `tenant-logos`.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('asset-photos', 'asset-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "asset_photos_insert" ON storage.objects;
DROP POLICY IF EXISTS "asset_photos_update" ON storage.objects;
DROP POLICY IF EXISTS "asset_photos_delete" ON storage.objects;
DROP POLICY IF EXISTS "asset_photos_select" ON storage.objects;

-- INSERT: solo en la carpeta `<mi_tenant>/...`
CREATE POLICY "asset_photos_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'asset-photos'
  AND (storage.foldername(name))[1] = public.get_my_tenant_id()::text
);

-- UPDATE: solo objetos de la carpeta del propio tenant
CREATE POLICY "asset_photos_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'asset-photos'
  AND (storage.foldername(name))[1] = public.get_my_tenant_id()::text
)
WITH CHECK (
  bucket_id = 'asset-photos'
  AND (storage.foldername(name))[1] = public.get_my_tenant_id()::text
);

-- DELETE: solo objetos de la carpeta del propio tenant
CREATE POLICY "asset_photos_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'asset-photos'
  AND (storage.foldername(name))[1] = public.get_my_tenant_id()::text
);

-- SELECT: lectura pública (fotos visibles en la app / PDFs).
CREATE POLICY "asset_photos_select"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'asset-photos');
