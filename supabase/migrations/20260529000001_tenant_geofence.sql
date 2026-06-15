-- =============================================================================
-- Geofence por tenant para validación de ubicación en QR dinámico
-- =============================================================================

ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS geo_lat      double precision,
    ADD COLUMN IF NOT EXISTS geo_lng      double precision,
    ADD COLUMN IF NOT EXISTS geo_radius_m integer DEFAULT 300;
