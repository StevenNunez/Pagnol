-- ════════════════════════════════════════════════════════════════════════════
-- Charlas diarias: firma de asistencia con evidencia
--
-- Hasta hoy la firma de un asistente era un `signed: true` dentro del JSON
-- `daily_talks.asistentes`, escrito por el propio navegador del trabajador:
--   · sólo podía firmar quien tuviera cuenta y sesión (los operadores no);
--   · cualquiera con sesión podía marcar a OTRO como firmado editando el JSON;
--   · no quedaba cómo, desde dónde ni con qué firma.
--
-- Ahora cada firma (y cada ausencia) es un HECHO append-only con su evidencia.
-- El estado de un asistente se DERIVA de estos hechos (firmado / ausente /
-- pendiente); el JSON `asistentes` queda como la lista de convocados.
--
-- Los hechos los escribe sólo el servidor (service role): la ruta decide si quien
-- firma es quien dice ser (sesión propia, rostro verificado en el servidor, o
-- firma manuscrita tomada por el responsable de la charla). Nadie inserta a mano.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.daily_talk_signatures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  talk_id         uuid NOT NULL REFERENCES public.daily_talks(id) ON DELETE CASCADE,
  worker_id       uuid NOT NULL REFERENCES public.profiles(id),
  -- Copias del día: si el perfil cambia, el registro conserva lo que valía.
  worker_name     text NOT NULL,
  worker_rut      text,
  status          text NOT NULL CHECK (status IN ('signed', 'absent')),
  -- Cómo se acreditó quién firmaba:
  --   own_session → el propio trabajador, desde su sesión;
  --   face        → en un equipo compartido, con verificación facial hecha en el servidor;
  --   handwritten → en un equipo compartido, firma manuscrita tomada por el responsable.
  method          text CHECK (method IN ('own_session', 'face', 'handwritten')),
  -- Asistir y haber COMPRENDIDO son cosas distintas: esto sólo es verdadero si el
  -- trabajador lo confirmó expresamente.
  acknowledged    boolean NOT NULL DEFAULT false,
  signature       text,
  recorded_by      uuid NOT NULL REFERENCES public.profiles(id),
  recorded_by_name text NOT NULL,
  -- user agent, IP, distancia facial redondeada…: lo que permite revisar después.
  evidence        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Huella del contenido de la charla al firmar: si el texto cambia después, se nota.
  content_hash    text,
  note            text,
  signed_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_talk_signatures_method_required
    CHECK (status = 'absent' OR method IS NOT NULL),
  CONSTRAINT daily_talk_signatures_handwritten_needs_ink
    CHECK (method IS DISTINCT FROM 'handwritten' OR (signature IS NOT NULL AND length(signature) > 0)),
  -- Una firma y una ausencia por persona y charla (quien faltó y llegó tarde firma después).
  CONSTRAINT daily_talk_signatures_one_per_status UNIQUE (talk_id, worker_id, status)
);

CREATE INDEX IF NOT EXISTS idx_daily_talk_signatures_talk
  ON public.daily_talk_signatures (talk_id);
CREATE INDEX IF NOT EXISTS idx_daily_talk_signatures_tenant
  ON public.daily_talk_signatures (tenant_id, signed_at DESC);

ALTER TABLE public.daily_talk_signatures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_talk_signatures_select" ON public.daily_talk_signatures;
CREATE POLICY "daily_talk_signatures_select" ON public.daily_talk_signatures
  FOR SELECT USING (
    public.is_super_admin() OR tenant_id = public.get_my_tenant_id()
  );

GRANT SELECT ON public.daily_talk_signatures TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.daily_talk_signatures FROM authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'daily_talk_signatures'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_talk_signatures;
  END IF;
END $$;

-- ── Nadie marca como firmado a otro editando el JSON ─────────────────────────
-- El JSON `asistentes` ya no es la fuente de la firma, pero seguía siendo
-- editable por cualquier miembro de la empresa. Desde un cliente (auth.uid() no
-- nulo) ningún asistente puede pasar a `signed: true`, ni nacer así. El servidor
-- (service role, auth.uid() nulo) no se toca. Las firmas viejas ya escritas
-- quedan como están: se leen como «firma anterior».
CREATE OR REPLACE FUNCTION public.daily_talks_guard_signed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.asistentes) = 'array' AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.asistentes) n
    WHERE COALESCE((n->>'signed')::boolean, false)
      AND (
        TG_OP = 'INSERT'
        OR NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(OLD.asistentes, '[]'::jsonb)) o
          WHERE o->>'id' = n->>'id' AND COALESCE((o->>'signed')::boolean, false)
        )
      )
  ) THEN
    RAISE EXCEPTION 'La firma de asistencia se registra desde la charla, no editando la lista.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_daily_talks_guard_signed ON public.daily_talks;
CREATE TRIGGER trg_daily_talks_guard_signed
  BEFORE INSERT OR UPDATE OF asistentes ON public.daily_talks
  FOR EACH ROW
  EXECUTE FUNCTION public.daily_talks_guard_signed();

NOTIFY pgrst, 'reload schema';
