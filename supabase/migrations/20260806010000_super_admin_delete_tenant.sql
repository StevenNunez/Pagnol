-- ═══════════════════════════════════════════════════════════════════════════
-- Borrado completo de una empresa — herramienta de super-admin
--
-- CONTEXTO: mientras la plataforma está en pruebas y el alta es abierta, el
-- super-admin necesita poder limpiar empresas de prueba de la base. El botón
-- "Eliminar empresa" existía en la UI pero NO borraba nada:
--   · no había política de DELETE sobre `tenants` (la petición devolvía HTTP 200,
--     0 filas y ningún error → la pantalla cantaba éxito y mentía);
--   · y aunque la hubiera, el borrado falla igual con
--     `23503: still referenced from table "profiles"` — verificado sembrando un
--     tenant desechable con usuarios y datos.
--
-- Por eso no basta una política: hace falta un barrido en cascada. Esta función
-- lo hace en la base, donde puede descubrir las tablas sola y saltarse los
-- triggers de inmutabilidad.
--
-- ⚠️ ES DESTRUCTIVA E IRREVERSIBLE. Arrastra TODO lo del tenant, incluidos los
-- hechos que el Artículo 2 del manifiesto declara inmutables (ledger financiero,
-- planillas cerradas, finiquitos pagados). Eso es deliberado: su propósito es
-- borrar empresas de PRUEBA. No es una baja comercial de un cliente real.
--
-- CUANDO EXISTA PRICING con accesos de pago, esta función y el botón que la usa
-- deben retirarse: dar de baja a un cliente que pagó nunca puede ser destruir su
-- historia. Queda anotado en PENDIENTES.md.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.super_admin_delete_tenant(p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_name text;
  v_tables      text[];
  v_table       text;
  v_deleted     bigint;
  v_report      jsonb := '{}'::jsonb;
  v_total       bigint := 0;
  v_pass        int;
  v_pending     boolean;
BEGIN
  -- ── Autorización ────────────────────────────────────────────────────────
  -- Se acepta al super-admin con sesión, o al service role (auth.uid() NULL),
  -- que sólo llega aquí desde /api/admin/delete-tenant, que ya verificó el
  -- bearer token del llamador contra profiles.role = 'super-admin'.
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sólo un super-admin puede eliminar una empresa.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT name INTO v_tenant_name FROM public.tenants WHERE id = p_tenant;
  IF v_tenant_name IS NULL THEN
    RAISE EXCEPTION 'La empresa % no existe.', p_tenant USING ERRCODE = 'no_data_found';
  END IF;

  -- ── Qué tablas se barren ────────────────────────────────────────────────
  -- Se descubren dinámicamente en vez de mantener una lista: el esquema crece
  -- (finance_entries, payroll_runs, severances…) y una lista quemada quedaría
  -- desactualizada en silencio, dejando datos huérfanos invisibles.
  --
  -- Se calcula UNA sola vez y se guarda: tener la misma consulta repetida en
  -- cada bucle ya causó un fallo real (un filtro corregido en unos sitios y en
  -- otros no).
  --
  -- Dos condiciones que no son obvias:
  --   · `data_type = 'uuid'` — la propia tabla `tenants` tiene una columna
  --     `tenant_id` que es el RUT, de tipo TEXT. Sin este filtro el DELETE
  --     revienta con `operator does not exist: text = uuid`.
  --   · se excluye `tenants` — se borra al final, por su clave primaria.
  SELECT array_agg(c.table_name ORDER BY c.table_name)
    INTO v_tables
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema AND t.table_name = c.table_name
  WHERE c.table_schema = 'public'
    AND c.column_name = 'tenant_id'
    AND c.data_type = 'uuid'
    AND t.table_type = 'BASE TABLE'
    AND c.table_name <> 'tenants';

  v_tables := COALESCE(v_tables, ARRAY[]::text[]);

  -- Los guards de inmutabilidad (Art. 2) rechazan el borrado incluso con service
  -- role: hay que desactivarlos para esta operación y reactivarlos sí o sí después.
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', v_table);
  END LOOP;

  BEGIN
    -- Varias pasadas porque entre las propias tablas hay claves foráneas
    -- (payroll_lines → payroll_runs, stock_movements → materials): en cada pasada
    -- cae una capa de dependencias. 6 cubren de sobra la profundidad real.
    FOR v_pass IN 1..6 LOOP
      v_pending := false;

      FOREACH v_table IN ARRAY v_tables LOOP
        BEGIN
          EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1', v_table)
            USING p_tenant;
          GET DIAGNOSTICS v_deleted = ROW_COUNT;

          IF v_deleted > 0 THEN
            v_total  := v_total + v_deleted;
            v_report := v_report || jsonb_build_object(
              v_table,
              COALESCE((v_report ->> v_table)::bigint, 0) + v_deleted
            );
          END IF;
        EXCEPTION WHEN foreign_key_violation THEN
          -- Otra tabla todavía la referencia; caerá en una pasada posterior.
          v_pending := true;
        END;
      END LOOP;

      EXIT WHEN NOT v_pending;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Reactivar los triggers pase lo que pase antes de propagar el error: si
    -- quedaran apagados, el Artículo 2 se caería para TODOS los tenants.
    FOREACH v_table IN ARRAY v_tables LOOP
      EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', v_table);
    END LOOP;
    RAISE;
  END;

  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', v_table);
  END LOOP;

  -- Si algo quedó referenciando al tenant, el DELETE de abajo falla con 23503 y
  -- la operación entera se revierte: mejor eso que una empresa a medio borrar.

  -- ── La empresa ──────────────────────────────────────────────────────────
  -- El trigger de plataforma (20260806000000) es BEFORE UPDATE, no interfiere.
  DELETE FROM public.tenants WHERE id = p_tenant;

  RETURN jsonb_build_object(
    'tenant_id',   p_tenant,
    'tenant_name', v_tenant_name,
    'rows_deleted', v_total,
    'by_table',    v_report
  );
END;
$$;

ALTER FUNCTION public.super_admin_delete_tenant(uuid) SET search_path = public, extensions;

-- Sólo el service role la ejecuta: se invoca desde /api/admin/delete-tenant, que
-- verifica el bearer token del llamador. No se expone a `authenticated` para que
-- una operación irreversible no quede a un POST de distancia desde el navegador.
REVOKE ALL ON FUNCTION public.super_admin_delete_tenant(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.super_admin_delete_tenant(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_delete_tenant(uuid) TO service_role;

COMMENT ON FUNCTION public.super_admin_delete_tenant(uuid) IS
  'DESTRUCTIVA: borra una empresa y TODOS sus datos, incluidos hechos inmutables. '
  'Herramienta de limpieza para la fase de pruebas con alta abierta. Retirar cuando '
  'exista pricing: la baja de un cliente de pago no puede ser un borrado físico.';
