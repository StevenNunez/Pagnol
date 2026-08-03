-- ═══════════════════════════════════════════════════════════════════════════
-- Bucket `contracts`: acotar la lectura POR TENANT (cierra la deuda de 20260803000000)
--
-- La migración anterior sacó el bucket de público —que era el P0— pero dejó la
-- lectura como "cualquier usuario autenticado", porque los paths no eran
-- uniformemente tenant-scoped. Esta la estrecha hasta donde el tenant se puede
-- derivar, SIN mover archivos ni romper enlaces a documentos ya firmados.
--
-- Qué hay en el bucket hoy (sondeado, no supuesto):
--   · `contracts/<uuid-de-solicitud>/…pdf` — actas de entrega FIRMADAS (nombre,
--     RUT y firma del trabajador). 10 carpetas; 9 corresponden a una fila viva de
--     `material_requests` y 1 quedó huérfana (su solicitud se borró).
--   · `contracts/direct/…pdf`             — actas de entrega directa, sin id de solicitud.
--   · `return-evidence/…jpg`              — fotos de evidencia de devolución.
--   · `ea-docs/<tenant>/…pdf`             — documentos EA (ya lleva el tenant).
--
-- ESTRATEGIA: derivar el tenant del propio path cuando se puede, y cruzarlo con
-- la solicitud cuando el path sólo trae su id. Lo que no se puede derivar
-- (objetos ANTIGUOS de `direct/` y `return-evidence/`, y la carpeta huérfana)
-- sigue accesible a usuarios autenticados: negarles el acceso rompería enlaces a
-- documentos laborales ya emitidos, que es peor que la exposición actual entre
-- tenants de la misma plataforma. El código ya guarda los NUEVOS con el tenant
-- delante (`return-evidence/<tenant>/…`, `contracts/direct/<tenant>/…`), así que
-- esa cola deja de crecer y se puede cerrar del todo más adelante.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.can_read_contract_object(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    CASE (storage.foldername(p_name))[1]
      -- ea-docs/<tenant>/… y las rutas nuevas: el tenant está en el path.
      WHEN 'ea-docs' THEN (storage.foldername(p_name))[2] = public.get_my_tenant_id()::text
      WHEN 'return-evidence' THEN
        -- Nuevas: return-evidence/<tenant>/archivo → 2 niveles.
        CASE WHEN array_length(storage.foldername(p_name), 1) >= 2
          THEN (storage.foldername(p_name))[2] = public.get_my_tenant_id()::text
          ELSE true  -- antiguas, sin tenant derivable
        END
      WHEN 'contracts' THEN
        CASE
          -- contracts/direct/<tenant>/archivo (nuevas) → 3 niveles.
          WHEN (storage.foldername(p_name))[2] = 'direct' THEN
            CASE WHEN array_length(storage.foldername(p_name), 1) >= 3
              THEN (storage.foldername(p_name))[3] = public.get_my_tenant_id()::text
              ELSE true  -- antiguas, sin tenant derivable
            END
          -- contracts/<uuid-solicitud>/archivo → el tenant sale de la solicitud.
          -- Si la solicitud ya no existe (carpeta huérfana), se deja pasar: es un
          -- documento emitido cuyo enlace no se puede romper.
          ELSE COALESCE(
            (SELECT r.tenant_id = public.get_my_tenant_id()
               FROM public.material_requests r
              WHERE r.id::text = (storage.foldername(p_name))[2]),
            true
          )
        END
      ELSE true
    END;
$$;

ALTER FUNCTION public.can_read_contract_object(text) SET search_path = public, extensions, storage;
REVOKE ALL ON FUNCTION public.can_read_contract_object(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_contract_object(text) TO authenticated;

COMMENT ON FUNCTION public.can_read_contract_object(text) IS
  'Veredicto por objeto del bucket `contracts`: ¿pertenece al tenant del usuario? '
  'Devuelve true cuando el tenant NO se puede derivar del path (objetos antiguos), '
  'para no romper enlaces a documentos laborales ya emitidos. SECURITY DEFINER '
  'porque debe leer material_requests saltándose su RLS, y sólo devuelve un booleano.';

DROP POLICY IF EXISTS "contracts_read_authenticated" ON storage.objects;
CREATE POLICY "contracts_read_tenant" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'contracts' AND public.can_read_contract_object(name));

-- El super-admin necesita ver cualquier documento para dar soporte.
DROP POLICY IF EXISTS "contracts_read_super_admin" ON storage.objects;
CREATE POLICY "contracts_read_super_admin" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'contracts' AND public.is_super_admin());

-- INSERT/UPDATE/DELETE se mantienen como estaban: escribir en el bucket exige
-- estar autenticado, y los paths nuevos ya nacen tenant-scoped.
