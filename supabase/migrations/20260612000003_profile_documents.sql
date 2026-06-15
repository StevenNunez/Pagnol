-- =============================================================================
-- S4 (parte 2) — Documentos KYC en tabla protegida
--
-- Antes: kyc_id_front / kyc_id_back / kyc_face_image vivían como base64 en
-- `profiles`, legibles por TODO miembro del tenant (profiles_select_tenant) y
-- difundidos a todos los clientes vía el collection (select '*'). Exposición de
-- documentos de identidad (cédula) entre compañeros.
--
-- Ahora: se mueven a `profile_documents` con RLS estricta: solo el DUEÑO o un
-- admin del tenant. El biometric_template se mantiene en `profiles` porque el
-- matching facial es client-side y necesita leer los templates del tenant.
--
-- Idempotente: seguro de re-ejecutar (los DROP COLUMN usan IF EXISTS).
-- =============================================================================

-- Helper: admin del tenant (roles administrativos por defecto con acceso a PII).
CREATE OR REPLACE FUNCTION public.is_tenant_admin()
RETURNS boolean AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('super-admin', 'administrador', 'director-faena')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Tabla protegida (1:1 con profiles).
CREATE TABLE IF NOT EXISTS public.profile_documents (
  profile_id      uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  tenant_id       uuid,
  kyc_id_front    text,
  kyc_id_back     text,
  kyc_face_image  text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Migrar datos existentes antes de eliminar las columnas.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='kyc_face_image'
  ) THEN
    INSERT INTO public.profile_documents (profile_id, tenant_id, kyc_id_front, kyc_id_back, kyc_face_image)
    SELECT id, tenant_id, kyc_id_front, kyc_id_back, kyc_face_image
    FROM public.profiles
    WHERE kyc_id_front IS NOT NULL OR kyc_id_back IS NOT NULL OR kyc_face_image IS NOT NULL
    ON CONFLICT (profile_id) DO NOTHING;
  END IF;
END $$;

-- RLS: dueño o admin del tenant.
ALTER TABLE public.profile_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profile_documents_access" ON public.profile_documents;
CREATE POLICY "profile_documents_access" ON public.profile_documents
  FOR ALL
  USING (
    profile_id = auth.uid()
    OR public.is_super_admin()
    OR (public.is_tenant_admin() AND tenant_id = public.get_my_tenant_id())
  )
  WITH CHECK (
    profile_id = auth.uid()
    OR public.is_super_admin()
    OR (public.is_tenant_admin() AND tenant_id = public.get_my_tenant_id())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_documents TO authenticated;

-- Eliminar las columnas sensibles de profiles (ya migradas).
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS kyc_id_front,
  DROP COLUMN IF EXISTS kyc_id_back,
  DROP COLUMN IF EXISTS kyc_face_image;
