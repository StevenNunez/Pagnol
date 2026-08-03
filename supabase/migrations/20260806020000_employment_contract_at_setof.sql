-- ═══════════════════════════════════════════════════════════════════════════
-- `employment_contract_at()` → RETURNS SETOF (cierra la trampa del sueldo cero)
--
-- PROBLEMA (detectado en el E2E de F1 de Remuneraciones, 2026-07-29):
-- la función era `RETURNS public.employment_contracts`, un tipo COMPUESTO. Un
-- trabajador SIN contrato no devolvía `NULL`, sino **una fila con todas las
-- columnas en NULL**. Para cualquier consumidor eso significa:
--
--     const c = await rpc('employment_contract_at', …);
--     if (c) { … }                  // ← true: el objeto existe
--     Number(c.base_salary)         // ← 0, en silencio
--
-- O sea: en vez de fallar, liquidaría **sueldo cero**. En un módulo donde un
-- error de cálculo tiene consecuencias legales, "cero silencioso" es la peor
-- forma posible de fallar.
--
-- Hoy los consumidores se protegen chequeando `fila?.id != null`, pero eso es
-- una convención que hay que recordar en cada llamada nueva. Con `SETOF` el
-- caso "sin contrato" devuelve **cero filas**, que es imposible de confundir.
--
-- Requiere DROP + CREATE: `CREATE OR REPLACE` no puede cambiar el tipo de
-- retorno de una función.
--
-- SEGURIDAD: se mantiene `SECURITY INVOKER` (por defecto). Es deliberado y no
-- debe cambiarse — ver la nota al pie.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.employment_contract_at(uuid, date);

CREATE FUNCTION public.employment_contract_at(p_user uuid, p_date date)
RETURNS SETOF public.employment_contracts AS $$
  SELECT *
    FROM public.employment_contracts
   WHERE user_id = p_user
     AND effective_from <= p_date
   ORDER BY effective_from DESC
   LIMIT 1;
$$ LANGUAGE sql STABLE;

ALTER FUNCTION public.employment_contract_at(uuid, date) SET search_path = public, extensions;
GRANT EXECUTE ON FUNCTION public.employment_contract_at(uuid, date) TO authenticated;

COMMENT ON FUNCTION public.employment_contract_at(uuid, date) IS
  'Contrato laboral vigente de un trabajador a una fecha (el de mayor effective_from '
  '<= fecha). Devuelve CERO filas si no tiene contrato — antes devolvía una fila de '
  'NULLs, que se leía como sueldo 0 en silencio. '
  'SECURITY INVOKER a propósito: la RLS de employment_contracts decide quién ve qué. '
  'Con SECURITY DEFINER esta función filtraría un sueldo ajeno a cualquier miembro del '
  'tenant, porque recibe el user_id del llamador.';

NOTIFY pgrst, 'reload schema';
