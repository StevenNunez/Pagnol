-- ════════════════════════════════════════════════════════════════════════════
-- Corrección de 20261026000000: el guard del modo de recepción no podía ejecutarse
--
-- `tenants_guard_receiving_mode()` corre con los permisos de quien actualiza la empresa
-- (un administrador, rol `authenticated`) y llama a `expected_purchase_open_lines()`, a la
-- que se le había quitado el EXECUTE a `authenticated`. Resultado: CUALQUIER cambio del
-- modo de recepción desde Configuración fallaba con «permission denied for function»,
-- hubiera o no compras abiertas. Probado contra el demo (2026-10-21).
--
-- Se corrige como se hace con el resto de los guards de `tenants`: la función corre con los
-- permisos de su dueño (SECURITY DEFINER) y cuenta las líneas directamente. La función
-- auxiliar sigue sin ser ejecutable por nadie más.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.tenants_guard_receiving_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE n int;
BEGIN
  IF NEW.receiving_mode IS DISTINCT FROM OLD.receiving_mode THEN
    n := public.expected_purchase_open_lines(OLD.id);
    IF n > 0 THEN
      RAISE EXCEPTION 'No se puede cambiar dónde se recibe: hay % línea(s) de compras esperadas sin cerrar. Ciérralas o cancélalas primero.', n
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tenants_guard_receiving_mode() FROM PUBLIC, anon, authenticated;
