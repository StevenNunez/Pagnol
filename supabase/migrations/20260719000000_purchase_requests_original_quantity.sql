-- purchaseRequestMutations.ts escribe original_quantity al ajustar la cantidad
-- en la gestión ADC (updatePurchaseRequestStatus) y al registrar recepciones
-- parciales (receivePurchaseRequest), pero la columna nunca se creó. Rompía
-- "Gestionar" al cambiar la cantidad, y en receivePurchaseRequest el error no
-- se revisaba: el material/stock/kardex quedaban creados igual y el usuario
-- veía "recepción exitosa" pese a que el UPDATE final fallaba en silencio —
-- reintentar el mismo botón "Recibir" volvía a sumar stock duplicado.
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS original_quantity numeric;

-- Mismo patrón: updatePurchaseRequestStatus escribe approver_name al aprobar,
-- pero la columna solo existía en material_requests/salary_advances/rentals,
-- no en purchase_requests — "Aprobar" en Gestionar fallaba siempre.
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS approver_name text;
