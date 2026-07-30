-- =============================================================================
-- P0 SEGURIDAD — El bucket `contracts` deja de ser público
--
-- Detectado el 2026-07-30 auditando PENDIENTES.md contra el estado real. El
-- backlog lo describía como "permite listar", pero el sondeo de
-- /storage/v1/bucket devolvió `public=true`: sus objetos se servían SIN
-- AUTENTICACIÓN a cualquiera que tuviera la URL.
--
-- Qué guarda:
--   · `contracts/<solicitud>/…pdf`  — actas de entrega/devolución FIRMADAS, con
--     nombre, RUT y la firma del trabajador capturada en el cierre biométrico
--   · `return-evidence/…jpg`        — fotos de evidencia de devolución
--   · `ea-docs/<tenant>/…pdf`       — documentos EA (Dirección del Trabajo)
--
-- Son datos personales de trabajadores identificables. El Art. 1 del manifiesto
-- (aislamiento por tenant) no sirve de nada si el archivo se sirve sin auth.
--
-- El código ya no usa `getPublicUrl()`: guarda el PATH y firma la URL en el
-- momento de abrirla (`src/modules/core/lib/storage.ts` + <SecureFileLink>), con
-- expiración de 5 minutos. Las filas antiguas guardaron la URL pública completa y
-- siguen funcionando: el helper extrae el path de esa URL antes de firmar.
-- =============================================================================

-- ── 1. El bucket pasa a privado ──────────────────────────────────────────────
UPDATE storage.buckets SET public = false WHERE id = 'contracts';

-- ── 2. Quién puede leer y escribir ───────────────────────────────────────────
-- Con el bucket privado, `createSignedUrl` exige que el llamador tenga SELECT
-- sobre el objeto. Sin estas políticas nadie podría abrir un acta.
--
-- ⚠️ DEUDA CONSCIENTE — el alcance es "cualquier usuario autenticado", no "del
-- tenant dueño del archivo". La razón es que los paths NO son uniformemente
-- tenant-scoped: `ea-docs/` sí lleva el tenant, pero `contracts/direct/…` y
-- `return-evidence/…` no. Acotar por tenant exige migrar la convención de rutas
-- y reescribir los paths ya guardados, y eso es una tarea aparte.
--
-- Aun así el salto de seguridad es grande: se pasa de "cualquiera en internet con
-- la URL" a "un usuario autenticado de la plataforma". Queda anotado en
-- PENDIENTES.md para cerrarlo del todo.
DROP POLICY IF EXISTS "contracts_read_authenticated" ON storage.objects;
CREATE POLICY "contracts_read_authenticated" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'contracts');

DROP POLICY IF EXISTS "contracts_insert_authenticated" ON storage.objects;
CREATE POLICY "contracts_insert_authenticated" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'contracts');

-- El borrado lo usa `confirmEASentToDT`, que elimina el acta una vez enviada a la
-- Dirección del Trabajo (no conservar documentos laborales más de lo necesario).
DROP POLICY IF EXISTS "contracts_delete_authenticated" ON storage.objects;
CREATE POLICY "contracts_delete_authenticated" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'contracts');

-- Necesario para `upload(..., { upsert: true })` de los documentos EA.
DROP POLICY IF EXISTS "contracts_update_authenticated" ON storage.objects;
CREATE POLICY "contracts_update_authenticated" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'contracts');
