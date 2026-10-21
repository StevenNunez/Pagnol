-- ════════════════════════════════════════════════════════════════════════════
-- El RUT es único dentro de cada empresa
--
-- Pedido de la reunión del 2026-10-20 (identificación con carnet): el RUN leído
-- del carnet es la llave para encontrar al trabajador, y una llave repetida
-- entregaría a nombre de la persona equivocada. La pantalla ya se niega a elegir
-- cuando hay dos fichas con el mismo RUT; esto impide que lleguen a existir.
--
-- Se compara el RUT NORMALIZADO (sin puntos, guion ni espacios, K en mayúscula):
-- "12.345.678-5" y "123456785" son la misma persona. Sólo cuentan los perfiles
-- vigentes con RUT escrito; los vacíos y los dados de baja no chocan. Una misma
-- persona en DOS empresas distintas sigue siendo posible (el índice es por empresa).
--
-- Medido contra la base viva antes de escribir esto: 0 RUT repetidos por empresa.
-- Si al aplicar existiera alguno, la migración se detiene y dice cuáles.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  dup RECORD;
  msg text := '';
BEGIN
  FOR dup IN
    SELECT tenant_id,
           regexp_replace(upper(rut), '[^0-9K]', '', 'g') AS rut_norm,
           count(*) AS n,
           string_agg(name, ', ' ORDER BY name) AS nombres
    FROM public.profiles
    WHERE deleted_at IS NULL
      AND regexp_replace(upper(coalesce(rut, '')), '[^0-9K]', '', 'g') <> ''
    GROUP BY 1, 2
    HAVING count(*) > 1
  LOOP
    msg := msg || format(E'\n  · %s (%s fichas): %s', dup.rut_norm, dup.n, dup.nombres);
  END LOOP;
  IF msg <> '' THEN
    RAISE EXCEPTION 'Hay RUT repetidos dentro de una misma empresa. Corrígelos antes de aplicar esta migración:%', msg;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_tenant_rut_unique
  ON public.profiles (tenant_id, (regexp_replace(upper(rut), '[^0-9K]', '', 'g')))
  WHERE deleted_at IS NULL
    AND regexp_replace(upper(coalesce(rut, '')), '[^0-9K]', '', 'g') <> '';
