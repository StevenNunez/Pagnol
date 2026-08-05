-- RFC-004 F2 — Arreglo del CHECK de `service_kind`
--
-- El CHECK de la migración 20260809000000 NO rechazaba un servicio sin subtipo,
-- que es justo lo que debía impedir. Lo destapó el E2E.
--
-- Por qué fallaba: un CHECK sólo rechaza cuando evalúa a FALSE — si evalúa a
-- NULL, Postgres deja pasar la fila. Con request_type = 'servicio' y
-- service_kind NULL, la primera rama daba `TRUE AND (NULL IN (...))` = NULL y
-- la segunda FALSE, así que el total era `NULL OR FALSE` = NULL. Pasaba.
--
-- El arreglo es explicitar `IS NOT NULL`, para que la comparación no se evalúe
-- sobre un NULL y la rama dé FALSE de verdad.

ALTER TABLE public.purchase_requests
  DROP CONSTRAINT IF EXISTS purchase_requests_service_kind_check;

ALTER TABLE public.purchase_requests
  ADD CONSTRAINT purchase_requests_service_kind_check
  CHECK (
    (request_type = 'servicio' AND service_kind IS NOT NULL AND service_kind IN ('mantencion', 'otro'))
    OR (request_type IS DISTINCT FROM 'servicio' AND service_kind IS NULL)
  ) NOT VALID;

ALTER TABLE public.purchase_requests
  VALIDATE CONSTRAINT purchase_requests_service_kind_check;
