-- =============================================================================
-- Remuneraciones — Paramétrica legal verificada contra normativa (ADR-011)
--
-- F1 sembró `payroll_parameters` con VALORES DE REFERENCIA y lo dejó advertido
-- en tres lugares (la migración, el CHANGELOG y el campo `notes`): sin verificar
-- no se podía emitir una liquidación real. Esta migración cierra esa deuda.
--
-- Lo que la verificación encontró (detalle y fuentes en ADR-011):
--   · los topes imponibles eran los de 2025 (subían a 90 / 135,2 UF en feb-2026)
--   · el IMM llevaba dos reajustes de atraso ($539.000 en enero, $553.553 en mayo)
--   · los tramos de asignación familiar eran los de 2025 y cambian otra vez en mayo
--   · el SIS pasó de 1,54% a 1,62% con las remuneraciones de abril
--   · AFP Uno cobra 0,46%, no 0,49%
--   · y lo más grande: la cotización de cargo del empleador de la reforma
--     previsional (Ley 21.735) NO EXISTÍA en el modelo. Sube a 3,5% con las
--     remuneraciones de AGOSTO de 2026 y absorbe al SIS.
--
-- La tabla del impuesto único, en cambio, se verificó CORRECTA al decimal contra
-- el SII (8 tramos, factores y rebajas en UTM): se copia sin cambios en cada
-- versión nueva.
--
-- No cambia ninguna regla de cálculo salvo donde el modelo no alcanzaba: se
-- agregan 3 columnas. El versionado por fecha que construyó F1 es justamente lo
-- que permite corregir tasas sin tocar código, y acá se usa por primera vez en
-- serio: 5 versiones para 2026, una por cada fecha en que la ley cambió algo.
-- =============================================================================

-- ── 1. Columnas que el modelo no tenía ───────────────────────────────────────

-- El IMM del tope de gratificación NO es el sueldo mínimo del mes.
--
-- La Dirección del Trabajo interpreta que el tope de 4,75 IMM del art. 50 se
-- determina con el ingreso mínimo vigente al 31 de DICIEMBRE del ejercicio
-- comercial, que es cuando se cierra el ejercicio y se determinan las utilidades.
-- Para todo el año 2026 ese valor es el de dic-2025: $529.000 — aunque el sueldo
-- mínimo del mes ya vaya en $553.553.
--
-- Hasta ahora `minimum_wage` servía a los dos conceptos, y como el único
-- consumidor es la gratificación, "corregirlo" al IMM vigente habría cambiado el
-- tope en silencio y roto el anclaje contra las liquidaciones reales de Steven
-- (que usan $529.000 y están BIEN). Se separan: cada campo con su regla de
-- vigencia. `minimum_wage` queda como el sueldo mínimo de verdad, disponible para
-- validar que ningún sueldo pactado caiga bajo el piso legal.
ALTER TABLE public.payroll_parameters
    ADD COLUMN IF NOT EXISTS gratification_imm numeric;

COMMENT ON COLUMN public.payroll_parameters.gratification_imm IS
    'IMM vigente al 31-dic del ejercicio comercial, base del tope de 4,75 IMM del art. 50. Distinto del sueldo mínimo del mes (minimum_wage).';
COMMENT ON COLUMN public.payroll_parameters.minimum_wage IS
    'Sueldo mínimo (IMM) vigente en el período. Para el tope de gratificación usar gratification_imm.';

-- Cotización de cargo del EMPLEADOR — reforma previsional (Ley 21.735).
--
-- Es plata que no se le descuenta al trabajador (no aparece en su liquidación)
-- pero sí es costo empresa, así que entra derecho al margen por contrato y a la
-- desviación de presupuesto de personal (ADR-010). Sin esta columna el costo real
-- que F4 emite al ledger estaba subestimado.
--
-- Calendario: 1% desde las remuneraciones de ago-2025, 3,5% desde ago-2026, y
-- sigue subiendo cada año hasta 8,5% en 2033. Por eso va versionada y no quemada.
--
-- Se separa del SIS porque hasta jul-2026 son dos cotizaciones distintas que se
-- suman, y desde ago-2026 el SIS queda INCORPORADO en el 3,5% (deja de pagarse
-- aparte). Modelarlos como un solo número haría imposible representar el corte.
ALTER TABLE public.payroll_parameters
    ADD COLUMN IF NOT EXISTS employer_pension_rate numeric NOT NULL DEFAULT 0;
ALTER TABLE public.payroll_parameters
    ADD COLUMN IF NOT EXISTS employer_sis_rate numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.payroll_parameters.employer_pension_rate IS
    'Aporte previsional de cargo del empleador (Ley 21.735), % del imponible topado. 1% ago-2025, 3,5% ago-2026, hasta 8,5% en 2033.';
COMMENT ON COLUMN public.payroll_parameters.employer_sis_rate IS
    'SIS de cargo del empleador cuando se cotiza por separado. 0 desde ago-2026: queda absorbido por employer_pension_rate.';

-- ── 2. Las 5 versiones de 2026 ───────────────────────────────────────────────
--
-- Una fila por cada fecha en que la ley cambió algo. Liquidar un mes toma la de
-- mayor `effective_from <= fecha`, así que liquidar marzo sigue usando las tasas
-- de marzo aunque hoy sea agosto — que es exactamente para lo que se diseñó.

-- 2026-01: reajuste del IMM a $539.000 (Ley 21.751) y nuevos tramos de asignación
-- familiar. Los topes imponibles siguen siendo los de 2025 hasta febrero.
UPDATE public.payroll_parameters SET
    minimum_wage      = 539000,
    gratification_imm = 529000,
    employer_sis_rate = 1.54,
    employer_pension_rate = 1.0,
    family_allowance_brackets =
        '[{"max_income": 631976,  "amount": 22007},
          {"max_income": 923067,  "amount": 13505},
          {"max_income": 1439668, "amount": 4267},
          {"max_income": null,    "amount": 0}]'::jsonb,
    notes = 'Verificada contra normativa (ADR-011). IMM $539.000 desde 01-01-2026 (Ley 21.751). Topes imponibles aún los de 2025: los de 2026 rigen desde las remuneraciones de febrero. SIS 1,54%. Aporte empleador Ley 21.735 al 1%.'
WHERE effective_from = '2026-01-01';

-- 2026-02: topes imponibles 2026 (Superintendencia de Pensiones). Rigen "a partir
-- del pago de las cotizaciones correspondientes a las remuneraciones de febrero".
INSERT INTO public.payroll_parameters (
    effective_from, minimum_wage, gratification_imm,
    cap_pension_uf, cap_unemployment_uf,
    employer_sis_rate, employer_pension_rate,
    family_allowance_brackets, income_tax_brackets, notes
)
SELECT '2026-02-01', 539000, 529000,
       90.0, 135.2,
       1.54, 1.0,
       family_allowance_brackets, income_tax_brackets,
       'Topes imponibles 2026: 90,0 UF (AFP/salud) y 135,2 UF (cesantía), reajustados por el Índice de Remuneraciones Reales (2,5%). Rigen desde las remuneraciones de febrero de 2026.'
  FROM public.payroll_parameters WHERE effective_from = '2026-01-01'
ON CONFLICT (effective_from) DO NOTHING;

-- 2026-04: nueva tasa SIS por licitación pública (1,54% → 1,62%), a contar de las
-- remuneraciones de abril. Solo cambia costo empresa: al trabajador no se le
-- descuenta el SIS.
INSERT INTO public.payroll_parameters (
    effective_from, minimum_wage, gratification_imm,
    cap_pension_uf, cap_unemployment_uf,
    employer_sis_rate, employer_pension_rate,
    family_allowance_brackets, income_tax_brackets, notes
)
SELECT '2026-04-01', 539000, 529000,
       90.0, 135.2,
       1.62, 1.0,
       family_allowance_brackets, income_tax_brackets,
       'SIS sube a 1,62% por licitación pública, desde las remuneraciones de abril de 2026. De cargo del empleador.'
  FROM public.payroll_parameters WHERE effective_from = '2026-01-01'
ON CONFLICT (effective_from) DO NOTHING;

-- 2026-05: segundo reajuste del IMM del año ($553.553) y nuevos montos/tramos de
-- asignación familiar. El IMM de la gratificación NO se mueve: sigue siendo el
-- del 31-dic-2025 hasta que cierre el ejercicio 2026.
INSERT INTO public.payroll_parameters (
    effective_from, minimum_wage, gratification_imm,
    cap_pension_uf, cap_unemployment_uf,
    employer_sis_rate, employer_pension_rate,
    family_allowance_brackets, income_tax_brackets, notes
)
SELECT '2026-05-01', 553553, 529000,
       90.0, 135.2,
       1.62, 1.0,
       '[{"max_income": 649039,  "amount": 22601},
         {"max_income": 947990,  "amount": 13870},
         {"max_income": 1478539, "amount": 4382},
         {"max_income": null,    "amount": 0}]'::jsonb,
       income_tax_brackets,
       'IMM $553.553 desde 01-05-2026 y nuevos tramos de asignación familiar. gratification_imm sigue en $529.000 (IMM al 31-12-2025, art. 50).'
  FROM public.payroll_parameters WHERE effective_from = '2026-01-01'
ON CONFLICT (effective_from) DO NOTHING;

-- 2026-08: 🔴 el cambio grande. El aporte de cargo del empleador sube de 1% a
-- 3,5% del imponible y ABSORBE al SIS — el patronal deja de ser 1,62% + 1% y pasa
-- a ser 3,5% total, no 3,5% + 1,62%. Por eso `employer_sis_rate` va a 0: no es
-- que el SIS desaparezca, es que se paga dentro del 3,5%.
-- Descomposición oficial: 0,1% cuenta individual + 0,9% CRP + 2,5% Seguro Social
-- (que incluye SIS y compensación por expectativa de vida).
INSERT INTO public.payroll_parameters (
    effective_from, minimum_wage, gratification_imm,
    cap_pension_uf, cap_unemployment_uf,
    employer_sis_rate, employer_pension_rate,
    family_allowance_brackets, income_tax_brackets, notes
)
SELECT '2026-08-01', 553553, 529000,
       90.0, 135.2,
       0, 3.5,
       family_allowance_brackets, income_tax_brackets,
       'Reforma previsional (Ley 21.735): aporte del empleador 1% → 3,5% desde las remuneraciones de agosto de 2026, con el SIS incorporado (0,1% cuenta individual + 0,9% CRP + 2,5% Seguro Social). Sigue subiendo anualmente hasta 8,5% en 2033.'
  FROM public.payroll_parameters WHERE effective_from = '2026-05-01'
ON CONFLICT (effective_from) DO NOTHING;

-- ── 3. Catálogo de AFP ───────────────────────────────────────────────────────
-- Comisiones verificadas: Capital 1,44 · Cuprum 1,44 · Habitat 1,27 · Modelo 0,58
-- · PlanVital 1,16 · ProVida 1,45 estaban correctas (ProVida además quedó
-- confirmada contra las liquidaciones reales). Solo Uno estaba mal.
UPDATE public.afp_rates SET commission_rate = 0.46
 WHERE name = 'Uno' AND effective_from = '2026-01-01' AND commission_rate <> 0.46;

-- El SIS es el MISMO para todas las AFP (se licita en conjunto), así que vivir en
-- el catálogo por AFP siempre fue el lugar equivocado: invita a que siete filas
-- se desincronicen. Pasa a `payroll_parameters`, donde ya está el resto de la
-- normativa nacional con vigencia. La columna se conserva por compatibilidad y se
-- actualiza al valor correcto, pero el motor deja de leerla.
UPDATE public.afp_rates SET sis_rate = 1.62 WHERE effective_from = '2026-01-01';
COMMENT ON COLUMN public.afp_rates.sis_rate IS
    'OBSOLETA: el SIS es igual para todas las AFP y desde ago-2026 va dentro del aporte del empleador. Usar payroll_parameters.employer_sis_rate / employer_pension_rate.';

-- ── 4. La línea de planilla necesita guardar el aporte por separado ──────────
-- `payroll_lines.employer_sis` se conserva con su significado ORIGINAL (el SIS
-- puro) en vez de reinterpretarse: las líneas ya emitidas son snapshots
-- inmutables (Art. 2) y cambiarle el sentido a una columna haría que un
-- documento viejo dijera algo que no dijo cuando se firmó. El aporte de la
-- reforma va en su propia columna.
ALTER TABLE public.payroll_lines
    ADD COLUMN IF NOT EXISTS employer_pension numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.payroll_lines.employer_pension IS
    'Aporte previsional de cargo del empleador (Ley 21.735). Separado de employer_sis, que desde ago-2026 va en 0 por quedar absorbido.';

-- ── 5. Jornada legal ─────────────────────────────────────────────────────────
-- Ley 21.561 ("40 horas"): la jornada ordinaria máxima bajó de 44 a 42 horas el
-- 26 de abril de 2026, y llegará a 40 en abril de 2028.
--
-- Importa para la liquidación porque el valor de la hora extra es
-- (sueldo/30) × (7/jornada) × 1,5: a menor jornada, MAYOR valor hora — y la ley
-- prohíbe expresamente rebajar la remuneración al reducir la jornada. Un contrato
-- que siga diciendo 44 le paga al trabajador un 4,8% menos por cada hora extra.
--
-- Solo se cambia el DEFAULT: los contratos existentes no se tocan. Son
-- append-only (Art. 2) y además un contrato histórico con 44 horas es un dato
-- correcto para su época — reescribirlo sería falsear el registro. Los vigentes
-- se corrigen con un anexo, y el motor avisa cuando detecta una jornada sobre el
-- máximo legal (ver payrollMath.ts).
ALTER TABLE public.employment_contracts ALTER COLUMN weekly_hours SET DEFAULT 42;

NOTIFY pgrst, 'reload schema';
