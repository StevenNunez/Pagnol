-- ════════════════════════════════════════════════════════════════════════════
-- Corrección de 20261027000000: el evento compra.recibida contaba otra historia
--
-- El aviso se arma al despachar y leía la cantidad ESPERADA de la línea de ese momento. Si
-- Valar corrige la cantidad entre la recepción y el envío (permitido: subirla, o bajarla hasta
-- lo recibido), el aviso de la primera recepción salía con la cantidad y el estado de después.
-- Hallado en el recorrido del demo (2026-10-21): «esperada 3» pasó a «esperada 4».
--
-- Cada línea recibida guarda ahora la cantidad esperada VIGENTE AL RECIBIR. Se copia con un
-- trigger al insertar (no hace falta tocar la función de recibir) y las anteriores se rellenan
-- con la cantidad actual de su línea (lo mejor que se sabe de ellas).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.expected_purchase_receipt_lines
  ADD COLUMN IF NOT EXISTS expected_qty numeric;

UPDATE public.expected_purchase_receipt_lines rl
   SET expected_qty = l.expected_qty
  FROM public.expected_purchase_lines l
 WHERE l.id = rl.line_id AND rl.expected_qty IS NULL;

CREATE OR REPLACE FUNCTION public.receipt_line_snapshot_expected()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  SELECT l.expected_qty INTO NEW.expected_qty FROM public.expected_purchase_lines l WHERE l.id = NEW.line_id;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.receipt_line_snapshot_expected() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_receipt_line_snapshot_expected ON public.expected_purchase_receipt_lines;
CREATE TRIGGER trg_receipt_line_snapshot_expected
  BEFORE INSERT ON public.expected_purchase_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION public.receipt_line_snapshot_expected();
