-- =============================================================================
-- Bóveda de templates biométricos — PARTE 1 de 2 (ADITIVA, no rompe nada)
--
-- PROBLEMA (verificado por sondeo REST el 2026-08-12, con un token de usuario
-- normal): `GET /rest/v1/profiles?select=id,name,biometric_template` devuelve
-- 200 y entrega los descriptores faciales de TODO el tenant. La causa no es un
-- descuido de una policy: es estructural. `profiles_select_tenant` es
--
--     FOR SELECT USING (is_super_admin() OR tenant_id = get_my_tenant_id())
--
-- sin condición de rol, y la RLS de Postgres es POR FILA, no por columna. Quien
-- puede ver la fila del compañero puede ver todas sus columnas, incluida la que
-- guarda sus 128 floats faciales. Son datos sensibles bajo la Ley 21.719,
-- vigente desde diciembre de 2026.
--
-- POR QUÉ NO SE CIERRA CON PERMISOS POR COLUMNA: Postgres no sabe "denegar una
-- columna". Con un GRANT de tabla vigente hay que revocar SELECT de `profiles`
-- entera y re-otorgar columna por columna — y entonces CADA `ALTER TABLE
-- profiles ADD COLUMN` futuro nace sin permiso y rompe en silencio. `profiles`
-- es una tabla que crece (employment_status, birth_date, emergency_contact_*
-- son recientes). Sería sembrar exactamente la clase de mina que este proyecto
-- ya pisó siete veces con el drift de esquema.
--
-- DISEÑO: el dato sensible se muda a su propia tabla, donde la RLS por fila SÍ
-- alcanza — porque ahí la fila ES el template. La bóveda no tiene ninguna
-- policy para `authenticated`: nadie la lee desde el navegador, ni siquiera un
-- administrador. La comparación 1:1 y 1:N pasa a `/api/biometric/match`, que
-- corre con service role y devuelve un veredicto, nunca el template. El
-- descriptor deja de salir del servidor.
--
-- `profiles.biometric_enrolled` (booleano) reemplaza a la columna en todo lo que
-- sólo necesitaba saber "¿está enrolado?" — que es la mayoría de los usos: los
-- badges de Personal, el panel de usuario y el guard de Movimientos.
--
-- ESTA MIGRACIÓN ES ADITIVA: no borra ni revoca nada, así que el código HOY
-- DESPLEGADO sigue funcionando igual después de aplicarla. Mientras dure la
-- ventana entre aplicarla y desplegar, un trigger espeja hacia la bóveda lo que
-- el código viejo siga escribiendo en `profiles`, para que no se pierda ningún
-- enrolamiento. El corte (DROP de la columna + cierre de enrollment_sessions)
-- vive en `20260816010000_biometric_vault_cutover.sql` y se aplica DESPUÉS del
-- despliegue.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

-- ── La bóveda ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.biometric_templates (
  user_id     uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Nullable a propósito: un super-admin no tiene tenant. Toda consulta de la
  -- ruta de match filtra por `tenant_id = <tenant del llamante>`, así que una
  -- fila sin tenant es inalcanzable por construcción — falla cerrado, no abierto.
  tenant_id   uuid,
  template    text NOT NULL,
  enrolled_by text,
  enrolled_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_biometric_templates_tenant
  ON public.biometric_templates (tenant_id);

COMMENT ON TABLE public.biometric_templates IS
  'Descriptores faciales (128 floats, face-api). Dato biométrico sensible bajo Ley 21.719: NO se expone a `authenticated` por ninguna vía. Se lee sólo con service role desde /api/biometric/match, que devuelve veredicto y distancia, nunca el template.';

-- ── RLS: cerrada de las dos maneras, a propósito ─────────────────────────────
-- (1) RLS activa SIN NINGUNA POLICY = deny para todo rol que no haga bypass.
-- (2) REVOKE de los privilegios que Supabase otorga por defecto a las tablas
--     nuevas del schema public (ALTER DEFAULT PRIVILEGES).
-- Con una sola bastaría; van las dos porque el costo es cero y el modo de fallo
-- de equivocarse acá es entregar caras ajenas.
ALTER TABLE public.biometric_templates ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.biometric_templates FROM authenticated;
REVOKE ALL ON public.biometric_templates FROM anon;

-- GRANT explícito a service_role para no depender de que tenga BYPASSRLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.biometric_templates TO service_role;

-- A propósito NO se usa FORCE ROW LEVEL SECURITY: su único efecto es quitarle al
-- DUEÑO de la tabla su exención, y el dueño nunca es el atacante de este modelo
-- (la amenaza es `authenticated` vía PostgREST, ya cerrado arriba). Lo que sí
-- haría FORCE es romper la copia de datos de más abajo y los triggers SECURITY
-- DEFINER, que corren como el dueño contra una tabla sin ninguna policy.

-- NO se agrega a la publicación de Realtime: un canal de Realtime sobre esta
-- tabla sería otra puerta de salida para el mismo dato.

-- ── Copiar lo que ya está enrolado ───────────────────────────────────────────
INSERT INTO public.biometric_templates (user_id, tenant_id, template, enrolled_by, enrolled_at)
SELECT p.id, p.tenant_id, p.biometric_template, p.enrolled_by, p.enrolled_at
  FROM public.profiles p
 WHERE p.biometric_template IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

-- Guard: si la copia dejara templates atrás, la migración aborta en vez de
-- avanzar hacia un DROP que perdería enrolamientos. Un enrolamiento perdido
-- significa citar al trabajador a que le vuelvan a tomar la cara.
DO $$
DECLARE en_profiles int; en_boveda int;
BEGIN
  SELECT count(*) INTO en_profiles FROM public.profiles WHERE biometric_template IS NOT NULL;
  SELECT count(*) INTO en_boveda
    FROM public.biometric_templates bt
    JOIN public.profiles p ON p.id = bt.user_id
   WHERE p.biometric_template IS NOT NULL;

  IF en_boveda < en_profiles THEN
    RAISE EXCEPTION
      'Bóveda biométrica: % templates en profiles pero sólo % copiados. Se aborta antes de tocar nada.',
      en_profiles, en_boveda;
  END IF;

  RAISE NOTICE 'Bóveda biométrica: % templates copiados.', en_boveda;
END $$;

-- ── El booleano que reemplaza a la columna en el 90% de los usos ─────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS biometric_enrolled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.biometric_enrolled IS
  'Derivado de biometric_templates por trigger. Es lo único que la UI necesita saber: "enrolado / pendiente". El descriptor en sí vive en la bóveda y no sale del servidor.';

UPDATE public.profiles p
   SET biometric_enrolled = true
  FROM public.biometric_templates bt
 WHERE bt.user_id = p.id
   AND p.biometric_enrolled IS DISTINCT FROM true;

-- El booleano se DERIVA, no se escribe a mano: si dependiera de que cada call
-- site se acuerde de actualizarlo, quedaría desincronizado el día que alguien
-- enrole por una vía nueva — y entonces Movimientos diría "sin biometría" de
-- alguien enrolado, o al revés.
CREATE OR REPLACE FUNCTION public.sync_biometric_enrolled()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.profiles SET biometric_enrolled = false WHERE id = OLD.user_id;
    RETURN OLD;
  END IF;
  UPDATE public.profiles SET biometric_enrolled = true WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
ALTER FUNCTION public.sync_biometric_enrolled() SET search_path = public, extensions;

DROP TRIGGER IF EXISTS trg_sync_biometric_enrolled ON public.biometric_templates;
CREATE TRIGGER trg_sync_biometric_enrolled
  AFTER INSERT OR UPDATE OR DELETE ON public.biometric_templates
  FOR EACH ROW EXECUTE FUNCTION public.sync_biometric_enrolled();

-- ── Puente para la ventana entre aplicar esto y desplegar ────────────────────
-- El código hoy en producción escribe el template en `profiles`. Sin este
-- trigger, un enrolamiento hecho durante esa ventana quedaría sólo en la columna
-- vieja y se perdería en el DROP de la parte 2.
--
-- Nota sobre recursión: `sync_biometric_enrolled` actualiza `profiles` pero NO
-- menciona `biometric_template` en el SET, y este trigger es `UPDATE OF
-- biometric_template`, que dispara sólo cuando esa columna aparece en el
-- statement. No hay ciclo.
CREATE OR REPLACE FUNCTION public.mirror_biometric_template()
RETURNS trigger AS $$
BEGIN
  IF NEW.biometric_template IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.biometric_templates (user_id, tenant_id, template, enrolled_by, enrolled_at, updated_at)
  VALUES (NEW.id, NEW.tenant_id, NEW.biometric_template, NEW.enrolled_by, NEW.enrolled_at, now())
  ON CONFLICT (user_id) DO UPDATE
    SET template    = EXCLUDED.template,
        tenant_id   = EXCLUDED.tenant_id,
        enrolled_by = EXCLUDED.enrolled_by,
        enrolled_at = EXCLUDED.enrolled_at,
        updated_at  = now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
ALTER FUNCTION public.mirror_biometric_template() SET search_path = public, extensions;

DROP TRIGGER IF EXISTS trg_mirror_biometric_template ON public.profiles;
CREATE TRIGGER trg_mirror_biometric_template
  AFTER INSERT OR UPDATE OF biometric_template ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.mirror_biometric_template();

NOTIFY pgrst, 'reload schema';
