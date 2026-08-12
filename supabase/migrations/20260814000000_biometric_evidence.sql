-- =============================================================================
-- Evidencia biométrica y excepciones autorizadas
--
-- PROBLEMA (auditoría del 2026-08-11): la verificación facial es la forma de
-- aceptar la recepción de un activo, pero NO dejaba ningún rastro. Al cerrar una
-- entrega sólo se guardaba fecha, PDF, quién entregó y quién recibió — ni la
-- distancia obtenida, ni la hora de la verificación, ni una imagen del momento,
-- ni siquiera un indicador de que hubo biometría (el mismo campo se usaba para
-- QR). Ante un reclamo ("yo nunca recibí eso") lo único exhibible era un PDF con
-- la firma PRE-GUARDADA del trabajador. La biometría era un portón en la
-- pantalla, no evidencia.
--
-- Y al revés: como el sistema exige biometría en los tres caminos de
-- identificación y NO existía vía de excepción, una cámara mojada o un
-- trabajador recién ingresado dejaban la faena detenida — el incentivo perfecto
-- para entregar la herramienta por fuera del sistema, que es peor que una
-- excepción registrada.
--
-- DISEÑO: una sola tabla APPEND-ONLY de hechos (Artículo 2 del manifiesto). Cada
-- fila es algo que ocurrió y no se edita ni se borra. El estado de una excepción
-- NO se guarda como campo mutable: se DERIVA encadenando hechos por
-- `exception_group_id` (solicitada → aprobada/rechazada), igual que el ledger
-- financiero deriva el saldo de sus asientos.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.biometric_verifications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,

  -- A quién se verificó. El nombre va en snapshot: si mañana cambia en su
  -- perfil, la evidencia debe seguir diciendo lo que decía el día del hecho.
  subject_user_id       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  subject_name          text NOT NULL,

  -- Quién operaba el pañol en ese momento.
  operator_user_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  operator_name         text NOT NULL,

  -- En qué punto del flujo: al identificar al trabajador, o al cerrar la
  -- recepción (que es el que constituye la aceptación del activo).
  stage                 text NOT NULL CHECK (stage IN ('identificacion', 'recepcion')),

  -- Contexto de la operación, para poder ir del activo a su evidencia.
  request_id            uuid,
  transaction_code      text,

  -- Resultado del acto.
  --   match / no_match / no_face / error  → verificación biométrica real
  --   exception_requested / _granted / _denied → vía de excepción autorizada
  outcome               text NOT NULL CHECK (outcome IN (
                          'match', 'no_match', 'no_face', 'error',
                          'exception_requested', 'exception_granted', 'exception_denied'
                        )),

  -- La distancia obtenida y el umbral VIGENTE ESE DÍA. Guardar el umbral es
  -- clave: si mañana se recalibra, una evidencia vieja sin él sería
  -- ininterpretable ("0,48" no dice nada sin saber contra qué se comparó).
  distance              numeric(6,4),
  threshold             numeric(6,4),

  -- Path (no URL) del frame capturado en el bucket privado: las URLs firmadas
  -- expiran, así que persistir una la dejaría muerta en minutos.
  evidence_path         text,

  -- ── Excepción ────────────────────────────────────────────────────────────
  -- Encadena los hechos de una misma excepción (solicitud y resolución).
  exception_group_id    uuid,
  exception_reason      text,
  authorized_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  authorized_by_name    text,
  -- 'presencial' = el ADC/Admin se autenticó en el pañol, en el momento.
  -- 'remota'     = lo aprobó desde la bandeja de Autorizaciones.
  authorized_mode       text CHECK (authorized_mode IN ('presencial', 'remota')),

  created_at            timestamptz NOT NULL DEFAULT now(),

  -- Una excepción tiene que decir POR QUÉ. Sin motivo no hay auditoría posible,
  -- y es la única defensa contra que la excepción se vuelva la norma.
  CONSTRAINT biometric_exception_needs_reason CHECK (
    outcome <> 'exception_requested'
    OR (exception_reason IS NOT NULL AND length(btrim(exception_reason)) >= 10)
  ),
  -- Toda resolución pertenece a una solicitud y tiene autor.
  CONSTRAINT biometric_resolution_needs_author CHECK (
    outcome NOT IN ('exception_granted', 'exception_denied')
    OR (exception_group_id IS NOT NULL AND authorized_by_user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_biometric_verifications_tenant
  ON public.biometric_verifications (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_biometric_verifications_request
  ON public.biometric_verifications (request_id);
CREATE INDEX IF NOT EXISTS idx_biometric_verifications_exception
  ON public.biometric_verifications (exception_group_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.biometric_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "biometric_verifications_select" ON public.biometric_verifications;
CREATE POLICY "biometric_verifications_select" ON public.biometric_verifications
  FOR SELECT USING (
    public.is_super_admin() OR tenant_id = public.get_my_tenant_id()
  );

-- Sólo se INSERTA, dentro del propio tenant. Sin UPDATE ni DELETE: la evidencia
-- que se puede editar no es evidencia. Un error se corrige agregando un hecho
-- nuevo, nunca reescribiendo el anterior.
DROP POLICY IF EXISTS "biometric_verifications_insert" ON public.biometric_verifications;
CREATE POLICY "biometric_verifications_insert" ON public.biometric_verifications
  FOR INSERT WITH CHECK (
    tenant_id = public.get_my_tenant_id()
  );

GRANT SELECT, INSERT ON public.biometric_verifications TO authenticated;
REVOKE UPDATE, DELETE ON public.biometric_verifications FROM authenticated;

-- Realtime: la bandeja de Autorizaciones tiene que ver la excepción apenas el
-- pañolero la pide, sin recargar.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'biometric_verifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.biometric_verifications;
  END IF;
END $$;

-- ── Marca en la entrega ──────────────────────────────────────────────────────
-- Redundante con la tabla de hechos a propósito: quien lista entregas necesita
-- ver "salió sin biometría" sin cruzar nada, y el PDF lo imprime desde aquí.
ALTER TABLE public.material_requests
  ADD COLUMN IF NOT EXISTS delivery_verification text
    CHECK (delivery_verification IS NULL
           OR delivery_verification IN ('biometric', 'exception'));
ALTER TABLE public.material_requests
  ADD COLUMN IF NOT EXISTS delivery_exception_id uuid;
