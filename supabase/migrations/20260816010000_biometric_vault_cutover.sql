-- =============================================================================
-- Bóveda de templates biométricos — PARTE 2 de 2 (EL CORTE)
--
-- ⚠️ APLICAR DESPUÉS DE DESPLEGAR EL CÓDIGO QUE ACOMPAÑA A ESTA MIGRACIÓN.
--
-- La parte 1 (`20260816000000_biometric_vault.sql`) es aditiva y convive con el
-- código viejo. Ésta cierra las dos puertas y es la que rompería la versión
-- anterior de la app:
--
--   1. `profiles.biometric_template` — DROP. Mientras exista, la policy
--      `profiles_select_tenant` la entrega a cualquier miembro del tenant, que
--      es el problema que todo este trabajo viene a cerrar.
--
--   2. `enrollment_sessions` — se cierra a `authenticated`. Es la segunda puerta
--      al mismo dato, y el backlog no la tenía anotada: esa tabla guarda
--      `biometric_template` Y `kyc_id_front` / `kyc_id_back`, o sea FOTOS DE LA
--      CÉDULA, y está en la lista de tablas con el patrón tenant estándar
--      (20260612000001, línea 58) — misma exposición exacta que profiles.
--      El asistente de enrolamiento pasa a crearla y consultarla por
--      `/api/enroll/session`, que devuelve sólo el `status`.
--
-- Si algo saliera mal, lo reversible es el despliegue; los datos NO se pierden:
-- viven completos en `biometric_templates` desde la parte 1.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

-- ── Último espejo antes de soltar la columna ─────────────────────────────────
-- Recoge cualquier enrolamiento hecho por el código viejo entre la parte 1 y el
-- despliegue. Sin esto, un enrolamiento de esa ventana se iría con el DROP y
-- habría que citar al trabajador para volver a tomarle la cara.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name = 'biometric_template'
  ) THEN
    INSERT INTO public.biometric_templates (user_id, tenant_id, template, enrolled_by, enrolled_at, updated_at)
    SELECT p.id, p.tenant_id, p.biometric_template, p.enrolled_by, p.enrolled_at, now()
      FROM public.profiles p
     WHERE p.biometric_template IS NOT NULL
    ON CONFLICT (user_id) DO UPDATE
      SET template   = EXCLUDED.template,
          updated_at = now();
  END IF;
END $$;

-- Guard: no se suelta la columna sin que TODOS sus templates estén en la bóveda.
DO $$
DECLARE huerfanos int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name = 'biometric_template'
  ) THEN
    RAISE NOTICE 'profiles.biometric_template ya no existe: el corte ya estaba hecho.';
    RETURN;
  END IF;

  SELECT count(*) INTO huerfanos
    FROM public.profiles p
   WHERE p.biometric_template IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.biometric_templates bt WHERE bt.user_id = p.id);

  IF huerfanos > 0 THEN
    RAISE EXCEPTION
      'Corte abortado: % perfiles tienen template en profiles y NO en la bóveda. Revisar antes de soltar la columna.',
      huerfanos;
  END IF;
END $$;

-- ── Se retira el puente y se suelta la columna ───────────────────────────────
DROP TRIGGER IF EXISTS trg_mirror_biometric_template ON public.profiles;
DROP FUNCTION IF EXISTS public.mirror_biometric_template();

ALTER TABLE public.profiles DROP COLUMN IF EXISTS biometric_template;

-- ── Segunda puerta: enrollment_sessions ──────────────────────────────────────
-- Se le quita el acceso a `authenticated` en vez de tocar sus columnas: mismo
-- razonamiento que con profiles, los permisos por columna son una mina para
-- cualquier ALTER TABLE futuro. La tabla la escriben y leen sólo las rutas de
-- servidor (`/api/enroll/*`), que corren con service role.
DO $$
DECLARE pol record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'enrollment_sessions'
  ) THEN
    RAISE NOTICE 'enrollment_sessions no existe en esta base; se omite.';
    RETURN;
  END IF;

  FOR pol IN
    SELECT policyname FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'enrollment_sessions'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.enrollment_sessions', pol.policyname);
  END LOOP;

  EXECUTE 'ALTER TABLE public.enrollment_sessions ENABLE ROW LEVEL SECURITY';
  EXECUTE 'REVOKE ALL ON public.enrollment_sessions FROM authenticated';
  EXECUTE 'REVOKE ALL ON public.enrollment_sessions FROM anon';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.enrollment_sessions TO service_role';
END $$;

COMMENT ON TABLE public.enrollment_sessions IS
  'Sesiones de enrolamiento por QR. Contiene descriptor facial y fotos de cédula: cerrada a `authenticated`, se opera sólo desde /api/enroll/*. El asistente consulta el estado por /api/enroll/session.';

-- ── Verificación en la misma migración ───────────────────────────────────────
DO $$
DECLARE tiene_columna boolean; privilegios int;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name = 'biometric_template'
  ) INTO tiene_columna;

  IF tiene_columna THEN
    RAISE EXCEPTION 'El corte no se completó: profiles.biometric_template sigue existiendo.';
  END IF;

  SELECT count(*) INTO privilegios
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name IN ('biometric_templates', 'enrollment_sessions')
     AND grantee IN ('authenticated', 'anon');

  IF privilegios > 0 THEN
    RAISE EXCEPTION
      'El corte no se completó: quedan % privilegios de authenticated/anon sobre las tablas biométricas.',
      privilegios;
  END IF;

  RAISE NOTICE 'Corte biométrico completo: la columna se soltó y ninguna de las dos tablas es legible por authenticated.';
END $$;

NOTIFY pgrst, 'reload schema';
