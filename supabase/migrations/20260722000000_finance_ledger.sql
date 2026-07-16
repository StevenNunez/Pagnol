-- =============================================================================
-- Dominio Financiero F0 (RFC-002 / Plan F0): ledger de hechos económicos
--
-- Núcleo del dominio "Resultado por Contrato". Una sola tabla de hechos
-- (finance_entries) alimentada por emisores explícitos dentro de las mutaciones
-- existentes (patrón stockLedger elevado a dinero).
--
-- Rige la Constitución del ARCHITECTURAL_MANIFESTO v2.0:
--   Art. 2 (hechos inmutables): SIN política ni GRANT de UPDATE/DELETE — para
--           nadie, ni admin. Las correcciones son hechos nuevos de reverso
--           (finance_reverse_source), jamás ediciones.
--   Art. 5 (todo hecho tiene autor): created_by/created_by_name obligatorios
--           en la práctica (los pone el emisor).
--
-- Convención de dinero (RFC-002-F0-Plan): amount_net = NETO en CLP congelado al
-- momento del hecho; currency/amount_original/fx_rate preservan el origen.
-- Los reversos se emiten en CLP (currency 'CLP', fx_rate 1).
--
-- NO se agrega a la publicación Realtime ni al DataProvider: los dashboards
-- consumen la RPC de agregación server-side (primera ruptura deliberada del
-- patrón useSupabaseCollection, decidida en RFC-002).
-- =============================================================================

-- ── 1. Visibilidad financiera: solo administración del tenant ────────────────
-- Decisión F0: el panel nace cerrado (administrador / soporte-pagnol). NO se usa
-- is_tenant_admin() porque ese helper incluye director-faena.
CREATE OR REPLACE FUNCTION public.is_finance_viewer()
RETURNS boolean AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('super-admin', 'administrador', 'soporte-pagnol')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;
ALTER FUNCTION public.is_finance_viewer() SET search_path = public, extensions;

-- ── 2. Tabla de hechos ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.finance_entries (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    entry_date        date NOT NULL DEFAULT CURRENT_DATE,   -- fecha contable del hecho
    nature            text NOT NULL CHECK (nature IN ('cost', 'income')),
    stage             text NOT NULL CHECK (stage IN ('committed', 'accrued', 'paid')),
    category          text NOT NULL CHECK (category IN
                        ('materials', 'labor', 'equipment', 'subcontract', 'rental', 'services', 'indirect')),
    -- Dinero (neto CLP congelado + origen)
    amount_net        numeric NOT NULL,                     -- negativo = reverso
    currency          text    NOT NULL DEFAULT 'CLP',
    amount_original   numeric NOT NULL,
    fx_rate           numeric NOT NULL DEFAULT 1,           -- valor UF/USD del día del hecho
    tax_rate          numeric,                              -- % IVA del documento (informativo)
    -- Dimensiones (planas — RFC-002: sin árbol multinivel)
    contract_id       uuid REFERENCES public.contracts(id) ON DELETE SET NULL,
    contract_name     text,                                 -- snapshot: sobrevive al contrato
    work_item_id      uuid,                                 -- partida (F3)
    cost_center_id    uuid,                                 -- gasto administrativo (opcional)
    -- Documento origen: texto sin FK — el documento puede borrarse, el hecho no.
    source_type       text NOT NULL,                        -- 'purchase_order' | 'goods_receipt' | 'supplier_payment' | ...
    source_id         text NOT NULL,
    source_code       text,                                 -- código legible (OC-042, REC-0007…)
    -- Contraparte
    counterparty_type text,                                 -- 'supplier' | 'worker' | 'asset'
    counterparty_id   text,
    counterparty_name text,
    -- Correcciones (Art. 2): un reverso apunta al hecho que anula
    reversal_of       uuid REFERENCES public.finance_entries(id),
    notes             text,
    -- Autoría (Art. 5)
    created_by        uuid,
    created_by_name   text,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finance_entries_tenant_contract ON public.finance_entries(tenant_id, contract_id);
CREATE INDEX IF NOT EXISTS idx_finance_entries_tenant_date     ON public.finance_entries(tenant_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_finance_entries_source          ON public.finance_entries(tenant_id, source_type, source_id);

ALTER TABLE public.finance_entries ENABLE ROW LEVEL SECURITY;

-- SELECT: solo visores financieros del tenant (los costos de MO en F1 revelarán
-- sueldos — esta tabla nunca se abre a todo el tenant). Super-admin ve todo.
DROP POLICY IF EXISTS "finance_entries_select" ON public.finance_entries;
CREATE POLICY "finance_entries_select" ON public.finance_entries FOR SELECT TO authenticated
USING (public.is_super_admin() OR (tenant_id = public.get_my_tenant_id() AND public.is_finance_viewer()));

-- INSERT: cualquier miembro del tenant (sus acciones operativas generan hechos:
-- el pañolero que recibe, abastecimiento que emite una OC…). El OR de super-admin
-- sigue el patrón del resto de tablas: sin él, un super-admin operando en un
-- tenant conmutado no podría emitir hechos (y por tanto no podría crear OCs).
DROP POLICY IF EXISTS "finance_entries_insert" ON public.finance_entries;
CREATE POLICY "finance_entries_insert" ON public.finance_entries FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin() OR tenant_id = public.get_my_tenant_id());

-- Art. 2: sin políticas de UPDATE/DELETE, y el GRANT tampoco los incluye
-- (defensa en profundidad: ni siquiera con una política futura por accidente).
GRANT SELECT, INSERT ON public.finance_entries TO authenticated;

-- ── 3. Reverso por documento origen (SECURITY DEFINER) ───────────────────────
-- Los usuarios operativos pueden provocar reversos (cancelar una OC) pero NO
-- pueden leer finance_entries (RLS de arriba). Esta función salta esa asimetría:
-- lee con privilegios del dueño, pero SOLO dentro del tenant del solicitante y
-- SOLO para insertar espejos negativos. Idempotente: si el documento ya está
-- neteado en 0, no emite nada.
CREATE OR REPLACE FUNCTION public.finance_reverse_source(
    p_source_type text,
    p_source_id   text,
    p_reason      text,
    p_tenant      uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  -- p_tenant solo se honra para super-admin (tenant conmutado); cualquier otro
  -- usuario queda clavado a su propio tenant aunque intente pasar otro.
  v_tenant uuid := CASE
      WHEN public.is_super_admin() AND p_tenant IS NOT NULL THEN p_tenant
      ELSE public.get_my_tenant_id()
  END;
  v_name   text;
  v_count  integer;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Sin tenant.';
  END IF;
  SELECT name INTO v_name FROM public.profiles WHERE id = auth.uid();

  WITH live AS (
    SELECT nature, stage, category, contract_id, contract_name, tax_rate,
           counterparty_type, counterparty_id, counterparty_name,
           MAX(source_code) AS source_code,
           SUM(amount_net)  AS net,
           MIN(id::text)::uuid AS first_id
    FROM public.finance_entries
    WHERE tenant_id = v_tenant
      AND source_type = p_source_type
      AND source_id   = p_source_id
    GROUP BY nature, stage, category, contract_id, contract_name, tax_rate,
             counterparty_type, counterparty_id, counterparty_name
    HAVING SUM(amount_net) <> 0
  )
  INSERT INTO public.finance_entries (
    tenant_id, entry_date, nature, stage, category,
    amount_net, currency, amount_original, fx_rate, tax_rate,
    contract_id, contract_name, source_type, source_id, source_code,
    counterparty_type, counterparty_id, counterparty_name,
    reversal_of, notes, created_by, created_by_name
  )
  SELECT v_tenant, CURRENT_DATE, nature, stage, category,
         -net, 'CLP', -net, 1, tax_rate,
         contract_id, contract_name, p_source_type, p_source_id, source_code,
         counterparty_type, counterparty_id, counterparty_name,
         first_id, p_reason, auth.uid(), v_name
  FROM live;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.finance_reverse_source(text, text, text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.finance_reverse_source(text, text, text, uuid) TO authenticated;

-- ── 4. Agregación server-side por contrato ────────────────────────────────────
-- SECURITY INVOKER: hereda el RLS de finance_entries (quien no es visor
-- financiero recibe cero filas). p_tenant solo tiene efecto real para
-- super-admin (tenant switch); para el resto el RLS acota igual.
CREATE OR REPLACE FUNCTION public.finance_contract_summary(
    p_from   date,
    p_to     date,
    p_tenant uuid DEFAULT NULL
) RETURNS TABLE (
    contract_id   uuid,
    contract_name text,
    nature        text,
    stage         text,
    category      text,
    total_net     numeric,
    entry_count   bigint
)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT fe.contract_id,
         COALESCE(MAX(c.name), MAX(fe.contract_name)) AS contract_name,
         fe.nature,
         fe.stage,
         fe.category,
         SUM(fe.amount_net) AS total_net,
         COUNT(*)           AS entry_count
  FROM public.finance_entries fe
  LEFT JOIN public.contracts c ON c.id = fe.contract_id
  WHERE fe.entry_date >= p_from
    AND fe.entry_date <= p_to
    AND fe.tenant_id = COALESCE(p_tenant, public.get_my_tenant_id())
  GROUP BY fe.contract_id, fe.nature, fe.stage, fe.category;
$$;
GRANT EXECUTE ON FUNCTION public.finance_contract_summary(date, date, uuid) TO authenticated;

-- ── 5. Valor UF diario (global, sin tenant) ───────────────────────────────────
-- Escrito SOLO por el cron (service role bypasea RLS); lectura para cualquier
-- usuario autenticado. Sin política de INSERT/UPDATE para authenticated: un
-- admin de tenant no puede alterar un valor que afecta a todos los tenants.
CREATE TABLE IF NOT EXISTS public.uf_rates (
    rate_date  date PRIMARY KEY,
    value      numeric NOT NULL,
    source     text NOT NULL DEFAULT 'mindicador.cl',
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.uf_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "uf_rates_select" ON public.uf_rates;
CREATE POLICY "uf_rates_select" ON public.uf_rates FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.uf_rates TO authenticated;

-- ── 6. Columnas aditivas ──────────────────────────────────────────────────────
-- Factor costo-empresa sobre baseSalary (leyes sociales, gratificación…).
-- Lo consume F1 (costo MO); el campo y su UI de Configuración nacen en F0.
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS labor_cost_factor numeric NOT NULL DEFAULT 1.35;

-- Encadena OC → pago (hoy solo existe el string purchase_order_number).
-- text (no uuid): purchase_orders.id admite códigos generados tipo 'PAG-PUR-0007'.
-- Sin FK: una OC cancelada/histórica no debe impedir registrar su factura.
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS purchase_order_id text;

NOTIFY pgrst, 'reload schema';
