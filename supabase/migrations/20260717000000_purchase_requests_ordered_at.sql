-- purchaseRequestMutations.ts (markClientRequestsSent, updatePurchaseRequestStatus) y
-- rfqMutations.ts (awardRfq) escriben purchase_requests.ordered_at al pasar a status
-- 'ordered', pero la columna nunca se creó: toda transición a 'ordered' fallaba
-- (con error explícito en el flujo de suministro al cliente, y en silencio en la
-- adjudicación de RFQ porque ese UPDATE no revisa el error de retorno).
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS ordered_at timestamptz;
