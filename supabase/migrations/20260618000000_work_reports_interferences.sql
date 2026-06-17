-- =============================================================================
-- Modulo Reportes de Trabajo - Interferencias / improductividad (Fase modelo 5)
-- Anade interferences (jsonb): filas ot/motivo/responsable/horas/n_trab que
-- alimentan la tabla "Improductividad / Interferencias" de la pagina 3 del PDF
-- SQM (hoy se renderiza vacia). Total HH se deriva en el cliente. Idempotente.
-- =============================================================================

ALTER TABLE public.work_reports
  ADD COLUMN IF NOT EXISTS interferences jsonb NOT NULL DEFAULT '[]'::jsonb;
