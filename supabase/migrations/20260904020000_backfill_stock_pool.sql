-- =============================================================================
-- Stock que existe en el total y no aparece en el desglose por contrato
--
-- PROBLEMA: hay materiales con stock cuyo desglose (`material_stocks`) no tiene
-- ninguna fila. El invariante `sum(material_stocks.qty) == materials.stock` no
-- se rompe —no hay descuadre— pero ese stock **no está atribuido a ningún
-- lado**, así que el informe de Stock por Contrato muestra menos unidades que
-- el total y no explica la diferencia.
--
-- Son datos anteriores al ledger de stock por contrato: el material se creó
-- cuando ese desglose no existía. El código de hoy es correcto —`addMaterial`
-- llama a `addToLedger` cuando el stock inicial es mayor que cero—, así que
-- esto no se vuelve a generar. Es una limpieza de una sola vez.
--
-- MEDIDO CONTRA LA BASE VIVA antes de escribir esto:
--   · Valar (la empresa que entra en operación): 22 materiales, 26 unidades —
--     el 6,8% de su stock, todas herramientas reutilizables.
--   · Minera Demo: 1 material, 120 unidades. Minero Teo Labs: 1, 39 unidades.
--     Mine Gold: ninguno.
--   · Descuadres reales (total ≠ suma del desglose): **cero** en las cuatro.
--
-- QUÉ HACE: crea la fila que falta en el **pool central** (`contract_id` NULL,
-- `warehouse_id` NULL), que es exactamente lo que significa "stock de la empresa
-- todavía no asignado a un contrato ni a un pañol". No inventa una asignación:
-- si esas herramientas están en una faena concreta, el pañolero las transfiere
-- desde la pantalla, que es quien sabe dónde están.
--
-- Idempotente: sólo toca materiales que hoy no tienen NINGUNA fila de desglose,
-- así que re-ejecutarla no duplica nada.
-- =============================================================================

INSERT INTO public.material_stocks (tenant_id, material_id, contract_id, warehouse_id, qty)
SELECT m.tenant_id, m.id, NULL, NULL, m.stock
FROM public.materials m
WHERE COALESCE(m.stock, 0) <> 0
  AND NOT EXISTS (
      SELECT 1 FROM public.material_stocks s WHERE s.material_id = m.id
  );

-- Verificación: después de esto no debe quedar ningún material con stock y sin
-- desglose. Si queda alguno, se avisa en vez de dejarlo pasar en silencio.
DO $$
DECLARE faltan int;
BEGIN
    SELECT count(*) INTO faltan
    FROM public.materials m
    WHERE COALESCE(m.stock, 0) <> 0
      AND NOT EXISTS (SELECT 1 FROM public.material_stocks s WHERE s.material_id = m.id);
    IF faltan > 0 THEN
        RAISE WARNING 'Backfill de stock: quedaron % materiales con stock y sin desglose.', faltan;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
