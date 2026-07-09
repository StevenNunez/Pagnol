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

### Seguridad
- **Endurecimiento pre-lanzamiento (P0 de la auditoría) — verificado end-to-end:**
  - **`/api/invite` ya no es un relay de correo abierto.** Antes cualquiera podía POSTear
    y disparar correos con branding Pagnol desde el SMTP propio (phishing + daño de
    reputación de dominio). Ahora exige `requireAuth` + permiso `users:create` + rate limit
    (30/h por IP). Los dos llamantes (`invitaciones/page.tsx`, `create-tenant-form.tsx`)
    adjuntan el Bearer con `authHeaders()`. Verificado: 401 sin sesión, 200 con admin.
  - **`/api/push/subscribe` ya no permite secuestrar notificaciones.** Antes tomaba
    `userId`/`tenantId` del body → un atacante registraba su dispositivo como suscripción
    de cualquier usuario. Ahora la identidad se deriva SIEMPRE de la sesión (`requireAuth`);
    el `DELETE` solo borra suscripciones propias (`endpoint` + `user_id`). Hook
    `use-push-notifications` actualizado. Verificado: 401 sin sesión, 200 con sesión.
  - **Contraseña por defecto pública eliminada** (`/api/users/create`). El fallback
    `'TemporaryPassword123!'` (constante en el código fuente) se reemplazó por
    `randomBytes(24)` aleatoria e irrecuperable; el usuario entra por QR/biometría o reset.
  - **Endpoint de prueba `/api/work-reports/pdf-test` eliminado** — encendía Chromium
    (`maxDuration 300`) sin auth (vector de costo/DoS). Verificado: 404.
  - **Security headers** en `next.config.js`: `X-Frame-Options: DENY` (anti-clickjacking
    del login), `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`
    (2 años) y `Permissions-Policy` (cámara/geo solo `self`, micrófono off). Verificados por curl.
  - **`remotePatterns` reducido** a los 2 hosts realmente usados (`picsum.photos`,
    `*.supabase.co`); se quitaron `images.unsplash.com` e `i.imgur.com` (superficie del
    Image Optimizer = vector de DoS/costo). El landing ya no usa Unsplash vía next/image.
  - **Dependencias:** `next` 16.1.4 → **16.2.10** (fix DoS del Image Optimizer),
    `nodemailer` → **9.0.3** (fix SMTP command injection vía CRLF), + `npm audit fix`.
    Quedan vulnerabilidades sin fix no-mayor: `jspdf` (ReDoS; requiere subir a v4 mayor) y
    la cadena `@genkit-ai`/`@opentelemetry` (transitivas, sin runtime expuesto) — evaluar aparte.

### Agregado
- **Entidad Cliente — jerarquía Empresa → Cliente → Contratos** (Fase 1 del modelo Valar).
  Antes el cliente era un string suelto (`contracts.client_name`), imposible de filtrar o
  agrupar. Ahora es una entidad real:
  - **Tabla `clients`** (nombre, RUT, contacto, estado) + `contracts.client_id` (FK). Interface,
    mapper, colección en `AppDataState`, mutaciones CRUD (`addClient`/`updateClient`/`deleteClient`)
    y wiring en `DataProvider`.
  - **Formulario de contrato:** el campo "Empresa mandante" (texto libre) pasó a ser un
    **selector de Cliente** con opción "+ Nuevo cliente…" para crear al vuelo y seleccionarlo.
    Se conserva `client_name` denormalizado para vistas legacy.
  - **Migración `20260708020000_clients_entity.sql` — PENDIENTE DE APLICAR:** crea la tabla,
    la FK, **backfill** (un cliente por cada `client_name` distinto + enlaza sus contratos),
    RLS por tenant, GRANTs y Realtime. Hasta aplicarla, crear/editar contratos con cliente falla.
  - Base para las Fases 2 (contrato al enrolar personal) y 3 (filtro Cliente→Contrato en pañol).
- **Activos — uploader de fotos** (`pagnol/activos`). Antes NO existía forma de subir
  fotos a un activo: el campo `photos` estaba en el modelo pero sin uploader en la ficha
  (el único era el de ficha técnica PDF) **y tampoco se persistía en las mutaciones** →
  todo activo mostraba "SIN FOTO" para siempre, sin salida. Ahora:
  - **Sección "Fotos del Activo"** en la ficha crear/editar: botón "Agregar" (archivo o
    **cámara** en móvil vía `capture`), multi-foto, thumbnails con botón de quitar.
  - Las imágenes se **comprimen en el navegador** (`compressImage`, máx 1600px) y se suben
    a Supabase Storage (bucket `asset-photos`, carpeta del tenant); se guarda la URL pública
    en `materials.photos`.
  - **Persistencia arreglada:** `photos` no se escribía en `addMaterial` ni `updateMaterial`
    (feature roto de punta a punta) — ahora sí.
  - **Migración `20260708010000_asset_photos_bucket.sql` — PENDIENTE DE APLICAR:** crea el
    bucket público `asset-photos` con policies por tenant (mismo patrón que `tenant-logos`).
    Hasta aplicarla, la subida falla (bucket inexistente). Verificado en navegador el render
    del uploader; la subida real se valida al aplicar la migración.
- **Activos — bandera "¿Requiere mantenimiento?"** (`pagnol/activos`). Ahora que las
  herramientas también son activos, no todos llevan plan de mantenimiento (un martillo no,
  un generador sí). Antes TODOS los activos mostraban la opción de mantenimiento.
  - **Nuevo campo `requiresMaintenance`** (columna `requires_maintenance`): toggle en la
    ficha de crear/editar, con **auto-sugerencia** por tipo de uso (ON para Activo Fijo /
    IT Controlado / Repuesto Crítico; OFF para Consumible / Herramienta Menor / Reutilizable),
    siempre editable a mano. Al activarlo aparece el campo "Próxima fecha de mantenimiento".
  - **UI de mantenimiento condicionada** a la bandera: el badge de mantenimiento (grid),
    la columna (lista → "No aplica"), el botón "Mantenimiento" de las acciones y el filtro
    "vencidos" solo aplican a activos que lo requieren.
  - **Módulo Mantenimiento:** el selector de activo de "Nueva OT" y el KPI de disponibilidad
    ahora solo consideran activos con `requiresMaintenance` (antes contaba todo el inventario,
    diluyendo la disponibilidad). Si no hay ninguno marcado, el selector lo explica.
  - **Bug latente corregido de paso:** `next_maintenance_date` no se escribía en NINGUNA
    mutación (el modal "Control de Mantenimiento" nunca guardaba la fecha). Ahora se persiste
    en `addMaterial` y `updateMaterial`.
  - **Migración `20260708000000_material_requires_maintenance.sql` — PENDIENTE DE APLICAR.**
    Añade la columna (default `false`) y hace backfill `true` donde ya había fecha de
    mantenimiento. **Requerida:** hasta aplicarla, crear activos falla (el insert referencia
    la columna nueva). Verificado en navegador el render/comportamiento del toggle; la
    persistencia queda validada al aplicar la migración.

### Cambiado
- **Activos — segmentación Activos/Consumibles + contador honesto** (`pagnol/activos`).
  La página lista TODOS los `materials` (fusión Bodega→Pagnol intencional), pero el contador
  "132 Activos" incluía 16 consumibles (stock que se agota, sin identidad individual). Ahora:
  - **Chips de segmento** "Todos / Activos / Consumibles" con su conteo (ej. 132 / 116 / 16),
    reutilizando el criterio de `usageType` (Consumible = no-activo). Filtran la vista en 1 clic.
  - **Contador honesto:** la píldora dice "N Ítems" (o "N Activos" / "N Consumibles" según el
    segmento activo), en vez de llamar "activos" a todo el inventario.
  - No se separó en dos módulos ni se migraron datos: se respeta el modelo unificado.
- **Activos — búsqueda con debounce** (`pagnol/activos`). El filtrado recomputaba sobre
  todo el inventario en cada tecla; ahora el input responde al instante pero el filtro real
  se aplica con 150 ms de retraso (sin lag en inventarios grandes).

### Corregido
- **Activos — modal "Control de Mantenimiento" no guardaba** (`pagnol/activos`). Enviaba
  vía `handleSubmit(handleSaveAsset)` con el schema completo (exige name/categoría/clase),
  pero `openMaintenanceModal` solo resetea 2 campos → la validación fallaba en silencio y
  la fecha/estado nunca se guardaban. Ahora usa un handler dedicado (`handleSaveMaintenance`)
  con actualización PARCIAL (fecha + estado), sin validar el schema completo. Combinado con
  el fix de persistencia de `next_maintenance_date`, el modal ya funciona.
- **Activos — placeholder de imagen y tamaño en mobile** (`pagnol/activos`, vista lista /
  detalle expandido — verificado en mobile 390×844 y desktop):
  - **Eliminado el placeholder falso `picsum.photos`:** los activos sin foto mostraban una
    imagen aleatoria descargada de internet (carga de red innecesaria + parecía que había
    foto). Ahora muestran un placeholder local limpio (ícono cámara + "Sin foto"),
    consistente con la vista grid. Verificado: **0 requests a picsum**.
  - **Imagen del detalle acotada en mobile:** en la fila expandida el contenedor era
    `w-full aspect-square` → en mobile (1 columna) ocupaba la pantalla completa. Ahora
    `max-w-[200px] mx-auto lg:max-w-none` — 200×200 en mobile, tamaño normal en desktop
    (llena su columna del grid de 4, sin cambios). Radio/borde también reducidos en mobile.
  - **`picsum.photos` removido de `remotePatterns`** en `next.config.js` (ya no se usa) —
    reduce aún más la superficie del Image Optimizer; único host remoto ahora: Supabase Storage.
- **Bugs mobile en diálogos y layouts sticky** (P1 de la auditoría — verificado en
  viewport 390×844):
  - **Doble botón "X" eliminado** en 8 diálogos con header temático propio que además
    pintaban la X default: `activos` (3: ficha, QR, reporte), `personal` (3: historial,
    permisos, ficha), `movimientos` (1: cámara/biométrico) y `enrollment-wizard` (1).
    Se les activó `hideClose` en `<DialogContent>`. Verificado: el modal "Registrar Activo"
    ahora muestra UNA sola X (la temática). **No tocados** (dependen de la X default, sin X
    manual propia): `carga-masiva`, `mantenimiento`, `authorization-inbox` (su X es el botón
    "Rechazar"), `onboarding-wizard`, `contract-stock-breakdown`.
  - **`sticky` sin breakpoint** en columnas laterales que colapsan a 1 columna en mobile
    (la card quedaba flotando sobre el contenido): `construction-control/wbs`,
    5× `safety/review-*` y `work-reports/[id]` → prefijados al breakpoint donde el grid es
    multi-columna (`lg:sticky lg:top-8` / `xl:sticky xl:top-4`). Mismo patrón que el fix
    previo de Gestión de Usuarios.

### Cambiado
- **Dark mode tokenizado en `attendance`, `profile` y `users`** (P1 de la auditoría —
  verificado en navegador, dark Y light, sin regresión):
  - **Neutros (slate):** ~80 usos de paleta cruda `slate-*` → tokens semánticos según el
    mapeo canónico de `pagnol` (`bg-muted`, `text-foreground`/`text-muted-foreground`,
    `border-border`, dots neutros `bg-muted-foreground`). Botones/toggles invertidos
    `bg-slate-900 text-white` → `bg-foreground text-background` (antes el texto blanco
    desaparecía sobre botón claro en dark).
  - **Colores de categoría/estado:** los mapas de color (presente=verde, ausente=rojo,
    día libre=índigo, licencia=ámbar, vacaciones=azul, turnos 5×2/7×7/…) NO caben en los
    4 tokens semánticos, así que se les añadieron **variantes `dark:`** (tinte translúcido
    `dark:bg-X-500/15`, texto claro `dark:text-X-300`, borde `dark:border-X-500/30`) que
    preservan el lenguaje de color y arreglan dark mode. Antes las tarjetas KPI "Dentro"/
    "Ausentes" (`bg-green-50`/`bg-red-50`) brillaban blancas en dark; ahora son tinte oscuro.
  - **Excluidas a propósito** (diseño fijo tipo tarjeta física / hoja de impresión):
    `profile/credential` (credencial digital navy) y `users/print-qrs` (hoja de QRs).

### Documentación
- **`PENDIENTES.md` (nuevo):** backlog priorizado de la auditoría pre-lanzamiento
  (P0 seguridad hecho, P1 en curso, P2 mejora continua) + el mapeo canónico de tokens.
- **`CLAUDE.md`:** documentada la sección **Biometría & Credenciales QR** (face-api en
  navegador, descriptores en `profiles.template`, modelos en `public/models`, flujo de
  enrolamiento por token `/enroll/[token]` + `qr_tokens`); mención de face-api/QR en el
  Stack; y agregadas las rutas `permissions/` y `profile/` al Module Map.
- **`README.md`:** actualizada la información al estado actual del producto —
  lista completa de módulos (Abastecimiento, Arriendos, Reportes de Trabajo en cascada,
  RRHH, Autorizaciones ADC, Estado de Pago, DTE, Configuración, Wallet, stock por
  contrato/pañol), tabla de stack ampliada (QR, offline Dexie, PDFs de servidor),
  biometría corregida a **verificación facial 1:1 en navegador**, y `src/modules/offline`
  en la estructura.
- **Landing (`src/app/page.tsx`):** corregida la biometría del producto —
  "DigitalPersona" (dato erróneo) → **reconocimiento facial (Face-API)**; y la tarjeta
  "Herramientas" reformulada a "Herramientas como Activos" para reflejar la fusión de
  herramientas dentro de la superficie única de Activos.

### Cambiado
- **Landing — quick wins + nuevo hero (verificado en navegador):**
  - **Modo claro SIEMPRE en rutas públicas** (`/`, `/pricing`, `/demo`): `forcedTheme="light"`
    por pathname en `theme-provider.tsx` — ignora el dark guardado en localStorage por
    usuarios del dashboard (verificado con puppeteer: landing claro con `theme=dark`
    almacenado; `/login` y dashboard conservan la preferencia). Se quitó el `ThemeSwitcher`
    del nav del landing (el toggle vive solo en el dashboard).
  - **Nuevo hero:** "El pañol digital de tu faena." — se eliminó el claim confuso
    "conectamos tu Sistema de Inventario o ERP"; copy directo sobre trazabilidad
    biométrica por contrato/pañol; chips reales (Verificación Facial, Funciona Sin Señal,
    Stock Multi-Contrato, Acta EA). El tagline "Control Total en el Corazón de la Faena"
    pasó al badge.
  - **Claims actualizados:** stats bar "12 Módulos" → "+20 Módulos Operativos",
    "100% Tiempo Real" → "Realtime + Offline"; intro del grid y CTA del footer alineados.
  - **Fundadores:** eliminadas las edades; eliminados los LinkedIn rotos/cruzados
    (`/GAC`, `/JRA`, `/FVA` → 404) y los íconos Twitter/Instagram/Facebook que apuntaban
    a `#` — solo se muestra LinkedIn cuando hay URL real (hoy: Steven).
  - **Footer:** eliminados los links muertos Privacidad/Términos/Soporte (`#`).
- **Landing fase 2 — capturas reales + narrativa "el pañol es el centro" (verificado
  en navegador, desktop y móvil):**
  - **Capturas reales del producto** (`public/img/landing/`, generadas con la cuenta
    demo vía puppeteer, retina 2x, limpiadas de banners de sesión): Movimientos en el
    hero, Gestión de Activos en la sección pañol y Mantenimiento (MTBF/MTTR/
    disponibilidad) en la sección ISO — reemplazan la ausencia total de evidencia
    visual (antes solo había una foto stock de Unsplash).
  - **Nueva sección "Todo empieza en el pañol"** (`#panol`): el flujo core en 4 pasos
    (Enrola → Verifica → Entrega y Devuelve → Trazabilidad Total).
  - **Nueva sección "Y crece con tu operación"** (`#suite`): la suite agrupada en
    4 frentes — Abastecimiento (ADC, RFQ+IA, recepción, proveedores 360°), Terreno
    (reportes SQM en cascada, OT offline), Personas (asistencia, remuneraciones, RRHH,
    CPHS) y Administración (arriendos, estados de pago, multi-empresa).
  - **Menú móvil (hamburguesa)** con los anchors de navegación — antes en celular no
    había navegación interna; botón "Comenzar" oculto en pantallas chicas para no
    saturar la barra.
  - Grid de módulos re-etiquetado como "El Núcleo — Módulo Pañol"; nav con anchors
    Pañol y Suite.

### Cambiado
- **Vistas legacy de préstamos migradas al modelo de activos.** El Panel Ejecutivo de
  Reportes de Trabajo ("Herramientas pendientes de devolución") y el Reporte de Inventario
  (tab Herramientas) leían `tool_logs`/`tools`, vacíos tras la migración herramientas→activos,
  por lo que siempre mostraban "todo devuelto"/"disponible". Ahora derivan los préstamos
  abiertos de solicitudes entregadas + devoluciones completadas (mismo modelo que
  `pagnol/herramientas`), con quién tiene cada herramienta y días sin devolver.

### Agregado
- **Jerarquía de categorías: Familia → Subcategoría** (ej: Herramientas → Herramientas
  Eléctricas / Manuales), aprobada con el usuario como parte del modelo "Pagnol = control
  total de activos" (naturaleza = tipo de uso; clasificación = categoría jerárquica;
  criticidad A/B/C ortogonal que ya gobierna la autorización de salida del pañol):
  - **Migración `20260703000000_material_categories_parent.sql` (PENDIENTE DE APLICAR):**
    columna `parent_id` autoreferente (ON DELETE SET NULL: borrar una familia deja a sus
    hijas como familias) + índice + check anti auto-referencia. Crear categorías planas
    sigue funcionando aunque no esté aplicada. Incluye además **saneo de duplicados**:
    el catálogo acumulaba categorías repetidas exactas (DEMO tenía 183 filas, decenas
    idénticas) — se deduplica por (tenant, nombre) y se agrega unique index para que no
    vuelva a ocurrir (seguro: los materiales referencian la categoría por nombre).
  - **Catálogos:** crear/editar categoría con selector "Familia" (solo 2 niveles: una
    familia con hijas no puede volverse subcategoría); lista agrupada familia →
    subcategorías indentadas; en búsqueda se muestra la familia junto a cada resultado.
  - **Activos:** nuevo filtro "Categoría" jerárquico — elegir una familia incluye todas
    sus subcategorías; la sugerencia de Tipo de Uso "Herramienta Menor" ahora también
    aplica cuando la FAMILIA de la categoría elegida es de herramientas.
  - **Herramientas:** filtro por subcategoría (las categorías presentes entre las
    herramientas registradas).
  - **Ficha de activo (modal crear/editar en Activos):** el selector "Categoría
    Logística" ahora muestra la jerarquía (familias en negrita, subcategorías
    indentadas) y se agregaron los campos **Fecha de Adquisición** (calendario) y
    **Proveedor** — ambos ya se persistían en la BD pero la ficha no los exponía.
  - **Formulario de Catálogos explícito:** toggle "¿Qué quieres crear? Familia /
    Subcategoría" (feedback del usuario: no era obvio que la familia se creaba
    dejando el padre vacío).

### Cambiado
- **Página Herramientas fusionada en Gestión de Activos** (decisión del usuario:
  "todo centralizado en Activos"). Lo que aportaba se movió antes de matarla:
  - **Activos muestra "En posesión de {trabajador}"** (tarjeta y lista) para los
    activos prestados, derivado de entregas − devoluciones (helper `tool-loans`);
    el buscador también encuentra activos por el nombre de quien los tiene.
  - **Impresión de QRs en lote generalizada**: `pagnol/activos/print-qrs` imprime
    credenciales de CUALQUIER activo (filtros por tipo de uso, categoría jerárquica
    y texto), con botón "Imprimir QRs" en la barra de Activos. Antes solo herramientas.
  - `/pagnol/herramientas` y su print-qrs son redirects (el primero aterriza en
    Activos con el filtro Herramienta Menor preaplicado vía `?tipo=`); la entrada
    "Herramientas" desapareció del sidebar; la alta rápida se reemplaza por
    "Registrar Activo" + sugerencia automática de tipo por categoría.

- **Lenguaje minero en toda la UI del pañol** (foco del producto: pañol de minería,
  ya sin módulo Bodega): barrido "Bodega→Pañol" y "obra→faena" en todos los textos
  visibles — Transacciones (Pañol → Faena / Faena → Pañol, rutas del kardex),
  Informes (Valorización en Pañol, Retorno a Pañol, Pañol Central), Solicitudes
  ("devoluciones desde faena"), Solicitudes de Compra ("ingreso al pañol"),
  placeholders (sector chancado), home ("activos, pañol, solicitudes y
  transacciones"), flujos del supervisor (Solicitar al Pañol, Contrato / Faena),
  purchasing/abastecimiento/reporte de entregas, etiquetas de permisos y pricing
  ("pañol de terreno"). Se conservan a propósito: "bodegas" en DTE (lenguaje SII),
  "Bodegas ordenadas" del checklist SQM (réplica fiel), y "Obra" en
  construction-control/work-reports/safety (dominios de construcción o campos de BD).

### Eliminado
- **Colección `toolLogs` y tipo `ToolLog`**: la página fusionada era su último lector
  (la tabla `tool_logs` está vacía en todos los tenants tras la migración
  herramientas→activos); una suscripción Realtime y una colección menos en el
  navegador. La colección `tools` legacy se conserva (asistente IA y fallback de
  nombres del panel Pagnol).

### Corregido
- **`pagnol/activos` no permitía crear herramientas (ni los demás tipos de uso canónicos).**
  El formulario y el filtro usaban la taxonomía legacy de Bodega (`Consumible/Retornable/
  Permanente`): todo activo nuevo quedaba como Consumible (una "herramienta eléctrica" nunca
  aparecía en Herramientas), elegir Retornable/Permanente violaba el constraint
  `materials_usage_type_check`, y editar una herramienta la degradaba a "Permanente"
  (`mapUsageType`). Ahora el formulario ofrece los 6 tipos canónicos con descripción
  (Consumible, Reutilizable Controlado, Herramienta Menor, Repuesto Crítico, Activo Fijo,
  IT Controlado), el filtro "Modelo de Uso" los usa y normaliza valores legacy guardados,
  y al elegir una categoría que contenga "herramienta" se sugiere automáticamente
  Herramienta Menor (sin pisar la elección manual).

### Agregado
- **Helper compartido `src/modules/core/lib/tool-loans.ts`**: `computeToolHolderMap` /
  `computeActiveToolLoans` reconstruyen la posesión de herramientas por event-sourcing
  (entregas/devoluciones en orden cronológico); `pagnol/herramientas`, el panel de
  work-reports y el reporte de inventario comparten esta única implementación.

### Eliminado
- **Código muerto del módulo de herramientas legacy** (sin importadores): `tool-checkout-card`,
  `edit-tool-form`, `generate-tool-form` y `toolMutations.ts` completo (add/update/delete/
  checkout/return/findActiveLogForTool) junto con sus firmas en el contexto. Las colecciones
  `tools`/`toolLogs` se conservan como historial de solo lectura (tarjeta legado en
  `pagnol/herramientas`, fallback de nombres en el panel Pagnol, contexto del asistente IA).

## [2026-06-29 — 2026-07-02] — Stock por Contrato/Pañol, Fusión Bodega→Pagnol, Beneficiario y Herramientas→Activos

Commiteado en `bd02368` y `d32437e`.

### Cambiado
- **Unificación Herramientas → Activos.** El sistema paralelo de herramientas (tabla `tools` +
  `tool_logs`, préstamo express sin stock/costo/contrato, herencia de la app de construcción)
  se unifica con los activos Pagnol:
  - **Migración `20260702130000_tools_to_materials.sql` (APLICADA 2026-07-02):** cada `tool` se
    materializa como `material` (usage_type 'Herramienta Menor', Clase C, unidad, categoría
    'Herramientas'). **Drift de esquema descubierto al aplicar la v1**: `tools` real NO tiene
    `qr_code` (tiene `serial_number`/`internal_code`/`assigned_to`, todos NULL en prod) y
    `tool_logs` usa `actual_return_date` (no `return_date`) y está **vacío** — el módulo legacy
    ya operaba sobre un esquema distinto al del código. La v2 usa las columnas reales y genera
    un serial determinístico `TOOL-XXXXXXXXXX` desde el id (idempotente), que es el QR que
    imprime la página nueva y reconoce el escáner de movimientos. Los **préstamos activos**
    (si existieran) migran como `material_requests` entregadas para que la devolución fluya por
    `pagnol/movimientos`; las tools "in-use" sin registro de préstamo migran como Disponibles
    con nota. Ledger y kardex consistentes; `tools`/`tool_logs` no se tocan (historial legado).
  - **`pagnol/herramientas` reescrita sobre materials:** alta rápida (activo Clase C con QR),
    estado y "en posesión de" reconstruidos desde solicitudes/devoluciones, renombrar/eliminar,
    CTA a Transacciones (Clase C se entrega al instante: identificar → escanear → firmar), e
    **historial del módulo antiguo** en tarjeta colapsable de solo lectura. Se retiró el panel
    de "Entrega y Devolución Rápida" que escribía en la tabla legacy (habría generado drift).
  - **`print-qrs` reescrita:** imprime QR de materials (`serialNumber`), con nombre del tenant.
  - Dashboard Pagnol: stats solo desde materials (contar `tools` legacy duplicaría);
    `reports/inventory` marca su pestaña de herramientas como "legado".
  - Beneficio: las herramientas ahora entran a valorización, stock por contrato, kardex,
    mantenimiento y al flujo de beneficiario, con verificación biométrica en cada entrega.

### Agregado
- **Beneficiario en solicitudes de material ("¿Quién retira?").** Separa quién solicita de
  quién retira — caso motor: el APR pide EPPs para un trabajador. Tres modos por solicitud:
  - **Yo mismo** (`self`, default): comportamiento histórico, retira el solicitante.
  - **Otro trabajador** (`directed`): la solicitud viaja dirigida a un beneficiario; en el
    pañol solo él puede retirarla (verificación biométrica del beneficiario, no del solicitante).
  - **Retiro abierto** (`open`): sin destinatario fijo; quien retira queda registrado al entregar.
  Piezas: migración `20260702120000_material_requests_beneficiary.sql` (**PENDIENTE DE APLICAR**
  en el SQL editor: `delivery_mode`, `beneficiary_id/_name`, `received_by_user_id/_name` + check +
  índice), selector "¿Quién retira?" en el formulario de solicitud (`supervisor/request`),
  y en `pagnol/movimientos`: al identificar biométricamente a un trabajador aparece el panel
  "N entregas listas para retiro" (dirigidas a él + propias + abiertas) con entrega en un toque;
  el botón "Entregar" de la tabla verifica al **beneficiario** cuando la solicitud es dirigida;
  toda entrega registra al **receptor real** (`received_by_*`) además del pañolero. La bandeja
  `pagnol/solicitudes` muestra "Retira: X" / "Retiro abierto" / "Recibió: X" y un aviso
  **"Sin retirar hace X días"** en aprobadas sin entregar (el stock ya salió al aprobar —
  decisión de mantener ese comportamiento en esta fase). La entrega inmediata biométrica
  (`addAndApproveMaterialRequest`) registra al trabajador identificado como receptor.

### Cambiado
- **Fusión de módulos: Bodega absorbida por el Módulo Pagnol (big-bang).** El módulo Bodega
  (herencia de la versión de construcción) desaparece como módulo independiente; toda su
  funcionalidad vive ahora bajo `/dashboard/pagnol` con la interfaz Pagnol. Los datos no se
  tocaron (ambos módulos ya operaban sobre las mismas tablas). Detalle del mapeo:
  - `bodega/requests` + `bodega/return-requests` → **`pagnol/solicitudes`** (página nueva:
    bandeja unificada con pestañas Retiros/Devoluciones y contadores de pendientes).
  - `bodega/tools` (+ `print-qrs`) → **`pagnol/herramientas`** (checkout/QR intactos).
  - `bodega/manual-stock-entry` → **`pagnol/ingreso-stock`**.
  - `bodega/warehouses` → **`pagnol/panoles`**.
  - `bodega/categories` + `bodega/units` → **`pagnol/catalogos`** (página nueva con pestañas).
  - `bodega/purchase-requests` → **`pagnol/solicitudes-compra`**.
  - `bodega/materials` → redirige a **`pagnol/activos`** (muere el CRUD duplicado de
    materiales; `activos` ya cubría archivo, edición, eliminación y desglose por contrato).
  - `bodega/permissions` (legacy) → redirige a `/dashboard/users`.
  - Todas las rutas `/dashboard/bodega/*` quedan como **redirects** — ningún bookmark se rompe.
  - Sidebar: el nav de Pagnol incorpora las entradas nuevas; el módulo "Bodega Central"
    desaparece. Home: la tarjeta "Módulo Bodega" se fusiona en la tarjeta Pagnol (visible para
    quien tenga `module_pagnol:view`, `module_bodega:view` o `module_warehouse:view`).
  - Permisos: el rol `abastecimiento` (tenía Bodega pero no Pagnol) recibe `module_pagnol:view`;
    `module_bodega:view` se conserva como permiso legado para roles por-tenant en BD.
  - El panel Pagnol hereda el widget **Stock Crítico** (top 5 con ≤10 unidades) del hub de
    Bodega para no perder funcionalidad.
  - Notificación push de aprobación y campanita del layout ahora apuntan a
    `pagnol/solicitudes` en vez de `bodega/requests`.

### Corregido
- **Herramientas: el botón "Sí, eliminar" del diálogo de confirmación no eliminaba.** En la
  página original de Bodega, el confirm llamaba a `onDelete()`, que solo seteaba un estado
  (`deleteCandidate`) que nadie consumía — la herramienta nunca se borraba. En la página
  migrada (`pagnol/herramientas`) el confirm llama directamente a `handleDelete()`.
- **Credenciales QR de herramientas imprimían "CONSTRUCTORA FERROACTIVA" hardcodeado**
  (herencia de la app de construcción). Ahora imprimen el nombre del tenant actual.
- **Gestión de Activos (pagnol/activos): no había forma de indicar cantidad al crear un activo
  Consumible.** El formulario "Registrar Activo" fijaba por código `usageType: 'Consumible'`,
  `unit: 'unidad'`, `stock: 1` sin ningún control visible — todo activo nuevo quedaba con
  cantidad 1 sí o sí (confirmado en datos reales de Valar: "Cemento especial Melon 25k" existía
  con `stock: 1`). Se agregó un selector **Tipo de Uso** (Consumible/Retornable/Permanente) y,
  cuando es Consumible, aparecen **Unidad de Medida** (texto libre con sugerencias — no un
  `Select` atado a la colección `units`, que en Valar está vacía y en otros tenants puede tener
  nombres duplicados) y **Cantidad Inicial**. Mismo formulario sirve para ADD y EDIT. Verificado
  de punta a punta (creación real vía navegador + BD: `stock`, `unit`, ledger `material_stocks`
  y kardex `stock_movements` quedan correctos). Archivo: `src/app/dashboard/pagnol/activos/page.tsx`.
- **Gestión de Usuarios: tarjeta "Crear Nuevo Usuario" invadía la lista en mobile.** Tenía
  `sticky top-8` sin condicionar al breakpoint; en el layout de una sola columna (mobile) la
  tarjeta quedaba fija cerca del top mientras la lista de usuarios scrolleaba por detrás,
  superponiendo avatares y texto. Ahora el sticky solo aplica desde `lg:` (donde el grid es
  realmente de 3 columnas). Archivo: `src/app/dashboard/users/page.tsx`.
- **Doble botón "X" superpuesto en diálogos con header propio** (p. ej. editar usuario en
  `<UserPanel>`, historial/permisos en `pagnol/personal`): `DialogContent` siempre dibujaba su
  botón de cierre por defecto además del que cada diálogo ya pinta a mano con el estilo del
  header industrial — en mobile el X genérico (sin contraste sobre el header oscuro) quedaba
  visible como un "fantasma" detrás del botón correcto. Se agregó el prop opcional `hideClose`
  a `src/components/ui/dialog.tsx` (default `false`, no afecta otros usos) y se activó en
  `<UserPanel>`.

### Agregado
- **Activos por Contrato y Pañol — Fase 3 (Reporte Stock por Contrato)**. Página nueva
  `/dashboard/reports/contract-stock` (entrada "Stock por Contrato" en el sidebar de Reportes):
  - **Valorización por contrato**: tarjetas con $ total (cantidad × `unitCost`), % del total y
    unidades por contrato; el pool central se destaca como valor "sin asignar a contrato";
    aviso de materiales sin costo unitario que no se valorizan.
  - **Matriz por contrato**: material × contrato (columnas dinámicas según contratos con
    existencias + pool central), con total y valorización por fila; búsqueda por material.
  - **Detalle por pañol**: filas planas material × contrato × pañol con filtros de contrato
    y pañol (incluye "Pool central" y "Sin pañol").
  - **Kardex del período**: movimientos filtrados por contrato/pañol/material con rango de
    fechas y resumen Entradas / Salidas / Neto; tipos etiquetados (Entrega, Devolución,
    Transferencia, etc.) con badges semánticos.
  - **Export Excel** (exceljs) con 3 hojas: Valorización, Matriz por contrato y Kardex del período.
  - Sin migración: todo se calcula de `material_stocks`, `stock_movements`, `contracts`,
    `warehouses` y `materials` ya presentes en el estado.
  - Verificado en navegador (puppeteer, tenant DEMO) + `tsc` + `next build`.

### Corregido
- **Transferencias entre contratos ahora estampan `warehouse_id` en el kardex** (asiento de
  entrada): el ledger ya guardaba el pañol destino pero el movimiento no lo registraba, por lo
  que el reporte mostraba "—" en la columna Pañol.
- **Activos por Contrato y Pañol — Fase 2 (CRUD de pañoles + scope del panolero)**:
  - **Página de administración de pañoles** (`/dashboard/bodega/warehouses`, entrada
    "Pañoles" en el sidebar de Bodega): tabla con encargado, contratos que atiende,
    existencias asignadas (suma del ledger) y estado; diálogo crear/editar con nombre,
    ubicación, encargado (panolero), contratos N:M (checkboxes), estado y notas; eliminación
    con confirmación (bloqueada por FK si el pañol tiene existencias). Acciones gated por
    `warehouses:manage`.
  - **Scope del panolero por pañol** en el flujo biométrico (`pagnol/movimientos`): si el
    usuario logueado es encargado de pañol(es) activos, la transacción queda imputada a su
    pañol (1 → autocarga; varios → chips para elegir "pañol que entrega/recibe").
    `addAndApproveMaterialRequest` y `addAndCompleteReturnRequest` aceptan `warehouseId`:
    se estampa en el kardex (`stock_movements.warehouse_id`), las devoluciones reingresan
    al ledger en ese pañol, y `consumeFromLedger` consume primero las existencias del pañol
    que entrega dentro de cada nivel de la cascada (contrato → pool → otros).
  - Verificado: `tsc --noEmit` limpio, `next build` OK, suite vitest offline 12/12.
- **Activos por Contrato y Pañol — Fase 1 (aplicación completa)**. Todo el ciclo de stock
  respeta ahora el desglose por contrato (`material_stocks`):
  - **Motor de ledger** (`src/modules/data/mutations/stockLedger.ts`): `addToLedger` (upsert),
    `consumeFromLedger` (cascada contrato → pool central → otros contratos, devolviendo el
    origen real para anotar el kardex) y `transferInLedger` (transferencia estricta, sin cascada).
  - **Integración en TODOS los flujos que tocan stock**: entrega de pañol (inmediata y por
    aprobación), devoluciones (pendiente/inmediata), recepción de OC (`goods_receipts`, calce
    ítem→solicitud por id o por nombre), recepción directa de solicitud de compra, ingreso
    manual (pool central), ajuste de stock desde edición (delta sobre pool con cascada), alta
    de material con stock inicial, materialización de equipos arrendados (heredan el contrato
    de la solicitud de arriendo) y carga masiva (`/api/bulk-upload`, pool central + recálculo
    del pool en updates).
  - **Transferencias entre contratos** (`warehouseMutations.transferMaterialStock`): permiso
    nuevo `stock:transfer` (administrador y pañolero), doble asiento en kardex tipo
    `contract-transfer`, el total no cambia.
  - **CRUD de pañoles** (mutaciones `addWarehouse`/`updateWarehouse`/`deleteWarehouse` +
    permiso `warehouses:manage`; la página de administración queda para Fase 2).
  - **UI**: componente compartido `<ContractStockBreakdown>` (desglose por contrato + diálogo
    de transferencia + alerta de drift) integrado en la fila expandida de Activos; filtro
    "Contrato" en Activos (incluye "Pool central"); chip de contrato en la tabla de
    Movimientos; disponibilidad "N contrato · M pool" en el selector de materiales de la
    solicitud del supervisor.
  - **Scoping por trabajador (contract_workers)**: el flujo biométrico del pañol imputa el
    despacho/devolución al contrato del trabajador identificado (1 contrato → autocarga;
    varios → el pañolero elige; ninguno → pool central con aviso). Las solicitudes de
    material ya venían scoped (`material_requests:select_any_contract`).
  - Kardex (`stock_movements`) registra `contract_id`/`contract_name`/`warehouse_id` y la
    justificación anota el fallback de origen ("Incluye N de pool central").
  - Verificado: `tsc --noEmit` limpio, `next build` OK, suite vitest offline 12/12.
- **Activos por Contrato y Pañol — Fase 0 (migración)** (`supabase/migrations/20260701010000_warehouses_material_stocks.sql`,
  ✅ **aplicada en Supabase el 2026-07-01**). Base de datos para diferenciar los activos según
  el contrato/proyecto al que pertenecen (caso Valar: contrato Torres vs. Miscelánios) y el
  pañol donde están:
  - `warehouses` (pañoles) + `warehouse_contracts` (N:M — un pañol puede atender varios
    contratos o un contrato tener su propio pañol).
  - `material_stocks`: desglose de existencias material × contrato × pañol. La ficha del
    material sigue siendo única y `materials.stock` sigue siendo el total; `contract_id NULL`
    = pool central de la empresa. Índice único `NULLS NOT DISTINCT` para upserts deterministas.
  - Kardex (`stock_movements`) y devoluciones (`return_requests`) ganan `contract_id`
    (+ `contract_name`, + `warehouse_id` en kardex) para registrar de qué contrato salió/reingresó.
  - RLS por tenant, GRANTs, Realtime y **backfill**: todo el stock existente queda como pool
    central (sin contrato) y se repartirá con la acción de transferencia (Fase 1).
  - CLAUDE.md: actualizado (tests de vitest, migraciones manuales, módulo offline, gotchas
    `use server`/RLS, mapa de módulos completo).

### Cambiado
- **Panel unificado de usuario (Capa 3)**. Se creó `<UserPanel>` (`src/components/user-panel.tsx`):
  un único diálogo con pestañas — **Identidad · Contrato/RRHH · Biometría · Seguridad ·
  Permisos** — que reemplaza las ventanas dispersas que editaban al mismo usuario. Las
  pestañas se muestran/ocultan según el permiso de quien lo abre (`users:edit`,
  `hr_employees:edit`, `users:create`/`pagnol:enroll_personal`, `permissions:manage`) y hay
  un modo `self` para Mi Perfil. Reutiliza `<UserIdentityFields>`, el `EnrollmentWizard`, los
  diálogos de contraseña/correo y el nuevo `<UserPermissionsEditor>`.
  - Se extrajo `<UserPermissionsEditor>` (`src/components/user-permissions-editor.tsx`) como
    fuente única del selector de autorizaciones; Gestión de Personal ahora lo reutiliza en vez
    de su copia inline.
  - Recableado: Módulo Usuarios, Mi Perfil y Ficha de RRHH ahora abren `<UserPanel>`. Se
    **eliminó** `edit-user-form.tsx` (su rol lo cumple el panel).
  - `<UserIdentityFields>` ganó `emailReadOnly` para editar identidad sin desbloquear el correo.
- **Consolidación de formularios de usuario (Capa 2, anti-duplicación)**. Los campos de
  identidad (nombre, RUT, email, rol, ID interno, contraseña, teléfono) que estaban
  duplicados entre `CreateUserForm` y el paso "info" del `EnrollmentWizard` se extrajeron a
  un componente compartido `<UserIdentityFields>` (`src/components/user-identity-fields.tsx`),
  genérico sobre el tipo del form (react-hook-form) y con props para layout (1/2 columnas),
  contraseña/teléfono opcionales y campos de solo-lectura. La ficha de RRHH
  (`rrhh/empleados`) se dejó **deliberadamente aparte**: usa otro permiso (`hr_employees:edit`,
  no `users:edit`), otro subconjunto de campos y otra UX; fusionarla habría acoplado cosas
  separadas y roto su modelo de permisos.
- **Consolidación de formularios de usuario (Capa 1, anti-duplicación)**. Los puntos que
  crean/editan usuarios (Crear Usuario, Enrolar, Invitar, Editar) compartían lógica copiada.
  Ahora hay fuentes únicas:
  - `useAssignableRoles()` (`src/modules/core/hooks/use-assignable-roles.ts`) — encapsula la
    lógica "roles del plan ∩ ROLES_ORDER, sin super-admin salvo super-admin". Reemplaza **3
    copias** (create-user-form, invitaciones, enrollment-wizard).
  - `<RoleSelect>` (`src/components/role-select.tsx`) — selector de rol único; pinta labels
    desde `ROLES` y siempre incluye el valor actual aunque el plan ya no lo permita.
  - `generateUserInternalId()` (`src/modules/core/lib/user-internal-id.ts`) — un solo
    generador de ID interno con algoritmo robusto (máx+1, tolera `PAG-####` y el viejo
    `PAG-EMP-####`). Antes había **dos formatos distintos** (personal usaba `PAG-`, crear
    usuario usaba `PAG-EMP-` con `length+1` frágil).
  - Se eliminaron los `z.enum([...24 roles a mano...])` **hardcodeados** en create/edit user
    form (ahora derivan de `ROLES_ORDER`), que se desincronizaban al cambiar roles.

### Agregado
- **Autorizaciones por usuario (permisos específicos)**. El modal de "Permisos" en Gestión
  de Personal pasó de un único toggle a un **selector completo de permisos agrupado con
  búsqueda**: marca/desmarca permisos puntuales para un trabajador (se guardan en
  `granted_permissions`, aditivos sobre el rol; los heredados del rol se muestran como
  bloqueados/"heredado"). Permite, p.ej., dar SOLO "Enrolar Personal" a un usuario de Calidad.

### Seguridad
- **RRHH puede editar la ficha sin acceso a datos sensibles (API service-role acotada)**.
  El rol `recursos-humanos` no es `is_tenant_admin()`, así que editar la ficha de otro
  empleado vía `updateUser` (cliente anon) chocaba con RLS. Nueva API `/api/users/hr-update`
  (service role) gateada por `hr_employees:edit` que escribe **solo** columnas de RRHH
  (cargo, teléfono, dirección, nacimiento, contacto de emergencia, estado laboral) — NUNCA
  rol, sueldo, previsión ni KYC. El `<UserPanel>` enruta el guardado por esta API cuando el
  actor es RRHH puro, y oculta los campos de identidad/nómina para ese rol. Alternativa más
  segura a meter `recursos-humanos` en `is_tenant_admin()` (que le habría dado acceso a KYC).
- **RLS: un admin del tenant no podía actualizar perfiles de OTROS usuarios**. La única
  policy de UPDATE en `profiles` era `profiles_update_own` (solo el propio perfil o
  super-admin). Por eso `updateUser()`/`updateUserPermissions()` (cliente anon) hacían
  UPDATE de 0 filas **sin error** y no persistían: enrolar biometría a un usuario existente,
  delegar permisos o editar datos de RRHH de otro trabajador "no hacían nada". Nueva
  migración `20260701000000_profiles_admin_update.sql` añade `profiles_update_tenant_admin`
  (`is_tenant_admin() AND tenant_id = get_my_tenant_id()`). El trigger anti-escalada no
  estorba (solo aplica al editar la propia fila). **Pendiente de aplicar en Supabase.**

### Corregido
- **Enrolamiento de usuarios existentes no quedaba guardado ("como si nada")**. Al enrolar
  biometría a un trabajador ya creado, el wizard usaba `updateUser()` por cliente anon y RLS
  lo bloqueaba en silencio. Ahora pasa por una API service-role dedicada
  (`/api/users/enroll`) que además guarda los documentos KYC en `profile_documents` (antes
  ese flujo ni los guardaba). Como defensa, `updateUser`/`updateUserPermissions` ahora usan
  `.select()` y lanzan error explícito si el UPDATE afecta 0 filas (RLS).
- **El permiso "Enrolar Personal" (`pagnol:enroll_personal`) no servía para nada**. Estaba
  definido y se podía delegar, pero el botón de enrolar y la API exigían `users:create`, así
  que darlo no habilitaba a nadie. Ahora el botón (`personal/page.tsx`) y las APIs
  (`/api/users/create` y `/api/users/enroll`) aceptan `users:create` **o**
  `pagnol:enroll_personal`. Un rol como Calidad ya puede ayudar a enrolar sin control total
  de usuarios.
- **Modal "Registro de Personal" mostraba solo 4 roles al enrolar**. `EnrollmentWizard`
  tenía hardcodeada la lista `pagnolRolesAssignable` (`administrador`, `panolero`,
  `supervisor`, `operador`), así que no se podían enrolar trabajadores con el resto de
  roles del plan. Ahora el selector de rol usa los roles del plan del tenant (mismo criterio
  que el Centro de Invitaciones), excluyendo `super-admin` salvo que el actor lo sea.
- **Invitados no aparecían en "Gestión de Personal" (módulo Pagnol)**. El perfil se creaba
  bien al aceptar la invitación (`/api/invite/accept`), pero la lista de `personal/page.tsx`
  filtraba a solo 4 roles (`administrador`, `panolero`, `supervisor`, `operador`) para todo
  usuario que no fuera `super-admin`. Como el Centro de Invitaciones permite invitar con
  cualquiera de los ~24 roles del plan, cualquier invitado con otro rol quedaba registrado
  pero oculto de la vista. Ahora la lista muestra a todo el personal del tenant y solo oculta
  las cuentas de plataforma (`super-admin`/`soporte-pagnol`).
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
