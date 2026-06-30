# Changelog

Todos los cambios notables de **Pagnol** se documentan en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Como el proyecto aún no usa versiones semánticas, los cambios se agrupan **por fecha**.

Categorías: **Agregado** (nuevo), **Cambiado** (modificado), **Corregido** (bugs),
**Eliminado** (removido), **Seguridad** (RLS/permisos/datos).

> Nota: las entradas anteriores al 2026-06-20 se reconstruyeron retroactivamente a
> partir del historial de Git y notas de desarrollo, por lo que pueden ser menos
> detalladas que las entradas nuevas.

---

## [Sin publicar]

Cambios en el árbol de trabajo, aún sin commit/push.

### Corregido
- **Build de producción roto por `extract-rental-quote-flow.ts`**. El flow es `'use server'`
  pero exportaba esquemas Zod (`ExtractRentalQuoteInputSchema`/`OutputSchema`): un archivo
  `'use server'` solo puede exportar funciones async, así que `next build` fallaba al recolectar
  page data (`A "use server" file can only export async functions, found object`). `tsc --noEmit`
  no lo detecta (solo `next build`). Los esquemas/tipos no se usan fuera del archivo → pasan a ser
  locales (sin `export`). Validado con `next build` local.

### Seguridad
- **Cron de alertas de arriendo: endpoint `fail-closed`**. `GET /api/cron/rental-alerts` era
  *fail-open*: si `CRON_SECRET` no estaba en el runtime, `if (secret && …)` no bloqueaba nada y el
  endpoint quedaba **abierto** — cualquiera con la URL podía dispararlo y enviar push. Ahora: sin
  `CRON_SECRET` responde **503** ("Cron no configurado"); con secret pero sin el header
  `Authorization: Bearer <CRON_SECRET>` responde **401**. Sirve también de diagnóstico: abrir la URL
  en el navegador debe dar 401 (protegido) o 503 (falta la var), nunca `ok:true`.

### Agregado
- **Los equipos arrendados ahora son activos del módulo Pagnol (trazabilidad completa)**.
  Hasta ahora un equipo arrendado vivía SOLO en `rental_assets` (ligado al contrato, para lo
  financiero) y **no aparecía en `/dashboard/pagnol/activos`**, por lo que no tenía movimientos
  (quién retira/entrega), ficha técnica, mantenimiento/OT ni QR — todo eso cuelga de la tabla
  `materials` (en Pagnol, un "activo" es un `Material`; `type Asset = Material`). Ahora, **al
  confirmar la OC** del arriendo, cada `rental_asset` se **materializa** como un `Material`
  espejo marcado `ownership='arrendado'`, con `rentalContractId`/`rentalAssetId` para enlazarlos.
  Así hereda **toda** la trazabilidad de Pagnol sin reimplementar nada, y se registra un
  movimiento inicial de ingreso a inventario.
  - **Al devolver / cerrar** el arriendo (`closeRentalContract` / `returnRentalAsset`), el activo
    espejo se **archiva** (`archived=true`): sale del inventario operativo pero **conserva su
    historial** de movimientos/OT/ficha.
  - **Badge "Arrendado"** en cada tarjeta de activo (módulo Pagnol → Activos).
  - **Botón "Ingresar a inventario Pagnol"** en el detalle del contrato de arriendo
    (`rentals/contracts/[id]`): aviso + acción para materializar los equipos de **contratos ya
    activos** (los confirmados antes de este cambio). Idempotente (índice único por
    `rental_asset_id`): no duplica.
  - Soporte de datos: nuevas columnas `materials.ownership` (default `'propio'`),
    `materials.rental_contract_id`, `materials.rental_asset_id` (FKs ON DELETE SET NULL + índice
    único parcial). Tipos (`Material`), mapper, `addMaterial`, nueva mutación
    `materializeRentalContractAssets` (wired en DataProvider + `types.ts`). Migración
    `20260628000000_materials_rental_origin.sql`. **Aplicada en Supabase** (verificado 2026-06-28: funciona).

---

## [2026-06-21 — 2026-06-28] — Configuración de App, Arriendos (multi-ítem + OC + IA) y Autorización ADC

Commits: *Pagnol Solicitud de Arriendos*, *…01*, *…02*, *fix01 Dark Mode*.

> **Migraciones de este bloque: TODAS aplicadas en Supabase** (verificado 2026-06-28
> sondeando el esquema real de la base). Las notas "pendiente de aplicar" que aparecían
> aquí quedaron corregidas a "aplicada".

### Agregado
- **Módulo de Configuración de App (`/dashboard/configuracion`)**. Panel por tenant, gateado por el
  nuevo permiso `module_settings:view` (admin/soporte-pagnol lo tienen). Tres bloques:
  1. **Datos de la empresa**: nombre, RUT, representante legal + su RUT, dirección y faenas
     (editor de chips). Guarda vía `updateTenant`.
  2. **Logo**: subir/quitar (bucket `tenant-logos`, ≤2 MB) con vista previa; alimenta los PDFs.
  3. **Formato de correlativos (Opción A)**: prefijo base por tenant. Vacío = iniciales del nombre
     (histórico). Vista previa en vivo (`{PREFIJO}-OCA-0001`). Cambiarlo solo afecta documentos
     **nuevos** (el contador es continuo por tenant+tipo).
  - Acceso desde el menú de usuario (junto a "Mi Perfil") y sidebar contextual propio.
  - Soporte de datos: nueva columna `tenants.code_prefix` + `tenants.logo_url`/`code_prefix` ahora
    editables en `updateTenant` y mapeados en el `Tenant` (DataProvider + AuthProvider). El RPC
    `next_internal_code` consulta `code_prefix` como paso intermedio (override semántico →
    code_prefix → iniciales). Migración `20260626020000_tenant_code_prefix.sql`. **Aplicada en
    Supabase** (verificado 2026-06-28).
- **Botón "Emitir OC →" en el RFQ adjudicado (Abastecimiento → Arriendos)**. Tras adjudicar, el
  contrato y su OC se gestionan en otro módulo (Arriendos → Contratos) y no había forma directa de
  llegar: el usuario quedaba sin saber el siguiente paso. Ahora la tarjeta del RFQ **adjudicado**
  muestra un botón **"Emitir OC →"** que navega directo al detalle del contrato
  (`/dashboard/rentals/contracts/{id}`), donde están los pasos Generar OC → Enviar → Confirmar.
- **Cotizaciones de arriendo por IA (subir PDF → extracción por ítem)**. El arrendador manda su
  cotización en PDF; en vez de teclear 30 ítems × 3 proveedores a mano, ahora en "Registrar
  cotización" se **sube el PDF** y **Gemini extrae los precios por equipo**, los mapea a los ítems
  de la solicitud y precarga una **tabla editable** (precio / cantidad / períodos / total por
  ítem). El usuario **revisa y corrige** antes de guardar (decisión: revisión previa, no auto).
  - Nuevo comparador **matriz equipo × proveedor**: una fila por equipo, una columna por arrendador,
    con el **mejor precio de cada ítem resaltado** + fila de total por período. Así se ve "cuál
    conviene" línea por línea sin sumar a mano.
  - Modelo extendido: `RentalQuoteResponse.lines[]` (`RentalQuoteLine`: itemId, precio, cantidad,
    períodos, total) + `extractedByAi`. `pricePerPeriod`/`totalEstimate` globales se derivan de las
    líneas (compat con comparador de totales y adjudicación). Sin migración (`responses` es jsonb).
  - Nuevo flow `src/ai/flows/extract-rental-quote-flow.ts` (Gemini 2.0 Flash multimodal, lee el PDF
    inline, structured output con Zod, `temperature 0`, reintentos) + API route
    `/api/rentals/extract-quote` (auth por sesión + rate-limit). Requiere `GEMINI_API_KEY`.
  - **Nota:** la adjudicación sigue siendo por proveedor completo (mejor total); el comparador por
    ítem es para decidir. El PDF se procesa pero **aún no se guarda como respaldo** (siguiente paso).
- **Flujo de Orden de Compra (OC) en Arriendos**. Se cerraron tres huecos del flujo arriendo:
  1. **PDF de Solicitud de Cotización (RFQ)**: en cada RFQ de arriendo ahora hay **"Solicitud PDF"**
     (descarga el documento para pedir precio al arrendador, sin montos) y **"Enviar por correo"**
     (adjunta el PDF y lo manda a los arrendadores invitados vía `/api/purchasing/send-order`; al
     enviar marca el RFQ como enviado). Antes solo existía "Marcar enviado" sin documento alguno.
  2. **Desglose neto / IVA (19%) / total**: visible en el comparador de cotizaciones del RFQ y en
     el detalle del contrato de arriendo (tarjetas Neto/ciclo, IVA, Total/ciclo). El monto del
     contrato se trata como **neto** y se le aplica `tax_rate` (19% por defecto, configurable).
  3. **Paso de OC con activación diferida del calendario**: "Adjudicar" ya **no** genera el
     calendario de pagos de inmediato. El contrato queda **'pending'** con `oc_status='pending'` y
     número de OC (correlativo `OCA`). En el detalle del contrato hay una sección **Orden de
     Compra**: *Generar OC (PDF)* → *Enviar OC* (correo, marca `sent`) → *Confirmar OC*. Al
     **confirmar**, el contrato pasa a **'active'** y **recién ahí** se genera el calendario; el 1er
     vencimiento se cuenta desde la **confirmación + plazo de pago** (días configurables).
  - Nuevo generador `src/lib/pdf-rental.ts` (solicitud de cotización + OC) parametrizado con los
    datos de empresa del **tenant** (nombre, RUT, dirección, logo), no hardcodeados.
  - Migración `20260626000000_rental_oc_flow.sql` (columnas `oc_number`, `oc_status`, `oc_sent_at`,
    `oc_confirmed_at`, `payment_terms_days`, `tax_rate` en `rental_contracts`; backfill: contratos
    previos quedan con OC 'confirmed' para no atascarse). **Aplicada en Supabase** (verificado 2026-06-28).
  - Nuevas mutations `markRentalOcSent` y `confirmRentalOc`; `generateRentalSchedule` ahora acepta
    un ancla de fecha + offset para arrancar el calendario desde la confirmación de la OC.

### Agregado
- **Editor de correlativos por documento — prefijo Y tipo (Configuración → Formato de correlativos)**.
  Antes solo se podía definir un prefijo base único por empresa; ahora se listan **todos los
  documentos** que generan correlativo (Solicitud de material/compra/arriendo, Orden de Compra,
  Cotización, Recepción, Activo, Movimiento, Centro de costo…) y se editan **inline ambos segmentos**
  del código: `[prefijo] - [tipo] - 0001`. Vacío = hereda (el prefijo base de la empresa o la clave
  interna del tipo). Ej.: `PUR` → `OC` deja la OC como `ACME-OC-0001`. El texto gris de cada campo
  es el valor heredado. Nuevas columnas `tenants.code_prefixes` y `tenants.code_types` (jsonb) y
  nueva resolución en `next_internal_code`: prefijo = override por tipo → default semántico del
  sistema → prefijo base → iniciales; etiqueta de tipo = override → clave interna. **El contador
  sigue indexado por la clave interna estable** (p.ej. `PUR`), así que renombrar el segmento visible
  NO reinicia ni choca la numeración. Migraciones `20260626050000_tenant_code_prefixes.sql` (prefijo)
  y `20260626060000_tenant_code_types.sql` (tipo; superset idempotente, deja el esquema final aunque
  no se haya aplicado la 050000). **Aplicadas en Supabase** (verificado 2026-06-28: `code_prefixes`/`code_types` existen).

### Corregido
- **No se podía enviar la OC de arriendo por correo después de confirmarla**. Al confirmar la OC
  (que activa el contrato y genera el calendario), la sección cambiaba a la vista compacta que solo
  tenía "Descargar OC (PDF)" — el botón "Enviar OC" desaparecía, así que quien confirmaba antes de
  enviar se quedaba sin forma de mandarla. Ahora la vista de OC confirmada también ofrece **"Enviar
  OC"**, y el reenvío posterior **no revierte** el estado a 'enviada' (solo marca `sent` si aún
  estaba pendiente).
- **Arriendo multi-ítem: precio por equipo y total correcto en OC**. Al adjudicar una cotización con
  varios equipos, `awardRentalQuote` ponía el **total general** (`pricePerPeriod`, que es la suma de
  líneas) como precio unitario de **cada** activo → cada equipo aparecía con el total y la OC no
  reflejaba el desglose. Ahora cada activo toma el precio de **su línea** (`winner.lines` por
  `itemId`; cantidad incluida), así la suma de activos cuadra con el neto del contrato. La OC (PDF)
  ahora **se desglosa por equipo** (fila por activo con su precio unitario y subtotal) y el
  SUBTOTAL/IVA/TOTAL suma correctamente; guard que ancla al neto del contrato si los precios de
  activos antiguos (con el bug previo) no cuadran, para no inflar el total. En el detalle del
  contrato se añadió columna **Subtotal** por activo + línea **"Suma de activos / ciclo"** y un aviso
  si esa suma no coincide con el neto del contrato. *(Contratos ya adjudicados con el bug: corregir
  el precio unitario de cada activo en la tabla, o volver a adjudicar.)*
- **Bloque "Para responder, contacta a" ahora en TODOS los correos a proveedores**. Solo el correo
  de la OC (arriendos) incluía el bloque de contacto del remitente (nombre, cargo, correo, teléfono)
  + `reply-to`; el envío de **Solicitud de cotización** desde `purchasing/orders` no lo mandaba.
  Ahora esa llamada a `/api/purchasing/send-order` también pasa `companyName`, `companyLogoUrl`,
  `senderName/Email/Phone/Role` (vía `useAuth().user` + `currentTenant`), así el proveedor siempre
  sabe a quién responder. (Las 3 vías a proveedores —cotización de compra, cotización de arriendo y
  OC— quedan consistentes; los correos de sistema/auth no se tocan.)
- **`<Badge>` dentro de `<p>` causaba error de hidratación** en el detalle de contrato de arriendo
  (sección OC confirmada). Se cambió el `<p>` por un `<div>` flex (mismo aspecto), ya que `<Badge>`
  renderiza un `<div>` y HTML no permite `<div>` dentro de `<p>`.
- **El prefijo base de correlativos "se guardaba" pero al recargar volvía vacío**. Mismo patrón que
  el logo: la columna `tenants.code_prefix` podía no existir (migración `20260626020000` no aplicada
  del todo) → UPDATE silencioso. La nueva migración `20260626050000` incluye
  `ADD COLUMN IF NOT EXISTS code_prefix` como red de seguridad y `NOTIFY pgrst` para refrescar el
  cache de esquema. Además ahora el campo base se puede **vaciar** para volver a las iniciales
  (antes un valor vacío se ignoraba en el guardado).
- **Logo no persistía al recargar — "Could not find the 'logo_url' column of 'tenants'"**. La
  columna `tenants.logo_url` nunca se había creado en este proyecto: la migración antigua
  `20260611000000_tenant_logo.sql` (que la agregaba junto al bucket) no se aplicó, y la consolidada
  `20260626030000` re-creó el bucket pero **omitió el ALTER de la columna**. Al guardar el logo,
  PostgREST rechazaba el UPDATE por columna inexistente. Nueva migración idempotente
  `20260626040000_tenant_logo_url_column.sql` (`ADD COLUMN IF NOT EXISTS logo_url text` +
  `NOTIFY pgrst, 'reload schema'`). **Aplicada en Supabase** (verificado 2026-06-28).
- **"Bucket not found" al subir el logo**. El bucket `tenant-logos` (y sus policies de aislamiento
  por tenant) estaba definido en migraciones antiguas (`20260611000000`, `20260612000002`) que no
  se habían aplicado en el proyecto. Nueva migración consolidada e idempotente
  `20260626030000_tenant_logos_bucket.sql` que crea el bucket público y deja las policies finales
  (escritura acotada a `<tenant_id>/...`, lectura pública) en una sola pasada. **Aplicada en
  Supabase** (verificado 2026-06-28: bucket `tenant-logos` existe).
- **Número de OC legible y correlativo (no el UUID)**. Al adjudicar, el toast mostraba el UUID del
  contrato (`b032d0a4…`), que confunde. Ahora `awardRentalQuote` devuelve también el `ocNumber`
  correlativo (`{INICIALES}-OCA-0001`, vía `next_internal_code`) y el toast lo muestra: "Orden de
  Compra {ocNumber} lista para emitir". El correlativo ya existía; solo no se exponía.
- **Inputs de cantidad/precio no permiten negativos**. En la tabla de registro de cotización
  (precio/cantidad/períodos) y en la cantidad de la solicitud de arriendo, el spinner bajaba a -1.
  Se añadió `min` (precio ≥ 0; cantidad/períodos ≥ 1, `step` entero) y se descartan los signos
  negativos escritos a mano (sanea el `onChange`). Los ingresos quedan de 0 en adelante.

### Cambiado
- **Arrendadores unificados con Proveedores (un arrendador ES un proveedor)**. Antes los
  arrendadores vivían en `rental_parties` (`party_type='lessor'`), una tabla separada de
  `suppliers`. Al darlos de alta inline desde "Cotizar" no aparecían en Abastecimiento →
  Proveedores, así que no se podían completar/gestionar como el resto de proveedores. Ahora
  **los arrendadores se crean y gestionan directamente como `suppliers`**:
  - El alta inline de "Cotizar" crea un **proveedor** (`categories: ['Arriendo']`), no un
    `rental_party`; el selector de invitados a cotizar lee de `suppliers`.
  - `rental_contracts.party_id` se vuelve **polimórfico**: en contratos **entrantes**
    (arrendador) apunta a `suppliers.id`; en **salientes** (cliente) sigue apuntando a
    `rental_parties.id`. Se eliminó la FK `party_id → rental_parties` para permitirlo.
  - La resolución de nombre del arrendador (contratos, detalle, pagos, panel) busca primero en
    `suppliers` y cae a `rental_parties` (clientes / datos antiguos).
  - La página **Arrendadores y Clientes** muestra un aviso: los arrendadores ahora se gestionan
    en Abastecimiento → Proveedores; ahí quedan los clientes y los registros antiguos.
  - `addSupplier` ahora **devuelve** el proveedor creado (antes `void`) para poder invitarlo en
    el acto. Migración `20260626010000_unify_lessors_suppliers.sql`: inserta como `suppliers`
    los arrendadores existentes (dedup por tenant+nombre) y re-apunta contratos y cotizaciones
    (`party_ids`, `responses[].partyId`, `awarded_party_id`). Idempotente; no borra los
    `rental_parties` migrados. **Aplicada en Supabase** (verificado 2026-06-28).
- **Correo de cotización/OC: protagonismo del tenant + reply-to al remitente**. La ruta
  `/api/purchasing/send-order` (compartida por compras y arriendos) ahora acepta datos opcionales
  (`companyName`, `companyLogoUrl`, `senderName/Email/Phone/Role`, `docLabel`) y con ellos:
  (1) muestra el **logo / nombre del tenant** en el encabezado del correo; (2) fija **`reply-to` al
  correo del remitente** y añade un bloque **"Para responder, contacta a"** con nombre, cargo,
  email y teléfono — así el proveedor ya no responde al buzón de TeoLabs. El **From** se mantiene
  como "PAGNOL - Abastecimiento" (decisión de la usuaria; se afina luego). Los envíos de arriendo
  (solicitud de cotización y OC) pasan estos datos. (Compras puede adoptarlos: son opcionales.)
- **"RFQ" → "Cotización" en la UI de arriendos**. La sigla en inglés (Request For Quotation)
  confundía; en Abastecimiento → Arriendos ahora se lee "Cotizaciones", "Crear solicitud de
  cotización", etc. (el código interno sigue siendo `RFA-####`).

### Corregido
- **RFQ de arriendo bloqueado sin arrendadores precargados**: al crear una cotización (RFQ) de
  arriendo, si el tenant no tenía arrendadores el flujo se trababa ("Créalos en Arriendos →
  Arrendadores y Clientes", obligando a salir a otra pantalla). Ahora el diálogo de RFQ permite
  **dar de alta el arrendador inline** (input + "Agregar"), que queda **invitado automáticamente**
  a la cotización — sin abandonar el flujo SOLCOT → cotizar → comparar → adjudicar. (Mismo
  requisito que el RFQ de compras, que sí tenía proveedores precargados; pendiente replicar el
  alta inline allá si se desea.)
- **Notificaciones push: "doy clic y no pasa nada"**. Causa raíz: la tabla `push_subscriptions`
  **nunca se creaba** en una migración (el RLS consolidado solo la tocaba con `IF EXISTS`), así
  que en proyectos nuevos no existía → `/api/push/subscribe` devolvía 500 y el hook lo ignoraba
  (se marcaba "suscrito" sin guardar nada, y jamás llegaba un push). Además la función
  `usePushNotifications.subscribe` fallaba **en silencio** en cada rama (`return false` sin avisar
  al usuario). Correcciones: (1) nueva migración `20260625040000_push_subscriptions.sql` (tabla +
  índice único por endpoint + RLS own + GRANT) — **aplicada en Supabase (2026-06-25)**; (2) el hook ahora da
  **feedback con toast** en cada caso (sin soporte, sin VAPID, permiso denegado, error del
  servidor, éxito) y **verifica la respuesta** del POST antes de marcar como suscrito; (3) nuevo
  ítem **"Enviar notificación de prueba"** en la campana (cuando ya estás suscrito) que dispara un
  push a tu propio usuario vía `/api/push/send` para verificar el circuito completo end-to-end.

### Agregado
- **Compras consolidado en un solo módulo (Abastecimiento)**: el viejo `/dashboard/purchasing` y
  `/dashboard/abastecimiento` quedaban como dos módulos paralelos. Ahora **Abastecimiento es el
  flujo único y completo** (solicitud → RFQ/SOLCOT → comparar → OC → recepción → pago, con lotes,
  finanzas y costos). Se trajeron a su menú **Lotes de Compra** y **Finanzas** (wrappers
  `abastecimiento/lotes` y `abastecimiento/finanzas` que reutilizan las páginas de purchasing);
  se quitó la tarjeta "Módulo Compras" del hub y la tarjeta "Compras y Abastecimiento" ahora es
  visible para quien tenga `module_purchasing:view` **o** `module_abastecimiento:view` (nadie
  pierde acceso). Las rutas `/dashboard/purchasing/*` siguen existiendo (las reusan los wrappers).
- **Enviar la cotización/OC por correo al proveedor directamente**: en el generador de
  cotizaciones (Órdenes), cada cotización generada tiene ahora un botón **"Enviar"** que adjunta
  el PDF y lo manda **directo al correo del proveedor** (prellena `supplier.email`, permite editar
  destinatarios y un mensaje), sin descargar el PDF ni redactar un correo aparte. Nuevo endpoint
  `POST /api/purchasing/send-order` (reusa `sendEmail`/SMTP, mismo patrón que el envío de informes
  de terreno; con auth Bearer + rate-limit). El botón de Descargar PDF se mantiene.
- **Push automático al ADC cuando terreno crea una solicitud**: al crear una solicitud de
  material/compra/arriendo que queda **pendiente de autorización**, se dispara (fire-and-forget)
  un **push web a los autorizadores del tenant** (ADC y demás roles con permiso `*:authorize`,
  incl. admin/soporte por bypass), aunque tengan la app cerrada; el push lleva a
  `/dashboard/authorizations`. Si la solicitud entra **pre-autorizada** (la creó un ADC+), no se
  notifica. Piezas: helper de servidor `src/lib/push-notify.ts` (`sendPushToUsers` +
  `getUserIdsWithPermission`, que resuelve destinatarios por rol/permiso en el tenant), endpoint
  `POST /api/push/notify-authorizers`, y helper cliente `notify-authorizers.ts` llamado desde las
  mutaciones `add*`. `/api/push/send` se refactorizó para reusar `sendPushToUsers`. (No requiere
  migración nueva; sí depende de `push_subscriptions`, ya creada arriba.)
- **Autorización del Administrador de Contratos (ADC) como etapa previa a Abastecimiento**:
  quien solicita material / compra / arriendo es el supervisor (terreno) y ahora **necesita ser
  autorizado por el ADC** antes de que Abastecimiento/Pañol empiece a gestionar. Si quien crea
  ya puede autorizar (ADC o superior), la solicitud entra **pre-autorizada** y salta directo a
  Abastecimiento. Implementación **aditiva** (sin tocar los enums de estado): 2 columnas por
  tabla `adc_authorized_at` / `adc_authorized_by` en `material_requests`, `purchase_requests` y
  `rental_requests` (migración `20260625030000_adc_authorization.sql`, additiva + backfill de
  existentes como autorizadas — **aplicada en Supabase**, verificado 2026-06-28). Nuevos permisos
  `material_requests:authorize` / `purchase_requests:authorize` / `rentals:authorize` asignados
  al rol **adc** (y a director-faena); el rol ADC pasó de solo-informes a autorizador de
  solicitudes. Helper `userCan(user, permission)` para gating en mutaciones. Nuevas mutaciones
  `authorizeMaterial/Purchase/RentalRequest` (levantan el gate sin cambiar el `status`). Las
  `add*` pre-autorizan si el creador tiene el permiso.
- **Componente compartido `AuthorizationInbox`** (`src/components/operations/authorization-inbox.tsx`):
  bandeja de tarjetas Autorizar/Rechazar genérica sobre `ApprovableRequest`, único componente
  para la etapa ADC de los 3 tipos (en vez de duplicar el flujo). Diálogo de rechazo con motivo
  opcional, estado por ítem, modo solo-lectura si no hay permiso.
- **Página única "Autorizaciones"** (`/dashboard/authorizations`): bandeja del ADC con 3
  pestañas (Material / Compra / Arriendo) que reúsan `AuthorizationInbox`. Entrada en el hub
  central + nav lateral, gateada por `module_authorizations:view`.
- **Campana de Notificaciones con autorizaciones del ADC (tiempo real)**: la campana del header
  (panel derivado de colecciones realtime, ya tocaba sonido + app badge al subir el contador)
  ahora incluye un ítem **"N Solicitud(es) por Autorizar"** que enlaza a `/dashboard/authorizations`,
  combinando material/compra/arriendo según los permisos `*:authorize` del usuario. Como las
  solicitudes llegan por Supabase Realtime, al ADC **le salta la notificación (con sonido) en
  vivo** cuando terreno crea una solicitud, y entra a autorizar desde ahí. Los contadores de
  material/compra del pañol pasaron a contar solo lo ya autorizado (coherente con las colas). Las colas de Abastecimiento
  (`purchasing/purchase-requests`, `abastecimiento/arriendos`), del pañol (`pagnol/movimientos`,
  `bodega/requests`) ahora **filtran las pendientes sin autorizar** (solo ven lo aprobado por el
  ADC). En arriendos se quitó el Aprobar/Rechazar de Abastecimiento (ahora lo hace el ADC; este
  solo cotiza las autorizadas).
- **Cierre / devolución de arriendo**: la página de detalle de un contrato de arriendo
  (`rentals/contracts/[id]`) ahora permite **cerrar el arriendo** registrando la devolución
  del/los equipo/s. Botón **"Cerrar arriendo"** en el encabezado (visible para `active`/`pending`
  con permiso `rentals:manage_contracts`) → diálogo con fecha de devolución, toggle "eliminar
  cuotas futuras" y un **resumen de impacto** (cuántos equipos se devuelven, cuántas cuotas
  pendientes futuras se eliminan) + notas de cierre. En una sola operación
  (`closeRentalContract`): marca el contrato como **Finalizado** con `end_date`, marca todos los
  activos aún activos como **Devueltos**, y borra las cuotas **pendientes con vencimiento
  posterior** a la devolución (las vencidas y las pagadas no se tocan). También hay **devolución
  parcial por equipo** (botón "Devolver" por fila → `returnRentalAsset`) para multi-ítem, una
  columna **Estado** (En arriendo / Devuelto + fecha) en la tabla de activos, y un banner cuando
  el contrato está finalizado. Sin migración (reusa `rental_assets.status`/`end_date` y
  `rental_contracts.status`/`end_date` existentes).

### Cambiado
- **Códigos de Solicitud de Arriendo con prefijo semántico SOLPED**: antes el código usaba
  las iniciales del tenant (`SYPV-ARR-0001`); ahora usa un prefijo fijo **`SOLPED`** (SOLicitud
  de PEDido) → **`SOLPED-ARR-0001`**, más legible y consistente entre tenants. La RPC
  `next_internal_code` gana un 3er parámetro opcional `p_prefix` (NULL = comportamiento
  histórico de iniciales; no rompe ningún otro código); el contador sigue siendo por
  (tenant, tipo), así la numeración no se reinicia. Cambios: migración
  `20260625020000_internal_code_prefix_override.sql` (reemplaza la función + backfill de los
  códigos de arriendo existentes a SOLPED), `nextInternalCode()` acepta `prefix?`, y
  `addRentalRequest` pasa `'SOLPED'`. **Aplicada en Supabase (2026-06-25).**

### Agregado
- **Categorías de Arriendo gestionables por tenant**: la categoría de un equipo de arriendo
  dejó de ser un enum fijo (`machinery|truck|vehicle|measurement|other`). Ahora cada tenant
  puede **crear sus propias categorías** (p.ej. "Contenedores", "Andamios", "Generadores")
  desde el propio formulario de solicitud (botón **+** junto al selector → diálogo), para que
  solicitudes/activos/reportes sean más exactos. `RentalAssetCategory` pasó a `string`; los
  defaults viven en código (`RENTAL_CATEGORY_DEFAULTS`) y se **fusionan** con las custom de la
  nueva tabla `rental_categories` en la UI. Helper `rentalCategoryLabel()` centraliza la
  etiqueta (default → label; custom → su nombre). Nueva colección `rentalCategories` +
  mutaciones add/update/delete. Migración `20260625010000_rental_categories.sql` (tabla + RLS
  canónico + GRANT + realtime, índice único por tenant case-insensitive) — **aplicada en
  Supabase (2026-06-25)**.
- **Solicitud de Arriendo multi-ítem (carrito)**: la solicitud de arriendo ahora permite
  pedir **varios equipos en un solo pedido** (p.ej. 2 contenedores oficina + 1 baño + 1
  generador), igual que la solicitud de compra/material, en vez de una solicitud por equipo.
  `rental_requests` gana una columna `items` (jsonb: `{name, category, quantity}[]`); las
  columnas legacy `equipment_name`/`category`/`quantity` se conservan como **espejo del primer
  ítem** (compat + NOT NULL). El form (`supervisor/rental-request`) usa carrito con "Agregar
  equipo"; el módulo de Abastecimiento (`abastecimiento/arriendos`) muestra los ítems por
  solicitud y, al armar el RFQ, **expande** los ítems de cada solicitud seleccionada a líneas
  de cotización (`flatMap`). Migración `20260625000000_rental_requests_items.sql` (additiva +
  backfill de filas mono-ítem existentes) — **aplicada en Supabase (2026-06-25)**.
- **Solicitud de Arriendo + RFQ de arriendo (conecta Abastecimiento ↔ Arriendos)**: nuevo
  tercer tipo de solicitud, junto a Material y Compra, para pedir equipos de terceros
  (camión pluma, andamios, maquinaria…) que no son stock de bodega ni herramientas del pañol.
  Flujo: terreno crea la solicitud (equipo + categoría + período desde/hasta + modalidad +
  obra) en `supervisor/rental-request` → Abastecimiento la ve en `abastecimiento/arriendos`,
  aprueba/rechaza, crea un **RFQ paralelo** invitando a **arrendadores** (`rental_parties`
  tipo `lessor`), registra cotizaciones (precio por período + nº de períodos), compara y
  **adjudica**. Al adjudicar se **auto-genera** el `RentalContract` (incoming) + `RentalAsset`
  por equipo + calendario de pagos en el módulo Arriendos. Implementación:
  migración `20260624000000_rental_requests.sql` (tablas `rental_requests` +
  `rental_quote_requests`, RLS por tenant + GRANTs + Realtime); tipos `RentalRequest` /
  `RentalQuoteRequest` / `RentalQuoteResponse`; mappers; `rentalRequestMutations.ts` (el
  puente de adjudicación reusa `rentalMutations`); wiring en `DataProvider`/`types.ts`;
  permisos `rentals:request` y `rentals:manage_quotes` (admin + abastecimiento + jefe-terreno
  / jefe-oficina-técnica); entradas de menú en Abastecimiento y Supervisor.
- **Solicitudes de material asociadas a un contrato/obra**: el supervisor ahora debe
  seleccionar un **Contrato** (obligatorio, desde los contratos activos existentes) al crear
  una solicitud de material, dejando el antiguo campo de texto libre como **Detalle / Ubicación**
  opcional. Permite diferenciar a qué contrato pertenece cada pedido de los que gestiona
  Abastecimiento. Cambios: nueva migración `20260623000000_material_requests_contract.sql`
  (columnas `contract_id` FK→`contracts` ON DELETE SET NULL + `contract_name` denormalizado +
  índice); `MaterialRequest` (interfaz), mapper, mutaciones `addMaterialRequest` /
  `addAndApproveMaterialRequest` y firmas en `types.ts`. La vista de gestión
  (`bodega/requests`) y el historial del supervisor muestran ahora el contrato.
- **Selección de contrato según perfil (oficina vs. terreno)**: nuevo permiso
  `material_requests:select_any_contract`. Los perfiles de **oficina/altos mandos**
  (administrador, soporte-pagnol, director-faena, jefe-oficina-técnica, abastecimiento,
  finanzas, RRHH, gerente-general) pueden **elegir cualquier contrato activo** en el
  selector. El **personal de terreno** (supervisor, etc.) tiene su contrato **autocargado**
  desde su asignación en `contract_workers` (read-only, sin selector); si tiene varios
  asignados, elige entre los suyos; si no tiene ninguno, se le pide contactar al
  administrador. Implementado en `permissions.ts` y `supervisor/request/page.tsx`.
- **Solicitudes de COMPRA asociadas a un contrato/obra**: el formulario de Solicitud de
  Compra (`purchasing/purchase-request-form`, compartido con `supervisor`) ahora exige
  seleccionar un **Contrato**, con la misma lógica por perfil que las solicitudes de material
  (oficina elige cualquiera vía `material_requests:select_any_contract`; terreno autocarga el
  suyo desde `contract_workers`). El antiguo "Área / Proyecto" pasa a **Detalle / ubicación**
  opcional. El historial del solicitante y la gestión de compras (`purchasing/purchase-requests`)
  muestran el contrato. Cambios: migración `20260623020000_purchase_requests_contract.sql`
  (columnas `contract_id` FK→`contracts` ON DELETE SET NULL + `contract_name` + índice),
  `PurchaseRequest` (interfaz + mapper) y `addPurchaseRequest`. **Aplicada en Supabase**
  (verificado 2026-06-28: `purchase_requests.contract_id` existe).
  > Nota: la creación de materiales inexistentes ya estaba resuelta en este flujo (nombre por
  > texto libre; el material se crea al recibir la OC en `receivePurchaseRequest`).

### Corregido
- **`administrador`/`soporte-pagnol` perdían permisos nuevos por drift de la tabla `roles`**:
  `can()` resolvía con `dynamicRoles[role] ?? ROLES_DEFAULT[role]` (reemplazo, **no** merge pese
  al comentario), así que una fila guardada en `roles` **congelaba** los permisos del rol a lo que
  existía al guardarla, ignorando permisos agregados después en el código (`material_requests:select_any_contract`,
  `rentals:*`, `module_rrhh:view`, etc.). Síntoma concreto: en `supervisor/rental-request` (y
  material/compra) `soporte-pagnol` veía *"No tienes un contrato asignado. Contacta a tu administrador"*
  (rama de trabajador de terreno) porque `select_any_contract` no le llegaba. Se agregó en `can()`
  (`AuthProvider.tsx`) un **bypass de control total dentro del tenant** para `administrador` y
  `soporte-pagnol` (igual que el super-admin pero acotado por RLS), de modo que ambos siempre pueden
  operar todo sin depender de filas `roles` desactualizadas. Nota: el formulario aún exige un
  **contrato activo**; el seed DEMO no crea contratos, así que hay que crear uno en
  `attendance/contracts` antes de poder enviar una solicitud.
- **`addPurchaseRequest` no persistía el campo `area`**: el formulario lo enviaba pero el
  `insert` lo omitía, perdiéndose siempre. Ahora se guarda (junto con el contrato).
- **Módulo Supervisor invisible para el Administrador**: la tarjeta del hub
  (`dashboard/page.tsx`) estaba gateada por `material_requests:create`, permiso que el rol
  `administrador` no incluía pese a tener `return_requests:create` y `purchase_requests:create`
  (incoherencia con su "control total del tenant"). Se agregó `material_requests:create` a
  `ADMINISTRADOR_PERMISSIONS` en `permissions.ts` (cubre también `soporte-pagnol`). El admin
  ahora ve 19 tarjetas en el Panel Central (antes 18) y puede crear solicitudes de material.

### Cambiado
- **Dashboard de Supervisor (`/dashboard/supervisor`) — rework + Arriendos**: se integró el
  nuevo flujo de arriendo (métrica "Arriendos en gestión", acción rápida "Solicitar Arriendo"
  y pestaña "Arriendos" en el historial de actividad). Además se migró toda la página a
  **tokens semánticos** del design system (antes usaba paletas crudas `amber/blue/purple/red`
  que no respetaban dark mode): métricas, acciones rápidas, badges de estado y feed de
  actividad ahora usan `warning/info/primary/success/destructive` con mapas estáticos
  (dark-mode safe, sin clases dinámicas purgables).
- **Banner de onboarding — texto engañoso reformulado** (`onboarding-banner.tsx`): decía
  *"Falta crear roles críticos: Administrador"*, que sonaba a que el usuario no tenía el rol,
  cuando en realidad detecta la ausencia de una **cuenta de respaldo** (cuenta el rol
  excluyendo al usuario actual). Nuevo texto: *"Delegación Recomendada — Aún no tienes cuentas
  de respaldo para: {rol}. Crea una para no depender de un solo usuario."*
- **Modo oscuro — Migración a tokens semánticos (módulo `pagnol`)**: se reemplazaron las
  paletas crudas de Tailwind (`slate`/`gray`/`amber`/`green`/`blue`/`red`/`orange`) por los
  **tokens semánticos** del sistema de diseño, que sí se adaptan a dark mode. Cubre todo el
  módulo `pagnol` (referencia canónica): `personal`, `activos`, `movimientos`, `reports`,
  `carga-masiva`, `page.tsx`, `mantenimiento`, `invitaciones`, y `hardware/*`
  (`biometric-verification`, `liability-contract`, `qr-readers`, `label-printing`,
  `hardware/page`). ~2.000+ ocurrencias migradas. Mapeo aplicado: superficies → `bg-card`/`bg-muted`; texto →
  `text-foreground`/`text-muted-foreground`; bordes → `border`/`border-border`; estados →
  `success`/`info`/`warning`/`destructive` (+ variantes `-subtle`); cabeceras oscuras →
  `bg-pagnol-dark`; botones invertidos → `bg-foreground text-background`. `npx tsc --noEmit`
  sin errores tras la migración.
  - **Casos preservados (intencionales):** acentos claros sobre superficies siempre-oscuras
    (`bg-pagnol-dark`/`industrial-gradient`), overlays translúcidos (`bg-white/10`, `/5`),
    fondos fijos de impresión/QR (`bg-white` del código QR para que escanee), y los hex
    dentro de strings de jspdf/Recharts (no son clases Tailwind).
  - **Páginas que faltaban en la primera pasada (corregidas):** `invitaciones` y
    `hardware/label-printing` habían quedado sin migrar por completo (eran islas claras en
    dark). Migradas a tokens, incluyendo sus KPI cards `from-*-50 to-*-50` a `bg-*-subtle`.
  - **Follow-up cerrado:** los gradientes decorativos de KPI (`from-*-50 to-*-50`) de
    `hardware/*` se convirtieron a los tokens `success-subtle`/`info-subtle`/`warning-subtle`
    (sí tienen variante dark en `globals.css`). El acento *indigo* del wizard de integración
    ERP (`carga-masiva`) se conservó como identidad del bloque, pero eliminando sus
    fondos/sombras claros fijos (`-50`/`-100`/`-200`) y dejándolo solo en formas sólidas o
    translúcidas dark-safe.
  - **Texto invisible en dark (corregido tras verificación en navegador):** verificación
    visual del módulo en dark mode (login real + 13 páginas) detectó que `text-pagnol-dark`
    seguía usándose como **color de texto** sobre superficies que sí adaptan a oscuro
    (`bg-card`/`bg-background`/`bg-warning-subtle`), quedando texto negro sobre fondo oscuro
    (≈invisible). Reemplazado por `text-foreground` en 11 puntos: KPIs y títulos/filas de
    `mantenimiento` (disponibilidad, MTBF, MTTR, órdenes, "Órdenes de Trabajo (OT)",
    nombres de material), `activos` (COSTO UNIT. de cards + 3 textos de modales) y el tab
    activo de `reports` (`bg-card text-foreground`). Se conservó intacto el único caso
    intencional: `pagnol/page.tsx` `hover:bg-white hover:text-pagnol-dark` (texto negro
    correcto sobre hover blanco). Re-captura en navegador confirma KPIs y tabs legibles.
- **`FeedbackButton` normalizado a tokens (`src/components/feedback-button.tsx`)**: el botón
  flotante "Reportar Error" (presente en todas las páginas) y su panel "Feedback System"
  estaban escritos con paleta cruda (`slate-*`/`bg-white`/`red-*`). Ya funcionaba en dark
  vía pares `dark:` explícitos, pero no usaba el lenguaje del sistema de diseño. Migrado a
  tokens: botones invertidos → `bg-foreground text-background`; superficies →
  `bg-background`/`bg-card`/`bg-muted`; textos → `text-foreground`/`text-muted-foreground`;
  bordes → `border-border`; botón rojo de quitar imagen → `bg-destructive
  text-destructive-foreground`. Conservados `pagnol-orange` (focus ring), radios y
  animaciones. Sin cambio funcional. `npx tsc --noEmit` OK y verificación en navegador
  (botón flotante + panel abierto en dark y light) confirma legibilidad y coherencia.

### Agregado
- **Offline First — Pulido del módulo**:
  - **Tests del motor de sincronización** (vitest + fake-indexeddb): 12 tests sobre outbox
    (FIFO, removePendingFor, mirror por-tenant, retry/discard) y `syncOutbox` (insert idempotente
    con upsert, corte por error de red conservando el item, marca de error de validación sin
    bloquear la cola, `upload_photo`, `delete_file`). Nuevo script `npm test`.
  - **Aviso de nueva versión del Service Worker** (`ServiceWorkerUpdater`): el SW ya no se
    auto-activa (sin `skipWaiting` en install); cuando hay una versión en espera se muestra un
    toast "Nueva versión disponible" con acción **Actualizar** (envía `SKIP_WAITING` y recarga).
  - **Limpieza de huérfanos en Storage**: nueva op `delete_file`; al eliminar sin conexión una
    foto YA subida, se encola el borrado de su archivo en Storage (antes quedaba huérfano).
- **Offline First — Fase 1 (app-shell) + Fase 2 (autosave de OT)**:
  - Service Worker (`public/sw.js`) reescrito con *runtime caching*: navegaciones
    network-first con fallback a caché, `/_next/static/*` cache-first, imágenes/fuentes
    stale-while-revalidate; la API (`/api/*`) y Supabase nunca se cachean. La app ahora
    **carga sin conexión** tras una primera visita online. Push notifications preservadas;
    versionado de caché (`CACHE_VERSION`) con limpieza en `activate`.
  - Indicador global de conexión en la barra superior (`OfflineIndicator` +
    `useOnlineStatus`): "En línea" / "Sin conexión".
  - Capa de almacenamiento local con **Dexie/IndexedDB** (`src/modules/offline/db.ts`),
    con `requestPersistentStorage()` para evitar el desalojo en móviles.
  - **Autosave del borrador de OT** (`useOfflineDraft`): cada edición se persiste en
    IndexedDB con debounce y se vuelca al ocultar/cerrar la pestaña; sobrevive a recarga,
    cierre de la app y reinicio del dispositivo. Al reabrir se restauran los cambios
    locales sin sincronizar.
  - Badge de estado por-registro (`DraftStatusBadge`): Sincronizado / Pendiente de
    sincronizar / Pendiente (sin conexión) / Error de sincronización. Al guardar
    sin conexión, los cambios quedan a salvo en local con aviso al usuario.
  - Dependencia nueva: `dexie@^4`.
- **Offline First — Fase 3 (cola de sincronización + lectura offline)**:
  - **Outbox** FIFO en IndexedDB (`src/modules/offline/outbox.ts`): toda mutación de OT
    sin conexión se encola (insert/update/delete) en lugar de fallar.
  - **UUID generado en el cliente** para nuevas OT → el insert es idempotente (upsert por
    `id`); reintentar la cola nunca duplica.
  - **Motor de sincronización** (`sync.ts` + `useOfflineSync`, montado en el layout):
    drena la cola al recuperar conexión y al encolar; error de red aborta la corrida y
    reintenta (no marca error permanente); error de validación se marca y no bloquea la cola.
  - **Espejo de lectura local** (`mirror`) + `useOfflineCollection`: las OT creadas/editadas
    offline siguen visibles en lista y detalle aunque la colección del servidor venga vacía
    (cold-start sin conexión). El registro local prevalece hasta sincronizar; luego manda el
    servidor.
  - Mutaciones `createWorkOrder`/`updateWorkOrder`/`deleteWorkOrder` ahora son offline-aware
    (intentan red; si no hay, encolan + espejo). Al eliminar una OT con `insert` aún en cola,
    se cancela lo encolado sin tocar el servidor.
  - Indicador global ampliado: "Sin conexión · N" / "Sincronizando N…" / "En línea"; badge
    por-registro basado en el estado real del outbox.
- **Offline First — Fase 4 (fotos de OT sin conexión)**:
  - Tabla `blobs` en IndexedDB (`blob-store.ts`): la foto comprimida se guarda local hasta
    subirse. Nueva op de outbox `upload_photo`.
  - Captura offline en la OT: comprime, guarda el Blob, encola la subida y agrega una entrada
    "pendiente" visible al instante (object URL desde el Blob, vía `OfflinePhotoImg`); overlay
    "Pendiente" sobre la miniatura.
  - El motor de sync sube el Blob a Storage (`upsert` idempotente), firma la URL y la asocia al
    array `photos` del registro (read-modify-write), limpiando las marcas locales; luego borra
    el Blob. Respeta el orden FIFO (la OT se crea antes de subir sus fotos).
  - Eliminar una foto aún no subida cancela su subida y borra el Blob local; degradación
    automática a captura local si la subida online falla por red.
  - `WorkReportPhoto` ganó `localBlobId?`/`pending?` (solo locales; se eliminan al sincronizar).
- **Offline First — Endurecimiento (confiabilidad)**:
  - **Panel de sincronización** (`SyncStatusDialog`, se abre al hacer clic en el indicador del
    header): lista la cola, muestra errores con su mensaje y nº de intentos, y permite
    **Reintentar** / **Descartar** por item, "Reintentar fallidos" y "Sincronizar ahora". Antes,
    un error de validación dejaba el item atascado sin visibilidad.
  - **Candado entre pestañas** (`navigator.locks`): si otra pestaña ya está sincronizando, la
    corrida se omite (evita carreras update/delete). Degrada con gracia si no hay Web Locks API.
  - **Aviso de almacenamiento bajo** (`StorageWarning` + `useStorageWarning`): banner cuando se
    supera el 85% de la cuota o quedan <50 MB, para sincronizar antes de que falle un guardado.
  - El indicador del header ahora refleja también el estado de error ("N errores", destructive).
- **Offline First — Robustez (background sync, refresco y conflictos)**:
  - **Más disparadores de sincronización** (`useOfflineSync`): además de `online`/encolado, ahora
    reintenta al volver el foco/visibilidad de la pestaña y cada 30 s mientras haya pendientes
    (cubre señal intermitente de terreno donde `online` no se dispara).
  - **Background Sync best-effort**: el SW escucha el evento `sync` (`pagnol-sync`) y pide a las
    pestañas abiertas que sincronicen al recuperar conexión en segundo plano. (El SW no puede
    subir con la app totalmente cerrada porque la sesión de Supabase vive en localStorage de la
    página; documentado.)
  - **Refresco de la OT tras sincronizar**: cuando una foto local pendiente ya quedó subida, su
    URL real se refleja en pantalla sin recargar y sin tocar otras ediciones del usuario.
  - **Detección de conflicto**: al guardar con conexión, si la OT fue modificada por otra persona
    desde que se abrió (`updated_at`/`updated_by`), se pide confirmación antes de sobrescribir.
- **Panel Ejecutivo de Reportes** como página índice del módulo Work Reports
  (`/dashboard/work-reports`): KPIs (OT, diarios, semanales, HH, HM, % cumplimiento,
  OT incompletas, por aprobar), gráficos (HH por día, estado de reportes, HH por
  especialidad, consumo de materiales por área en CLP para gerencia), tablas
  accionables (OT incompletas, por aprobar, herramientas sin devolver, top
  materiales) y banda de alertas. Vista única adaptable por rol.
- **Campo `minStock` (stock crítico) en materiales**: migración `min_stock`, campo en
  formularios de crear/editar material; el Panel marca stock crítico real.
- **Campo `materialId` en OT**: selector de catálogo de bodega en el formulario de OT
  (permite material libre o del catálogo) para cálculo de costos exactos.
- **Housekeeping del PDF (pág. 4, formato SQM)**: foto opcional por punto en lugar del
  campo "Responsable".

### Cambiado
- **Reestructuración de rutas de Work Reports**: el índice del módulo ahora es el
  Panel Ejecutivo; el listado de Reportes Diarios se movió a
  `/dashboard/work-reports/reportesdiarios`. Nav del sidebar actualizado.
- **`can()` respeta la configuración de permisos por-tenant**: además de
  `ROLES_DEFAULT`, ahora consulta los roles dinámicos cargados desde la tabla `roles`
  (merge por-rol, base segura en código).

### Corregido
- **Dark mode — texto invisible en inputs de autenticación**: en login, register,
  reset-password y update-password el texto escrito no se veía en modo noche (texto
  con token claro sobre fondo claro fijo). Se fuerza texto oscuro en esos inputs.
- **Gestión de Permisos — error de RLS y switch que no persistía**:
  - La tabla `roles` no tenía política de escritura (`new row violates row-level
    security policy`).
  - La lectura de `roles` nunca ocurría porque `useSupabaseCollection('roles', …)` no
    recibía `tenantId` en las opciones y el fetch retornaba temprano → al recargar el
    switch se revertía.
  - El switch no daba feedback inmediato: se agregó actualización optimista con
    reconciliación contra el servidor.

### Seguridad
- **Permisos por-tenant**: la tabla `roles` pasó de global (solo lectura) a por-tenant,
  con `tenant_id`, PK compuesta `(id, tenant_id)`, RLS completo (escritura solo para
  administradores del propio tenant; super-admin sin restricción) y GRANTs explícitos.
  Aísla la configuración de permisos entre empresas.

### Migraciones (todas aplicadas en Supabase — verificado 2026-06-28)
- `20260621000000_material_min_stock.sql`
- `20260621010000_roles_per_tenant.sql`
- `20260623000000_material_requests_contract.sql`
- `20260623020000_purchase_requests_contract.sql`
- `20260624000000_rental_requests.sql`
- `20260625000000_rental_requests_items.sql`
- `20260625010000_rental_categories.sql`
- `20260625020000_internal_code_prefix_override.sql`
- `20260625030000_adc_authorization.sql`
- `20260625040000_push_subscriptions.sql`
- `20260626000000_rental_oc_flow.sql`
- `20260626010000_unify_lessors_suppliers.sql`
- `20260626020000_tenant_code_prefix.sql`
- `20260626030000_tenant_logos_bucket.sql`
- `20260626040000_tenant_logo_url_column.sql`
- `20260626050000_tenant_code_prefixes.sql`
- `20260626060000_tenant_code_types.sql`

---

## [2026-06-20]

### Agregado
- **Módulo Abastecimiento** (hub paraguas que reutiliza purchasing/payments/bodega/dte):
  Proveedores 360°, RFQ + Comparador de cotizaciones, Recepción ligada a OC, Costos
  (Centros de Costo), Reportes y Alertas. Fases F0–F5 completas con sus migraciones.

### Corregido
- **Realtime "hay que recargar"**: en proyectos Supabase nuevos la publicación
  `supabase_realtime` nace vacía; ninguna tabla emitía eventos, obligando a recargar.
  Se publicaron todas las colecciones tenant-scoped con `REPLICA IDENTITY FULL`.

### Migraciones
- `20260619010000_enable_realtime_publication.sql`

---

## [2026-06-15 — 2026-06-19] — Módulo Reportes de Trabajo

Commits: *Pagnol Modulo Reporte de Trabajos 00–06*.

### Agregado
- **Módulo Work Reports con arquitectura en cascada** OT (Orden de Trabajo) → Reporte
  Diario → Reporte Semanal, con generación de PDF en los tres niveles y firmas.
- **Réplica fiel del PDF formato SQM** (4 páginas) y modelo de datos híbrido
  (`wr_areas`, `wr_ots`, matriz HH×OT en JSONB).
- **Catálogos de precarga** para reportes (áreas, especialidades, hitos, y catálogo
  genérico: cliente/contrato/ubicación/turno/jornada).
- **Roles nuevos** del flujo de reportes: `jefe-operaciones`, `adc`, `gerente-general`,
  y cuenta interna `soporte-pagnol` (mismo nivel que administrador, scoped por tenant).
  Firmas de `jefe-operaciones` y `adc` en paralelo.
- **Módulo RRHH**: rol `recursos-humanos` + módulo (empleados, documentos, solicitudes).

### Cambiado
- **PDF al vuelo**: el PDF se genera en memoria sin guardarlo en Storage; compresión de
  fotos antes de incrustarlas.

### Corregido
- Crash de `SignaturePad`; PDF roto con imágenes WEBP/PNG; firma final que podía
  desaparecer del PDF; manejo de error del botón "Observar".
- **PDF con Chromium en Vercel**: el directorio `bin/` de `@sparticuz/chromium` no se
  incluía en el bundle; agregado a `outputFileTracingIncludes`.

---

## [2026-05-29] — Recuperación de contraseña

Commits: *Pagnol_Recuperaciondecontraseña 01–04*.

### Agregado
- Flujo de recuperación y restablecimiento de contraseña (`/reset-password`,
  `/update-password`).

---

## [2026-05-20] — Base inicial

### Agregado
- Versión inicial del proyecto **Pagnol**: ERP SaaS multi-tenant para faenas
  mineras/construcción sobre Next.js + Supabase, con módulos base (activos/Pagnol,
  bodega, asistencia, seguridad, compras, pagos, control de obra, usuarios, etc.).
