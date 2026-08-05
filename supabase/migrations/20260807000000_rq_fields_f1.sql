-- RFC-004 F1 — Campos del Requerimiento (RQ)
--
-- Agrega a `purchase_requests` los datos que faltaban para saber DE QUÉ BOLSILLO
-- sale cada gasto y CUÁN URGENTE es. No crea tablas ni toca RLS: las columnas
-- viajan en una tabla que ya está aislada por `tenant_id` (Artículo 1).
--
-- Artículo 2 (hechos inmutables): las filas históricas NO se reescriben. Quedan
-- con los campos nuevos en NULL, salvo `request_type`, que nace con default
-- 'producto' porque todo lo emitido hasta hoy ES un producto — el default hace
-- explícito un hecho existente, no lo cambia.

-- ── Tipo de requerimiento ────────────────────────────────────────────────────
-- La columna nace en F1 pero el formulario todavía NO deja elegir 'servicio':
-- `receivePurchaseRequest` siempre crea un Material y suma stock, así que un
-- servicio recibido hoy generaría un activo fantasma con stock 1 que además
-- entraría en la valorización del inventario (riesgo #1 del RFC-004). El
-- selector se enciende en F2, cuando la recepción sepa no tocar el pañol.
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS request_type text NOT NULL DEFAULT 'producto';

-- ── Ordinario / extraordinario = presupuestado vs imprevisto (D4) ────────────
-- v1: marca declarada por quien pide. Nace pensado para deducirse solo contra
-- `finance_budget_entries` (contrato × categoría) cuando esa tabla tenga datos.
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS expense_kind text;

-- ── Urgencia + fecha requerida ───────────────────────────────────────────────
-- `urgency` es la etiqueta que elige el solicitante; `needed_by` es la fecha
-- concreta que se calcula al crear. Se guardan las dos a propósito: "alta" sin
-- fecha deja de significar algo a los tres días, y sin la etiqueta no se sabe
-- con qué criterio se pidió esa fecha.
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS urgency text;
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS needed_by date;

-- ── Descripción por ítem ─────────────────────────────────────────────────────
-- `justification` sigue siendo el POR QUÉ del lote (común, obligatorio).
-- `item_description` es el QUÉ EXACTAMENTE de esta línea: marca, medida,
-- especificación. Es el dato que hoy se pierde y obliga a Abastecimiento a
-- llamar por teléfono antes de cotizar.
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS item_description text;

-- ── Proveedor sugerido ───────────────────────────────────────────────────────
-- Se guardan los dos: el id cuando lo eligió de la lista (sirve para armar la
-- OC y para el histórico del proveedor) y siempre el nombre, porque en terreno
-- la mitad de las sugerencias son proveedores que todavía no están dados de
-- alta. ON DELETE SET NULL: borrar un proveedor no puede borrar el hecho de que
-- alguien lo sugirió, pero tampoco puede dejar una referencia colgando.
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS suggested_supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS suggested_supplier_name text;

-- ── Dominios cerrados ────────────────────────────────────────────────────────
-- Los CHECK admiten NULL a propósito: las filas históricas no tienen estos
-- datos y no se van a inventar. Se agregan con NOT VALID + VALIDATE para no
-- bloquear la tabla mientras se revisan las filas existentes.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requests_request_type_check') THEN
    ALTER TABLE public.purchase_requests
      ADD CONSTRAINT purchase_requests_request_type_check
      CHECK (request_type IN ('producto', 'servicio')) NOT VALID;
    ALTER TABLE public.purchase_requests VALIDATE CONSTRAINT purchase_requests_request_type_check;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requests_expense_kind_check') THEN
    ALTER TABLE public.purchase_requests
      ADD CONSTRAINT purchase_requests_expense_kind_check
      CHECK (expense_kind IS NULL OR expense_kind IN ('ordinario', 'extraordinario')) NOT VALID;
    ALTER TABLE public.purchase_requests VALIDATE CONSTRAINT purchase_requests_expense_kind_check;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requests_urgency_check') THEN
    ALTER TABLE public.purchase_requests
      ADD CONSTRAINT purchase_requests_urgency_check
      CHECK (urgency IS NULL OR urgency IN ('alta', 'media', 'baja')) NOT VALID;
    ALTER TABLE public.purchase_requests VALIDATE CONSTRAINT purchase_requests_urgency_check;
  END IF;
END $$;

-- ── Índice para la bandeja ───────────────────────────────────────────────────
-- La bandeja de Abastecimiento ordena por "lo que vence primero" dentro de lo
-- que sigue abierto. Parcial para no indexar el histórico ya cerrado.
CREATE INDEX IF NOT EXISTS purchase_requests_needed_by_idx
  ON public.purchase_requests (tenant_id, needed_by)
  WHERE status NOT IN ('received', 'rejected');

COMMENT ON COLUMN public.purchase_requests.request_type IS
  'producto | servicio. RFC-004 D3: un servicio NO toca inventario al recibirse (habilitado en F2).';
COMMENT ON COLUMN public.purchase_requests.expense_kind IS
  'ordinario (presupuestado) | extraordinario (imprevisto). RFC-004 D4: declarado en v1, deducible contra finance_budget_entries más adelante.';
COMMENT ON COLUMN public.purchase_requests.needed_by IS
  'Fecha requerida, calculada al crear a partir de urgency (alta +1d, media +3d, baja +7d).';
COMMENT ON COLUMN public.purchase_requests.item_description IS
  'Especificación de ESTA línea (marca, medida, modelo). Distinto de justification, que es el motivo común del lote.';
