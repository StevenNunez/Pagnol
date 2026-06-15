-- =============================================================================
-- S4 (parte 1) — Aislamiento por tenant del bucket tenant-logos
--
-- Antes: las policies solo verificaban bucket_id = 'tenant-logos', sin aislar
-- por tenant → cualquier usuario autenticado podía sobrescribir o borrar el
-- logo de CUALQUIER tenant.
--
-- Ahora: escritura/actualización/borrado solo dentro de la carpeta del propio
-- tenant. La app ya sube a la ruta `${tenant.id}/logo.ext`, por lo que el
-- primer segmento del path es el tenant_id. La lectura sigue siendo pública
-- (los logos se incrustan en PDFs).
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

-- Reemplazar las policies abiertas por versiones acotadas a la carpeta del tenant.
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
