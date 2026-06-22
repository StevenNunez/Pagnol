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

### Agregado
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
