-- =============================================================================
-- Grant API access to all public schema tables.
--
-- From May 30 2026, new Supabase projects no longer expose public schema tables
-- to the Data API by default. Every table needs an explicit GRANT before it can
-- be queried through PostgREST / supabase-js.
--
-- Running this on an older project is harmless (idempotent).
-- =============================================================================

-- Full CRUD for logged-in users (RLS policies enforce row-level restrictions).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

-- Read-only for anonymous access — only needed for truly public tables.
-- Keeping it narrow: anon can read nothing by default; add specific grants below if needed.
-- GRANT SELECT ON public.some_public_table TO anon;

-- Sequences (needed for INSERT on tables with serial/bigserial PKs)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Ensure future tables created in this session also get the grant
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
