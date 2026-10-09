-- ════════════════════════════════════════════════════════════════════════════
-- Retiro con revisión posterior (etapa 2): nadie revisa su propio retiro.
--
-- La pantalla y la mutación ya lo impiden; esto lo cierra en la base, que es
-- la que manda. Reemplaza la política de INSERT de 20261007000000 (se aplica
-- después de ella; si aquélla aún no está aplicada, aplicar las dos en orden).
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "withdrawal_reviews_insert" ON public.withdrawal_reviews;
CREATE POLICY "withdrawal_reviews_insert" ON public.withdrawal_reviews
  FOR INSERT WITH CHECK (
    tenant_id = public.get_my_tenant_id()
    AND reviewer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.material_requests mr
      WHERE mr.id = request_id
        AND mr.tenant_id = withdrawal_reviews.tenant_id
        AND mr.requires_review
        -- En las entregas directas `supervisor_id` es quien retiró.
        AND mr.supervisor_id::text IS DISTINCT FROM auth.uid()::text
    )
  );
