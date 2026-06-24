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

### Cambiado
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

### Migraciones (aplicadas en Supabase)
- `20260621000000_material_min_stock.sql`
- `20260621010000_roles_per_tenant.sql`

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
