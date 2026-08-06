-- RFC-004 F3 — Arreglo del CHECK del enlace de arriendo
--
-- Mismo error que en 20260810000000, cometido de nuevo en la migración anterior:
-- un CHECK que evalúa a NULL **no rechaza nada**, porque Postgres sólo descarta
-- la fila cuando la expresión da FALSE.


--
--   CHECK (rental_request_id IS NULL OR service_kind = 'arriendo')
--
-- Con un producto enlazado, `service_kind` es NULL: la comparación da NULL, el
-- total queda `FALSE OR NULL` = NULL, y la fila entraba igual.
--
-- Regla para cualquier CHECK condicional de aquí en adelante: comparar sólo
-- después de exigir `IS NOT NULL`. Lo destapó el E2E de F3.
--
-- Verificado contra la base que ninguna fila viola la versión corregida antes
-- de validarla.

ALTER TABLE public.purchase_requests
  DROP CONSTRAINT IF EXISTS purchase_requests_rental_link_check;

ALTER TABLE public.purchase_requests
  ADD CONSTRAINT purchase_requests_rental_link_check
  CHECK (
    rental_request_id IS NULL
    OR (service_kind IS NOT NULL AND service_kind = 'arriendo')
  ) NOT VALID;

ALTER TABLE public.purchase_requests
  VALIDATE CONSTRAINT purchase_requests_rental_link_check;
