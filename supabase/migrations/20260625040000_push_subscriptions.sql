-- =============================================================================
-- Tabla push_subscriptions (Web Push / VAPID)
--
-- El RLS consolidado (20260612000001) solo aplicaba políticas a esta tabla
-- "IF EXISTS", pero NINGUNA migración la creaba — en proyectos nuevos no existe,
-- así que /api/push/subscribe fallaba con 500 (relation does not exist) y el
-- cliente lo ignoraba (creía estar suscrito). Aquí se crea idempotente.
--
-- Las rutas /api/push/subscribe y /api/push/send usan el admin client (service
-- role, bypass RLS); igual dejamos RLS "own" + GRANT por buenas prácticas.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  tenant_id  uuid NOT NULL,
  endpoint   text NOT NULL,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- onConflict: 'endpoint' en el upsert ⇒ el endpoint debe ser único.
CREATE UNIQUE INDEX IF NOT EXISTS uq_push_subscriptions_endpoint
  ON public.push_subscriptions(endpoint);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_tenant_user
  ON public.push_subscriptions(tenant_id, user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'push_subscriptions'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.push_subscriptions', pol.policyname);
  END LOOP;

  EXECUTE $f$
    CREATE POLICY push_subscriptions_own ON public.push_subscriptions
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id)
  $f$;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
