-- =============================================================================
-- Columna `tenants.logo_url` (faltante en este proyecto)
--
-- La migración 20260611000000_tenant_logo.sql (que creaba el bucket + la columna)
-- nunca se aplicó en este proyecto. La consolidada 20260626030000 re-creó el
-- BUCKET pero NO incluyó el ALTER de la columna → al guardar el logo desde
-- Configuración salía: "Could not find the 'logo_url' column of 'tenants' in the
-- schema cache" (PostgREST no encontraba la columna).
--
-- Esta migración deja la columna en su lugar. Idempotente: seguro de re-ejecutar.
-- =============================================================================

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS logo_url text;

-- Refresca el cache de esquema de PostgREST para que la Data API vea la columna
-- de inmediato (sin esperar al reload automático).
NOTIFY pgrst, 'reload schema';
