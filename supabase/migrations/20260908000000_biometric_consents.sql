-- =============================================================================
-- Consentimiento informado para el tratamiento de datos biométricos
--
-- POR QUÉ: hasta hoy el trabajador entregaba su rostro y las fotos de su cédula
-- sin que en ninguna parte quedara constancia de que se le explicó para qué, ni
-- de que aceptó. La Ley 19.628 exige autorización previa y por escrito, y la Ley
-- 21.719 —vigente desde diciembre de 2026— clasifica el dato biométrico como
-- SENSIBLE, con consentimiento específico. Sin este registro, cada enrolamiento
-- ya hecho es un tratamiento sin base de licitud.
--
-- QUÉ SE GUARDA Y POR QUÉ ASÍ:
--
--  · `consent_text` COMPLETO, no una referencia al archivo del código. Si sólo
--    se guardara la versión, cambiar la redacción mañana dejaría sin sustento a
--    todos los consentimientos viejos: no habría forma de reconstruir qué leyó
--    exactamente esa persona ese día. El texto pesa ~2 KB; la duda no tiene
--    precio.
--
--  · `subject_name` / `subject_rut` / `subject_email` DENORMALIZADOS. En el alta
--    de un trabajador nuevo por QR, él acepta en su teléfono ANTES de que exista
--    su fila en `profiles`: en ese instante no hay `user_id` al que apuntar. El
--    `user_id` se vincula después, cuando el perfil se crea.
--
--  · `user_id` es ON DELETE SET NULL, no CASCADE. Borrar a un trabajador no
--    puede borrar la prueba de que autorizó — es justamente el documento que se
--    necesita si alguien reclama después de irse.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.biometric_consents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid,
  user_id          uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Token de la sesión de QR: es lo único que conecta el consentimiento firmado
  -- en el teléfono con el perfil que se crea después en el computador.
  enrollment_token text,
  subject_name     text,
  subject_rut      text,
  subject_email    text,
  consent_version  text NOT NULL,
  consent_text     text NOT NULL,
  -- Dónde lo aceptó: en su propio teléfono, o en el computador del administrador
  -- con el trabajador presente.
  channel          text NOT NULL CHECK (channel IN ('mobile_qr', 'desktop')),
  accepted_at      timestamptz NOT NULL DEFAULT now(),
  ip               text,
  user_agent       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_biometric_consents_user   ON public.biometric_consents (user_id);
CREATE INDEX IF NOT EXISTS idx_biometric_consents_tenant ON public.biometric_consents (tenant_id);
CREATE INDEX IF NOT EXISTS idx_biometric_consents_token  ON public.biometric_consents (enrollment_token);

COMMENT ON TABLE public.biometric_consents IS
  'Constancia de que el trabajador leyó y aceptó el tratamiento de sus datos biométricos (Ley 19.628 / Ley 21.719). Se escribe sólo desde las rutas de servidor del enrolamiento. Es prueba de cumplimiento: no se edita ni se borra.';

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Lectura para el tenant (que un administrador pueda ver "aceptó el 8 de
-- septiembre" es el punto de tener esto). Escritura sólo por service role: la
-- constancia la levanta el servidor en el mismo acto del enrolamiento, nunca el
-- navegador — si el cliente pudiera insertar, podría fabricar consentimientos.
ALTER TABLE public.biometric_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS biometric_consents_select_tenant ON public.biometric_consents;
CREATE POLICY biometric_consents_select_tenant ON public.biometric_consents
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id());

REVOKE ALL ON public.biometric_consents FROM authenticated;
REVOKE ALL ON public.biometric_consents FROM anon;
GRANT SELECT ON public.biometric_consents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.biometric_consents TO service_role;

NOTIFY pgrst, 'reload schema';
