-- =============================================================================
-- Unificar ARRENDADORES con PROVEEDORES (suppliers)
--
-- Decisión de negocio: "un arrendador ES un proveedor". Hasta ahora los
-- arrendadores vivían en `rental_parties` (party_type='lessor') y los proveedores
-- en `suppliers`, como entidades separadas. Esto los unifica: los arrendadores
-- pasan a gestionarse en Abastecimiento → Proveedores (tabla `suppliers`).
--
-- A partir de ahora:
--   • rental_contracts.party_id (incoming)            → suppliers.id   (arrendador)
--   • rental_contracts.party_id (outgoing)            → rental_parties.id (cliente)
--   • rental_quote_requests.party_ids / responses[].partyId / awarded_party_id
--                                                     → suppliers.id   (arrendador)
--
-- Como `party_id` se vuelve POLIMÓRFICO (apunta a suppliers o a rental_parties
-- según la dirección), se elimina su FK a rental_parties.
--
-- Aditivo + idempotente. NO borra los rental_parties 'lessor' migrados (rollback
-- seguro): solo deja de usarlos y la UI los oculta. Dedup por (tenant_id, nombre).
-- =============================================================================

-- 0/1. Quitar la FK party_id → rental_parties + insertar arrendadores faltantes
--      como proveedores. El literal de `categories` se adapta al tipo real de la
--      columna (text[] o jsonb).
DO $$
DECLARE
  fk_name  text;
  cat_type text;
BEGIN
  -- 0. Eliminar la FK de party_id (cualquiera sea su nombre autogenerado).
  FOR fk_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)
    WHERE con.conrelid = 'public.rental_contracts'::regclass
      AND con.contype = 'f'
      AND a.attname = 'party_id'
  LOOP
    EXECUTE format('ALTER TABLE public.rental_contracts DROP CONSTRAINT %I', fk_name);
  END LOOP;

  -- 1. Tipo real de suppliers.categories (varía según cómo se creó el esquema).
  SELECT data_type INTO cat_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'suppliers' AND column_name = 'categories';

  IF cat_type = 'jsonb' THEN
    INSERT INTO public.suppliers
      (tenant_id, name, rut, email, phone, address, bank, account_type, account_number, notes, categories)
    SELECT rp.tenant_id, rp.name, rp.rut, rp.email, rp.phone, rp.address,
           rp.bank, rp.account_type, rp.account_number, rp.notes, '["Arriendo"]'::jsonb
    FROM public.rental_parties rp
    WHERE rp.party_type = 'lessor'
      AND NOT EXISTS (
        SELECT 1 FROM public.suppliers s
        WHERE s.tenant_id = rp.tenant_id AND lower(s.name) = lower(rp.name)
      );
  ELSE
    INSERT INTO public.suppliers
      (tenant_id, name, rut, email, phone, address, bank, account_type, account_number, notes, categories)
    SELECT rp.tenant_id, rp.name, rp.rut, rp.email, rp.phone, rp.address,
           rp.bank, rp.account_type, rp.account_number, rp.notes, ARRAY['Arriendo']::text[]
    FROM public.rental_parties rp
    WHERE rp.party_type = 'lessor'
      AND NOT EXISTS (
        SELECT 1 FROM public.suppliers s
        WHERE s.tenant_id = rp.tenant_id AND lower(s.name) = lower(rp.name)
      );
  END IF;
END $$;

-- 2. Mapeo arrendador viejo (rental_parties.id) → proveedor nuevo (suppliers.id).
--    Se define como CTE en cada statement (sin tablas temporales, para no disparar
--    la advertencia de RLS del linter de Supabase).

-- 3a. Re-apuntar los CONTRATOS que referenciaban a un arrendador viejo.
WITH lessor_map AS (
  SELECT DISTINCT ON (rp.id) rp.id AS old_id, s.id AS new_id
  FROM public.rental_parties rp
  JOIN public.suppliers s ON s.tenant_id = rp.tenant_id AND lower(s.name) = lower(rp.name)
  WHERE rp.party_type = 'lessor'
  ORDER BY rp.id, s.id
)
UPDATE public.rental_contracts c
SET party_id = m.new_id
FROM lessor_map m
WHERE c.party_id = m.old_id;

-- 3b. Re-apuntar la lista de invitados de las cotizaciones (jsonb array de ids).
WITH lessor_map AS (
  SELECT DISTINCT ON (rp.id) rp.id AS old_id, s.id AS new_id
  FROM public.rental_parties rp
  JOIN public.suppliers s ON s.tenant_id = rp.tenant_id AND lower(s.name) = lower(rp.name)
  WHERE rp.party_type = 'lessor'
  ORDER BY rp.id, s.id
),
agg AS (
  SELECT q2.id,
         jsonb_agg(COALESCE(m.new_id::text, e.elem) ORDER BY e.ord) AS new_ids
  FROM public.rental_quote_requests q2,
       LATERAL jsonb_array_elements_text(q2.party_ids) WITH ORDINALITY AS e(elem, ord)
  LEFT JOIN lessor_map m ON m.old_id::text = e.elem
  GROUP BY q2.id
)
UPDATE public.rental_quote_requests q
SET party_ids = agg.new_ids
FROM agg
WHERE q.id = agg.id
  AND q.party_ids IS DISTINCT FROM agg.new_ids;

-- 3c. Re-apuntar el arrendador adjudicado.
WITH lessor_map AS (
  SELECT DISTINCT ON (rp.id) rp.id AS old_id, s.id AS new_id
  FROM public.rental_parties rp
  JOIN public.suppliers s ON s.tenant_id = rp.tenant_id AND lower(s.name) = lower(rp.name)
  WHERE rp.party_type = 'lessor'
  ORDER BY rp.id, s.id
)
UPDATE public.rental_quote_requests q
SET awarded_party_id = m.new_id
FROM lessor_map m
WHERE q.awarded_party_id = m.old_id;

-- 3d. Re-apuntar el partyId dentro de cada cotización recibida (jsonb array de objetos).
WITH lessor_map AS (
  SELECT DISTINCT ON (rp.id) rp.id AS old_id, s.id AS new_id
  FROM public.rental_parties rp
  JOIN public.suppliers s ON s.tenant_id = rp.tenant_id AND lower(s.name) = lower(rp.name)
  WHERE rp.party_type = 'lessor'
  ORDER BY rp.id, s.id
),
agg AS (
  SELECT q2.id,
         jsonb_agg(
           CASE WHEN m.new_id IS NOT NULL
                THEN jsonb_set(r.resp, '{partyId}', to_jsonb(m.new_id::text))
                ELSE r.resp END
           ORDER BY r.ord
         ) AS new_resp
  FROM public.rental_quote_requests q2,
       LATERAL jsonb_array_elements(q2.responses) WITH ORDINALITY AS r(resp, ord)
  LEFT JOIN lessor_map m ON m.old_id::text = (r.resp->>'partyId')
  GROUP BY q2.id
)
UPDATE public.rental_quote_requests q
SET responses = agg.new_resp
FROM agg
WHERE q.id = agg.id
  AND q.responses IS DISTINCT FROM agg.new_resp;
