-- =============================================================================
-- Borrado de datos biométricos: al desvincular de la empresa y al revocar
--
-- POR QUÉ: el texto del consentimiento (biometric-consent.ts) le dice al
-- trabajador que sus datos biométricos se eliminan al terminar el vínculo o si
-- retira la autorización. Hasta hoy NADA lo hacía: `separate_worker` no tocaba
-- la bóveda, `deleteUser` es un borrado suave (el ON DELETE CASCADE nunca se
-- dispara) y no existía la revocación. Prometer un borrado que no ocurre es
-- peor que no prometerlo (Ley 21.719, vigente desde dic-2026).
--
-- QUÉ SE BORRA (los datos que sólo sirven para RECONOCER a la persona):
--   · biometric_templates   → la plantilla facial (el trigger baja
--                             profiles.biometric_enrolled solo)
--   · profile_documents     → selfie y fotos de la cédula
--   · enrollment_sessions   → copias intermedias de un enrolamiento por QR
--                             que nunca se consumió
--
-- QUÉ NO SE BORRA, a propósito:
--   · biometric_consents    → es la PRUEBA de que autorizó (user_id ya es SET NULL)
--   · biometric_verifications / evidencia de entregas pasadas → cuánto tiempo se
--     conserva es una decisión legal pendiente, NO se toca acá.
--
-- QUÉ QUEDA ESCRITO: `biometric_erasures`, un hecho append-only (quién, cuándo,
-- por qué, qué había). Es la prueba de que el borrado ocurrió.
--
-- CUÁNDO SE DISPARA:
--   · automático: desvinculación de la EMPRESA sin equipos pendientes (trigger
--     sobre worker_separations — así no se reemplaza `separate_worker`).
--     Con equipos pendientes NO se borra sola: devolver una herramienta necesita
--     poder identificar a la persona. Queda visible en Desvinculaciones con un
--     botón «Borrar ahora».
--   · manual: `erase_biometric_data()` — revocación del consentimiento, o el
--     borrado diferido de arriba. Lo puede pedir RR.HH. o la propia persona.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.biometric_erasures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid,
  -- SET NULL, no CASCADE: el rastro del borrado debe sobrevivir a la persona.
  user_id         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Copias del día del hecho (si el perfil cambia o desaparece, el registro conserva lo que valía).
  subject_name    text,
  subject_rut     text,
  reason          text NOT NULL CHECK (reason IN ('separation', 'revocation')),
  had_template    boolean NOT NULL DEFAULT false,
  had_documents   boolean NOT NULL DEFAULT false,
  had_sessions    boolean NOT NULL DEFAULT false,
  separation_id   uuid,
  performed_by    uuid,
  performed_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_biometric_erasures_user   ON public.biometric_erasures (user_id);
CREATE INDEX IF NOT EXISTS idx_biometric_erasures_tenant ON public.biometric_erasures (tenant_id, created_at DESC);

COMMENT ON TABLE public.biometric_erasures IS
  'Constancia de que se borraron los datos biométricos de una persona (Ley 21.719). Hecho append-only: se escribe sólo desde las funciones de borrado.';

ALTER TABLE public.biometric_erasures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS biometric_erasures_select ON public.biometric_erasures;
CREATE POLICY biometric_erasures_select ON public.biometric_erasures
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (tenant_id = public.get_my_tenant_id() AND public.can_manage_hr())
  );

REVOKE ALL ON public.biometric_erasures FROM authenticated;
REVOKE ALL ON public.biometric_erasures FROM anon;
GRANT SELECT ON public.biometric_erasures TO authenticated;
GRANT SELECT, INSERT ON public.biometric_erasures TO service_role;

-- ── El borrado en sí (interno: no se expone) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public._erase_biometric_core(
  p_worker      uuid,
  p_reason      text,
  p_by          uuid,
  p_by_name     text,
  p_separation  uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  w            record;
  v_template   boolean := false;
  v_documents  boolean := false;
  v_sessions   boolean := false;
  v_n          int;
BEGIN
  SELECT id, name, rut, tenant_id INTO w FROM public.profiles WHERE id = p_worker;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró a la persona.' USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.biometric_templates WHERE user_id = p_worker;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_template := v_n > 0;

  DELETE FROM public.profile_documents WHERE profile_id = p_worker;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_documents := v_n > 0;

  -- Enrolamientos por QR que nunca se consumieron todavía guardan plantilla y fotos.
  UPDATE public.enrollment_sessions
     SET biometric_template = NULL, kyc_face_image = NULL, kyc_id_front = NULL, kyc_id_back = NULL
   WHERE user_id = p_worker
     AND (biometric_template IS NOT NULL OR kyc_face_image IS NOT NULL
          OR kyc_id_front IS NOT NULL OR kyc_id_back IS NOT NULL);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_sessions := v_n > 0;

  -- Que `enrolled_at` siga diciendo «enrolado el…» sin plantilla confunde.
  UPDATE public.profiles SET enrolled_by = NULL, enrolled_at = NULL WHERE id = p_worker;

  INSERT INTO public.biometric_erasures (
    tenant_id, user_id, subject_name, subject_rut, reason,
    had_template, had_documents, had_sessions, separation_id, performed_by, performed_by_name
  ) VALUES (
    w.tenant_id, w.id, w.name, w.rut, p_reason,
    v_template, v_documents, v_sessions, p_separation, p_by, p_by_name
  );

  RETURN jsonb_build_object('template', v_template, 'documents', v_documents, 'sessions', v_sessions);
END;
$$;

REVOKE ALL ON FUNCTION public._erase_biometric_core(uuid, text, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._erase_biometric_core(uuid, text, uuid, text, uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public._erase_biometric_core(uuid, text, uuid, text, uuid) FROM anon;

-- ── Borrado manual: revocación o borrado diferido ────────────────────────────
CREATE OR REPLACE FUNCTION public.erase_biometric_data(
  p_worker uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_me     uuid := auth.uid();
  v_actor  record;
  w        record;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  IF p_reason NOT IN ('separation', 'revocation') THEN
    RAISE EXCEPTION 'Motivo de borrado no válido.';
  END IF;

  SELECT id, name, tenant_id INTO v_actor FROM public.profiles WHERE id = v_me;
  SELECT id, tenant_id, employment_status INTO w FROM public.profiles WHERE id = p_worker;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró a la persona.' USING ERRCODE = 'P0002';
  END IF;

  -- Cada persona puede retirar SU propia autorización; el resto, sólo quien gestiona RR.HH. de su empresa.
  IF v_me IS DISTINCT FROM p_worker THEN
    IF NOT public.can_manage_hr()
       OR (w.tenant_id IS DISTINCT FROM v_actor.tenant_id AND NOT public.is_super_admin()) THEN
      RAISE EXCEPTION 'No autorizado: no puedes borrar datos biométricos de esta persona.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- «Separación» sólo tiene sentido para quien de verdad salió de la empresa.
  IF p_reason = 'separation' AND w.employment_status IS DISTINCT FROM 'terminated' THEN
    RAISE EXCEPTION 'Esta persona no está desvinculada de la empresa.';
  END IF;

  RETURN public._erase_biometric_core(p_worker, p_reason, v_me, v_actor.name, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.erase_biometric_data(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.erase_biometric_data(uuid, text) TO authenticated;

-- ── Automático: desvinculación de la empresa sin equipos pendientes ──────────
CREATE OR REPLACE FUNCTION public.erase_biometric_on_separation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.kind = 'separation'
     AND NEW.scope = 'company'
     AND COALESCE(jsonb_array_length(NEW.pending_items), 0) = 0 THEN
    PERFORM public._erase_biometric_core(NEW.worker_id, 'separation', NEW.created_by, NEW.created_by_name, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_erase_biometric_on_separation ON public.worker_separations;
CREATE TRIGGER trg_erase_biometric_on_separation
  AFTER INSERT ON public.worker_separations
  FOR EACH ROW EXECUTE FUNCTION public.erase_biometric_on_separation();

NOTIFY pgrst, 'reload schema';
