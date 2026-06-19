-- =============================================================================
-- F2 — RFQ (Cotizaciones) + Comparador
-- Tabla `quote_requests`: una RFQ agrupa N solicitudes de compra aprobadas y
-- se envía a N proveedores invitados. Las respuestas (cotizaciones) se guardan
-- como array JSONB embebido (modelo híbrido: adjunto del proveedor + datos
-- estructurados) para evitar una segunda colección y mantener atomicidad.
--
-- Regla de oro: la OC nace de una RFQ adjudicada (award) — el flujo de
-- adjudicación genera la orden de compra desde la oferta ganadora.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.quote_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  internal_code        text NOT NULL,
  title                text NOT NULL DEFAULT '',
  status               text NOT NULL DEFAULT 'draft', -- draft | sent | closed | awarded | cancelled
  request_ids          jsonb NOT NULL DEFAULT '[]'::jsonb,  -- purchase_requests incluidas
  items                jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{id,name,unit,quantity,category}]
  supplier_ids         jsonb NOT NULL DEFAULT '[]'::jsonb,  -- proveedores invitados
  responses            jsonb NOT NULL DEFAULT '[]'::jsonb,  -- QuoteResponse[]
  deadline             date,
  notes                text,
  awarded_supplier_id  uuid,
  awarded_quote_id     text,
  awarded_at           timestamptz,
  purchase_order_id    uuid,
  created_by           uuid,
  created_by_name      text NOT NULL DEFAULT '',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, internal_code)
);

CREATE INDEX IF NOT EXISTS idx_quote_requests_tenant ON public.quote_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_quote_requests_status ON public.quote_requests(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_quote_requests_created ON public.quote_requests(tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_quote_requests_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quote_requests_updated_at ON public.quote_requests;
CREATE TRIGGER trg_quote_requests_updated_at
BEFORE UPDATE ON public.quote_requests
FOR EACH ROW
EXECUTE FUNCTION public.set_quote_requests_updated_at();

ALTER TABLE public.quote_requests ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'quote_requests'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.quote_requests', pol.policyname);
  END LOOP;

  EXECUTE $policy$
    CREATE POLICY quote_requests_tenant ON public.quote_requests
    FOR ALL
    USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
    WITH CHECK (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
  $policy$;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_requests TO authenticated;

-- ---------------------------------------------------------------------------
-- Bucket privado para adjuntos de cotizaciones (PDF / Excel / imagen).
-- Aislado por tenant: primer segmento del path = tenant_id.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'rfq-quotes',
  'rfq-quotes',
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
      AND policyname LIKE 'rfq_quotes_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY rfq_quotes_select ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'rfq-quotes'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
);

CREATE POLICY rfq_quotes_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'rfq-quotes'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
);

CREATE POLICY rfq_quotes_update ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'rfq-quotes'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
)
WITH CHECK (
  bucket_id = 'rfq-quotes'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
);

CREATE POLICY rfq_quotes_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'rfq-quotes'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
);
