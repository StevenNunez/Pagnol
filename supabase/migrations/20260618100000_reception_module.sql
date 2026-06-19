-- =============================================================================
-- F3 — Recepción de Mercadería ligada a OC (parcial + fotos)
-- Tabla `goods_receipts`: cada fila es UN evento de recepción contra una Orden
-- de Compra. Una OC puede recibirse en varios eventos (recepción parcial); la
-- cantidad recibida por ítem se acumula sumando todas las recepciones de la OC.
-- Las fotos de respaldo (evidencia) se guardan como array JSONB de URLs firmadas
-- (bucket privado `reception-photos`), patrón idéntico a work-report-photos.
--
-- Trazabilidad: OC (purchase_orders) → Recepción (goods_receipts) → Stock
-- (materials + stock_movements). Al completarse la recepción de todos los ítems
-- la OC pasa a 'completed' y sus solicitudes a 'received'.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.goods_receipts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  internal_code        text NOT NULL,
  purchase_order_id    uuid NOT NULL,
  purchase_order_code  text NOT NULL DEFAULT '',
  supplier_id          uuid,
  supplier_name        text NOT NULL DEFAULT '',
  items                jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{itemId,name,unit,orderedQuantity,receivedQuantity,materialId}]
  photos               jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{id,url,path,name,date}]
  notes                text,
  received_by          uuid,
  received_by_name     text NOT NULL DEFAULT '',
  received_at          timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, internal_code)
);

CREATE INDEX IF NOT EXISTS idx_goods_receipts_tenant ON public.goods_receipts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_order ON public.goods_receipts(tenant_id, purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_created ON public.goods_receipts(tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_goods_receipts_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_goods_receipts_updated_at ON public.goods_receipts;
CREATE TRIGGER trg_goods_receipts_updated_at
BEFORE UPDATE ON public.goods_receipts
FOR EACH ROW
EXECUTE FUNCTION public.set_goods_receipts_updated_at();

ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'goods_receipts'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.goods_receipts', pol.policyname);
  END LOOP;

  EXECUTE $policy$
    CREATE POLICY goods_receipts_tenant ON public.goods_receipts
    FOR ALL
    USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
    WITH CHECK (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
  $policy$;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.goods_receipts TO authenticated;

-- ---------------------------------------------------------------------------
-- Bucket privado para fotos de recepción (evidencia de la mercadería).
-- Aislado por tenant: primer segmento del path = tenant_id.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'reception-photos',
  'reception-photos',
  false,
  20971520, -- 20 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
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
      AND policyname LIKE 'reception_photos_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY reception_photos_select ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'reception-photos'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
);

CREATE POLICY reception_photos_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'reception-photos'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
);

CREATE POLICY reception_photos_update ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'reception-photos'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
)
WITH CHECK (
  bucket_id = 'reception-photos'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
);

CREATE POLICY reception_photos_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'reception-photos'
  AND (
    public.is_super_admin()
    OR (
      (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[1]::uuid = public.get_my_tenant_id()
    )
  )
);
