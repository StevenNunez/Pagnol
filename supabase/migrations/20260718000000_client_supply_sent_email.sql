-- Guarda a quién se envió realmente el correo de suministro al cliente, para
-- poder mostrarlo en el historial y permitir reenviar (corregir un typo, o
-- mandarlo a otro contacto) sin perder el registro de a quién se le envió.
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS sent_to_client_email text;
