-- =============================================================================
-- Remuneraciones F1 — Fundación de datos (RFC-003)
--
-- Hoy "remuneraciones" es una calculadora: el sueldo se DIGITA a mano aunque
-- profiles.base_salary exista, `afp` es texto libre (conviven 'Habitat', ''
-- y NULL), no hay plan de Isapre, no existe el contrato laboral y los
-- parámetros legales están hardcodeados en el componente
-- (`SUELDO_MINIMO = 460000`, con un comentario que admite que debería ser
-- dinámico). Esta migración crea la materia prima para liquidar de verdad.
--
-- NO calcula nada todavía: eso es F2 (`payrollMath.ts`, puro y testeado).
--
-- Decisiones de Steven (RFC-003): dotación mixta mensual/diaria · Fonasa e
-- Isapre conviven · gratificación art. 50 · hay sueldos que gatillan impuesto
-- único (por eso entra la serie UTM).
--
-- ⚠️ VALORES SEMILLA: las tasas y topes que siembra esta migración son de
-- referencia y DEBEN verificarse contra la normativa vigente antes de emitir
-- liquidaciones reales. Están versionados justamente para poder corregirlos sin
-- tocar código (ese es el fix del hallazgo 4).
-- =============================================================================

-- ── 1. Serie UTM ─────────────────────────────────────────────────────────────
-- El impuesto único de 2ª categoría usa tramos en UTM/UTA. mindicador.cl la
-- entrega en el MISMO endpoint que ya consume el cron de UF (F0): se extiende
-- ese cron, no se construye otro. Misma forma que uf_rates.
CREATE TABLE IF NOT EXISTS public.utm_rates (
    rate_date  date PRIMARY KEY,
    value      numeric NOT NULL,
    source     text NOT NULL DEFAULT 'mindicador.cl',
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.utm_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "utm_rates_select" ON public.utm_rates;
CREATE POLICY "utm_rates_select" ON public.utm_rates FOR SELECT TO authenticated USING (true);
-- Sin INSERT/UPDATE para authenticated: lo escribe el cron con service role.
-- Un admin de tenant no puede alterar un valor que afecta a todos (patrón uf_rates).
GRANT SELECT ON public.utm_rates TO authenticated;

-- ── 2. Catálogo de AFP ───────────────────────────────────────────────────────
-- Reemplaza el texto libre de profiles.afp. Es normativa NACIONAL, no de
-- tenant: una AFP no cobra distinto según la empresa. Global con vigencia, como
-- uf_rates.
--
-- Modelo: el 10% de cotización obligatoria va al FONDO del trabajador y es
-- igual en todas; lo que distingue a cada AFP es su COMISIÓN. Se guardan
-- separados porque son conceptos distintos (y en la liquidación se muestran
-- distinto), aunque al trabajador se le descuente la suma.
CREATE TABLE IF NOT EXISTS public.afp_rates (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL,
    commission_rate numeric NOT NULL,           -- % adicional al 10% obligatorio
    sis_rate        numeric,                    -- SIS: lo paga el EMPLEADOR, no el trabajador
    effective_from  date NOT NULL,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (name, effective_from)
);
ALTER TABLE public.afp_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "afp_rates_select" ON public.afp_rates;
CREATE POLICY "afp_rates_select" ON public.afp_rates FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.afp_rates TO authenticated;

-- Semilla ⚠️ VERIFICAR: comisiones de referencia. El SIS (1,53%) lo paga el
-- empleador y por eso NO se descuenta al trabajador — entra al costo empresa.
INSERT INTO public.afp_rates (name, commission_rate, sis_rate, effective_from) VALUES
    ('Capital',   1.44, 1.53, '2026-01-01'),
    ('Cuprum',    1.44, 1.53, '2026-01-01'),
    ('Habitat',   1.27, 1.53, '2026-01-01'),
    ('PlanVital', 1.16, 1.53, '2026-01-01'),
    ('ProVida',   1.45, 1.53, '2026-01-01'),
    ('Modelo',    0.58, 1.53, '2026-01-01'),
    ('Uno',       0.49, 1.53, '2026-01-01')
ON CONFLICT (name, effective_from) DO NOTHING;

-- ── 3. Paramétrica legal versionada ──────────────────────────────────────────
-- Reemplaza las constantes del componente. GLOBAL, no por tenant: el sueldo
-- mínimo y los topes imponibles son LEY nacional — que cada tenant tuviera su
-- propia versión sería una fuente de error, no de flexibilidad. (El RFC-003 los
-- planteaba por tenant; se corrige acá y queda anotado en el ADR.)
--
-- Lo importante es la VIGENCIA: una liquidación de marzo se calcula con los
-- parámetros de marzo, siempre. La planilla guardará el snapshot de lo que usó.
CREATE TABLE IF NOT EXISTS public.payroll_parameters (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    effective_from         date NOT NULL UNIQUE,
    -- Sueldo mínimo (IMM): base del tope de gratificación art. 50
    minimum_wage           numeric NOT NULL,
    -- Topes imponibles en UF (se convierten con uf_rates del período)
    cap_pension_uf         numeric NOT NULL,     -- AFP y salud
    cap_unemployment_uf    numeric NOT NULL,     -- seguro de cesantía
    -- Cotizaciones fijas
    pension_rate           numeric NOT NULL DEFAULT 10.0,   -- fondo del trabajador
    health_rate            numeric NOT NULL DEFAULT 7.0,    -- piso legal (Fonasa = exacto)
    -- Seguro de cesantía (AFC): cambia según el tipo de contrato
    afc_indefinite_worker  numeric NOT NULL DEFAULT 0.6,
    afc_indefinite_employer numeric NOT NULL DEFAULT 2.4,
    afc_fixed_employer     numeric NOT NULL DEFAULT 3.0,    -- plazo fijo/obra: trabajador 0%
    -- Gratificación art. 50: 25% del imponible con tope de N IMM anuales
    gratification_rate     numeric NOT NULL DEFAULT 25.0,
    gratification_cap_imm  numeric NOT NULL DEFAULT 4.75,
    -- Tramos (jsonb: son tablas, no escalares)
    family_allowance_brackets jsonb NOT NULL DEFAULT '[]'::jsonb,
    income_tax_brackets       jsonb NOT NULL DEFAULT '[]'::jsonb,
    notes                  text,
    created_at             timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payroll_parameters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payroll_parameters_select" ON public.payroll_parameters;
CREATE POLICY "payroll_parameters_select" ON public.payroll_parameters FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.payroll_parameters TO authenticated;

-- Semilla ⚠️ VERIFICAR TODOS LOS VALORES antes de liquidar en producción.
-- Los tramos de impuesto único van en UTM (factor y rebaja del método chileno);
-- la asignación familiar, en tramos de renta con monto fijo por carga.
INSERT INTO public.payroll_parameters (
    effective_from, minimum_wage, cap_pension_uf, cap_unemployment_uf,
    family_allowance_brackets, income_tax_brackets, notes
) VALUES (
    '2026-01-01',
    529000,      -- ⚠️ IMM de referencia
    87.8,        -- ⚠️ tope imponible AFP/salud en UF
    131.9,       -- ⚠️ tope AFC en UF
    -- [{ hasta_renta, monto_por_carga }] — el último tramo con monto 0 = sin derecho
    '[{"max_income": 620251, "amount": 22007},
      {"max_income": 905941, "amount": 13505},
      {"max_income": 1412957, "amount": 4267},
      {"max_income": null,    "amount": 0}]'::jsonb,
    -- [{ desde_utm, hasta_utm, factor, rebaja_utm }] — método chileno de tramos
    '[{"from_utm": 0,     "to_utm": 13.5,  "factor": 0,     "deduction_utm": 0},
      {"from_utm": 13.5,  "to_utm": 30,    "factor": 0.04,  "deduction_utm": 0.54},
      {"from_utm": 30,    "to_utm": 50,    "factor": 0.08,  "deduction_utm": 1.74},
      {"from_utm": 50,    "to_utm": 70,    "factor": 0.135, "deduction_utm": 4.49},
      {"from_utm": 70,    "to_utm": 90,    "factor": 0.23,  "deduction_utm": 11.14},
      {"from_utm": 90,    "to_utm": 120,   "factor": 0.304, "deduction_utm": 17.8},
      {"from_utm": 120,   "to_utm": 310,   "factor": 0.35,  "deduction_utm": 23.32},
      {"from_utm": 310,   "to_utm": null,  "factor": 0.4,   "deduction_utm": 38.82}]'::jsonb,
    'Semilla inicial F1 — VALORES DE REFERENCIA, verificar contra normativa vigente antes de emitir liquidaciones reales.'
) ON CONFLICT (effective_from) DO NOTHING;

-- ── 4. Quién administra RRHH ─────────────────────────────────────────────────
-- Misma cadena que can(): super-admin → bypass admin/soporte → permiso otorgado
-- en el perfil → fila de rol por tenant. `hr_employees:edit` ya existe y lo trae
-- el rol recursos-humanos por defecto (ROLES_DEFAULT), por eso se incluye la
-- rama del rol.
--
-- ⚠️ VA ANTES de employment_contracts A PROPÓSITO: las políticas RLS de esa
-- tabla la invocan, y Postgres exige que la función exista al crear la política.
-- Definirla después aborta la migración completa (el editor SQL corre todo en
-- una transacción, así que un error tardío revierte hasta las tablas).
CREATE OR REPLACE FUNCTION public.can_manage_hr()
RETURNS boolean AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.roles r
      ON r.id = p.role AND r.tenant_id = p.tenant_id
    WHERE p.id = auth.uid()
      AND (
            p.role IN ('super-admin', 'administrador', 'soporte-pagnol', 'recursos-humanos')
         OR to_jsonb(p.granted_permissions) ? 'hr_employees:edit'
         OR to_jsonb(r.permissions)         ? 'hr_employees:edit'
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;
ALTER FUNCTION public.can_manage_hr() SET search_path = public, extensions;
GRANT EXECUTE ON FUNCTION public.can_manage_hr() TO authenticated;

-- ── 5. Contrato laboral ──────────────────────────────────────────────────────
-- ⚠️ VOCABULARIO: en Pagnol `contracts` son CONTRATOS DE OBRA con el cliente y
-- `contract_workers` asigna trabajadores a esas obras. Esta tabla es el
-- CONTRATO LABORAL del trabajador — cosa distinta. Por eso el nombre explícito
-- `employment_contracts`, y en la UI siempre "Contrato Laboral" (RFC-003).
--
-- APPEND-ONLY (Art. 2): un anexo (cambio de sueldo, de AFP, de jornada) es una
-- FILA NUEVA con su `effective_from`, no un UPDATE. El contrato vigente en una
-- fecha X es el de mayor `effective_from <= X` — así no hay que "cerrar" el
-- anterior, y liquidar marzo con las condiciones de marzo sale gratis.
CREATE TABLE IF NOT EXISTS public.employment_contracts (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

    -- Desde cuándo rigen ESTAS condiciones (no es la fecha de ingreso: un anexo
    -- de junio tiene effective_from = junio y el trabajador sigue siendo antiguo)
    effective_from   date NOT NULL,

    contract_type    text NOT NULL CHECK (contract_type IN ('indefinido', 'plazo_fijo', 'por_obra')),
    -- Término del CONTRATO (plazo fijo/obra). NULL en indefinido.
    contract_end_date date,

    -- Decisión 4 (dotación mixta): administrativos mensual, terreno por día
    salary_mode      text NOT NULL DEFAULT 'monthly' CHECK (salary_mode IN ('monthly', 'daily')),
    base_salary      numeric NOT NULL,       -- mensual o valor día según salary_mode

    -- Jornada: hoy vive como texto suelto ('7x7'). Se conserva el texto para no
    -- perder información, pero las horas semanales son lo que el motor necesita
    -- para la base de horas extra.
    work_schedule    text,
    weekly_hours     numeric NOT NULL DEFAULT 44,

    -- Previsional
    afp_name         text,                   -- referencia por nombre al catálogo
    health_system    text NOT NULL DEFAULT 'fonasa' CHECK (health_system IN ('fonasa', 'isapre')),
    -- Solo Isapre: plan pactado en UF. El 7% legal es el PISO; si el plan vale
    -- más, la diferencia la paga el trabajador.
    health_plan_uf   numeric,
    family_charges   integer NOT NULL DEFAULT 0,

    -- Gratificación art. 50 (decisión 5). Se deja por contrato porque no todos
    -- los contratos la pactan igual.
    has_gratification boolean NOT NULL DEFAULT true,

    notes            text,
    created_by       uuid,
    created_by_name  text,
    created_at       timestamptz NOT NULL DEFAULT now(),

    -- Un trabajador no puede tener dos versiones vigentes desde el mismo día
    UNIQUE (user_id, effective_from),
    -- Isapre sin plan es un dato incompleto que rompería el cálculo en silencio
    CONSTRAINT health_plan_required_for_isapre
        CHECK (health_system <> 'isapre' OR health_plan_uf IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_employment_contracts_lookup
    ON public.employment_contracts (tenant_id, user_id, effective_from DESC);

ALTER TABLE public.employment_contracts ENABLE ROW LEVEL SECURITY;

-- El sueldo de un trabajador es dato sensible: lo ven RRHH y la administración,
-- y cada trabajador el suyo.
DROP POLICY IF EXISTS "employment_contracts_select" ON public.employment_contracts;
CREATE POLICY "employment_contracts_select" ON public.employment_contracts FOR SELECT TO authenticated
USING (
    public.is_super_admin()
    OR user_id = auth.uid()
    OR (tenant_id = public.get_my_tenant_id() AND public.can_manage_hr())
);

DROP POLICY IF EXISTS "employment_contracts_insert" ON public.employment_contracts;
CREATE POLICY "employment_contracts_insert" ON public.employment_contracts FOR INSERT TO authenticated
WITH CHECK (
    public.is_super_admin()
    OR (tenant_id = public.get_my_tenant_id() AND public.can_manage_hr())
);

-- Art. 2: sin UPDATE/DELETE. Corregir un contrato = anexo con nueva vigencia.
GRANT SELECT, INSERT ON public.employment_contracts TO authenticated;

-- ── 6. Contrato vigente de un trabajador en una fecha ────────────────────────
-- La regla "el de mayor effective_from <= fecha" en un solo lugar: la usarán el
-- motor de cálculo (F2), la planilla (F3) y la UI. Duplicarla es pedir que
-- diverjan.
--
-- ⚠️ SECURITY INVOKER (el default) A PROPÓSITO, no por omisión.
-- Esta función devuelve la FILA COMPLETA del contrato —sueldo, AFP, plan de
-- salud, cargas— indexada por un `p_user` que elige quien llama. Con
-- SECURITY DEFINER habría puenteado la política de SELECT de más arriba y
-- cualquier usuario autenticado podría haber leído el sueldo de otro: los uuid
-- de perfiles del propio tenant son visibles para todo miembro
-- (`profiles_select_tenant`), así que bastaba con pasar el id de un compañero.
--
-- Como INVOKER, la RLS de la tabla se aplica y la respuesta ya está acotada a
-- "el propio contrato, o cualquiera del tenant si can_manage_hr()". La regla de
-- acceso vive en UN solo lugar (la política), no replicada acá.
--
-- El motor de F2 no pierde nada: corre server-side con service role, que hace
-- bypass de RLS por su cuenta.
CREATE OR REPLACE FUNCTION public.employment_contract_at(p_user uuid, p_date date)
RETURNS public.employment_contracts AS $$
  SELECT *
    FROM public.employment_contracts
   WHERE user_id = p_user
     AND effective_from <= p_date
   ORDER BY effective_from DESC
   LIMIT 1;
$$ LANGUAGE sql STABLE;
ALTER FUNCTION public.employment_contract_at(uuid, date) SET search_path = public, extensions;
GRANT EXECUTE ON FUNCTION public.employment_contract_at(uuid, date) TO authenticated;

-- NOTA DE TRANSICIÓN: profiles.base_salary / afp / tipo_salud / cargas_familiares
-- se conservan intactos. F1 no los migra ni los borra — el ledger de costo MO
-- (F1 del RFC-002) sigue leyendo profiles.base_salary y romperlo dejaría la
-- asistencia sin devengar. La migración de datos y el corte se hacen en F3,
-- cuando la planilla real reemplace la estimación.

NOTIFY pgrst, 'reload schema';
