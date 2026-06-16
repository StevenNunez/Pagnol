-- Hace privado el bucket de fotos para que las políticas RLS de storage
-- apliquen correctamente y las fotos no sean accesibles sin autenticación.
UPDATE storage.buckets SET public = false WHERE id = 'work-report-photos';
