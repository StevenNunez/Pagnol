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

### Seguridad — 🔴 P0: cualquier trabajador podía reescribir los datos comerciales de su empresa

**Verificado explotándolo contra la base viva ANTES de escribir el fix** (E2E 18/32), con un
usuario de rol `operador` real y peticiones `PATCH` a `/rest/v1/tenants`.

La política `tenants_update_own` (migración `20260612000001`) decía
`FOR UPDATE USING (is_super_admin() OR id = get_my_tenant_id())`: **cualquier miembro
autenticado del tenant, sin importar su rol**. El operador logró, todo con HTTP 200:

| Lo que hizo | Consecuencia |
|---|---|
| Cambiarse el **plan de suscripción** | Fraude directo al modelo de negocio |
| Marcar el **contrato de responsabilidad como firmado** | La auditoría de contratos deja de ser evidencia |
| **Asignarse hardware** (escáner QR + impresora) | Falsea el control de equipos entregados |
| **Desactivar su propia empresa** (`is_active=false`) | — |
| **Renombrar la empresa** y cambiarle el **RUT** | — |
| Alterar **`labor_cost_factor`** | Falsea el margen por contrato de toda la faena |
| Bajar **`criticality_settings`** | Se salta las aprobaciones de clase A/B/C en compras |

Lo más grave no es cada campo por separado: son **exactamente los datos que administra la
consola de super-admin**. La plataforma gobernaba información que el propio cliente podía
reescribir por debajo.

- **Migración `20260806000000_tenants_platform_guard.sql` (PENDIENTE DE APLICAR).**
  Trigger `trg_prevent_tenant_platform_escalation` que congela las columnas **por nivel**,
  siguiendo el patrón que ya existía para `profiles`
  (`prevent_profile_privilege_escalation`):
  - **Plataforma** (`plan`, `is_active`, `contract_signed*`, `hardware_assigned`, `tenant_id`,
    `id`) → sólo super-admin. **Ni el administrador del propio tenant**: son la relación
    comercial entre Pagnol y su cliente, no configuración de la empresa.
  - **Configuración** (nombre, RUT comercial, representante legal, dirección, faenas, logo,
    geocerca, correlativos, umbrales de criticidad, factor de costo laboral) → sólo quien
    administra esa empresa, vía el helper nuevo `can_manage_tenant_settings()`.
  - El **service role sigue sin restricción** (`auth.uid()` es NULL): crons de UF y costo
    laboral, `/api/tenant/geofence` y el registro de empresas no se ven afectados.
- **Se cerró el INSERT libre**: `tenants_insert_authenticated` dejaba a cualquier usuario
  autenticado crear empresas ilimitadas. El alta real ocurre server-side con service role, así
  que la política pasa a `is_super_admin()` sin romper el registro.
- **Por qué un trigger y no estrechar la RLS:** una política no puede comparar `OLD` contra
  `NEW` — sólo permite o niega la fila entera, y aquí hay que distinguir *qué columna* cambia.
  La política de UPDATE queda intacta, así que ningún flujo pierde acceso a la fila.
- **No se creó ningún permiso nuevo**, a propósito: `can()` resuelve
  `dynamicRoles[rol] ?? ROLES_DEFAULT[rol]`, así que un permiso recién inventado es invisible
  para todo tenant con filas propias en `roles` (la misma razón por la que en Wallet se
  descartó `module_wallet:view`).
- **Carga Masiva**: el panel de umbrales de criticidad ahora se oculta a quien no administra la
  empresa (`can('module_settings:view')`), para no ofrecer un botón que la base va a rechazar.

### Corregido — Cinco controles del módulo super-admin que confirmaban cambios que no ocurrían

Mismo patrón en toda la consola: `UPDATE`/`DELETE` bloqueados por RLS **no devuelven error**,
devuelven 0 filas. Ninguna de estas pantallas lo comprobaba.

- **El botón "Eliminar empresa" mentía.** No existe política de `DELETE` sobre `tenants`:
  verificado con un super-admin real contra un tenant desechable, la petición responde
  **HTTP 200, 0 filas y ningún error**. La UI mostraba "Empresa eliminada", quitaba la fila de
  la lista, y al recargar la empresa seguía ahí. Ahora borra de verdad (ver más abajo).
- **`handleToggleContract`** (`tenants/[tenantId]`) no miraba `error` **en absoluto**: siempre
  cantaba éxito. Ahora revierte el switch y avisa si no se guardó.
- Se añadió la misma comprobación al guardado de hardware en `tenants/[tenantId]` y en
  `super-admin/hardware`, y al toggle de contratos en `super-admin/contracts`.

### Agregado — Borrado real de empresas (herramienta de limpieza para la fase de pruebas)

Mientras el alta es abierta, el super-admin necesita poder limpiar empresas de prueba. Añadir
una política de `DELETE` **no habría bastado**: verificado sembrando un tenant desechable con
usuarios y datos, el borrado falla con `23503: still referenced from table "profiles"`.

- **Migración `20260806010000_super_admin_delete_tenant.sql` (PENDIENTE DE APLICAR).**
  Función `super_admin_delete_tenant(uuid)` que **descubre dinámicamente** las tablas con
  columna `tenant_id` (una lista quemada quedaría desactualizada en silencio según crece el
  esquema, dejando datos huérfanos invisibles), borra en **varias pasadas** porque entre ellas
  hay claves foráneas, y **desactiva los guards de inmutabilidad del Artículo 2** — que
  rechazan el borrado incluso con service role — reactivándolos siempre, incluso si algo falla.
  Sólo `service_role` puede ejecutarla: una operación irreversible no debe quedar a un `POST`
  de distancia desde el navegador.
- **Ruta `POST /api/admin/delete-tenant`**: verifica el bearer token contra
  `profiles.role = 'super-admin'`, exige el **nombre exacto de la empresa** como confirmación,
  impide borrar la empresa propia, elimina las cuentas de Auth (si no, quedarían huérfanas y
  **seguirían pudiendo iniciar sesión**), y comprueba que la empresa desapareció en vez de
  confiar en la ausencia de error.
- **UI**: el doble clic se reemplaza por un diálogo donde hay que escribir el nombre de la
  empresa, con el detalle de lo que se va a destruir y el conteo real de lo borrado al terminar.

> ⚠️ **Es deliberadamente destructivo**: arrastra el ledger financiero, las planillas cerradas y
> los finiquitos pagados. Sirve para borrar empresas de **prueba**, no para dar de baja a un
> cliente. **Cuando exista pricing con accesos de pago hay que retirar la función, la ruta y el
> botón** — anotado en `PENDIENTES.md`.

**Verificación (E2E 33/33 + 10/10 + 13/13, todo sobre tenants desechables):**

- El E2E de seguridad se corrió **ANTES del fix y dio 18/32**: los 14 agujeros quedaron probados
  como hechos y no como opinión, y las regresiones (el administrador conserva su configuración,
  el super-admin gobierna la plataforma, el service role no se ve afectado) ya pasaban antes, así
  que se sabía exactamente qué no romper.
- 🔴 **Dos bugs propios que el E2E destapó antes de que llegaran a usarse:**
  1. **La función de borrado reventaba con `operator does not exist: text = uuid`.** El barrido
     descubre tablas por tener una columna `tenant_id`… y **`tenants` tiene una columna
     `tenant_id` que es el RUT, de tipo TEXT**. Corregido exigiendo `data_type = 'uuid'` y
     excluyendo `tenants`. La causa de fondo era tener la misma consulta **repetida en cuatro
     bucles**: al corregir el filtro sólo cambiaron dos. Ahora se calcula una vez en un array.
  2. **El primer sondeo dio "7 cerrados / 0 abiertos" y era mentira**: el `INSERT` del perfil de
     prueba chocaba con el trigger `handle_new_user` (409) y el sujeto quedaba sin `tenant_id`,
     así que la RLS no matcheaba **nada** y todo parecía protegido. Se añadieron checks de
     sanidad que abortan si el sujeto no está bien montado. *Un "cerrado" sin comprobar que la
     prueba muerde es indistinguible de un "no probé".*
- **El check que más importaba** no era que borrara, sino que **los guards de inmutabilidad
  quedaran reactivados**: la función los desactiva en todas las tablas con `tenant_id`, así que
  dejarlos apagados habría tumbado el Artículo 2 **para todos los tenants**. Se verificó con un
  tenant **testigo** que conserva un hecho inmutable, comprobado antes y después del borrado.
- El borrado se llevó **8 `material_categories` que nadie sembró** — las crea un trigger al dar
  de alta la empresa. Es justo lo que una lista de tablas escrita a mano habría dejado huérfano.
- La ruta se probó **contra el servidor real**: sin token → 401, administrador de tenant → 401,
  nombre mal escrito → 400 sin borrar, empresa inexistente → 404, y en el borrado real las
  cuentas de Auth desaparecen y **el usuario ya no puede iniciar sesión**.

### Seguridad — CSP promovida a ENFORCEMENT

Estaba en `Content-Security-Policy-Report-Only` desde el 2026-07-30: reportaba, no bloqueaba. Se
promovió **después de comprobar que no rompe nada**, no por confianza en la lectura del código.

- **15 rutas** (públicas y del dashboard) → **0 violaciones**.
- **Los flujos que cargan librerías pesadas**, que eran el riesgo real → **0 violaciones**:
  exportar Excel (`exceljs` + blob), el asistente de IA, la **biometría con cámara**
  (`face-api`: `wasm-eval` + workers, con cámara falsa de Chrome) y la credencial QR.
- **El detector se validó primero**: se provocó una violación deliberada de `img-src` y se
  comprobó que la capturaba. *Cero hallazgos con un detector que no mide se lee igual que cero
  hallazgos reales* — la lección que esta sesión repitió varias veces.
- **Y se volvió a verificar TODO con la política ya bloqueando**, no sólo en Report-Only: en
  Report-Only el navegador no impide nada, así que "0 violaciones" ahí no prueba que la app
  funcione cuando sí bloquea.

⚠️ La verificación corrió en **dev**. Si algo fallara en producción el síntoma sería un recurso
que no carga (imagen, fuente, worker), y revertir es cambiar una línea de `next.config.js`.
Sigue pendiente quitar `'unsafe-inline'` de `script-src` con nonces por request.

### Corregido — Los estados vacíos ya no mienten mientras cargan (extensión de ADR-014)

`EmptyState` ahora consulta la carga del estado global y muestra el spinner en su lugar. Se
resolvió **en el componente**, no en cada página: son **54** las que pintan un vacío sin mirar
`isLoading`, y `DataTable` delega su estado vacío en este mismo componente — así que un solo
cambio las cubre a todas.

- Para leerlo sin romper nada se añadió `AppLoadingContext`, un contexto mínimo aparte del estado
  tracked: `useTrackedState` **lanza** fuera del provider y `EmptyState` también se usa fuera del
  dashboard, mientras que `useContext` devuelve su default sin romper. Además su valor cambia una
  sola vez (`true → false`), así que no arrastra re-renders.
- Prop de escape `ignoreAppLoading` para listas que no salen de `useAppState()` (filtros locales).
- **Verificado renderizando en 6 páginas**: ninguna afirma vacío mientras carga y —lo que más
  importaba— **ninguna se queda pegada en el spinner**.

### Corregido — 🔴 Ninguna página distinguía "cargando" de "vacío" (ADR-014)

`/dashboard/reports/contract-stock` **afirmaba "No hay existencias registradas" teniendo 137 filas
en el ledger**. No era un defecto de esa página: era estructural, y afectaba a toda la app.

Dos causas que se sumaban:
- `useSupabaseCollection` devolvía **sólo el array**, sin señal de si ya hizo su primer fetch.
- `isLoading` del `DataProvider` **no servía de sustituto**: comprobaba `data !== undefined` y el
  hook **nunca devuelve `undefined`** (arranca en `[]`), así que se apagaba en el primer render
  con todas las colecciones aún vacías.

- **El hook devuelve `hasLoaded` adjunto al array** (`LoadableArray<T>`), no enumerable. Se
  descartó `{ data, hasLoaded }` porque el cambio de firma rompería las **40+ llamadas** de golpe;
  así los consumidores siguen usándolo como array y sólo quien necesita la distinción lee la marca.
- Se marca **después del fetch aunque venga vacío o falle** —significa "ya se intentó"—; si se
  marcara sólo con datos, una colección legítimamente vacía se quedaría en el spinner para siempre.
- **Se resetea al cambiar de tenant** (TenantSwitcher del super-admin): sin eso, la UI presentaría
  el array del tenant anterior como ya cargado. En un refresh manual no, para evitar parpadeos.
- `isLoading` de `useAppState()` **ahora es fiable** y Stock por Contrato ya separa los tres
  estados. **El resto de páginas sigue sin distinguirlos**: queda como trabajo pendiente.
- ⚠️ Un primer intento usó `isLoading` tal cual en la página; **se comprobó renderizando que NO
  funcionaba y se revirtió** antes de darlo por bueno.

**Verificado renderizando** sobre la ruta ya compilada: a los ~3,5 s muestra "Cargando
existencias…", a los ~5,9 s los datos, y **en ningún instante** afirma que no hay existencias.

### Verificado — Solicitud de compra normal: aprobar ajustando cantidad y recibir

E2E **16/16** en Minera Demo con las mutaciones reales y RLS activa. Aprobar recortando la
cantidad (100 → 60) **ya no lanza el error** que aparecía; conserva la cantidad original pedida
para trazabilidad del recorte, registra quién aprobó, el stock sube exactamente lo recibido, el
kardex lo registra y el doble clic en Recibir se rechaza sin volver a sumar.

- `updatePurchaseRequestStatus` guardaba **sin comprobar filas afectadas**: se le añadió
  `.select()` y un error explícito, para que una aprobación bloqueada por RLS no se confirme.
- ⚠️ El invariante del ledger falló al principio **por la siembra del test**, no por el código: el
  material se creó por REST sin pasar por `addToLedger`, y medir el TOTAL arrastraba ese desfase.
  Se corrigió a medir el **delta** y se reparó el dato en DEMO. *Cuarta vez que aparece el patrón:
  cuando un check de ledger falla, sospechar primero del check.*

### Seguridad — Bucket `contracts` acotado por tenant (cierra la deuda del P0 anterior)

La migración `20260803000000` sacó el bucket de público pero dejó la lectura como "cualquier
usuario autenticado", porque los paths no eran uniformemente tenant-scoped.

- **Migración `20260806040000` (PENDIENTE DE APLICAR).** `can_read_contract_object()` deriva el
  tenant del propio path cuando está (`ea-docs/<tenant>/…` y las rutas nuevas) y lo **cruza contra
  la solicitud** cuando el path sólo trae su id (`contracts/<uuid>/…`). **Sin mover archivos.**
- **Sondeado, no supuesto:** de las 10 carpetas con forma de uuid, **9 corresponden a una fila viva
  de `material_requests`** y una quedó huérfana. Los objetos cuyo tenant **no** se puede derivar
  (los antiguos de `direct/` y `return-evidence/`, y la huérfana) siguen accesibles a usuarios
  autenticados **a propósito**: negarlos rompería enlaces a actas laborales ya firmadas, que es
  peor que la exposición entre tenants de la misma plataforma.
- **La cola deja de crecer:** los archivos nuevos ya nacen con el tenant en la ruta
  (`return-evidence/<tenant>/…`, `contracts/direct/<tenant>/…`).
- **Verificado con la migración aplicada (8/8 + 9/9)**, y lo que se probó primero fue que **NO
  rompiera**: un acta que deja de abrirse es peor que la exposición que se cierra.
  · El administrador **real** de Minero Teo Labs abre sus **9 actas firmadas** (9/9).
  · Un usuario de otra empresa **no** puede firmar la URL de esas actas.
  · Los documentos antiguos sin tenant derivable siguen accesibles, y el super-admin ve todo.
  · En las rutas nuevas, un archivo de otro tenant se rechaza.
  ⚠️ La primera corrida dio **0/9** y parecía que había roto el acceso a documentos legales: era
  la URL de firma mal construida en el script de prueba. *Quinta vez en la sesión que el check
  falla y el código está bien — con service role el mismo path daba `Invalid Compact JWS`, que era
  la pista de que el problema era la petición, no el permiso.*

### Corregido — `npm run lint` llevaba tiempo roto: el proyecto estaba SIN linter

El script era `next lint`, que Next 16 eliminó, y no existía `eslint.config.js` (ESLint 9 exige
flat config). Fallaba entero, así que **ningún lint se estaba ejecutando**.

- `eslint.config.mjs` nuevo + `"lint": "eslint ."`. Se conserva `next/core-web-vitals`, la config
  que ya había: el objetivo era recuperar la herramienta, no cambiar reglas.
- **No hace falta `FlatCompat`** (revienta con esta versión por una referencia circular en sus
  plugins): `eslint-config-next` 16 ya exporta flat config nativa.
- Se ignora `.claude/**`: había un **worktree de git** ahí dentro y el linter estaba analizando esa
  copia, lo que inflaba el recuento con errores de archivos que no son del proyecto.
- `react/no-unescaped-entities` se apaga: la app está en español y los apóstrofes en texto JSX son
  constantes — esa regla sola aportaba **108 de los 138 errores** y hacía inútil el resultado.
- **Estado real: 93 problemas (11 errores, 82 warnings)** en código vivo. Deuda preexistente que
  ahora es visible; varios errores son patrones legítimos que marca el plugin nuevo de React.

### Corregido — Reporte Semanal: el turno nocturno quedaba partido en dos días

Con turno nocturno la jornada cruza la medianoche (20:00 → 08:00), pero este reporte agrupaba las
marcas por **día calendario**: la entrada quedaba en un día sin salida y la salida de madrugada
aparecía en el día siguiente sin entrada, así que las horas no cuadraban. El reporte mensual y la
liquidación ya lo hacían bien —parean por **sesión**—; el semanal se había quedado con el criterio
viejo (tiene su propia copia de `calculateDailySummary`).

Ahora, cuando el turno es nocturno, agrupa por sesión (entrada → salida siguiente, máximo 26 h,
atribuida al día de la **entrada**): el mismo algoritmo ya probado del hook mensual. Se cambió sólo
**cómo se agrupan** las marcas, sin tocar el cálculo de horas, para no arriesgar el caso diurno.

⚠️ **`tsc` limpio y build OK, pero no ejercitado con marcas nocturnas reales**: no hay en Minera
Demo un trabajador con turno nocturno y marcas cruzando medianoche.

### Cambiado — Deuda de estructura y normativa

- **`employment_contract_at()` → `RETURNS SETOF`** (migración `20260806020000`, **PENDIENTE**).
  Devolvía un tipo compuesto, así que un trabajador **sin contrato** no daba `NULL` sino **una fila
  con todas las columnas en NULL**: `if (fila)` daba true y `Number(base_salary)` daba **0 en
  silencio** — o sea, liquidar sueldo cero en vez de fallar. Ahora devuelve cero filas. Verificado
  que **ningún código llama a esa RPC** (sólo se la menciona en un comentario), así que el cambio
  de firma no rompe consumidores.
- **Feriados 2027 sembrados** (migración `20260806030000`, **PENDIENTE**). Sin ellos el feriado
  proporcional del finiquito se calcula corto y **le paga de menos al trabajador**.
  ⚠️ Las fechas están **calculadas**, no copiadas de fuente oficial: Semana Santa por algoritmo de
  Pascua y los traslados por la Ley 19.973 (el 29-jun y el 12-oct caen martes en 2027 → se corren
  al lunes). **Verificar antes de emitir un finiquito con fechas de 2027** — misma lección que
  ADR-011: una cifra legal deducida no es una cifra legal verificada.
- **Dark mode**: `permissions` y `estado-pago` tokenizados por completo (0 usos de paleta cruda,
  0 clases pegadas). Al hacerlo aparecieron **pares `dark:` huérfanos** — el reemplazo automático
  cambia la mitad clara y deja `dark:bg-blue-900/20` colgando; se cerraron a mano.
- **SQL huérfano**: `src/lib/migrations/` (3 archivos que nadie importaba) → `scripts/legacy-sql/`.
- **Timestamp de migración duplicado** resuelto: `work_reports_daily_ots` pasa a `20260617005000`
  (el hueco intermedio; `20260617010000` ya estaba ocupado por `work_reports_header`). Verificado
  que **no queda ningún timestamp repetido** en todo el directorio.

### Verificado — Suministros del cliente (comodato), end-to-end

Pendiente desde el lote de julio. Ejercitado con las mutaciones reales bajo sesión con RLS activa
en Minera Demo: **16/16**. Flujo completo: solicitud al cliente (correlativo `SCL`) → gate del ADC
→ envío → recepción en pañol.

**El punto de integridad, comprobado con datos:** existiendo un material propio *"Cemento Portland
25 kg"* con 120 sacos, se recibieron 40 del cliente **pasando a propósito el material propio como
"existente"**, tal como podría hacer la UI. El propio **quedó intacto en 120** y las unidades
fueron a una **fila espejo `ownership='cliente'`**. Una segunda recepción de 40 se **acumuló en la
misma fila espejo** (40 → 80) sin crear una duplicada. Además: el kardex apunta a la fila espejo y
dice de quién es el material, se cumple `sum(material_stocks) == materials.stock`, y el **doble
clic en Recibir se rechaza** sin volver a sumar stock (el bug VALAR-SCL-0001).

**La valorización excluye el comodato**, verificado **en pantalla** con el dato real: el contrato
que recibió el suministro muestra **$0** con la leyenda *"80 unidad(es) · 80 del cliente"*, y el
total advierte *"80 unidad(es) del cliente (comodato) — excluidas de la valorización"*.

### Corregido — Stock por Contrato afirmaba "No hay existencias registradas" mientras cargaba

Con **137 filas en el ledger**, la página mostraba su estado vacío durante los primeros segundos.
En faena con mala señal eso se lee como "perdimos el stock".

La causa es transversal y no se puede arreglar desde la página: `useSupabaseCollection` devuelve
**sólo el array**, sin señal de si ya hizo su primer fetch, e `isLoading` del `DataProvider` **ya
es `false`** para entonces (el efecto que lo apaga corre en su primera pasada, con las colecciones
todavía vacías) — se intentó ese guard y **no funcionó**, así que se descartó en vez de dejar un
arreglo aparente. Mitigación: el texto ya no afirma que no haya existencias. **El arreglo de raíz
—que el hook exponga `hasLoaded`— queda en `PENDIENTES.md`: toca 40+ llamadas.**

### Corregido — Finiquitos (F5): el pago podía dejar el ledger inconsistente para siempre

Verificación pendiente desde el 2026-07-30: el E2E de F5 cubrió base y motor con service role,
pero **no el emisor del ledger**, que corre client-side al cerrar y al pagar.

Se ejercitó con las mutaciones reales bajo **sesión de RRHH con RLS activa** (bundle esbuild del
código de cliente), montando un trabajador con contrato indefinido: **18/18**.

- 🔴 **`markSeverancePaid` marcaba `pagado` ANTES de emitir al ledger.** `pagado` es un estado
  **inmutable** —lo impone un trigger, incluso para el service role—, así que si la emisión
  fallaba después, el finiquito quedaba pagado para siempre **con la obligación viva en el ledger
  y sin el hecho `paid`**, sin forma de arreglarlo desde la aplicación. Ahora emite primero, como
  ya hacía `closeSeverance` justamente por esta razón: si falla la emisión, el finiquito sigue
  `cerrado` y se puede reintentar.
- **Lo que quedó probado** (verificando el **neto** por fuente, no la ausencia de filas — en un
  ledger append-only el reverso *es* una fila espejo): el costo emitido es exactamente
  `ledgerAmount()`; la obligación de caja coincide; los hechos se fechan en la **fecha de
  término** (no hoy, o el margen mentiría en dos meses); el pago se fecha el día que salió la
  plata; la obligación se salda **por reverso** con una fila nueva y queda en **neto 0**; y el
  líquido del último mes **no se emite dos veces** (lo emite la planilla — la trampa de ADR-012).
- La UI de finiquitos se verificó **renderizando** en dark y light: lista, estados y montos.

### Cambiado — Super-admin: una sola consola en vez de dos a medias

`/dashboard/subscriptions` y `/dashboard/super-admin/tenants` listaban **las mismas empresas**,
pero cada una tenía **la mitad de las acciones**: en una se creaba y se editaba el plan, en la
otra se borraba y se gestionaban hardware y contrato. Había que saber en cuál estaba cada cosa.

- **Una lista** (`/super-admin/tenants`) con búsqueda, alta en diálogo, baja y acceso al detalle.
- **Un detalle** (`/super-admin/tenants/[tenantId]`) que absorbe la edición de nombre, plan y
  estado que sólo existía en `/subscriptions/[id]`, junto al hardware, el contrato y los usuarios.
- `/subscriptions` y `/subscriptions/[id]` quedan como **redirecciones**, para no romper enlaces
  guardados. `plans` y `feedback` se conservan: no estaban duplicadas.
- 🔴 **Las etiquetas del sidebar estaban cruzadas**: `/subscriptions` (lista de empresas) se
  rotulaba "Planes y Clientes" y `/subscriptions/plans` (gestión de planes) se rotulaba "Gestión
  de Tenants". Ahora dicen lo que son.
- **El conteo de usuarios ya no miente**: se hacía con un `count` por empresa contra `profiles`,
  que la RLS filtra — devolvía **0** para cualquiera que no fuera super-admin, además de una
  consulta por fila. Ahora usa la ruta admin que ya existía para eso.
- `EditTenantForm` guardaba sin comprobar filas afectadas: se le añadió `.select()` y un mensaje
  explícito cuando la base rechaza el cambio.

### Cambiado — Super-admin: sistema de diseño (cierra los 44 usos de paleta cruda del backlog)

Las 6 pantallas del módulo pasan a tokens y componentes compartidos: `PageShell`, `DataTable`,
`EmptyState` y `LoadingState` en vez de `Loader2` y textos de estado vacío escritos a mano.
Radios de marca (`rounded-[1.5rem]`), badges por token (`badge-success`, `info-subtle`) y mapas
de color **estáticos** —las clases construidas con template strings se purgan en producción—.

- La peor era **Feedback**: usaba `bg-white` y `text-slate-800` **fijos**, sin variante oscura.
- **Verificado renderizando** (puppeteer + Chrome, sesión minteada por API) en **dark, light y
  celular a 390 px**, con un super-admin temporal que se crea y se borra en el propio script.
- ⚠️ **Dos capturas iniciales salieron en blanco y el escáner no reportó nada** — que se lee
  igual que "todo bien". Primero por capturar el spinner, y después porque el Panel Global no
  escribe "Cargando" sino que pinta *skeletons*. Al ampliar la espera, el `animate-pulse`
  **permanente** del indicador "EN LÍNEA" del header hacía que no terminara nunca; hubo que
  acotarla a skeletons con tamaño de panel. **Mirar el PNG es el paso que no se salta.**

### Cambiado — Wallet: sistema de diseño y verificación visual en navegador

Cierra la auditoría del módulo. **Verificado renderizando de verdad** (puppeteer + Chrome, sesión
real), no por grep: billetera, adelantos y bandeja de aprobación en **dark y light**, más el
diálogo de registrar pago y la billetera en viewport de celular.

- **Tokens en vez de paleta cruda** en las tres pantallas: `slate/amber/green/blue/yellow` →
  `bg-card`, `bg-muted`, `warning-*`, `info-*`, `success-*`, `destructive`. La tarjeta principal
  pasa a `bg-pagnol-dark`, que es oscura en **ambos** temas — por eso los `text-white/X` y los
  acentos claros de su interior se mantienen: son intencionales, no deuda.
- **`bg-pagnol-orange` → `bg-primary`** (son el mismo naranja: `--primary` es `#F97316`), y los
  botones vuelven a las variantes de `<Button>` en vez de clases de color a mano.
- **`/wallet/advances` reescrita sobre los componentes compartidos**: `PageShell` + `DataTable`
  (con su `EmptyState` integrado) en vez de una `<table>` armada a mano y tres tarjetas de KPI
  duplicadas. Suma una columna «Descontado», que es lo que el trabajador quiere saber.
- **Corregido al mirar la captura**: el guion de «sin descuentos» se pintaba en `text-destructive`
  y se leía como un monto descontado; ahora va en muted.

Sin desbordes horizontales en 390 px. La única superposición en celular es el botón flotante
«Reportar error», que es global y precede a este trabajo.

### Agregado — Wallet: el anticipo se paga de verdad y existe para el flujo de caja (ADR-013)

Migración **`20260805000000_salary_advances_paid.sql`** aplicada. E2E `run-e2e-wallet-p2.cjs`
**18/18** con las mutaciones reales bajo sesión de usuario; regresión de los bloques anteriores
verde tras reemplazar el trigger (seguridad 21/21, liquidación real 15/15, planilla 6/6).

Un anticipo terminaba su vida en `approved` y ahí se quedaba: sin fecha de transferencia, sin
medio de pago, sin autoría, y **sin existir para el dominio financiero**. La UI le promete al
trabajador una transferencia en 24 horas hábiles y no había con qué respaldarla.

- **Estado `pagado` con el respaldo de una factura**: fecha, medio y autoría congelada. Un trigger
  impide reescribirlo después — es el respaldo del trabajador, no un campo editable. `approved →
  paid` es la única transición válida desde un estado resuelto, y el `status` pasó a tener `CHECK`
  (no lo tenía: cualquier texto entraba, verificado insertando `'cobrado'`).
- **Aprobar emite una obligación de caja** (`payable`/`committed`/`labor`, `source_type
  salary_advance`); registrar el pago **la apaga por reverso** (Art. 2). No se emite hecho de
  costo: ese lo devenga la planilla del mes, y emitirlo acá lo contaría dos veces.
- **La bandeja de Adelantos separa "aprobados pendientes de transferir"**, que antes se mezclaban
  con el historial y no eran trabajo visible para nadie.
- **El rechazo pide motivo**: la columna `rejection_reason` existía desde la reparación del drift
  #6 y la UI le pasaba `''`. El trabajador veía "Rechazado" sin saber por qué.

🔴 **Corregido de paso — el `payable` de la planilla sobreproyectaba la caja.** `emitPayrollCost`
(ADR-010) emitía como obligación el `employerCost` completo, que incluye la plata ya entregada
como anticipo: el anticipo descuenta del líquido pero no rebaja los haberes. Pasa a ser
`payrollPayableAmount(employerCost, advancesAmount)` — función pura con 7 tests nuevos. La
invariante: **el payable del anticipo más el de la planilla suman el costo empresa completo, en
cualquier orden en que ocurran**, sin contar dos veces la misma caja. El error estuvo dormido
mientras Wallet no funcionó (`advancesAmount` era siempre 0) y **repararlo lo activó**.

### Cambiado — Wallet: la billetera muestra la liquidación REAL, no una inventada

**Sin migración.** E2E `run-e2e-wallet-p1.cjs` **15/15** contra la base viva, sin residuos.

"Mis Liquidaciones" fabricaba `sueldo/30 × días − anticipos` y lo presentaba como liquidación: sin
AFP, sin salud, sin impuesto único, sin gratificación ni topes imponibles. Era **la calculadora
que se retiró por riesgo legal (ADR-011/012) sobreviviendo en la única pantalla que el trabajador
cree**. Ahora lee sus `payroll_lines` reales (F3) con el estado de la planilla y **descarga el PDF
de su liquidación**, dibujado desde el snapshot igual que en RRHH.

- **Los borradores no se muestran.** `payroll_lines?select=*,run:payroll_runs!inner(*)`: la RLS de
  `payroll_lines` sí le deja ver su línea mientras la planilla está en ajuste — lo único que la
  esconde es el INNER JOIN contra `payroll_runs`, cuya política exige `status <> 'borrador'`. El
  filtro lo hace Postgres. **Verificado sembrando una línea en un borrador real**: la ve por la
  tabla directa y no la ve por el query de la billetera. Era el supuesto que no se podía razonar
  desde el código.
- **El sueldo sale del contrato laboral vigente** (`employment_contracts`, F1), no de
  `profiles.base_salary`: ese campo legacy no se mueve al firmar un anexo, así que el cupo se
  calculaba sobre un sueldo viejo. Sin contrato ya no hay cupo — no existiría liquidación de la
  cual descontar el adelanto — y la alerta dice qué pedirle a RRHH.
- **Los días se cuentan con `laborDayPresence`**, el criterio del ledger y de la planilla. Antes
  cualquier marca sumaba: licencias, vacaciones y permisos entraban como días trabajados e
  inflaban el cupo. El devengado usa `earnedBaseSalary`, la misma función del motor (respeta el
  modo mensual/por día del contrato).
- **El cupo se descuenta contra la deuda vigente**, no contra el mes calendario: todo anticipo con
  `payroll_line_id` nulo, sea de cuando sea. Antes, uno de un mes anterior que nunca entró en una
  planilla no ocupaba cupo y se podía volver a pedir sobre la misma plata.
- **"Mi Finiquito" era un callejón sin salida** (ruta retirada → módulo que el trabajador no puede
  abrir): ahora es su historial de adelantos.
- El saldo del mes en curso se mantiene —es el único mes que por definición no tiene liquidación—
  pero **rotulado**: sueldo base por días trabajados, antes de descuentos.

### Corregido — `mark_type` nunca llegaba desde el mapper de asistencia

El tipo `AttendanceLog` declara `markType` desde siempre, pero `mappers.attendance_logs` no lo
traía: llegaba `undefined` a **todos** los consumidores del estado global. Consecuencias más allá
de Wallet: el tablero diario de Asistencia nunca detectaba las marcas especiales (LM, PSG, V, PP,
D), `attendance/overview` nunca veía una licencia médica, y el panel de Finanzas contaba una
ausencia como día trabajado al pasar los logs por `laborDayPresence`.

### Seguridad — Wallet: control de acceso de los anticipos de sueldo (P0)

Migración **`20260804000000_salary_advances_rls.sql`** aplicada. E2E `run-e2e-wallet-sec.cjs`
**21/21** (8/21 antes del fix: los 13 rojos eran el agujero).

`salary_advances` había entrado en el barrido genérico de la migración consolidada
(`20260612000001`): una sola política `FOR ALL` con `tenant_id = mi tenant`. Para casi todas las
tablas eso alcanza; para ésta no, porque el sujeto del dato es el trabajador y la operación mueve
plata. **Verificado explotando el agujero contra la base viva** con una sesión real de rol
`operador` (E2E `run-e2e-wallet-sec.cjs`, 8/21 antes del fix):

- **Se auto-aprobó su propio anticipo** con un `PATCH` a `/rest/v1/salary_advances` — HTTP 200,
  la fila quedó `approved`. Desde F3 un anticipo aprobado se descuenta solo en la planilla.
- **Leyó los anticipos de sus compañeros** (nombre, monto, quién aprobó). Es información de
  sueldo, del mismo orden que `payroll_lines`, que sí filtra por `user_id = auth.uid()`.
- **Insertó un anticipo ya aprobado** por $999.999 en un solo POST, sin pasar por nadie.
- **Pidió un anticipo a nombre de un compañero** y **borró el anticipo de otro**.

No hubo explotación posible antes porque el módulo nunca funcionó (drift #6, reparado el
2026-07-29) y la tabla estaba vacía. Se cierra antes de que se use.

**Lo aplicado:**
- Políticas **por operación** (patrón de `payroll_runs`/`payroll_lines`): el trabajador ve y pide
  **lo suyo**; ver el resto, aprobar, rechazar y borrar exige `can_manage_advances()`.
- `can_manage_advances()` **preserva exactamente quién aprueba hoy** (la pantalla vive en Pagos ⇒
  `module_payments:view`) y suma RRHH, que desde F3 descuenta los anticipos en la planilla y los
  liquida en el finiquito. A propósito **no se inventó un permiso nuevo**: los roles por-tenant
  congelan sus permisos y un permiso recién creado habría dejado sin aprobar a tenants que hoy
  aprueban.
- El `INSERT` obliga a **nacer pendiente y sin aprobador** — sin eso, auto-aprobarse en el mismo
  POST deja la política de `UPDATE` sin nada que revisar.
- **Cuatro ojos**: `approver_id <> user_id`. Ni el administrador aprueba su propia solicitud (el
  super-admin sí, control total, y queda con su nombre estampado).
- **Trigger `salary_advances_guard`**: un anticipo resuelto no cambia de monto, de trabajador ni
  de fecha, no vuelve a `pending`, y uno ya descontado no se reasigna a otra liquidación. Vale
  **también para el service role** — probado con él a propósito.

### Corregido — el finiquito no descontaba los anticipos pendientes

`severanceMutations.ts` buscaba los anticipos por `request_date` (columna que **no existe**:
PostgREST respondía 400 y el error se descartaba) y por `status = 'aprobado'` en español, cuando
`approveSalaryAdvance` escribe `'approved'`. La consulta devolvía **siempre vacío**, así que el
finiquito no descontaba ningún anticipo vigente: el trabajador se iba con plata ya adelantada.
Ambos nombres salieron del tipo TS en vez del esquema real — el mismo patrón del drift #6. Ahora
además el error se propaga en vez de tragarse.

### Eliminado — el flujo de adelantos duplicado del home de Trabajador

`/dashboard/worker` era una copia de `/dashboard/wallet` con la lógica financiera duplicada, y la
copia tenía el candado suelto: `advancesTaken` estaba fijo en `0` con un comentario
`// Placeholder`, así que el cupo del 50% **ignoraba lo ya solicitado** — se podía pedir el máximo
tantas veces como se quisiera desde ahí, mientras la billetera (la misma tabla, el mismo
trabajador) sí lo descontaba. La página ahora enlaza a la billetera: el saldo, el cupo y los
adelantos se calculan en **un solo lugar**.

Se retiró también la lista "Últimas Liquidaciones" de esa página: eran **dos montos inventados en
el código** (Enero 2024 $850.000, Diciembre 2023 $820.000) con un botón de descarga que no
descargaba nada.

### Seguridad — `npm audit fix` aplicado (P0)

**86 → 79 vulnerabilidades** (−4 high, −2 moderate, −1 low). Solo cambió `package-lock.json`;
`package.json` quedó intacto. 270 tests verdes, `tsc` limpio, build OK.

El audit destapó dos cosas que el backlog no registraba: **`vitest` tiene una vulnerabilidad
crítica** (vía `vite`) que nadie había detectado, y **buena parte de la cadena
`@genkit-ai`/`@opentelemetry` ya tenía arreglo disponible** — el pendiente decía "revisar cuando
Genkit publique una versión", y esa versión ya existía.

Lo que queda son cambios mayores que rompen API y necesitan prueba dedicada: `jspdf` (crítica, 15
archivos la usan), `vitest` (crítica) y la cadena de `exceljs`. Detalle en `PENDIENTES.md`.

### Seguridad — Content-Security-Policy en modo Report-Only (P0)

Los headers base ya estaban; faltaba la CSP. Se añade en `next.config.js` como
**`Content-Security-Policy-Report-Only`**: no bloquea nada, solo reporta violaciones en la consola
del navegador. Es deliberado — activar una CSP estricta a ciegas rompe la app en producción, y
había tres consumidores imposibles de inventariar solo leyendo código: la hidratación de Next, el
websocket de Supabase Realtime y el modelo de reconocimiento facial.

Lo que el inventario determinó: `'unsafe-eval'` + `'wasm-unsafe-eval'` son necesarios porque
`@vladmandic/face-api` compila kernels de TensorFlow.js en runtime · `'unsafe-inline'` en estilos
porque Tailwind y Radix inyectan estilos inline · `wss://*.supabase.co` para Realtime ·
`api.pwnedpasswords.com` porque el registro y el cambio de clave lo consultan desde el cliente ·
`blob:` en `worker-src` y `media-src` para el service worker y la cámara · `next/font` self-hostea
Inter en el build, así que no hace falta `fonts.gstatic.com`.

**Para promoverla a enforcement:** navegar la app completa (login, dashboard, biometría, PDF,
asistente de IA) con la consola abierta, anotar cada violación, ajustar y recién ahí renombrar la
cabecera a `Content-Security-Policy`. Mientras tanto no protege, pero tampoco puede romper nada.

### Seguridad — 🔴 El bucket `contracts` era público y ahora es privado (P0)

**Migración `20260803000000_contracts_bucket_private.sql` — APLICADA y verificada (2026-07-30).**
Sondeo posterior: `public=false` y un objeto real devuelve **HTTP 400 sin autenticación**. Los
otros seis buckets con datos personales ya eran privados; `contracts` era el único expuesto.
Quedan públicos solo `tenant-logos` y `asset-photos`, que no llevan datos personales.

El bucket estaba en `public=true`: sus objetos se servían **sin autenticación** a cualquiera con
la URL. Guarda las actas de entrega/devolución **firmadas** de `pagnol/movimientos` —nombre, RUT y
la firma del trabajador capturada en el cierre biométrico—, las fotos de evidencia de devolución y
los documentos EA de la Dirección del Trabajo. Son datos personales de trabajadores
identificables: el Art. 1 (aislamiento por tenant) no sirve de nada si el archivo se sirve sin auth.

**Cómo se cerró, sin migrar datos:**

- `src/modules/core/lib/storage.ts` — `getContractsSignedUrl()` firma con expiración de 5 minutos
  y acepta **indistintamente el path nuevo o la URL pública que guardaron las filas antiguas**
  (extrae el path de la URL antes de firmar), así que no hay que reescribir nada de lo ya guardado.
- `<SecureFileLink>` — reemplaza los `<a href={url} target="_blank">` en los 5 puntos donde se
  abría un archivo. Firma **en el clic**: una URL firmada expira, así que persistirla la dejaría
  muerta a los minutos.
- Los 3 puntos de subida (actas de entrega, evidencia de devolución, documentos EA) ahora guardan
  el **path** en vez de la URL pública.
- La vista previa de la foto de evidencia pasa a mostrar el archivo local: un path no sirve como
  `src` de una imagen. De paso se corrigió que, al fallar la subida, ya no se persiste un path
  inexistente.
- Políticas de `storage.objects` para que un usuario autenticado pueda leer, subir y borrar.

⚠️ **Deuda consciente:** el alcance de lectura es "cualquier usuario autenticado", no "del tenant
dueño del archivo", porque los paths **no son uniformemente tenant-scoped** (`ea-docs/` lleva el
tenant; `contracts/direct/…` y `return-evidence/…` no). Acotarlo exige migrar la convención de
rutas y reescribir los paths guardados — queda en `PENDIENTES.md`. Aun así el salto es grande:
de "cualquiera en internet con la URL" a "un usuario autenticado de la plataforma".

### Cambiado — PENDIENTES.md verificado contra el estado real (2026-07-30)

Se auditó el backlog ítem por ítem sondeando la base, las dependencias y el código, en vez de
darlo por bueno. **Cerrados y eliminados del archivo:**

- Migración `20260718000000_client_supply_sent_email.sql` — **estaba aplicada**
  (`purchase_requests.sent_to_client_email` existe).
- Migración `20260720000000_materials_soft_delete.sql` — **estaba aplicada**
  (`materials.deleted_at/deleted_by/deletion_reason` existen).
- Migración del bucket privado de work-reports — **aplicada**: `work-report-pdfs` y
  `work-report-photos` están en `public=false`.
- Drift de safety (`20260612000004`) — las tablas existen (`daily_talks`, `assigned_checklists`,
  `checklist_templates`, `safety_inspections`, `behavior_observations`).
- Dark mode de `construction-control` — **0 usos** de paleta cruda.

🔴 **Hallazgo nuevo al verificar: el bucket `contracts` es PÚBLICO** (`public=true`). Guarda los
PDF de entrega/devolución **firmados** de `pagnol/movimientos` —con nombre, RUT y firma del
trabajador— y los documentos de Estados de Avance, y el código usa `getPublicUrl()`: son
accesibles sin autenticación por quien tenga la URL. El pendiente anterior lo describía solo como
"permite listar", que subestimaba el problema. Elevado a P0.

Las mediciones de deuda se actualizaron con los números reales (dark mode por módulo, adopción de
`EmptyState`/`LoadingState`), y se incorporó la mantención recurrente que deja Remuneraciones: el
aporte del empleador sube cada agosto hasta 2033 y los festivos hay que sembrarlos cada año.

### Agregado — Remuneraciones F5: finiquitos persistentes (ADR-012)

**Migración `20260802000000_severances.sql` — APLICADA (2026-07-30). Verificado E2E 19/19.**

El E2E corre con **service role** a propósito: prueba que el Art. 2 lo impone la BASE y no el
cliente. Quedó comprobado que un finiquito cerrado rechaza cambiar montos, volver a borrador y ser
eliminado, y que `cerrado → pagado` es la única transición admitida. También el borde exacto del
art. 163 (fracción de exactamente 6 meses **no** suma un año) y los 15 feriados sembrados.

Última fase del RFC-003. `attendance/severance` calculaba en `useState`, imprimía un PDF y no
guardaba nada — el hallazgo 3 del RFC aplicado al documento con más consecuencias legales.
**Ya se había usado en el tenant real**: existe un finiquito generado el 14-07-2026 cuyo único
registro es el PDF que quedó en una carpeta de Descargas (fue una prueba, no se entregó).

**Cuatro defectos de cálculo corregidos**, verificados contra normativa:

- 🔴 **El feriado proporcional se pagaba corto.** La ley lo define en días **hábiles** (art. 67),
  el sábado es **siempre inhábil** (art. 69), y al liquidarlo hay que proyectarlo desde el día
  siguiente al término sumando los sábados, domingos y festivos que atraviese. La calculadora
  hacía `(días/365) × 15` y los pagaba como corridos — siempre en contra del trabajador, y más
  mientras más largo el período.
- 🔴 **No existía el tope de 90 UF** del art. 172 sobre la base de indemnización.
- 🟠 **`fracción >= 6 meses`** daba un año completo; el art. 163 exige fracción **superior** a
  seis meses.
- 🟠 **Faltaba el feriado progresivo** (art. 68).

**Piezas:** `severanceMath.ts` puro (41 tests) · tabla `severances` append-only con snapshot
inmutable y Art. 2 **por trigger en la base** · `public_holidays` nacional (15 feriados de 2026
verificados) · `severanceLedger.ts` · páginas `/dashboard/rrhh/finiquitos` + `[id]` · PDF formal
que cita la causal legal y detalla el feriado en días hábiles **y** corridos.

**Lo que ahora sale del sistema en vez de digitarse:** antigüedad y base de cálculo del contrato
laboral, vacaciones tomadas de la asistencia, anticipos pendientes, y el líquido del último mes
tomado de la planilla. El feriado progresivo se **declara** (el art. 68 exige acreditar 10 años
con empleadores anteriores que este sistema no conoce; calcularlo sería inventarlo).

🔴 **La trampa que la fase evitó:** el finiquito incluye el líquido del último mes, pero **ese
monto ya lo emitió la planilla al ledger** con su propio costo y payable. Emitirlo de nuevo
habría duplicado el costo de personal del mes. Al ledger va solo `ledgerAmount()` — los conceptos
propios del finiquito. Mismo patrón que en F4 obligó a apartar los meses liquidados del cron de MO.

⚠️ **VERIFICADO, NO ANCLADO:** no hubo finiquito real de un tercero disponible. Los tests fijan la
mecánica según la ley, pero validan la interpretación, no a un emisor real — la misma distinción
que dejó pasar la hora extra 4× sobrestimada. `describe.todo` reservado.

**270 tests** (+41), `tsc` limpio.

### Eliminado — La calculadora vieja de finiquitos (ADR-012)

`attendance/severance` sale del sidebar, igual que `monthly-report`. La ruta se conserva con un
aviso que dirige al módulo nuevo.

### Corregido — Paramétrica legal verificada contra normativa (ADR-011)

**Migración `20260801000000_payroll_legal_rates_2026.sql` — APLICADA (2026-07-30).**

**Verificado E2E 37/37 contra la base viva**, con el motor alimentado por los parámetros que
devuelve Postgres (no por los del test): las 5 versiones resuelven por fecha · el corte de agosto
sube el costo empresa **sin mover un peso del líquido del trabajador** · la gratificación topa con
$529.000 aunque el sueldo mínimo de esa misma fila diga $553.553 · el tope de 90 UF y el aviso
correspondiente · Isapre sobre el tope (el 7% se topa, el plan no) · y la advertencia de jornada.

Cierra la deuda que F1 dejó advertida: las tasas, topes y tramos sembrados eran **valores de
referencia sin verificar**, y mientras no se contrastaran contra normativa el sistema no podía
emitir una liquidación real. Verificado contra SII, Superintendencia de Pensiones, Dirección del
Trabajo, ChileAtiende, Ley 21.751 y Ley 21.735.

**La mecánica estaba bien; los valores con fecha, no.** La tabla del impuesto único coincide **al
decimal** con el SII (8 tramos, factores y rebajas en UTM), y de paso validó que la serie UTM del
cron es correcta. Todo lo demás con vigencia estaba atrasado:

- **Topes imponibles**: 87,8 → **90,0 UF** (AFP/salud) y 131,9 → **135,2 UF** (cesantía), desde
  las remuneraciones de febrero de 2026. Con el tope viejo se **subcotiza** a las rentas altas.
- **IMM**: 529.000 → **539.000** (enero, Ley 21.751) → **553.553** (mayo).
- **Asignación familiar**: tramos de 2025 → los de enero de 2026, y nuevos montos y tramos desde
  mayo ($22.601 / $13.870 / $4.382).
- **SIS**: 1,53 → **1,62%** desde las remuneraciones de abril (licitación pública).
- **Comisión AFP Uno**: 0,49 → **0,46%**. Las otras seis estaban correctas.

**Ninguna liquidación se había emitido a un trabajador real** (las 6 planillas de la base están en
tenants de prueba), así que no hay documentos entregados que rehacer.

La paramétrica queda con **5 versiones para 2026**, una por cada fecha en que la ley cambió algo:
liquidar un mes pasado con las tasas de ese mes sale gratis. Es el primer uso serio del versionado
que construyó F1.

### Agregado — Cotización de cargo del empleador: Ley 21.735 (ADR-011)

🔴 **Faltaba entera una cotización que existe desde agosto de 2025.** La reforma previsional creó
un aporte de cargo del empleador —1% del imponible entonces, **3,5% desde las remuneraciones de
agosto de 2026**, subiendo hasta 8,5% en 2033— que el modelo no tenía dónde guardar.

No se le descuenta al trabajador, pero **es costo empresa**: sin él, el costo real que F4 emite al
ledger estaba subestimado en ~1,9 puntos del imponible, y con eso el **margen por contrato y la
desviación de presupuesto de personal**. En una faena de 50 personas son más de $1M mensuales de
costo invisible.

- Dos columnas nuevas (`employer_pension_rate`, `employer_sis_rate`) porque hasta julio de 2026 el
  SIS y el aporte **se suman**, y desde agosto el SIS queda **absorbido** dentro del 3,5% — el
  patronal es 3,5%, no 3,5% + 1,62%. Un solo número no puede representar ese corte.
- El SIS sale del catálogo de AFP (`afp_rates.sis_rate` queda obsoleta): se licita en conjunto, es
  el mismo para las siete, y tenerlo repetido solo invitaba a que se desincronizaran.
- `payroll_lines.employer_pension` es columna nueva en vez de reinterpretar `employer_sis`: las
  líneas emitidas son snapshots inmutables y no pueden cambiar de significado a posteriori.

### Corregido — El tope de gratificación usaba el IMM equivocado (ADR-011)

**Actualizar el sueldo mínimo a ciegas habría introducido un error.** La Dirección del Trabajo
determina el tope de 4,75 IMM del art. 50 con el **ingreso mínimo vigente al 31 de diciembre del
ejercicio comercial**, no con el del mes liquidado: para todo 2026 son **$529.000**, aunque el
sueldo mínimo ya vaya en $553.553.

O sea que la semilla de F1 tenía el valor **correcto para la gratificación** y equivocado como
sueldo mínimo — un solo campo sirviendo dos conceptos con reglas de vigencia distintas. Se separan
(`gratification_imm` y `minimum_wage`). El anclaje contra las 3 liquidaciones reales de Steven
sigue reproduciéndolas al peso: **usaban $529.000 y estaban bien**.

### Agregado — Advertencia de jornada sobre el máximo legal (Ley 21.561)

La jornada ordinaria bajó de 44 a **42 horas el 26 de abril de 2026** (y a 40 en abril de 2028).
Los contratos de la base seguían en 44.

Importa porque el valor de la hora extra es `(sueldo/30) × (7/jornada) × 1,5`: **a menor jornada,
mayor valor hora** — y la ley prohíbe expresamente rebajar la remuneración al reducir la jornada.
Un contrato que siga diciendo 44 paga cada hora extra **4,8% más barata** de lo que corresponde.

El motor **advierte, no altera montos** (manda siempre lo pactado), y evalúa con el último día del
período porque abril de 2026 es un mes partido. Los contratos existentes no se reescriben: son
append-only y un contrato con 44 horas es correcto para su época — se corrigen con un anexo. El
default del esquema pasa a 42.

### Agregado — ISAPRE: mecánica verificada contra normativa (ADR-011)

Tests del camino Isapre, el único donde la cotización de salud se despega del 7% fijo: plan en UF,
7% como piso, adicional de cargo del trabajador, conversión con la UF del período, y el caso que
nadie revisa — **con renta sobre el tope, el 7% se topa pero el plan no**, así que el adicional
crece. También que el adicional rebaja la base tributable (menos impuesto) y que el costo empresa
**no** cambia por el sistema de salud.

⚠️ **VERIFICADO, NO ANCLADO.** Estos tests verifican la lectura de la normativa, no el
comportamiento de un emisor real. La distinción no es teórica: el anclaje de Fonasa destapó que la
hora extra estaba **4× sobrestimada**, y ningún test sintético lo habría detectado porque todos se
derivaban de la misma constante equivocada. **Basta una liquidación real con Isapre para
cerrarlo.**

### Eliminado — La calculadora vieja de liquidación (ADR-011)

`attendance/monthly-report` seguía publicada en el sidebar como "Liquidación de Sueldo" —más
visible que el módulo nuevo— y emitía un PDF con aspecto de liquidación desde constantes quemadas
(`SUELDO_MINIMO = 460000`, valor de 2023), sin tope imponible, impuesto único, asignación
familiar, AFC por tipo de contrato ni plan de Isapre, y sin descontar las ausencias.

Construir el módulo nuevo y dejar esa puerta abierta era el riesgo legal más directo que quedaba
en pie. La ruta se conserva con un aviso que dirige a Remuneraciones (quien tenga el enlace
guardado necesita entender qué pasó, no un 404); el sidebar y el hub de Asistencia ahora apuntan
al módulo nuevo.

**229 tests** (+32), `tsc` limpio.

### Agregado — Remuneraciones F1: fundación de datos (RFC-003)

**Migración `20260727000000_payroll_foundation.sql` — APLICADA (2026-07-29).**

**Verificado E2E 56/56 (tenant DEMO, mutaciones reales).** Cubrió: la regla de vigencia en 7
fechas incluidos los bordes exactos, comparando `contractAt` (TS) contra
`employment_contract_at` (SQL) para que la duplicación no diverja · los 5 guards de la
mutación más los CHECK de la base saltándose la mutación · Art. 1 (aislamiento por tenant),
Art. 2 (UPDATE/DELETE rechazados) y Art. 5 (autoría) · la **regresión del fix de seguridad**
con un usuario rol `operador` real · catálogos y paramétrica resueltos por fecha · la serie
UTM llegando de verdad por el cron (31 tasas, UTM de julio $71.649).

Hasta ahora "remuneraciones" era una calculadora: el sueldo se **digitaba a mano** aunque
`profiles.base_salary` existiera, `afp` era texto libre (convivían `'Habitat'`, `''` y
`NULL`), no había plan de Isapre ni contrato laboral, y los parámetros legales estaban
hardcodeados en el componente (`SUELDO_MINIMO = 460000`, con un comentario que admitía que
debería ser dinámico). Esta fase crea la materia prima; **el motor de cálculo es F2**.

- **`employment_contracts`** — el contrato **laboral** del trabajador (distinto de
  `contracts`, que en Pagnol es el contrato de **obra** con el cliente; por eso el nombre
  explícito y "Contrato Laboral" en toda la UI). **Append-only**: un anexo es una versión
  nueva con su vigencia, nunca un `UPDATE`, así liquidar marzo con las condiciones de marzo
  sale del propio esquema. Incluye tipo de contrato, **modalidad mensual o por día**
  (dotación mixta), jornada, AFP, salud con **plan de Isapre en UF** y cargas.
- **`payroll_parameters`** — paramétrica legal **con vigencia**: sueldo mínimo, topes
  imponibles en UF, tasas AFC por tipo de contrato, tope de gratificación y los tramos de
  asignación familiar e impuesto único (jsonb). **Global, no por tenant**: son ley nacional,
  y que cada tenant tuviera su propio sueldo mínimo sería fuente de error, no de
  flexibilidad (corrige lo que proponía el RFC-003).
- **`afp_rates`** — catálogo nacional que reemplaza el texto libre. Separa la comisión de
  cada AFP del 10% obligatorio, y registra el SIS (que **paga el empleador**, no se
  descuenta al trabajador).
- **Serie UTM** (`utm_rates`) — el impuesto único usa tramos en UTM. Se extendió el cron de
  UF de F0 en vez de crear otro: es el mismo proveedor y el mismo patrón. **Si la UTM falla,
  la UF igual se actualiza** — sostiene arriendos y topes que ya están en producción.
- **`can_manage_hr()`** con la misma cadena que `can()`, y **`employment_contract_at()`**
  para que la regla "el vigente en una fecha" exista en un solo lugar (con `SECURITY
  INVOKER`, ver Seguridad más abajo).
- UI dentro del `UserPanel` (superficie única de edición): estado del contrato vigente,
  alta de anexos con **selector de AFP** en vez de texto libre, e historial de versiones.

⚠️ **Los valores semilla (tasas, topes, tramos) son de referencia y deben verificarse contra
la normativa vigente antes de emitir liquidaciones reales.** Están versionados justamente
para corregirlos sin tocar código. Los campos legacy de `profiles` se conservan intactos:
el costo de MO del ledger los sigue usando y romperlos dejaría la asistencia sin devengar.

### Agregado — Remuneraciones F2: motor de liquidación (RFC-003 / ADR-008)

**Migración `20260729000000_payroll_gratification_base.sql` — APLICADA (2026-07-29).**
`payrollMath.ts` puro y testeado (57 tests; 129 en total), patrón `financeMath.ts`.

Reemplaza la aritmética de `attendance/monthly-report`, que además de no persistir nada
tenía **conceptos legales ausentes** —tope imponible, impuesto único, asignación familiar,
AFC diferenciado por tipo de contrato, plan de Isapre— y **errores en lo que sí calculaba**:
`SUELDO_MINIMO = 460000` desactualizado alimentando el tope de gratificación, gratificación
sobre sueldo base, jornada hardcodeada en `sueldo / 180`, y el 10% previsional mezclado con
la comisión de AFP en un único porcentaje.

- **Las ausencias descuentan.** Era el error más caro de la calculadora: `absentDays` se
  calculaba, se pintaba en rojo en pantalla y no entraba al cálculo — el sueldo se pagaba
  íntegro. El motor proporcionaliza con **el criterio del ledger** (marcas P/ATR/MJ, divisor
  30) para que la desviación que F4 va a medir sea plata y no diferencia de criterio.
- **Base de la gratificación pactada por contrato** (`gratification_base`, decisión de
  Steven): `imponible` o `sueldo_base`. Nunca se incluye a sí misma — sería circular.
  Hallazgo de los tests: para sueldos altos la elección es indiferente porque manda el tope.
- **Topes imponibles en UF**, con el suyo propio para el AFC (más alto que el de AFP/salud).
- **Salud: el 7% es piso.** Con Isapre, si el plan en UF vale más, se cobra el plan y la
  diferencia se muestra como "adicional".
- **AFC según tipo de contrato**: a plazo fijo y por obra el trabajador **no** aporta — la
  calculadora anterior le descontaba 0,6% igual.
- **Impuesto único** por tramos en UTM, calculado sobre la renta **menos** cotizaciones.
- **Asignación familiar** por tramo y carga, tratada como **haber** no imponible.
- **Costo empleador** (SIS + AFC de cargo del empleador) como salida propia: es el insumo
  que en F4 reemplazará la estimación `sueldo/30 × 1,35` del ledger.
- El motor recibe **UF y UTM ya resueltas**, no una fecha: liquidar marzo con las tasas de
  marzo es responsabilidad de quien llama, y así los tests son reproducibles.

### Agregado — Remuneraciones F4: el costo real reemplaza la estimación (RFC-003 / ADR-010)

**Migración `20260731000000_payroll_ledger_f4.sql` — APLICADA (2026-07-29).**
**Verificado E2E 34/34** (tenant DEMO, mutaciones reales + el cron de MO de verdad).

Es la fase que entrega el requisito que ordenaba la iniciativa: leer *"en gastos de personal
este mes te ahorraste $150.000"*. Hasta ahora el ledger devengaba una **estimación**
(`labor_day` = sueldo/30 × 1,35) y la planilla real de F3 no llegaba al dominio financiero: la
desviación comparaba el presupuesto contra un proxy.

- **Al cerrar la planilla**, la estimación del mes se reversa y la reemplaza el **costo empresa
  real** (haberes + SIS + AFC del empleador), imputado a cada obra **en la misma proporción de
  días** que tenía la estimación. Verificado con 12 días en una obra y 8 en otra: 60/40 exacto.
- **El reemplazo es selectivo por trabajador**: quien no entró en la planilla conserva su
  estimación, porque no se le calculó un costo real que se le pueda asignar.
- Los hechos se fechan en el **último día del mes liquidado**, no hoy — si no, el margen mensual
  mentiría en dos meses a la vez. De ahí el guard: `finance_reverse_labor_month` rechaza un mes
  contablemente cerrado, y `finance_period_precheck` gana un chequeo que avisa de planillas sin
  cerrar para que el orden correcto (planilla → período) sea el evidente.
- **Ciclo de caja completo**: al cerrar nace un `payable` por el desembolso total; al pagar se
  apaga por reverso y nace el `paid` fechado en la fecha de pago real. El `payable` va sin
  vencimiento, igual que los EP en F4.2 — al cerrar no hay fecha comprometida.
- **`payroll_run` entra en `UNCOMMITTED_SOURCES`**: nace devengado, así que sin eso el
  presupuesto volvería a mostrar "ejecutado" junto a "100% disponible" para el mayor costo de la
  faena (el bug que destapó el E2E de F3).
- **Desviación en `/finanzas/presupuesto`** con signo, color y frase en castellano, más el
  desglose por contrato. Sin presupuesto cargado **no** inventa un 100% de ahorro: lo dice.

### Corregido — 🔴 El cron de mano de obra habría duplicado el costo del mes liquidado

Detectado al diseñar F4; no estaba en el RFC. `labor-cost.ts` reconcilia una **ventana móvil de
35 días** y re-emite lo que falta. Cerrar la planilla de julio el 1 de agosto deja esos días
dentro de la ventana: **el cron del día siguiente habría revivido la estimación** que el cierre
acababa de apagar, dejando el mes con costo estimado *más* real y el margen por contrato
mintiendo a diario. Y es el caso normal, no un borde: la planilla se cierra justo después del
mes que liquida.

Fix: `fetchLiquidatedMonths` + `splitByLiquidatedMonth` apartan esos días **antes** de armar el
lote, reutilizando el patrón de `splitByClosedPeriod` (ADR-006) en vez de reaccionar al error —
el INSERT va en lotes de 500 y una sola fila conflictiva abortaría la reconciliación completa
del tenant. Se filtra por el **día trabajado** (sufijo del `source_id`), no por `entry_date`,
porque un hecho reconciliado se emite en otra fecha. Verificado corriendo el cron tres veces
después del cierre: la estimación siguió en cero.

### Corregido — 🔴 Sin UF del período, el tope imponible quedaba desactivado

Destapado por el E2E de F3. `uf_rates` solo cubre ~45 días hacia atrás (es lo que entrega
mindicador.cl: la serie parte el 2026-06-16), así que **liquidar cualquier mes anterior dejaba
`ufValue = 0`**. Con UF en 0, `taxableCap()` devuelve `Infinity` y el tope imponible **no se
aplica**: AFP y salud se calculan sobre la renta completa en vez del tope.

El error va en la dirección más costosa — **le descuenta de más al trabajador** — y afecta
justamente a las rentas altas, que son las que topan. Un aviso no alcanza para eso.

Dos correcciones: (1) si no hay UF del período se usa **la más antigua conocida** como
aproximación y se declara explícitamente en los avisos, porque un tope aproximado (la UF se
mueve del orden de 0,3% al mes) es infinitamente mejor que ningún tope; (2) **`closePayrollRun`
rechaza cerrar sin UF**, porque una planilla cerrada es inmutable y emitiría liquidaciones que
descuentan de más.

### Corregido — 🔴 Drift #6: el módulo Wallet nunca funcionó

**Migración `20260730010000_wallet_drift_repair.sql` — PENDIENTE DE APLICAR.**

Descubierto al aplicar la migración de F3. El código de producción escribía y leía **cuatro
columnas que no existen** en `salary_advances`:

| Función | Columna inexistente | Efecto |
|---|---|---|
| `addSalaryAdvanceRequest` | `worker_id`, `worker_name` | pedir un anticipo fallaba con PGRST204 |
| `approveSalaryAdvance` | `approver_name` | aprobar fallaba |
| `rejectSalaryAdvance` | `approver_name`, `rejection_reason` | rechazar fallaba |
| `mappers.salary_advances` | `worker_id` | `workerId` siempre `undefined` |

El esquema real es `id, tenant_id, user_id, amount, reason, status, approver_id, requested_at,
processed_at`. **Evidencia de que nunca funcionó: `salary_advances` tenía 0 filas en los cuatro
tenants**, incluido producción. Sexto caso del mismo patrón de drift en este proyecto.

Lo que enmascaró el bug: el tipo TypeScript expone la columna como `workerId`, así que el
nombre `worker_id` parecía obvio — y `tsc` no valida nombres de columna. Es también cómo se
colaba en mi propia migración de F3, que fue lo que lo destapó.

**Criterio de reparación**: la **clave** la manda la base (se mantiene `user_id` y se adapta el
código, porque es el nombre que usa el resto del esquema); los **nombres congelados** sí se
agregan como columnas, porque son convención del proyecto (`contract_name`, `supplier_name`,
`created_by_name`) y tienen valor real: si el perfil cambia luego, el anticipo aprobado no debe
mentir sobre quién lo pidió ni quién lo autorizó. La tabla está vacía, así que no hay backfill.

Verificado de paso que `behavior_observations` —el otro consumidor de `worker_id` en el
código— **sí** tiene sus columnas: ese módulo está sano.

### Agregado — Remuneraciones F3: planilla persistente (RFC-003 / ADR-009)

**Migración `20260730000000_payroll_runs.sql` — APLICADA (2026-07-29), verificada 15/15
incluidos los triggers de Art. 2.**

Páginas nuevas: **`/dashboard/rrhh/remuneraciones`** (listado con líquido emitido y costo
empresa) y **`/dashboard/rrhh/remuneraciones/[id]`** (armado del borrador con días, horas extra
y anticipos precargados; cierre; marca de pago). Entrada en el sidebar de RRHH bajo
`hr_employees:edit`.

**PDF de liquidación** (`src/lib/liquidacion-pdf.ts`): replica la estructura del documento que
el trabajador reconoce —HABERES AFECTOS / OTROS HABERES / ASIGNACIONES VARIAS / DESCUENTOS
LEGALES, totales, monto en palabras, "Recibí Conforme"— y se dibuja **desde el snapshot**, no
recalculando: el documento dice lo que se emitió aunque las tasas hayan cambiado después.
Incluye `numero-a-palabras.ts` (10 tests) anclado contra los montos textuales de las
liquidaciones reales. Verificado generando el PDF de febrero 2026: reproduce el documento al
peso (totales 1.634.227 / 565.494, líquido 1.068.733).

**Verificado E2E 45/45** (tenant DEMO, mutaciones reales con sesión de usuario y RLS activa):
propuesta (contrato vigente, 20 días de 23 marcas porque las ausencias no devengan, anticipos
precargados) · UNIQUE por mes con mensaje claro · cálculo y **recálculo idempotente** (una
línea, no dos) · **el anticipo se amarra y deja de ofrecerse** · eliminar el borrador **lo
libera** y vuelve a estar disponible · cierre congelando la paramétrica · Art. 2 vía
mutaciones (recalcular, eliminar y cerrar dos veces: rechazados) · pago · plazo fijo sin AFC
del trabajador · asignación familiar por cargas · Art. 1 aislamiento · RLS: un operador no ve
la línea de otro ni las planillas ajenas.

Hasta ahora la liquidación vivía en `useState` → PDF → se perdía (hallazgo 3 del RFC-003).

- **`payroll_runs` + `payroll_lines`** con estados **borrador → cerrada → pagada** (decisión
  de Steven). Cerrar congela el snapshot; `pagada` lleva fecha de pago real y es la transición
  que emitirá el hecho `paid` al ledger en F4.
- **Art. 2 garantizado por TRIGGER en la base**, no solo en el cliente: una planilla cerrada
  no admite cambios de monto ni de período, solo el paso a pagada; solo los borradores se
  eliminan; las líneas de una planilla no-borrador son intocables. Vale también para el
  service role y para cualquier script — una liquidación emitida que se puede editar no es un
  documento, es un borrador con otro nombre.
- 🔴 **El doble descuento de anticipos pasa a ser imposible por esquema.**
  `salary_advances` gana `payroll_line_id`: un anticipo con línea asignada no vuelve a
  ofrecerse, y `ON DELETE SET NULL` lo libera solo si se elimina el borrador. Antes,
  `SalaryAdvance` no tenía **ninguna** marca de haber sido descontado y un anticipo aprobado
  el día 31 podía descontarse dos veces (hallazgo 2 del RFC-003). Se descartó filtrar por
  rango de fechas justamente por eso.
- **Haberes con prorrateo por días trabajados** (`prorate` por haber): reproduce las
  liquidaciones reales, que prorratean movilización y colación (feb 30 días $69.920 → mar 16
  días $37.291, exactamente ×16/30) pero **no** el desgaste de herramientas ni los bonos
  ocasionales. Se captura el monto mensual y el sistema divide, en vez de pedir la división
  hecha.
- **`proposePayrollLines()` propone sin escribir**: resuelve contrato vigente, cuenta días con
  el **criterio del ledger** (`laborDayPresence`, marcas P/ATR/MJ) y lista los anticipos
  pendientes. Las horas extra quedan en 0 a propósito: requieren autorización, no salen de un
  reloj — las tres liquidaciones reales muestran 27, 40 y 31 horas que alguien aprobó.
- **Snapshot inmutable por línea** (entrada + resultado + avisos): la planilla no recalcula al
  leerse, muestra lo que guardó. Recalcular marzo con los parámetros de julio lo falsearía.
- Trabajadores con asistencia pero **sin contrato laboral vigente** se reportan aparte en vez
  de liquidarse con datos incompletos.

### Corregido — 🔴 El valor de la hora extra estaba 4× sobrestimado

Detectado al anclar el motor contra liquidaciones reales. La fórmula implementada era
`sueldo × 28 / (30 × jornada) × 1,5`; la correcta es **`(sueldo / 30) × (7 / jornada) × 1,5`**
— un factor 4 de diferencia. Con sueldo 900.000 y jornada 44 h daba $28.636 la hora en vez de
$7.159,05, que es lo que las tres liquidaciones reales pagaron.

El factor se redondea a **7 decimales** porque así lo aplicó el emisor: sin ese redondeo el
resultado se desvía 1-2 pesos por liquidación. Se validó contra 27, 40 y 31 horas extra en
tres meses distintos.

Es exactamente el riesgo que motivó dejarlas como constantes exportadas y no quemadas en el
cálculo: el error estaba en el número, no en la mecánica, y ningún test sintético lo habría
delatado porque los sintéticos se derivan de la misma constante equivocada.

### Verificado — Anclaje del motor contra 3 liquidaciones reales

Tres meses consecutivos del mismo trabajador (ene/feb/mar 2026) emitidos por un tercero, con
su finiquito. El motor **reproduce los tres al peso** (±1 en un total, por redondeos del
emisor): sueldo proporcional, horas extra, gratificación topada y sin topar, AFP, salud, base
tributable, impuesto único, total de haberes, descuentos y líquido.

El par es especialmente útil porque cubre casos opuestos: febrero es un mes completo con
gratificación **topada** y anticipo; marzo es parcial (16 días) con gratificación **sin
topar**. Entre ambos ejercitan proporcionalidad, tope e impuesto en dos tramos.

**La evidencia real confirma buena parte de la paramétrica semilla**, que hasta ahora era
"valor de referencia sin verificar": IMM $529.000 (deducido del tope de gratificación
$209.396 = 4,75 × IMM / 12), tope de gratificación 4,75 IMM, cotización previsional 10%,
salud 7%, comisión ProVida 1,45%, tramo de impuesto con factor 0,04 y rebaja 0,54 UTM, y que
un contrato **por obra** no cotiza seguro de cesantía del trabajador. También confirma el
divisor 30 para proporcionalizar y que la base de la gratificación es el imponible **sin
incluirse a sí misma** (ADR-008 §1).

⚠️ **Sigue sin validar**: los topes imponibles en UF (la renta nunca se les acercó), los
tramos altos del impuesto, la asignación familiar (el caso tiene 0 cargas) y **todo el camino
Isapre** — el único donde el plan en UF puede superar al 7% legal. Cerrar Isapre sigue siendo
condición de salida a producción del RFC-003 (`describe.todo` reservado).

### Corregido — 🔴 La migración de F1 no podía aplicarse (orden de declaración)

`can_manage_hr()` se definía **después** de las políticas RLS de `employment_contracts` que
la invocan. Postgres exige que la función exista al crear la política, así que la migración
abortaba con *"function public.can_manage_hr() does not exist"* — y como el editor SQL de
Supabase corre el lote en una transacción, el error tardío revertía **todo**, incluidas las
tablas ya creadas. Resultado: la migración parecía haberse ejecutado y la base quedaba
exactamente igual que antes. La función se promovió a sección 4, delante de sus consumidores.

**Por qué no lo vio nadie:** `tsc` y `npm run build` no leen SQL, y la migración se había
dado por aplicada sin verificarlo contra la base. Una migración que nunca se ejecutó es
código sin probar, aunque el resto de la fase compile y pase los tests.

### Seguridad — 🔴 `employment_contract_at()` habría expuesto los sueldos de todo el tenant

Detectado al auditar la migración **antes de aplicarla**, en el sondeo previo al E2E.

La función se escribió con `SECURITY DEFINER` y `GRANT EXECUTE ... TO authenticated`,
devolviendo la **fila completa** del contrato (sueldo, AFP, sistema de salud, plan en UF,
cargas) indexada por un `p_user` que elige quien llama. `SECURITY DEFINER` ejecuta con los
privilegios del dueño, así que la función **puenteaba por completo** la política de `SELECT`
de `employment_contracts` —escrita justamente para que un contrato lo vea solo su titular o
alguien con `can_manage_hr()`.

Era explotable dentro del tenant, no en teoría: `profiles_select_tenant` permite a cualquier
miembro autenticado leer todos los perfiles de su tenant, `id` incluido. Con el uuid de un
compañero —o de un jefe— a mano, una sola llamada RPC devolvía su remuneración. Al no
filtrar tampoco por `tenant_id`, un uuid de otro inquilino habría funcionado igual.

**Corregido antes de que la migración llegara a la base**: la función pasa a `SECURITY
INVOKER` (el default), de modo que la RLS de la tabla se aplica y la regla de acceso vive en
**un solo lugar** —la política— en vez de replicarse dentro de la función. Se descartó la
alternativa de mantener `DEFINER` con validación propia por eso mismo: ya arrastramos una
duplicación consciente (`is_period_closed` en SQL vs `closedMonthsFromEvents` en TS) que hay
que mantener sincronizada a mano, y una tercera copia de "quién puede ver un sueldo" se paga
en bugs. El motor de F2 no pierde nada: corre server-side con service role, que hace bypass
de RLS por su cuenta.

**Patrón a seguir**: en este proyecto `SECURITY DEFINER` se reserva para funciones que
devuelven un **veredicto** (`is_period_closed`, los helpers `can_*`/`is_*`) o que validan el
tenant del solicitante por dentro (`finance_reverse_source`). Una función `DEFINER` que
recibe un identificador del llamador y le devuelve una fila sensible es un agujero de RLS.

### Trampa conocida para F2 — `employment_contract_at()` no devuelve `NULL` cuando no hay contrato

Detectada en el E2E. Al ser `RETURNS public.employment_contracts` (un tipo compuesto, no
`SETOF`), un trabajador **sin** contrato laboral no produce "nada": produce una **fila con
todas las columnas en `NULL`**. Consecuencia para el motor de F2: un `if (contrato)` da
`true` con un contrato vacío y `Number(fila.base_salary)` cae silenciosamente en `0` — se
liquidaría un sueldo cero en vez de fallar.

Mientras la firma no cambie, **el consumidor debe chequear `fila?.id != null`**, no la
verdad del objeto. El arreglo de raíz es `RETURNS SETOF public.employment_contracts` (0 filas
cuando no hay match), pero exige `DROP FUNCTION` + `CREATE` porque no se puede cambiar el
tipo de retorno con `CREATE OR REPLACE`: queda como decisión para el plan de F2.

### Agregado — Dominio Financiero F4.2: flujo de caja proyectado (RFC-002-F4-Plan / ADR-007)

**Migraciones `20260726000000_finance_cash_flow.sql` y `20260726010000_finance_reverse_due_date.sql`
— APLICADAS (2026-07-28).** El ledger respondía "¿cuánto gané?"; ahora también "¿me alcanza
la plata, y cuándo?".

**Verificado E2E 17/17 + regresión 10/10 (tenant DEMO, mutaciones reales).**

- **Las obligaciones de caja entran al ledger como naturaleza propia** (`payable` /
  `receivable`), junto a `cost`/`income`. Una factura pendiente NO es un costo nuevo —la
  recepción ya lo devengó—, así que sumarla como costo habría duplicado el margen. Se
  descartó la idea original (que la factura reemplazara el devengo de la recepción) porque
  `purchase_order_id` es opcional y una OC admite facturas parciales: exigía un prorrateo
  delicado. Detalle en ADR-007.
- **Convención de monto invertida y deliberada:** `cost`/`income` en **NETO** (resultado);
  `payable`/`receivable` en **BRUTO** (caja, lo que sale del banco).
- **Ciclo de vida por reverso, nunca por UPDATE** (Art. 2): la obligación nace con el
  documento, se apaga al pagar/eliminar/anular, se re-emite al repactar monto o vencimiento
  y **revive** al des-marcar un pago de arriendo.
- **Tres fuentes**: facturas de proveedor, cuotas de arriendo y EP por cobrar. Los EP entran
  **sin vencimiento** a propósito —no hay fecha de cobro comprometida y estimarla sería
  inventarla—; la página los muestra aparte en vez de ocultarlos.
- **`/dashboard/finanzas/flujo`**: calendario semanal de entradas/salidas con **saldo
  acumulado** (la pregunta no es cuánto sale esta semana, sino en qué semana falta plata),
  marca de vencido y bloque "sin fecha comprometida". El saldo parte de cero: proyecta
  movimiento, no saldo bancario (Pagnol no lleva tesorería).

### Corregido — 🔴 Los reversos perdían el vencimiento (afectaba a todo el dominio)

`finance_reverse_source` se escribió en F0, antes de que existiera `due_date`, y emitía los
reversos con esa columna en NULL. El neto global siempre estuvo correcto —por eso ninguna
suma lo delataba—, pero el error era de **agrupación**: el reverso no neteaba con su
original y el flujo habría mostrado **pagos que ya no existen**, con las obligaciones
repactadas contadas dos veces. Ahora `due_date` entra al `GROUP BY` y se copia al reverso;
`entry_date` sigue siendo `CURRENT_DATE` para no chocar nunca con un período cerrado (F4.1).
Verificado que las cadenas de costo de F0–F2 (sin vencimiento) siguen neteando e idempotentes.

### Corregido — El panel de Finanzas habría contado las obligaciones como costo

Clasificaba con `if (income) … else → costo`; al agregar `payable` ese `else` habría
duplicado el margen. Pasa a clasificación explícita por naturaleza. **Todo consumidor nuevo
del ledger debe filtrar por `nature` explícitamente — un `else` genérico ahora es un bug.**

### Agregado — Dominio Financiero F4.1: cierre de período (RFC-002-F4-Plan / ADR-006)

**Migración `20260725000000_finance_period_close.sql` — APLICADA (2026-07-28).**

**Verificado E2E 23/23 + precheck 6/6 (2026-07-28, tenant DEMO, ejercitando el trigger
real):** el guard rechaza al usuario autenticado **y al service role** con un mensaje que
nombra período, fecha y autor del cierre; no se coló ningún hecho; siguen pasando los
hechos de hoy, los reversos (se fechan con `CURRENT_DATE`) y el presupuesto; el resto del
lote entra aunque una fila esté bloqueada; los eventos no aceptan `UPDATE`/`DELETE`;
cerrar el período de otro tenant lo rechaza la RLS; reabrir sin motivo falla, y tras
reabrir el hecho vuelve a entrar quedando cierre **y** reapertura en el historial. El
precheck se probó creando las condiciones a propósito: detecta asistencia sin sueldo,
ciclo de arriendo sin devengar y meses anteriores abiertos — y **se apaga** al corregir la
causa (no es ruido permanente). DEMO quedó sin residuos.

Sin cierre, todo lo construido en F0–F3 seguía siendo mutable hacia atrás: un hecho
fechado en enero podía nacer en julio y cambiar un margen ya reportado. El soft-lock
congela el pasado.

- **`finance_period_events`** — eventos append-only (`close`/`reopen`) por tenant × mes,
  con autor y motivo. El estado vigente de un mes es su último evento, así que
  cerrar → reabrir → cerrar queda completo en el historial. Reabrir exige motivo.
- **El guard vive en la base**, no en los emisores: trigger `BEFORE INSERT` sobre
  `finance_entries` que rechaza cualquier hecho cuya fecha contable caiga en un mes
  cerrado, con un mensaje que nombra el período, la fecha de cierre y quién lo cerró.
  Son nueve emisores y dos crons — congelar el pasado no puede depender de que todos
  recuerden chequear. Aplica también al service role.
- **Chequeo previo antes de cerrar** (`finance_period_precheck`): días con asistencia sin
  sueldo base (su MO no está en el ledger), ciclos de arriendo vencidos sin devengar, EP
  aprobados sin cobrar, y meses anteriores todavía abiertos. No bloquea — muestra la foto
  para que nadie cierre a ciegas.
- **Los materializadores reportan lo bloqueado en vez de perderlo** (decisión D1): el cron
  de MO y el de ciclos de arriendo apartan las filas del mes cerrado *antes* del INSERT
  —el lote es de 500 y una sola fila rechazada lo abortaría entero—, emiten todo lo demás
  y devuelven `blocked` + los meses afectados. Reintentan en cada corrida, así que reabrir
  el mes basta para que se emitan solos.
- **`/dashboard/finanzas/cierre`**: estado de los últimos 18 meses, cerrar/reabrir con
  revisión previa, e historial. El presupuesto NO se bloquea: es intención, no un hecho
  ocurrido, y se replanifica hacia adelante (ADR-005).
- Regla compartida `closedMonthsFromEvents` / `splitByClosedPeriod` en `src/lib/finance-periods.ts`
  (+9 tests, 72 en verde) para que UI, crons y guard no puedan discrepar.

Permisos: sin novedad — `finance:manage` ya decía *"Administrar Finanzas (presupuestos,
**cierres**)"*.

### Corregido — 🔴 El "disponible" del presupuesto ignoraba el costo de mano de obra

**Migración `20260724000000_finance_budget_consumption.sql` — PENDIENTE DE APLICAR.**
Encontrado por el E2E de F3 (la única fase que se commiteó antes de verificarse).
Detalle y decisión en el addendum del `ADR-005`.

`disponible = presupuesto − comprometido` daba por hecho que todo costo se
compromete antes de devengarse. **La mano de obra nace devengada** —el trabajador
trabajó, no hay OC que comprometer— igual que el consumo de pañol y las
transferencias de stock. Consecuencia: el mayor costo de una faena era invisible
para el control presupuestario, y la misma fila mostraba *"49% ejecutado"* junto a
*"disponible: todo el presupuesto"*. Medido en DEMO: $108.000 de MO fuera del
cálculo sobre un presupuesto de $220.000.

- Nueva columna **Consumido** = comprometido + devengado de las fuentes que no
  pasan por compromiso (`labor_day`, `material_request`, `stock_transfer`);
  **Disponible** = presupuesto − consumido. El badge "sobre-comprometido" ahora se
  evalúa contra el consumido. `% Ejec.` no cambia.
- La regla vive en `financeMath.budgetConsumption()` (puro, +8 tests → 51 en verde),
  con `UNCOMMITTED_SOURCES` como punto único de verdad: **al escribir un emisor
  nuevo hay que decidir si entra ahí**. El RPC `finance_contract_summary` solo
  agrega — se le sumó `source_type` al `GROUP BY`.
- Se descartó `max(comprometido, devengado)` por subestimar categorías que mezclan
  orígenes (OC pendiente + consumo de pañol); hay un test que fija ese caso.

### Seguridad — Los permisos de Finanzas dejan de ser decorativos en la base

**Migraciones `20260724000000` (APLICADA) y `20260724010000` — PENDIENTE DE APLICAR.**

La mutación exigía `finance:manage` pero la RLS exigía `is_finance_viewer()`, que
solo mira el ROL (`administrador`/`soporte-pagnol`/`super-admin`). Todo el dominio
financiero estaba cerrado por rol: **otorgar `module_finance:view` o `finance:manage`
a cualquier otro rol no habilitaba nada**, aunque el cliente sí los evaluara.

- `public.can_manage_finance()` — nuevo helper que replica la cadena real de `can()`
  (super-admin → bypass admin/soporte → `granted_permissions` → rol por tenant) y
  gobierna la escritura de presupuesto.
- `public.is_finance_viewer()` ahora reconoce además `module_finance:view` con esa
  misma cadena. Se **amplía, nunca se restringe** — los tres roles que ya pasaban
  siguen pasando —, y al vivir en una sola función alinea de una vez el ledger
  (`finance_entries`) y el presupuesto, sin tocar sus políticas.
- La política de SELECT del presupuesto admite también `can_manage_finance()`:
  administrar ⊃ ver. Sin eso, `addBudgetEntry` (que hace `.insert().select()`)
  fallaba justo después de escribir.

**Consecuencia deliberada:** otorgar `module_finance:view` a un rol ahora sí abre el
margen y la estructura de costos — lo que el permiso decía hacer desde F0.

### Verificado — E2E de F3 (2026-07-28, tenant DEMO, mutaciones reales)

20/21 en verde antes de la corrección; el fallo era el bug de arriba. Cubrió:
guards de monto 0 y motivo vacío · append-only con vigente = suma
(200.000 + 50.000 − 30.000 = 220.000) · **Art. 2**: `UPDATE`/`DELETE` no pasan y la
línea sobrevive intacta · **Art. 1**: INSERT en otro tenant rechazado por RLS ·
**Art. 5**: autoría en cada línea · import CSV (2 válidas, 3 inválidas rechazadas
con detalle por fila, `"1.500.000"` bien parseado) · badge sobre-comprometido.
DEMO quedó sin residuos.

---

### Agregado — Dominio Financiero F3: presupuesto de costo (RFC-002-F3-Plan / ADR-005)

> Commiteado en `8d42669`; migración `20260723020000_finance_budget.sql` **APLICADA**
> (2026-07-16). Se mantiene aquí por continuidad de lectura con la corrección de arriba.

Le da referencia al margen: presupuesto vs comprometido vs devengado vs pagado.

- **`finance_budget_entries`**: líneas de presupuesto **append-only** por contrato ×
  categoría de costo (decisión Steven: esa granularidad en v1 — los hechos aún no llevan
  partida; `work_item_id` queda nullable para el futuro). Línea inicial y modificaciones
  son lo mismo: un INSERT con **motivo obligatorio** (rebajas en negativo); el vigente es
  la suma — el historial de modificaciones presupuestarias de RFC-001 sale gratis del
  esquema (Art. 2: sin UPDATE/DELETE). Solo CLP en v1 (decisión Steven). RLS cerrada a
  visores financieros; editar exige `finance:manage` (permiso existente de F0).
- **`/dashboard/finanzas/presupuesto`**: tabla presupuesto | comprometido | devengado |
  pagado | disponible | % ejecución por contrato (expandible a categoría), contra el
  ledger **histórico completo** (el presupuesto es total, no de un rango); badges
  "sin presupuesto" y "sobre-comprometido"; diálogo de línea/rebaja con motivo;
  historial por contrato; **importación CSV** (papaparse: Contrato | Categoría |
  Monto | Motivo). Botón "Presupuesto" en la toolbar del panel Resultado por Contrato.
- Matemática pura `budgetRollup` / `budgetExecutionPct` (+5 tests, 55 en verde).

### Agregado — Dominio Financiero F2: ingresos y emisores restantes (RFC-002-F2-Plan / ADR-004)

**Migración `20260723010000_finance_f2.sql` — APLICADA (2026-07-16).** El panel de
Finanzas muestra por primera vez **MARGEN por contrato** (ingreso devengado − costo
devengado) — el diferenciador estratégico del RFC-001.

**Verificado E2E (2026-07-16, tenant DEMO, ejercitando las mutaciones reales con sesión
real):** 17/17 — EP con correlativo, delta congelado y herencia del contrato de la raíz
WBS; aprobar devengó $300.000 de ingreso; EP2 encadenó el delta ($200.000); EP sin
avance nuevo bloqueado; cobro con fecha real; anulación reversó a $0 y el EP siguiente
calculó su delta contra el último EP VIVO; arriendo comprometió Σ calendario
($1.500.000) sin duplicar al re-confirmar, el materializador devengó el ciclo vencido
(idempotente), pago→pagado, des-marcar reversó todo y el materializador re-devengó;
consumo movió el costo pool→contrato ($26.700) y la transferencia de stock
pool→Miscelánios movió $17.800 con su par negativo/positivo.

- **Ingresos desde Estado de Pago**: puente WBS↔contratos (`work_items.contract_id` en
  la raíz de la obra, selector en Control de Obra); el EP hereda la imputación y congela
  el **delta del período** al crearse (`previous_earned`/`period_earned` — el acumulado
  JAMÁS se devenga, duplicaría los EP anteriores; delta ≤ 0 bloquea la creación).
  Máquina de estados nueva en `paymentStateMutations.ts`: **Aprobar** (permiso
  `payment_states:approve`, default ADC) → ingreso devengado `revenue`; **Marcar
  cobrado** (`payment_states:pay`, fecha real) → ingreso pagado; **Anular** → reverso
  de todo lo vivo. Correlativo `EP` + acciones en el historial (quien aprueba ve todos
  los EP del tenant).
- **Arriendos** (categoría `rental`, imputados vía `rental_contracts.client_contract_id`,
  heredado de las solicitudes de terreno al adjudicar y editable en la ficha):
  OC confirmada → **comprometido** = Σ del calendario generado (UF congelada del día);
  **ciclo vencido → devengado** por materializador diario (mismo cron de MO, ventana 35
  días, autor `Sistema (devengo arriendo)`); pago marcado → **pagado** (fecha real).
  Des-marcar/eliminar cuota, cortar calendario al cerrar (con recompromiso por el
  calendario final) y eliminar contrato reversan sus hechos.
- **Consumo de pañol** (anti-doble-conteo, ADR-004 §7-8): la entrega de un CONSUMIBLE
  mueve el costo desde la dimensión de origen real (pool = "Sin contrato" u otro
  contrato, según lo que reporte `consumeFromLedger`) hacia el contrato destino —
  una unidad nunca costea dos veces. Transferencias de stock entre contratos emiten el
  par negativo/positivo. Herramientas se prestan, no se consumen: no emiten.
  Devoluciones no emiten (reingresan a la misma dimensión).
- **Mantenciones: DIFERIDA con ADR-004 §6** (decisión Steven): `total_cost`/`parts_used`
  son digitación libre que no mueve stock; MO ya la captura F1 y los repuestos el consumo
  de pañol — emitir duplicaría.
- **Panel Finanzas**: KPIs Ingresos y **Margen** + columnas por contrato (margen y %)
  + fila de ingresos (devengado/cobrado) en el desglose.
- **Drift #5 reparado por la migración**: `payment_states` viva no tenía
  `total_value`/`earned_value` — **crear un EP estaba 100% roto** (PGRST204), mismo
  patrón que compras (F0) y asistencia (F1).
- 12 tests nuevos de matemática pura (`epPeriodEarned`, `rentalNetToClp`,
  `consumptionTransfers`) — 50 en verde.

### Agregado — Dominio Financiero F1: costo de mano de obra (RFC-002-F1-Plan / ADR-003)

**Sin migración SQL propia** (la categoría `labor`, `counterparty_type='worker'` y
`tenants.labor_cost_factor` existen desde F0); requiere la reparación de asistencia
`20260723000000` (abajo). **Verificado E2E (2026-07-16, tenant DEMO, vía
`/api/finance/labor-refresh` real):** día trabajado devengó $54.000 (1,2M/30×1,35) al
contrato de la primera marca; vacaciones ('V') no devengó; presencia sin contrato alertó;
el día abierto (hoy) quedó excluido; segunda corrida = no-op (idempotencia); cambio de
sueldo → espejo negativo fechado hoy (`reversal_of`) + re-emisión fechada el día
trabajado; configurar el sueldo faltante emitió el día pendiente y apagó la alerta;
netos vivos y RPC del panel cuadrados tras 11 hechos inmutables. Cron protegido
(401 sin/con token falso).

- **Modelo día-persona** (decisión Steven): `presencia × sueldo base/30 × factor
  costo-empresa`. Presencia = ≥1 marca `'in'` trabajada del día (scan normal o marcas
  importadas P/ATR/MJ; A/D/LM/PSG/V/PP no devengan). Contrato del hecho = el de la
  primera marca del día (resuelto por el scan vía `contract_workers`); sin sueldo base
  ⇒ NO se emite hecho $0, se alerta (calidad de dato). Sesgo documentado: los descansos
  pagados de turnos rotativos no devengan (ajuste llegará con el presupuesto, F3/F4).
- **Materializador con ventana de reconciliación** (`src/lib/labor-cost.ts`): primer
  emisor del ledger que NO vive en una mutación (ADR-003) — el día-persona es una
  derivación de marcas que se editan retroactivamente. Cron diario materializa días
  CERRADOS (hoy en America/Santiago excluido) y re-verifica una ventana móvil de 35 días:
  si marcas/sueldo/factor cambiaron, emite espejo negativo (`reversal_of`, misma semántica
  que `finance_reverse_source`) + hecho corregido. Idempotente; INSERT-only (Art. 2);
  autor `Sistema (costo MO)` (Art. 5, autoría explícita del proceso).
- **Matemática pura en `financeMath.ts`** (+17 tests): `laborDayCost`, `laborDaySourceId`,
  `laborDayPresence`, `laborDayExpected`, `reconcileLaborDay` (decisión no-op / reverso+
  re-emisión). Detectó y respeta que el import Excel inserta `type='in'` para TODAS las
  marcas, incluidas ausencias.
- **`/api/cron/labor-cost`** (GET, `CRON_SECRET` fail-closed, diario 06:00 UTC ≈ 02–03 AM
  Chile en `vercel.json`): itera todos los tenants; un tenant con datos rotos no frena al
  resto. **`/api/finance/labor-refresh`** (POST, admin del tenant, patrón uf-refresh):
  respaldo manual; `tenantId` del body solo se honra para super-admin.
- **Panel Finanzas**: botón «Recalcular MO» (llama al respaldo manual y refresca el
  resumen) + tarjeta de alerta «N trabajador(es) con asistencia sin sueldo base» derivada
  client-side del rango visible. La categoría *Mano de obra* ya se despliega en el rollup
  por contrato existente (F0).

### Corregido — 🔴 Drift de esquema: registro de asistencia 100% roto (preexistente)

**Migración `20260723000000_attendance_drift_repair.sql` — APLICADA (2026-07-16),
verificada: columnas nuevas presentes, 140 filas legacy normalizadas a `in`/`out` +
`qr`, `date` rellenada desde el timestamp.**
Descubierto por el E2E de F1 (mismo patrón que el drift de compras reparado en F0):
la tabla `attendance_logs` viva nació con el esquema antiguo y nunca se migró.

- El INSERT del scan QR, del registro manual y del import Excel **fallaba con PGRST204**
  (el código escribe `date`, `registrar_id`, `registrar_name`, que no existían), y
  `updateAttendanceLog` igual (`original_timestamp`, `modified_at`, `modified_by`).
- Las 140 filas legacy (siembra demo de abril) usan `type='check-in'/'check-out'` y
  `method='QR'`; el código lee `type='in'/'out'` — esas marcas eran invisibles para
  el módulo de asistencia, los reportes y el costo de MO. La migración las normaliza
  y rellena `date` desde el `timestamp` en hora de Chile.
- Índice nuevo `(tenant_id, date)` para el reporte de asistencia y la ventana de
  reconciliación del materializador de MO.

### Agregado — Dominio Financiero F0: ledger de hechos económicos (RFC-002)

**Migración `20260722000000_finance_ledger.sql` — APLICADA (2026-07-16).**
**Verificado E2E en navegador (2026-07-16)**: solicitud → OC valorizada ($ de catálogo
precargado) → recepción (devengado + `unitCost` actualizado al precio real) → factura
bruta → pago (neto IVA 19%) → panel Resultado por Contrato con las tres etapas en
$61.725 y 100% devengado; luego los tres reversos en cadena (eliminar factura pagada,
eliminar recepción, anular OC) dejaron el panel en $0 neto con 3 hechos + 3 espejos
enlazados por `reversal_of`, stock y desglose por contrato cuadrados. Cron UF probado
(401 sin token / 200 con `CRON_SECRET`, 31 tasas desde mindicador.cl).

- **`finance_entries`**: tabla de hechos económicos inmutables (Art. 2 de la Constitución:
  sin política ni GRANT de UPDATE/DELETE — para nadie). Neto CLP congelado + moneda origen +
  tasa; dimensiones planas (contrato, partida, categoría, documento origen, contraparte);
  reversos vía RPC `finance_reverse_source` (SECURITY DEFINER, idempotente). SELECT solo
  administrador/soporte-pagnol (`is_finance_viewer()`); INSERT cualquier miembro del tenant.
  Deliberadamente FUERA de Realtime y del DataProvider.
- **Emisores en compras** (`financeLedger.ts`, patrón stockLedger elevado a dinero):
  OC creada → *comprometido* (ambas rutas), recepción → *devengado* (por ítem, con el contrato
  ya resuelto), factura pagada → *pagado* (bruto→neto IVA 19%, contrato heredado de la OC).
- **Toda OC nace valorizada + retroalimentación de precios**: la generación de cotizaciones
  ahora exige precios (precargados desde `materials.unitCost`, diálogo nuevo) y guarda
  `total_amount`; al recibir, el precio real de compra actualiza el catálogo.
- **`abastecimiento/recepcion` → panel**: RPC `finance_contract_summary` (agregación
  server-side) alimenta la página nueva **`/dashboard/finanzas` (Resultado por Contrato)**:
  comprometido / devengado / pagado por contrato con desglose por categoría, fila
  "Sin contrato" como alerta de calidad de dato, y rango de fechas.
- **Facturas de Proveedor** (`payments/pago-facturas`): página reconstruida — era un duplicado
  copy-paste del procesador de cotizaciones y NO existía superficie para registrar/pagar
  facturas. Ahora: registrar (bruto + vencimiento + OC vinculada vía columna nueva
  `purchase_order_id`), marcar pagada, eliminar con reverso.
- **UF automática**: tabla global `uf_rates` + cron diario `/api/cron/uf-rate`
  (mindicador.cl, patrón CRON_SECRET, registrado en vercel.json) + botón "Actualizar UF"
  (`/api/finance/uf-refresh`, solo re-consulta la fuente oficial — nunca digitación manual).
- **Configuración**: campo factor costo-empresa (`tenants.labor_cost_factor`, default 1.35,
  validado 1.0–3.0); lo consumirá el costo de MO en F1.
- **Permisos**: `module_finance:view` + `finance:manage` (ningún rol los recibe por defecto;
  admin/soporte entran por el bypass de `can()`); tarjeta en el panel central y sidebar.
- **Tests**: `financeMath.ts` (neto/bruto, UF→CLP, armado de filas) con 12 tests; el include
  de Vitest ahora lo cubre.

### Corregido — Drift de esquema: generar OC estaba 100% roto en el proyecto actual

**Migración `20260722010000_purchasing_schema_repair.sql` — APLICADA (2026-07-16).**
Descubierto por el E2E de F0: el esquema vivo (reconstruido post-30-may-2026) nunca tuvo
las columnas que el código de compras usa hace meses — el insert de `purchase_orders`
fallaba con PGRST204 y ninguna OC se había podido crear jamás en este proyecto.

- **`purchase_orders`**: se agregan `internal_code`, `supplier_name`, `creator_name`,
  `request_ids`, `official_oc_id`, `processed_at`, `processed_by`; `id` pasa de uuid a
  **text** (el generador asigna códigos correlativos tipo `MDS-PUR-0002`), junto con sus
  tres referencias (`supplier_payments`, `purchase_requests`, `goods_receipts`).
- **`purchase_lots.supplier_id`**: no existía — el generador lo guardaba con error
  silencioso y el flujo RFQ no podía emitir la OC firme.
- **`supplier_payments`**: se agregan `issue_date` y `payment_date` (las escribe la página
  de Facturas de Proveedor).
- **`generatePurchaseOrder` ahora es segura ante fallos**: las solicitudes se marcan
  `ordered` DESPUÉS de persistir la OC (antes quedaban en estado fantasma si el insert
  fallaba).
- **Toasts de la página de órdenes ya no tragan el error real**: los `PostgrestError` de
  Supabase son objetos planos (no `instanceof Error`) y todo fallo se mostraba como
  "Error desconocido"; ahora se lee `.message` directo.

### Corregido — 2 bugs de integridad preexistentes en compras

- **`cancelPurchaseOrder` hacía DELETE de la OC**: el documento desaparecía sin rastro.
  Ahora es soft-cancel (`status='cancelled'`) + reverso de sus hechos financieros; los KPIs
  que sumaban "todas las OC" ahora excluyen anuladas (purchasing y proveedores 360°).
  Además ya no permite anular una OC completada.
- **`deleteGoodsReceipt` borraba la recepción SIN revertir el stock ingresado**: el total del
  material, el desglose por contrato y el kardex quedaban inflados para siempre (violaba el
  espíritu del Art. 3). Ahora reversa stock + ledger + kardex (misma resolución de contrato
  que usó la recepción), reabre la OC si había quedado completada y reversa los hechos
  financieros.

### Agregado — Manifiesto Arquitectónico v2.0 en tres capas + registro de decisiones (ADR)

- **`docs/research/ARCHITECTURAL_MANIFESTO.md` v2.0**: reescritura conjunta tras desafío
  deliberado de la v1.0 (Steven). Clasifica el sistema por el test "¿quién sufre si esto
  cambia?": **Constitución** (5 artículos innegociables: aislamiento de tenants, hechos
  inmutables, ledgers cuadran, biometría en dispositivo, todo hecho tiene autor; enmienda
  solo con dos firmas), **Arquitectura** (cambia vía RFC con tres peajes: carga de la prueba
  proporcional, migración de datos, ADR) y **Capa rápida** (convención sin cuestionamiento).
  La idea central de la v1.0 ("Pagnol se descubre") se conserva como mecanismo estructural:
  el ascensor del descubrimiento entre capas.
- **`docs/decisions/`** nace como registro de decisiones arquitectónicas;
  **ADR-001** documenta la decisión de tres capas y las alternativas rechazadas.

### Agregado — Dominio Financiero: investigación arquitectónica (RFC-001 / RFC-002)

Nace `docs/research/` con los primeros RFC del proyecto:

- **RFC-001-Dominio-Financiero.md** (Steven): planteamiento del problema — Pagnol registra
  la operación pero no puede responder preguntas financieras (costo real por contrato,
  utilidad, flujo proyectado). Rescatado desde un worktree huérfano al repo principal.
- **RFC-002-Resultado-por-Contrato.md** (respuesta arquitectónica): ledger financiero
  append-only alimentado por los módulos existentes (patrón `stockLedger` elevado a dinero),
  máquina de estados Presupuesto→Comprometido→Devengado→Pagado, ingresos vía estado-pago,
  presupuesto de costo por partida (manual/Excel; APU en fase posterior), CLP+UF desde v1,
  MO = asistencia × factor costo-empresa, agregación server-side (primera ruptura consciente
  del patrón `useSupabaseCollection`), cierre de período y fases F0–F5. Explícitamente fuera
  de alcance: contabilidad general y tesorería v1. Solo documentación — sin código ni
  migraciones; pendiente aprobación para planificar F0.

### Agregado — Áreas Internas: la estructura propia de la empresa (caso Valar)

**El problema de fondo:** "personal/stock de planta" y "dato que falta asignar" eran
el **mismo estado**. Un trabajador de Administración simplemente no tenía fila en
`contract_workers`, exactamente igual que un operario que alguien olvidó asignar; y el
casco que se le entregaba caía al pool central (`material_stocks.contract_id IS NULL`),
que la migración `20260701010000` definió explícitamente como **limbo** ("se reparte
después con la acción de transferencia"), no como una unidad organizacional real.
Resultado: era imposible distinguir al contador de finanzas de un olvido, y el costo de
su equipamiento contaminaba el balde de "no asignado" en vez de imputarse a su área.

**El modelo:** un **Área Interna** (Administración, Finanzas, Abastecimiento, Gerencia…)
es una fila de `contracts` con `kind='internal'` y `client_id NULL`. Como todo el sistema
ya pivotea sobre `contract_id` (`contract_workers`, `material_stocks`, `warehouse_contracts`,
kardex, asistencia, las 3 solicitudes), un área hereda **gratis** personas, stock, pañoles,
imputación y reportes — sin una segunda dimensión que duplicaría el invariante del ledger.
Se descartó por eso una entidad `internal_areas` paralela.

Efecto colateral deseado: `contract_id IS NULL` **recupera su significado real** (limbo), y
"sin asignar" pasa de ser un estado normal a una **alerta de calidad de dato** accionable.

- Migración `20260721000000` (**pendiente de aplicar**): `contracts.kind` (`client`|`internal`,
  default `client` → los contratos existentes no cambian), `contracts.cost_center_id` (FK opcional
  a `cost_centers`: el presupuesto de compras sigue siendo entidad aparte, solo se enlaza), y un
  CHECK que impide que un área interna tenga mandante.
- **Sin backfill, deliberado**: no se mueve el pool actual a ningún área (contiene todo el stock
  histórico; migrarlo declararía en silencio que es suyo) ni se auto-asigna a planta al personal
  sin contrato (puede ser planta o un olvido — solo el usuario sabe cuál).
- **Sin seed en SQL**: Pagnol es multi-tenant y un `INSERT` en la migración inyectaría las áreas a
  *todos* los tenants. Se crean desde Configuración → Clientes y Contratos, por tenant.
- Pañol de oficina: es un `warehouse` normal ligado al área vía `warehouse_contracts` (N:M) — cero
  código nuevo de ledger. El pañol central que "abastece a todo" ya estaba soportado por ese N:M.
- UI: nueva sección "Áreas internas" en Configuración; selector de tipo en el formulario de
  contrato; agrupación Contratos / Áreas Internas en `ClientContractFilter`, `UserPanel` y el
  wizard de enrolamiento; badges diferenciados en Usuarios y Personal.

### Corregido — El bloque "subcontratista" del formulario de contrato no persistía nada
`isSubcontractor`, `parentContractId`, `subcontractorCompany` y `subcontractorRut` estaban
declarados en el tipo `Contract` y en el formulario, pero **el mapper no los leía y las
mutaciones no los escribían**, y las columnas ni siquiera existían en `contracts`. Marcar la
casilla no tenía efecto alguno: se perdía en silencio al guardar. Se añaden las columnas
(migración `20260721000000`), el mapeo y la escritura. `tsc` no lo detectaba porque los campos
son opcionales.

### Corregido — `updateContract` podía fallar en silencio bajo RLS
No encadenaba `.select()`, así que un `UPDATE` que no matchea ninguna fila por RLS "tenía
éxito" sin escribir nada (gotcha conocido del proyecto).

### Agregado — Filtro por contrato/área en /dashboard/users y /dashboard/pagnol/personal
Con muchos usuarios era imposible saber en qué contrato estaba cada uno sin entrar a su ficha.
Ambas páginas ganan el filtro en cascada Cliente → Contrato/Área (reusando `ClientContractFilter`,
con opción "Sin asignar") y muestran los contratos y áreas de cada persona como badges en la
tarjeta — distinguiendo visualmente contrato de cliente (azul) de área interna (ámbar). La
tarjeta de Personal se compactó (menos padding, avatar y tipografías más chicas).

### Agregado — Eliminar activo en /dashboard/pagnol/activos (borrado auditado)
No existía forma de eliminar un activo — el botón nunca se implementó (`deleteMaterial`
estaba escrito pero sin usar en ningún lado). Al construirlo se encontró que
`stock_movements.material_id` tiene FK `ON DELETE CASCADE` hacia `materials`: un
DELETE real habría borrado TODO el kardex histórico del activo (entradas/salidas/
ajustes previos), no solo el evento de eliminación — confirmado en la base real.
Por eso "Eliminar" es un **borrado suave auditado** (`materials.deleted_at` /
`deleted_by` / `deletion_reason`, migración `20260720000000`, pendiente de
aplicar): el activo desaparece de toda la app (mismo mecanismo `softDelete` que
ya usa `profiles`/`deleteUser`) pero la fila y su kardex completo quedan intactos,
más un nuevo registro de kardex (`type: 'deletion'`) con motivo y quién eliminó.
Antes de eliminar, bloquea si el activo tiene componentes hijos, devoluciones/
retiros pendientes que lo referencian, o si viene de un contrato de arriendo.
Reservado a `materials:delete` — hoy solo `administrador`/`soporte-pagnol` (ya
estaba definido así en `ADMINISTRADOR_PERMISSIONS`, nadie más lo tenía). De paso
se corrigió el texto fabricado del modal de edición ("PAGNOL IMS CORE SYSTEM |
FAENA NORTE" no significaba nada) por el código interno y nombre real del activo.

### Corregido — "Recibir" en Solicitudes de Compra podía duplicar stock en silencio
Auditoría completa de `/dashboard/pagnol/solicitudes-compra` (2026-07-13).
Encontrado y **reproducido en navegador**: `receivePurchaseRequest` escribía
`original_quantity` (columna inexistente) como último paso, DESPUÉS de crear
el material y sumar el stock — el error de esquema se ignoraba, el diálogo se
cerraba como si hubiera funcionado, y la solicitud quedaba en el mismo estado
con el botón "Recibir" disponible: cada reintento volvía a sumar stock. Así
quedó un activo del cliente de Valar (`VALAR-ACT-0392`, solicitud
`VALAR-SCL-0001`) con stock 2 en vez de 1 — **reparado manualmente** (kardex
duplicado eliminado, ledger y stock corregidos, solicitud finalizada como
`received`). Mismo patrón en `updatePurchaseRequestStatus` (`approver_name`
tampoco existía — "Aprobar" en Gestionar fallaba siempre) y en el ajuste de
cantidad (`original_quantity`). Migración
`20260719000000_purchase_requests_original_quantity.sql` agrega ambas
columnas (pendiente de aplicar). `receivePurchaseRequest` ahora hace la
transición de estado **primero y de forma atómica** (`UPDATE ... WHERE status
IN (...)`) antes de tocar material/stock — un reintento del mismo click ahora
aborta con "ya fue recibida" en vez de duplicar, y revisa el error de todos
los pasos intermedios (antes varios `.update()`/`.insert()` no se revisaban).

### Agregado — Gate ADC + permiso en `updatePurchaseRequestStatus`
Aprobar/rechazar una solicitud de compra no exigía el permiso
`purchase_requests:approve` ni que el ADC la hubiera autorizado — cualquier
usuario autenticado del tenant podía llamarla directamente. Ahora exige el
permiso y, para aprobar, exige `adc_authorized_at` (o que quien aprueba
también pueda autorizar).

### Cambiado — Rediseño de Solicitudes de Compra (firma Pagnol)
KPIs clickeables que filtran la tabla (antes un `<Select>` separado, con
colores crudos `yellow-600`/`purple-600`/`cyan-600`/`blue-600`); nueva
distinción "Esperando ADC" vs. "Por Gestionar" (antes ambos se veían como
"Pendiente", reusando `resolvePurchaseStage`/`PurchaseStageBadge` ya
construidos para el pipeline del supervisor); banner a Autorizaciones si hay
solicitudes esperando ADC; columna de código interno; filtro de solicitante
ahora usa `requesterName` con fallback (antes ignoraba las filas de recepción
parcial, que no tienen `supervisorId`); filtro de fechas + export a Excel;
`DataTable`/`EmptyState` reemplazan el spinner que bloqueaba toda la página.

### Cambiado — Diseño de correo unificado en las 8 rutas que envían mail
Cada ruta (invitación, bienvenida, reset de contraseña, alerta de feedback,
solicitud de integración ERP, OC/cotización a proveedor, informe de terreno,
suministro al cliente) tenía su propio HTML duplicado, con footers distintos
entre sí y sin link a `www.pagnol.cl` en la mayoría. Se tomó la invitación
como estándar y se extrajo a `src/modules/core/lib/emailLayout.ts`
(`renderEmailLayout` + `emailButton`), y el correo de bienvenida duplicado
entre `/api/register` y `/api/register/oauth` se unificó en
`src/modules/core/lib/welcomeEmail.ts`. Todas las rutas ahora comparten header
(PAGNOL + acento naranja), tarjeta blanca y footer con `www.pagnol.cl` +
`contacto@pagnol.cl`. Las de OC/cotización e informe de terreno, que antes no
tenían ningún branding (un `<div>` suelto), ahora usan el mismo envoltorio.

### Agregado — Reenvío de suministro al cliente + ver a quién se envió
`purchase_requests.sent_to_client_email` (migración `20260718000000`, pendiente
de aplicar) guarda el destinatario real del último envío. El historial de
solicitudes (`purchase-history-card.tsx`) ahora muestra "Enviado a X el fecha"
para las ya `ordered`, y ofrece un botón **Reenviar al cliente** (antes el
botón desaparecía tras el primer envío, sin forma de corregir un correo mal
escrito ni de volver a mandarlo a otro contacto). El diálogo de envío precarga
el último destinatario usado en vez de solo el correo genérico del cliente.

### Corregido — `purchase_requests.ordered_at` no existía: transición a "ordered" fallaba
`markClientRequestsSent`, `updatePurchaseRequestStatus` y `awardRfq` escriben
`ordered_at` al pasar una solicitud a `status='ordered'`, pero la columna nunca
se creó en ninguna migración. En el flujo de suministro al cliente esto se veía
como "no se pudo enviar" justo después de que el correo salía bien; en la
adjudicación de RFQ fallaba **en silencio** porque ese `UPDATE` no revisaba el
error de retorno, así que las solicitudes nunca quedaban realmente en
`ordered` ni con `purchase_order_id` asignado. Migración
`20260717000000_purchase_requests_ordered_at.sql` agrega la columna (pendiente
de aplicar); `rfqMutations.ts` ahora revisa y lanza el error de ese `UPDATE`.

### Corregido — Control de Obra: crear Contrato/Partida estaba 100% roto + siembra colisionaba entre tenants
Auditoría completa del módulo (2026-07-12). Hallazgo más grave: **crear un
Contrato/Partida nunca funcionó en producción** — `work_items.id` es `TEXT
PRIMARY KEY` sin `DEFAULT` y el código nunca generaba un id, así que el INSERT
siempre fallaba (`23502 null value in column "id"`, verificado contra la BD
viva). Además, el estado en memoria **fabricaba** la estructura de ejemplo
(`WORK_ITEMS_SEED`) cada vez que `workItems` estaba vacío — un tenant veía
"39 tareas" aunque nunca se hubiese guardado nada real, ocultando por completo
que la creación estaba rota.

- **Migración `20260716000000_construction_control_hardening.sql`** (**APLICADA**
  por el usuario): `DEFAULT gen_random_uuid()::text` en `work_items.id`; FK
  `parent_id → work_items.id ON DELETE RESTRICT` (antes sin integridad
  referencial); `CHECK` en `type`/`status` limitando a los valores reales del
  dominio `WorkItem` (el Gantt llegaba a escribir `type='milestone'`, inexistente).
- **Siembra ahora es opt-in, no automática**: se eliminaron las DOS
  fabricaciones (el `INSERT` con ids globales fijos `'1'..'39'` en
  `DataProvider.tsx`, que colisionaba entre tenants — solo el primer tenant
  sembrado tenía datos reales — y la fabricación en memoria del mismo seed).
  Nueva mutación `seedExampleWorkItems` con ids prefijados por tenant (sin
  colisión posible), disparada por un botón "Cargar Estructura de Ejemplo" en
  el `EmptyState` honesto del EDT. **Verificado end-to-end en navegador**:
  clic real → filas persistidas de verdad en la BD con ids
  `<tenant>_<n>` y jerarquía correcta.
- `deleteWorkItem` ahora verifica sub-partidas y registros de avance antes de
  borrar (antes: sin guard, sin permiso gateado en el Gantt; el error crudo de
  Postgres por la FK ya bloqueaba el caso con avances, pero con un mensaje
  ilegible).
- **Gantt**: ya no permite arrastrar la barra de progreso (escribía `progress`
  directo, rompiendo el invariante avance-por-registros); se quitó el botón
  "Nueva Tarea" (feature fantasma que solo mostraba "Acción Desactivada"); el
  modal de edición ya no permite cambiar tipo/padre (riesgo de corromper
  `path`), solo fechas/responsable/color; borrado gateado por permiso.
- **SPI/Curva S honestos**: antes cualquier partida sin fecha planificada se
  trataba como si venciera "hoy", mostrando "Atrasado, SPI 0.00" con datos
  inventados. Ahora solo se calculan sobre partidas con fechas reales; sin
  ellas se muestra un `EmptyState` explicando qué falta.
- **Dark mode del Gantt reparado de raíz**: las 7 clases CSS hardcodeadas
  (`._3_pmuJ`, etc.) para adaptar `gantt-task-react` a dark **ya no existían
  en el bundle instalado** — verificado inspeccionando el DOM real, 0
  coincidencias. Reescrito con clases verificadas contra el render actual +
  selectores por `tag` (`text`, `line`) inmunes a futuros cambios de versión.
- **Un solo lenguaje para "aprobar partidas"**: existían dos sistemas de
  calidad con nombres cruzados ("Mis Protocolos"/"Revisar Protocolos de
  Calidad" operando sobre `WorkItem.status`, separado de la entidad real
  `Protocol` con checklist y firmas). Renombradas a "Mis Partidas
  Enviadas"/"Aprobar Partidas de Obra" (sidebar y título coherentes) para dejar
  "Protocolos de Calidad" como el único nombre de la entidad real.
- **Fuga de acceso en el detalle de protocolo**: la lista ya ocultaba
  borradores ajenos a quien no revisa, pero `protocolos/[id]` no tenía ningún
  chequeo — se podía editar/firmar el borrador de otra persona entrando por
  URL directa. Agregado el mismo filtro de ownership.
- Eliminado el feature fantasma de fotos de evidencia en protocolos
  (`evidencePhotos` sin setter ni UI de captura, pero cada guardado escribía
  `evidence_photos: []` como si fuera real).
- **Diseño**: las 8 páginas del módulo migradas a tokens semánticos (~70
  usos de paleta cruda, 42 fondos claros sin dark) y a los componentes
  compartidos `PageShell`/`EmptyState`/`LoadingState`. La isla blanca de
  "Protocolos de Calidad" en dark mode (bug más visible del audit) queda
  verificada con screenshot antes/después.

### Reescrito — Pagnol AI: de "resumen de 50 filas" a asistente con datos reales (tool-calling + MCP)
El asistente respondía sobre un JSON recortado (`slice(0,50)` de materiales/tools/
solicitudes armado en el navegador) sin memoria de conversación, vía un server
action sin auth ni rate limit. Rediseño completo en 4 fases:

- **Fase 1 — Cerebro con herramientas reales**: `src/ai/tools/definitions.ts`
  define 11 herramientas de solo-lectura (`buscarMateriales`, `stockPorContrato`,
  `kardexMaterial`, `solicitudesMaterialPendientes`, `solicitudesCompraPendientes`,
  `ordenesDeTrabajo`, `mantenimientosProximos`, `resumenAsistencia`,
  `arriendosActivos`, `pagosPendientes`, `buscarPersonal`), cada una filtrando
  SIEMPRE por `tenant_id` server-side y gateada por permiso (`module_pagnol:view`,
  `module_payments:view`, etc. — mismo criterio que `can()`). `src/ai/tools/
  genkit-tools.ts` las registra como tools de Genkit; el tenant/permisos viajan
  por el `context` de `ai.generate()`, nunca por el input del modelo.
  `pagnol-assistant-flow.ts` reescrito con historial de conversación real
  (multi-turno) y `maxTurns: 6` para resolución de tool-calling. Se eliminó el
  campo `decisions` (JSON estructurado que la UI nunca leía). **Bug de la API de
  Gemini descubierto y corregido durante la verificación**: `tools` +
  `output.schema` (salida estructurada) son incompatibles — Gemini responde
  400 `Function calling with a response mime type: 'application/json' is
  unsupported`; se usa `response.text` en su lugar.
- **Fase 2 — Transporte seguro**: nuevo endpoint `POST /api/ai/assistant`
  (`requireAuth` + `resolveTenant` + `rateLimitByIp` 30/hora) reemplaza el
  server action abierto `askPagnol` (eliminado de `ask-ferro.ts`, que ya no
  autenticaba ni limitaba). El tenant siempre viene de la sesión, nunca del
  body.
- **Fase 3 — UI**: `inventory-assistant.tsx` reescrito con historial real
  enviado al backend, quick-queries que mapean a herramientas que existen de
  verdad (antes preguntaban por "próximo mantenimiento" y `tools`, datos que
  el contexto viejo ni tenía), y migrado a tokens del design system
  (`bg-card`/`text-muted-foreground`/`border-border` en vez de `slate-*`/
  `bg-white` crudos).
- **Fase 4 — MCP externo**: `POST /api/mcp` expone las MISMAS herramientas de
  `definitions.ts` a clientes externos (Claude Desktop, Claude Code) vía
  JSON-RPC 2.0 stateless ("Streamable HTTP"), autenticado con un token propio
  por usuario (no sesión Supabase). Nueva tabla `api_tokens` (migración
  `20260715000000_api_tokens.sql`, **PENDIENTE DE APLICAR**): el token en
  texto plano se genera en el navegador (Web Crypto), se hashea SHA-256 y solo
  el hash se persiste — se muestra una sola vez. Gestión de tokens (generar/
  revocar) agregada a `dashboard/configuracion` (card "Integraciones — Pagnol
  AI (MCP)").

**Verificado end-to-end en navegador** (login real + pregunta real): el
asistente ejecutó `buscarMateriales(soloStockCritico:true)` contra la BD real
y devolvió materiales concretos con nombres y stock reales. El protocolo MCP
se verificó con curl (`initialize` OK, `tools/list` sin token → 401 correcto);
la prueba completa con token real quedó pendiente de la migración de
`api_tokens`.

### Seguridad — Endurecimiento por linter de Supabase (lote 2026-07-12)
Migración `20260714000000_security_linter_hardening.sql` — **APLICADA** por el
usuario. Resuelve las advertencias del Security Advisor verificadas
contra el código real:

- **Buckets públicos sin listing** (lo más serio): eliminadas las policies
  SELECT amplias de `contracts`, `asset-photos` y `tenant-logos`. Se confirmó
  EN VIVO que un anon podía listar las carpetas por tenant vía la API de
  storage (`/storage/v1/object/list/...`); en `contracts` eso expone PDFs de
  contratos EA y de responsabilidad firmados (PII). La app no usa `.list()`
  ni `.download()` (solo `upload`/`getPublicUrl`/`remove`), y la URL pública
  no pasa por RLS en buckets públicos → cero impacto funcional.
- **`check_rate_limit` solo service role**: se revocó EXECUTE de
  anon/authenticated. Cierra un DoS selectivo: cualquiera podía quemar la
  cuota de rate-limit de otra IP (p.ej. bloquear su reset de contraseña)
  llamando la RPC directamente.
- **`next_internal_code` con guard de tenant**: un usuario autenticado del
  tenant A ya no puede quemar correlativos del tenant B (permite super-admin
  cross-tenant y service role). Además se revocó EXECUTE de anon.
- **`use_qr_token`**: revocado EXECUTE de anon (solo la usa el dashboard
  autenticado).
- **4 triggers `set_*_updated_at`** (work-reports, RFQ, recepción, cost
  centers): `search_path` fijo + EXECUTE público revocado — habían quedado
  fuera del hardening `20260614000001` por ser posteriores.
- **Decisión documentada**: los helpers de RLS (`get_my_tenant_id`,
  `is_super_admin`, `get_my_role`, `is_tenant_admin`) conservan EXECUTE para
  anon a propósito — el login por RUT consulta `profiles` como anon y las
  policies los invocan; para anon devuelven null/false (inofensivo).
- Queda manual (no es SQL): activar "leaked password protection" en
  Dashboard → Authentication (chequeo HaveIBeenPwned).

### Agregado — Skills de auditoría para Claude Code (`.claude/skills/`)
Tres skills que destilan la metodología y los hallazgos de todas las auditorías
realizadas (2026-06/07), para que futuros modelos las usen como guía al auditar:

- `auditoria-seguridad`: rutas API (api-auth, resolveTenant, rate-limit), RLS
  (patrón canónico, USING(true), auto-escalación en profiles, GRANTs post-30may,
  UPDATE silencioso de 0 filas), drift de esquema contra BD viva, storage,
  secretos/PII, permisos `can()` y cómo probar con dos tenants.
- `auditoria-ui-ux`: greps del design system (tokens vs paleta cruda, firma
  Pagnol, anti-patrones), mapeo canónico de migración a tokens, receta completa
  de verificación visual real en navegador (puppeteer-core + Chrome del sistema,
  dark/light/mobile) y bugs de patrón conocidos (doble X, sticky sin breakpoint,
  cmdk duplicados).
- `auditoria-arquitectura`: invariantes (ledger de stock, flujo de datos único,
  react-tracked, mutaciones bindeadas), bugs transversales ya vistos ≥2 veces
  (INSERT roto en silencio, TZ off-by-one, mutación retroactiva en cascadas,
  borrado sin guards, registros fantasma), decisiones deliberadas que NO son
  hallazgos, y el método de auditoría de módulo paso a paso.

Las tres codifican las reglas de trabajo del proyecto: crítica primero →
implementar tras confirmación, nunca commitear, migraciones pendientes de
aplicar avisadas explícitamente, CHANGELOG siempre.

### Agregado — Suministros del cliente (activos del cliente, caso Valar↔Novandino)
Cuando el tenant no tiene o no consigue un material, el CLIENTE del contrato lo
proporciona. Nueva iniciativa completa (Fases 0–4). Migración pendiente de
aplicar: `supabase/migrations/20260713000000_client_supply_requests.sql`.

- **Modelo**: `purchase_requests.request_target` (`'supplier'` histórico |
  `'client'`) + `client_id`/`client_name`/`sent_to_client_at`;
  `materials.client_id` y `ownership` extendido a
  `'propio' | 'arrendado' | 'cliente' | 'subcontrato'` (el último reservado,
  sin UI — deja listo el caso subcontratos). Se reutiliza el pipeline de
  compra completo (correlativo, gate ADC, batch, estados, recepción) en vez de
  duplicar una entidad nueva.
- **Solicitud del supervisor**: el formulario de compra ahora tiene selector
  de destino "Comprar a proveedor / Solicitar al cliente". El cliente se
  deriva SOLO del contrato seleccionado (`contracts.client_id`); si el
  contrato no tiene cliente, se avisa y se bloquea el envío. Correlativo
  propio `SCL` (configurable en Configuración → Correlativos).
- **Flujo**: solicitud → gate ADC (igual que compra; la bandeja del ADC marca
  "Suministro del cliente X" en cada línea) → el SUPERVISOR la envía por
  correo al cliente (decisión confirmada: Abastecimiento/admin no se meten)
  con PDF "Solicitud de Suministro" (`generateClientSupplyPDF`, reutiliza la
  ruta `purchasing/send-order` y prellena `clients.contact_email`) → queda
  `ordered` + `sent_to_client_at` → recepción en pañol.
- **Recepción = activo del cliente (integridad clave)**: los ítems recibidos
  NUNCA se mezclan con el stock propio — se materializan en una fila espejo
  `ownership='cliente'` + `client_id` (patrón de los arrendados), porque al
  cierre del contrato hay que restituirlos y esa cuenta es imposible con
  contadores compartidos. La recepción parcial conserva el destino cliente y
  su saldo queda `ordered` (no vuelve a la cola de compra). Kardex anota
  "Suministro del cliente X — solicitud SCL-0001".
- **Abastecimiento fuera del ciclo**: las solicitudes al cliente se excluyen
  de la cola de Abastecimiento (`purchasing/purchase-requests`, reusada por
  el hub) y en `pagnol/solicitudes-compra` no tienen botón "Gestionar" (solo
  "Recibir" cuando llegan); nunca alcanzan `approved`, así que lotes/RFQ/OC
  no las ven.
- **Visibilidad**: badge "Del cliente" en las tarjetas de Activos; el
  historial del supervisor muestra badge "Cliente: X", etapa nueva "Por
  enviar al cliente" y botón de envío; la valorización de Stock por Contrato
  EXCLUYE los activos del cliente (comodato — no inflan el inventario
  propio) contándolos aparte; Ingreso Manual de Stock permite crear material
  "Del cliente" con su dueño.
- **Stock por Contrato — consistencia total del comodato**: la matriz y el
  detalle por pañol (pantalla + Excel) ahora también EXCLUYEN de la
  valorización los activos del cliente (antes un material del cliente CON
  costo unitario se valorizaba en la matriz, contradiciendo las tarjetas de
  arriba). Se marcan "Del cliente" en vez de mostrar monto. El Excel de
  Valorización suma una columna "Unidades del cliente" y la matriz distingue
  "Del cliente" de "Sin costo unit.".
- **Guard de migración**: crear una solicitud al cliente sin la migración
  aplicada falla con error explícito (antes el insert tolerante habría
  descartado `request_target` en silencio, convirtiéndola en compra normal).
- Pendiente futuro (dato listo, sin flujo): restitución al cliente al cierre
  del contrato y el caso subcontratos.

### Cambiado — Rediseño de `work-reports` → Centro Operativo (cierre del módulo)
La página principal del módulo (`/dashboard/work-reports`) era un "Panel
Ejecutivo" de BI (costo de materiales en CLP, herramientas sin devolver, stock
crítico) — datos de Pañol/Bodega que ya tienen su propia página, y sin ninguna
acción operativa real. Rediseñada como Centro Operativo del ciclo OT → Diario
→ Semanal:

- **Sacados los widgets de Pañol/Bodega** (herramientas sin devolver, stock
  crítico, consumo/costo de materiales, top materiales) — fuera de alcance del
  módulo, ya cubiertos en `bodega/`. Se eliminó la dependencia de
  `materials`/`requests`/`returnRequests`/`computeActiveToolLoans`.
- **Agregado — "Requiere tu acción"**: sección personalizada por identidad +
  permiso (no gated a `view_all`, visible a quien tenga algo pendiente): OT
  propias atrasadas, Diarios propios observados, Diarios esperando tu firma
  (Operaciones vía `work_reports:review_operations` / ADC vía
  `work_reports:final_approve`), Semanales esperando tu firma. Antes la
  página no distinguía "algo está pendiente" de "te toca a ti actuar".
  La tabla "Diarios por aprobar" ahora marca "Te toca a ti" cuando aplica.
- **Agregado — accesos rápidos** (OT / Diarios / Semanales / Catálogos) en el
  toolbar: antes la única forma de llegar a las sub-páginas era el sidebar.
- **Agregado — Pipeline del módulo**: OT (sueltas vs. consolidadas vs.
  listas) → Diarios por estado → Semanales por estado, en una sola vista.
- **Corregido — "OT incompletas" era ruido**: contaba cualquier OT bajo 100%
  (hasta una recién creada al 0%), inflando la alerta. Redefinido como
  "OT atrasadas" (`workDate` anterior a hoy y avance < 100%) — la definición
  real de "esto quedó pendiente", separada de "OT en curso hoy" (normal).
- **Corregido — mismo bug de zona horaria** del filtro de período y del
  agrupador de HH por día (`new Date('YYYY-MM-DD')` parseaba UTC); ahora todas
  las comparaciones de fecha son por texto (`YYYY-MM-DD` directo) o via
  parseo local explícito.
- **Cambiado — la medición de HH/HM ya no está gated a gerencia**
  (`work_reports:view_all`): el gráfico de tendencia ahora muestra HH y HM
  juntos, se agregó "HH por área" (reemplaza el gráfico de costo por área que
  era de bodega), y todo queda visible a cualquiera con acceso al módulo —
  supervisor incluido, tal como se pidió ("medir todo lo que tenemos en el
  módulo").
- **Cambiado — "Pulso operativo · hoy"** (OT de hoy, OT atrasadas, OT listas
  para consolidar, Diarios en borrador/observados, Semanales en borrador) es
  independiente del selector de período — siempre refleja "ahora", no un
  rango histórico.
- Renombrado "Panel Ejecutivo" → "Centro Operativo" en el título y el sidebar.

### Corregido / Cambiado — Reportes Semanales (`work-reports/semanal`)
Auditoría completa del módulo Semanal (listado + detalle). Migración pendiente
de aplicar: `supabase/migrations/20260712000000_weekly_reports_hardening.sql`.

- **🔴 Cualquiera con permiso de crear podía firmar como "Jefe de Operaciones"**
  — la firma de operaciones ahora exige `work_reports:review_operations`
  (o super-admin) y solo se puede firmar después de que el supervisor firmó
  (mismo orden lógico que el resto de la cascada).
- **🔴 Firmar no bloqueaba nada — el contenido seguía 100% editable después**,
  incluyendo un `<Select>` manual de Estado que devolvía "Listo" a "Borrador"
  sin re-firmar. Se eliminó ese Select: firmar como supervisor ahora congela
  el contenido (header, rango de fechas, Diarios consolidados) y toma una
  copia congelada de los Diarios (`consolidated_reports_snapshot`, mismo
  patrón que el snapshot OT→Diario). Se agregó un botón explícito "Reabrir
  borrador" (limpia firmas y snapshot, vuelve a `draft`) como único camino de
  vuelta a edición.
- **🔴 Se podía firmar un Semanal vacío** (sin título, sin Diarios, con rango
  de fechas invertido) — se agregó validación previa a la firma del
  supervisor.
- **🔴 `updateWorkWeeklyReport` sin guard `.select()`** (RLS que no matchea
  filas no lanza error) y sin filtro explícito por `tenant_id` en
  update/delete — corregido, mismo patrón que `workOrderMutations`.
- **🔴 Se podía borrar un Semanal firmado/"Listo" con un `confirm()` nativo**,
  sin ninguna protección. `deleteWorkWeeklyReport` ahora lo bloquea salvo para
  super-admin (decisión confirmada: sin excepción para
  administrador/soporte-pagnol); el botón de borrar del listado se oculta
  para esos casos. `confirm()` reemplazado por `AlertDialog`.
- **Cambiado — el selector de Diarios ya no permite consolidar borradores**
  (mismo criterio que "OT debe estar Lista" para el Diario): solo Diarios
  enviados a revisión o más allá son seleccionables; los ya seleccionados
  se pueden seguir desmarcando.
- **Corregido — fecha corrida un día** en listado, detalle y tabla de
  consolidación (mismo bug de parseo UTC ya corregido en OT/Diarios).
- **Corregido — permiso de edición**: `work_reports:edit` en vez de
  `work_reports:create` para el contenido del detalle.
- **Agregado — listado con estado de carga** (antes mostraba "Sin reportes"
  mientras cargaba) y con guard de borrado por estado.
- **Cambiado — la cabecera se hereda del primer Diario consolidado**
  (cliente/faena/obra/contrato/área/especialidad/supervisor), en vez de
  digitarse dos veces.
- **Corregido — la columna "Personal" del resumen semanal** confundía el
  máximo diario con un total; se relabeló ("Personal (día)" / "máx. N" en el
  pie) para que no se lea como suma.
- La ruta de PDF (`work-weekly-reports/[id]/pdf`) ahora también usa el
  snapshot congelado del Semanal cuando existe.

### Corregido / Cambiado — Reportes Diarios (`work-reports/reportesdiarios` + `work-reports/[id]`)
Auditoría del listado de Diarios y su relación con el Reporte Semanal.

- **🔴 KPI "HH acumuladas" / "HM acumuladas" mentían para todo Diario en modo
  cascada** (el flujo actual): leían `r.labor`/`r.equipment` directo de la
  fila, campos que la cascada nunca escribe (los datos viven en las OT
  consolidadas). Ahora reusan `dailyEffectiveTotals` (el mismo helper correcto
  que ya usaba el módulo Semanal), al que además se le agregó `hm` y respeto
  por `consolidatedOrdersSnapshot` cuando el Diario ya está congelado.
- **🔴 Columna "OT" del listado mostraba "-"** para casi todo Diario en cascada
  (el campo legacy `otNumber` nunca se llena desde `dailyOts`). Ahora muestra
  la(s) OT reales consolidadas.
- **🔴 Borrar un Diario no revisaba si un Reporte Semanal ya lo consolidó**
  (mismo patrón que el fix de OT→Diario de la sesión anterior) — `deleteWorkReport`
  ahora lo bloquea si algún `work_weekly_reports.consolidated_report_ids` lo
  referencia.
- **🔴 Se podía borrar un Diario `final_approved`/`archived`** (con firmas de
  aprobación) con un solo clic. `deleteWorkReport` ahora lo bloquea salvo para
  `super-admin`; el botón de borrar del listado se oculta para esos informes.
- **Cambiado — se evitan los Diarios "fantasma"**: si el usuario crea un
  Reporte Diario y sale sin capturar nada, se borra solo al salir de la página
  (mismo patrón aplicado a OT la sesión anterior).
- **Agregado — buscador + filtro de período** (Todo / Esta semana / Este mes)
  en el listado; antes no había forma de acotar la tabla.
- **Corregido — fecha corrida un día** en la columna "Fecha" del listado
  (mismo bug de parseo UTC ya corregido en OT).
- **Cambiado — "% Avance" se sugiere** como el promedio de las OT consolidadas
  al seleccionarlas (antes 100% manual, desconectado del avance real de cada
  OT); sigue siendo editable a mano.

### Corregido / Cambiado — OT / Reportes de Trabajo (`work-reports/ot`)
Auditoría completa del módulo OT (listado + detalle) y su consumo en el Diario
(`work-reports/[id]`). Migración pendiente de aplicar:
`supabase/migrations/20260711000000_work_orders_hardening.sql`.

- **🔴 Integridad — snapshot de OT al enviar el Diario a revisión.** El Diario
  derivaba personal/equipos/materiales/HH/fotos de las OT **en vivo**: editar una
  OT después de que el Diario que la consolida fue firmado/aprobado cambiaba
  retroactivamente ese documento. `transitionWorkReport` ahora congela una copia
  (`work_reports.consolidated_orders_snapshot`) al pasar a `pending_review`
  (incluye reenvíos tras observación); la UI y ambas rutas de PDF
  (`work-reports/[id]/pdf`, `work-weekly-reports/[id]/pdf`) usan esa copia en
  vez de las OT en vivo una vez que el Diario salió de `draft`/`observed`.
- **🔴 Integridad — borrar una OT consolidada la hacía desaparecer en silencio**
  del Diario (HH, fotos y columnas de la matriz se esfumaban). `deleteWorkOrder`
  ahora bloquea el borrado si la OT está referenciada por algún `work_report`.
- **🔴 Integridad — pérdida silenciosa de ediciones al subir/borrar fotos.**
  `handleFiles`/`removePhoto` en la OT enviaban solo `{ photos }` al servidor y
  luego marcaban el borrador local como sincronizado; cualquier otra edición
  (descripción, personal, etc.) sin guardar se perdía sin aviso. Ahora envían el
  borrador completo.
- **🔴 Integridad — `updateWorkOrder` no detectaba updates de 0 filas por RLS**
  (Supabase no lanza error; ver gotcha documentado en `CLAUDE.md`). Se agregó
  `.select()` + verificación de filas devueltas.
- **Corregido — fecha corrida un día** en las tarjetas del listado (`fmtDate`
  parseaba `YYYY-MM-DD` como UTC; en Chile mostraba el día anterior).
- **Corregido — permisos inconsistentes**: eliminar OT ahora exige
  `work_reports:delete` (antes `work_reports:create`); editar una OT exige
  `work_reports:edit` (antes `work_reports:create`, distinto del resto del
  módulo). Se agregó `work_reports:delete` a los roles `supervisor`,
  `jefe-terreno` y `director-faena` en `ROLES_DEFAULT` — ya tenían `create`,
  así que sin este ajuste habrían perdido la capacidad de borrar sus propias OT
  (no aplica a tenants con overrides de rol ya guardados en la tabla `roles`).
- **Cambiado — el estado "Lista" ahora bloquea, no es decorativo**: solo se
  pueden consolidar en un Diario las OT en estado `ready`. Una OT consolidada en
  un Diario que ya salió de borrador queda bloqueada para edición (banner
  explicativo en la OT).
- **Cambiado — se evitan las OT "fantasma"**: si el usuario crea una OT y sale
  sin escribir nada, se borra sola al salir de la página en vez de quedar como
  tarjeta vacía para siempre.
- **Cambiado — el selector de OT del Diario filtra por fecha** del Diario por
  defecto (con opción "Mostrar todas"), en vez de listar el historial completo.
- **Agregado — N° de OT con dos modos**: correlativo automático del tenant (RPC
  `next_internal_code`, mismo mecanismo que el resto de los documentos —
  configurable en Configuración → Correlativos, tipo `OT`) o manual (lo asigna
  el cliente, como antes). El modo se fija al crear la OT y queda registrado en
  `ot_number_source`.
- **Agregado — "Personal" y "Equipos" ahora son combobox contra catálogo**
  (usuarios del tenant / activos Pagnol) con fallback a texto libre, en vez de
  solo texto libre. Guardan `userId`/`assetId` cuando se selecciona del
  catálogo; la consolidación del Diario agrupa por ese ID cuando existe (evita
  que "J. Pérez" y "Juan Perez" cuenten como dos personas distintas en la
  matriz de HH).
- Reemplazados los `window.confirm()` nativos del listado por `Dialog`/`AlertDialog`.

### Cambiado — Panel Supervisor (`dashboard/supervisor`), cierre del módulo
- **Rediseño del hub** para que hable el mismo idioma que sus 3 páginas hijas
  (`supervisor/request`, `purchasing/purchase-request-form`, `supervisor/return-request`),
  reusando 100% la lógica de pipeline ya construida — sin mutaciones ni migraciones nuevas:
  - **KPIs honestos y clickeables** (antes 5 tarjetas decorativas, ninguna navegaba): "Pañol
    en trámite" y "Listas para retiro" (`resolveSupervisorStage`), "Compras en trámite"
    (`resolvePurchaseStage`), **"Por devolver"** (`computeReturnBalanceItems` — reemplaza al
    viejo "Devoluciones: N" que contaba la cola del PAÑOLERO, cero acción para el supervisor,
    por el saldo real que SÍ le corresponde a él), "Arriendos en curso". Cada tarjeta es un
    `<Link>` a su página. Se eliminó "Stock Crítico" (umbral `stock<=10` falso — mismo
    defecto ya corregido dos veces esta semana en Reportes y Panel Principal — y no es
    información del supervisor).
  - **Feed de actividad con la etapa REAL de cada tipo**: `<StageBadge>`, `<PurchaseStageBadge>`,
    `<ReturnStatusBadge>`+`<ConditionBadge>` en vez del `status` crudo de la BD ("Aprobado"
    a secas, sin distinguir "lista para retiro" de "ya entregada"). Cada fila es clickeable
    y navega a su página. Las compras multi-ítem del mismo carrito (`batchId`) se agrupan
    en una sola fila ("Pedido de compra (N ítems)") con la etapa del ítem MENOS avanzado
    del grupo (no anuncia "Recibida" si falta llegar uno solo).
  - `Tabs` de shadcn → chips de segmento (firma Pagnol), tarjetas KPI con el mismo estilo
    unificado de la serie (ícono arriba, número grande, clickeable).
  - Verificado en navegador con datos reales de las 3 sesiones anteriores: los 4 tipos de
    actividad aparecen con su etapa correcta, KPIs cuadran con los datos, clicks en KPI y
    en fila navegan a la página correcta (`waitForNavigation` confirmado).

### 🔴 Corregido — bug preexistente que rompía TODAS las solicitudes de compra
- **`purchase_requests` — crear una Solicitud de Compra estaba 100% roto** contra el
  proyecto Supabase actual, desde antes de esta sesión (no relacionado con el rediseño;
  descubierto al verificar el envío real en el navegador). Dos problemas independientes:
  1. **`id` es `uuid` en la tabla real**, pero el código intentaba insertar el código
     legible de `nextInternalCode()` (ej. `"PAG-PRQ-0007"`) como valor de `id` →
     `invalid input syntax for type uuid`. **Toda** solicitud de compra fallaba al enviarse.
  2. El insert también escribía `internal_code` y `requester_name`, columnas que
     **no existen** en la tabla (`Could not find the 'requester_name' column...`).
  - **Fix de código:** `id` ahora lo genera Postgres (uuid real); el código legible se
    guarda en la nueva columna `internal_code` (mismo patrón que `material_requests`/
    `return_requests`). Nuevo helper `insertPurchaseRequestRow()` en
    `purchaseRequestMutations.ts` reintenta sin `internal_code`/`requester_name`/`batch_id`
    si Postgres reporta que la columna no existe — **una solicitud de compra ya funciona
    incluso ANTES de aplicar la migración** (usa el fallback `REF <8 primeros del uuid>`
    en la UI hasta que se aplique).
  - **Migración `20260710010000_purchase_requests_batch.sql` — APLICADA por el usuario**
    (agrega `internal_code`, `requester_name`, `batch_id`). Las solicitudes ya muestran el
    código real `PRQ-XXXX` y el agrupado por `batch_id` queda activo de punta a punta.
  - Verificado end-to-end en navegador: solicitud real enviada con la cuenta demo, apareció
    al instante vía Realtime, sobrevivió a recargar la página, etapa "En revisión" correcta.

### 🔴 Corregido — bug preexistente que rompía TODAS las devoluciones (integridad de stock)
- **`return_requests` — registrar una devolución estaba 100% roto**, descubierto igual que
  el de compras: al verificar el envío real en el navegador para el rediseño de
  `supervisor/return-request`. Dos causas apiladas, la primera ocultando a la segunda:
  1. **`addReturnRequest` nunca revisaba el `error` del insert** (`await supabase...insert()`
     sin chequear `error`) — el gotcha de RLS/insert silencioso del proyecto en su forma más
     pura. El toast decía "Éxito" con cero filas guardadas; el material quedaba en el limbo.
  2. **Al corregir (1) y volver a intentar, salió a la luz un segundo bug**: la columna
     `return_requests.items` es `NOT NULL` pero el insert nunca la poblaba (columna heredada
     de un diseño multi-ítem anterior — no existe en el tipo `ReturnRequest` de TypeScript).
     Sin (1), este error se tragaba en silencio igual que el anterior.
  - **Fix:** el insert ahora chequea `error` (throw con el mensaje real) y puebla
    `items: [{ materialId, quantity }]`. Verificado end-to-end en navegador: devolución real
    enviada (3 de 7 pares), apareció al instante en el historial con código `MDS-RET-0003`,
    sin perder datos.
- **Sobre-devolución posible: podías devolver más de lo retirado, o devolver la misma
  cantidad dos veces** mientras la primera esperaba revisión del pañolero. La página nunca
  restaba lo ya devuelto (pendiente o completado) del saldo. Fix en dos capas:
  - **Cliente** (`computeReturnBalanceItems` en `return-balance.ts`): saldo = tomado
    (aprobado, con custodia real vía la misma fórmula de `computeToolHolderMap`) − ya
    devuelto (pendiente + completado, rechazado no cuenta), agrupado por (material,
    **contrato** — no solo material, para no mezclar contratos distintos en un mismo saldo).
  - **Servidor** (`computeReturnBalances` en la mutación): recalcula el mismo saldo desde
    cero e independientemente ANTES de insertar — nunca confía solo en lo que mandó el
    cliente. `addReturnRequest` cambió de firma: cada ítem ahora lleva su propio
    `contractId`/`contractName` (antes un solo contrato compartido para todo el carrito,
    lo que forzaba a mezclar y caer al pool central si había más de uno).
  - Verificado end-to-end: solicitud de 7 pares de guantes creada y aprobada, saldo mostrado
    correctamente (7, sin filtro de fecha que lo escondiera), devolución parcial de 3
    enviada, saldo bajó a 4 de inmediato vía Realtime — la fila ya no permite reclamar de
    nuevo lo ya declarado.

### Cambiado — Devolución de Materiales (`supervisor/return-request`)
- **Rediseño completo con la misma vara que el resto del módulo supervisor.** Nuevos
  `src/components/supervisor-returns/` (`return-balance.ts`, `return-history-card.tsx`),
  reutiliza `ReturnStatusBadge`/`ConditionBadge` ya construidos para la bandeja del pañol:
  - **Sin filtro de fecha por defecto** (antes partía en "hoy" y mostraba el engañoso "Sin
    materiales para devolver" si retiraste ayer). Ahora se muestra TODO el saldo pendiente,
    sin importar cuándo se retiró — un material es fungible, la fecha no debería esconderlo.
  - **Historial con pipeline** (Por revisar / Completada / Rechazada) + KPIs clickeables +
    chips de filtro + buscador — antes no existía ningún historial: el supervisor enviaba
    la devolución y quedaba completamente ciego a su estado, sin código visible, sin saber
    si el pañolero la recibió OK o con falla.
  - Cada fila de saldo muestra el contrato de reingreso explícito (antes: si las solicitudes
    de origen mezclaban contratos, reingresaba al pool central en silencio sin avisar).
  - Cantidad a devolver clampeada en línea (ya no permite escribir más del saldo y recién
    reclamar al enviar). Toast con el error real del servidor (incluye el saldo exacto si
    se intenta devolver de más).
  - Firma Pagnol: `PageShell`, tarjetas con micro-labels y tokens semánticos — dejó de ser
    `<Card>`/`<Table>` genérico de shadcn con `fade-in` muerto (sin `animate-in`).

### Cambiado (2/2) — Solicitud de Compra (`purchasing/purchase-request-form`, compartida
por `supervisor/purchase-request-form` vía re-export)
- **Rediseño completo con la misma vara que `supervisor/request`.** Página partida en
  `src/components/supervisor-purchases/` (`purchase-pipeline.ts`, `purchase-stage-badge`,
  `purchase-material-combobox`, `purchase-history-card`):
  - **Pipeline honesto**: Esperando ADC → En revisión → Aprobada → Ordenada → Recibida →
    Rechazada (antes `status` aplanaba "esperando ADC" y "en revisión de Abastecimiento"
    en un solo "Pendiente"). Hints por etapa; recepción parcial muestra "se solicitaron
    N originalmente"; rechazo muestra el motivo (`rejectionReason`, antes oculto).
  - **Ítems de un mismo carrito ahora se agrupan como un pedido** (`batchId`, ver arriba):
    antes 5 ítems enviados juntos quedaban como 5 filas sin nada que las uniera; ahora
    `PurchaseHistoryCard` los muestra en una tarjeta "REF-XXXX + 4 ítems más", cada ítem
    con su propia etapa (Abastecimiento aprueba/rechaza por ítem, así que un badge único
    de grupo mentiría si divergen).
  - **Fix cmdk (mismo bug que en supervisor/request, aquí peor):** el combobox de material
    ni siquiera pasaba `value` a `CommandItem` (usaba el texto renderizado); con las 7
    "Bomba Sumergible..." homónimas de la demo colisionaba igual. Fix: `value` = nombre+id.
    Se conservó el soporte de texto libre ("Usar nombre: X" para material fuera de catálogo).
  - **Envío robusto:** `Promise.allSettled` en vez de `Promise.all` — si 2 de 5 ítems
    fallan, el toast reporta cuántos entraron y cuáles no, y el carrito se queda SOLO con
    los que fallaron (los que sí entraron no se reintentan — evita duplicarlos).
  - **KPIs clickeables + chips de filtro + buscador** (código/material/contrato) — antes un
    `<Select>` genérico pending/approved/rejected sin código de solicitud visible.
  - **Badges con paletas crudas eliminadas** (`bg-yellow-100`, `bg-green-100`, `bg-red-100`,
    `bg-blue-100`, `bg-cyan-100`, `bg-purple-100` — 6 colores pastel ilegibles en dark
    mode) → tokens semánticos. Historial de `<Table>` a tarjetas, `PageShell`, micro-labels
    — dejó de ser la página con el salto visual más marcado del módulo.
  - Verificado end-to-end en navegador: envío real de un ítem con texto libre (material
    fuera de catálogo), etapa correcta, KPI actualizado, sobrevive a recarga de página.

### Corregido
- **Buscador de material/beneficiario perdía la selección con nombres duplicados**
  (`supervisor/request`, y el mismo patrón en cualquier combobox cmdk del proyecto).
  `CommandItem` usaba `value={m.name}` — con materiales homónimos (ej. 7 "Bomba Sumergible
  Grundfos SP 5-18" en la demo) cmdk no podía distinguir el resaltado por teclado ni la
  resolución interna de "ítem actual" entre instancias. Ahora `value` combina nombre + id
  (`MaterialCombobox`, `BeneficiaryCombobox` en `src/components/supervisor-requests/`);
  el buscador sigue filtrando por nombre (aparece primero en la cadena) y cada ítem queda
  inequívoco. Verificado en navegador: las 7 bombas homónimas se resaltan y seleccionan
  individualmente sin colisión.
- **Errores de envío de solicitud mostraban un mensaje genérico** que ocultaba la causa real
  (stock insuficiente, destinatario faltante, etc.). El toast ahora muestra `error.message`.

### Cambiado
- **`supervisor/request` — el supervisor no podía ver dónde estaba su propio pedido.**
  El campo `status` (pending/approved/rejected) esconde dos preguntas clave: ¿a quién le
  toca moverlo? y ¿ya puedo ir a buscarlo? Nuevo pipeline honesto en
  `src/components/supervisor-requests/` (`request-pipeline.ts` + `StageBadge` +
  `RequestHistoryCard`), derivado de campos que ya existían pero la página no leía
  (`adcAuthorizedAt`, `deliveryDate`, `receivedByUserName`):
  - **Esperando ADC** (pendiente, sin autorización) → **En cola del pañol** (autorizada,
    el pañolero debe aprobarla) → **Lista para retiro** (aprobada, con "esperando hace N
    días" cuando corresponde) → **Entregada** (con quién la retiró) → **Rechazada**.
  - **KPIs clickeables** arriba del historial (En trámite / Listas para retiro / Entregadas
    / Rechazadas) + chips de filtro + buscador por código/material/contrato — antes solo
    había un `<Select>` genérico pending/approved/rejected sin código de solicitud visible.
  - Verificado end-to-end: solicitud real enviada en el navegador, tarjeta renderizada al
    instante vía Realtime con código (`MDS-TX-0012`), badge "En cola del pañol" y el hint
    correcto — sin recargar la página.
  - **Rediseño a la firma visual Pagnol** (era la única página del módulo con el look
    genérico de shadcn: `border-l-4`, `Card` chicas, badges con paletas crudas
    `bg-amber-100`/`bg-emerald-100`/`bg-red-100` ilegibles en dark mode). Ahora usa
    `PageShell`, micro-labels `font-black uppercase tracking-widest`, radios de marca,
    tokens semánticos en todo (`badge-success`/`-warning`/`-info`), chips de segmento
    estilo Activos/Solicitudes.
  - **Transparencia contrato/pool en el selector de material**: el helper "Disponible"
    ahora avisa cuando el contrato elegido no tiene stock propio ("saldrá del pool central
    u otro contrato") — la validación de cantidad se mantiene contra el stock global
    porque `consumeFromLedger` cascada entre contratos, así que un tope más estricto
    habría bloqueado pedidos válidos.

### Eliminado
- **Pestaña "Análisis IA" del Centro de Reportes** (a pedido del usuario: el asistente
  on-demand cubre esa necesidad). Se eliminó `ai-tab.tsx` y el tipo `AI_INSIGHTS`.

### Seguridad
- **Gate ADC reforzado en el servidor.** `updateMaterialRequestStatus` (aprobación en el
  pañol) ahora RECHAZA solicitudes sin `adc_authorized_at` — antes solo la UI de la bandeja
  lo filtraba, pero el inbox del Panel Principal mostraba TODAS las pendientes y podía
  descontar stock de una solicitud que el ADC nunca autorizó. El inbox del panel ahora
  también filtra por `adcAuthorizedAt`.

### Corregido
- **Aceptar una devolución desde la bandeja mandaba TODO a mantenimiento.** La página llamaba
  `updateReturnRequestStatus(id, 'completed')` SIN el parámetro de condición; la mutación
  interpretaba "condición ≠ OK" y dejaba el material `En Mantenimiento` (con `return_condition`
  en null). Ahora un diálogo obliga a declarar la condición (En buen estado / Con falla / Roto)
  y la pasa a la mutación — un ítem OK vuelve a estar Disponible.
- **Botones de aprobación se mostraban con el permiso equivocado.** Usaban el genérico
  `material_requests:approve` mientras el servidor exige `approve_class_a/b/c` → un usuario
  veía "Aprobar" y al confirmar recibía error. Ahora `canApproveClass()` refleja la jerarquía
  real del servidor (A cubre B/C, B cubre C).

### Cambiado
- **Bandeja de Solicitudes (`pagnol/solicitudes`) — rediseño a la firma visual Pagnol.**
  Era la única página del módulo con el look genérico de shadcn (herencia de las viejas
  páginas de Bodega): tabs grises anidadas, tarjetas `border-l-4`, sin KPIs. Ahora sigue el
  estándar (partida en `src/components/pagnol-requests/`): fila de KPIs clickeables (retiros
  por aprobar, devoluciones por revisar, sin retirar +3 días, esperando ADC), chips de
  segmento y de estado estilo Activos, tarjetas con micro-labels y tokens semánticos. Además:
  - **Retiros ahora tiene buscador** (por código, persona, material o contrato) y muestra el
    `internalCode`; históricos con paginación ("mostrar más").
  - **Sección "Esperando al ADC"** (solo lectura, enlaza a `/authorizations`): antes las
    solicitudes atascadas en el ADC eran invisibles en toda la bandeja.
  - **Devoluciones completadas muestran condición y evidencia** (`returnCondition`,
    `evidenceUrl`), antes ocultas.
  - Se quitó el `refreshData()` masivo tras cada aprobación (Realtime ya refresca).
  Verificado en navegador (retiros, devoluciones, completadas con condición/recepción).

### Cambiado
- **Panel principal Pagnol (`dashboard/pagnol`) — rediseño con datos reales** (auditoría
  2026-07-10, misma vara que Reportes):
  - **KPI "Tránsito Externo" reemplazado por "En Terreno".** El viejo sumaba `material.inUse`
    (se escribe como `in_use` en snake_case — corrección a la nota previa: SÍ se actualiza en
    aprobación/devolución, no estaba "muerto"), pero contaba cantidades y podía desalinearse.
    "En Terreno" ahora cuenta retornables realmente en poder de alguien vía
    `computeToolHolderMap` (consistente con Activos y Reportes; en demo: 3).
  - **Fin del refetch masivo:** se eliminó el `refreshData()` al montar, que recargaba las
    30+ colecciones del tenant en cada visita al panel (Realtime ya mantiene los datos
    frescos). También tras aprobar (Realtime actualiza la colección).
  - **Inbox de aprobación completo:** ahora muestra **cantidades por ítem**, justificación,
    contrato y código interno, y tiene botón **Rechazar** (antes solo se podía aprobar a
    ciegas, sin cantidades). Copy honesto: "requieren tu aprobación" en vez de "firma
    digital/biométrica requerida" (el botón nunca pidió firma).
  - **Copy y métricas honestas:** fuera "Sistema Online"/"Integridad de Red: 100%"
    (estáticos), "Óptimo" fijo (ahora Óptimo/Estable/Crítico según el % real), badges
    decorativos ("AMIS Ready", "Efectivo", "ISO 55001 Aligned"); anillo de salud = %
    real de disponibles sin archivados; "unidades" → "ítems".
  - **Stock crítico unificado** con el umbral `minStock` real (tercer umbral distinto
    eliminado) + botón **Reponer** con prefill; barra proporcional al umbral real.
  - Bug corregido: `useMemo` de transacciones sin `users` en deps (nombres "Desconocido"
    stale); actividad reciente ahora muestra el custodio real y etapas `STAGE_META`
    (distingue Entregada de Aprobada); banner de mantenimientos vencidos clickeable;
    gráfico 7 días en una sola pasada. Verificado en navegador (demo).
- **Centro de Reportes (`pagnol/reports`) — rediseño completo con datos honestos**
  (auditoría 2026-07-10; página de 1.073 líneas partida en `src/components/pagnol-reports/`).
  Correcciones de VERDAD de datos:
  - **Posesión unificada con Activos:** ahora usa `computeToolHolderMap` (custodio real =
    quien recibió / beneficiario dirigido, no el supervisor que aprobó). Reportes y Activos
    ya no se contradicen.
  - **Fin de la "verificación biométrica" falsa:** el escudo verde salía con solo aprobar;
    la columna "Garantía Judicial" se reemplazó por etapas reales (Pendiente/Aprobada/
    Entregada/Rechazada/Devuelto) + check de confirmación.
  - **`Progress value={75}` hardcodeado eliminado** — la Operatividad ahora es el % real
    de activos Disponibles (en demo pasó de un 28% falso a 86% real).
  - **Stock crítico por `minStock` real** (fallback 5 SOLO para consumibles/repuestos;
    un Activo Fijo con stock 1 ya no aparece "crítico").
  - **Score de responsabilidad solo con ítems retornables** — los consumibles ya no
    castigan el score (nadie devuelve cemento); si no hay prestables, no se muestra score.
  - "En Uso" solo aplica a retornables en poder de alguien.
  Funcionalidad nueva:
  - **Auditoría:** rango de fechas (presets 7d/30d/mes + desde/hasta), filtro por operación,
    búsqueda por persona/código, paginación (50/pág) y **export Excel**.
  - **Mantenimiento accionable:** Vencidos y Próximos 15 días por `nextMaintenanceDate`
    + enlace al módulo de Mantenimiento.
  - **Botón "Reponer" ahora funciona:** navega al formulario de solicitud de compra con el
    material precargado (`purchase-request-form` acepta `?materialId=`).
  - **Trazabilidad:** búsqueda case-insensitive con debounce y selector cuando hay varias
    coincidencias; muestra foto del activo y quién lo tiene.
  - **Personal:** buscador, orden por activos a cargo, paginación, fecha "desde" de cada
    tenencia.
  - Impresión útil: CSS scoped que imprime solo el reporte con encabezado (título/fecha/autor).
  - Detalles: colores del donut SEMÁNTICOS (verde=Disponible, rojo=Agotado...), eje CLP
    compacto ($48M), tooltips theme-aware, `EmptyState` compartido, enlace cruzado a
    Stock por Contrato. Verificado en navegador (7 capturas, tenant demo).

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
- **RRHH — Turnos y Contratos en su propio módulo.** El rol `recursos-humanos` ya tenía
  los permisos (`shifts:manage`, `contracts:manage`) pero la gestión vivía escondida bajo
  Asistencia: podía pero no tenía cómo llegar. Ahora su sidebar RRHH incluye **Contratos**
  y **Turnos** (rutas espejo `/dashboard/rrhh/contratos` y `/dashboard/rrhh/turnos` que
  re-exportan las páginas de Asistencia — fuente única, cero duplicación, y se mantiene el
  contexto del módulo RRHH), más dos tarjetas de acceso en el Panel RRHH ("Contratos
  activos" y "Turnos definidos"), gated por permiso. Su flujo completo queda dentro del
  módulo: crear turnos → crear contratos → asignar contrato+turno+fecha de subida por
  empleado (pestaña Contrato/RRHH del panel de usuario).
- **Turnos acorde a asistencia (4×4, 7×7, 14×14, …)** — el motor de ciclos existía pero
  estaba DESCONECTADO de los reportes; ahora el sistema de turnos funciona de punta a punta:
  - **Ancla de ciclo POR TRABAJADOR** (`contract_workers.rotation_start_date`, migración
    `20260709000000` — APLICADA 2026-07-09; persistencia verificada end-to-end con
    recarga): el turno define el patrón y cada trabajador
    su "fecha de subida". Un solo turno "14×14" sirve para grupos desfasados (A sube cuando
    B baja); null hereda la referencia del turno (retrocompatible). El campo aparece al
    asignar turno rotativo en UserPanel, ficha de contrato y wizard de enrolamiento, y es
    editable inline en las asignaciones existentes. Los inserts omiten la columna cuando
    no aplica, así nada se rompe antes de aplicar la migración (solo no persiste el ancla).
  - **Reportes conectados al turno real** (antes `getWorkerShift()` existía y NADIE lo
    llamaba): Liquidación, Horas Extras y Reporte Semanal ahora resuelven el turno del
    trabajador y calculan con SU ciclo — descanso del ciclo no es ausencia, trabajar en
    descanso/sábado/feriado cuenta como extra, y el encabezado indica qué regla se aplicó
    ("Turno: X (14x14)" o "Sin turno asignado (regla Lun–Vie)"). Sin turno todo se
    comporta exactamente como antes.
  - **Turno nocturno que cruza medianoche**: en el cálculo mensual las marcas se parean
    por sesión (entrada→salida siguiente, máx 26 h) atribuida al día de la ENTRADA, y la
    jornada termina al día siguiente (20:00→08:00). Colación solo descuenta en diurno.
    Limitación conocida: el detalle del Reporte Semanal muestra la salida nocturna en el
    día calendario en que ocurrió.
  - **Presets nuevos 4×4 y 10×10** en Gestión de Turnos (además de 5×2/4×3/7×7/14×14/21×7/
    personalizado).
  - **`<ShiftCycleCalendar>`** (`src/components/shift-cycle-calendar.tsx`): mini-calendario
    del mes con días trabaja/descanso pintados y navegación — en la tarjeta de cada turno
    (reemplaza la tira lineal) y como vista previa al asignar turno con fecha de subida.
  - **Bug latente corregido:** el mapper de `shift_schedules` ahora normaliza los `time`
    de Postgres ("08:00:00" → "08:00"); los cálculos parsean "HH:mm" y habrían fallado
    silenciosamente al conectar los turnos. También se corrigió otro `SelectItem value=""`
    (crash Radix al abrir el dropdown de turno en la ficha de contrato).
- **Configuración → Clientes y Contratos** (cierre de la iniciativa Valar: UI dedicada de
  administración de la jerarquía Empresa → Cliente → Contrato). Página nueva
  `/dashboard/configuracion/clientes` con entrada propia en el sidebar del módulo
  Configuración (gated `module_settings:view` — solo administrador y soporte-pagnol):
  - **CRUD de clientes:** crear/editar ficha completa (razón social, RUT, contacto,
    correo, teléfono, notas) y estado Activo/Inactivo (inactivo desaparece de filtros y
    formularios). Eliminar avisa que los contratos NO se borran (quedan sin cliente,
    `ON DELETE SET NULL`) y sugiere marcar Inactivo como alternativa.
  - **Contratos por cliente:** cada tarjeta lista sus contratos (código, vigencia,
    dotación, estado) con edición inline y click-through a la ficha operacional de
    Asistencia; botón "+ Contrato" crea uno con el cliente preseleccionado.
  - **Sección "Contratos sin cliente":** junta los huérfanos (p. ej. pre-backfill) para
    asignarles su mandante y que entren a los filtros por cliente.
  - Verificado end-to-end en navegador: crear cliente → "+ Contrato" preselecciona →
    eliminar con aviso; Asistencia → Contratos sigue funcionando.
- **Filtro en cascada Cliente → Contrato** (Fase 3 del modelo Valar). Nuevo componente
  compartido `<ClientContractFilter>` (`src/components/client-contract-filter.tsx`):
  select de Cliente (activos) + select de Contrato acotado al cliente elegido (si el
  contrato seleccionado deja de pertenecer, se resetea). El select de Cliente se oculta
  solo cuando el tenant no tiene clientes. Semántica común: contrato puntual manda;
  solo cliente = unión de sus contratos; `POOL` = "sin contrato" según la página.
  Integrado en las tres superficies:
  - **Activos (`pagnol/activos`):** reemplaza el select de Contrato del panel de filtros.
    Filtrar por cliente muestra los materiales con existencias en cualquiera de sus
    contratos (vía `material_stocks`); se mantiene la opción "Pool central".
  - **Asistencia (`attendance`):** reemplaza los chips de contrato. Filtrar por cliente
    acota la dotación (KPIs, cobertura y tabla) a los trabajadores asignados a sus
    contratos; nueva opción **"Sin contrato asignado"** para encontrar al personal aún
    sin `contract_workers` (complemento directo de la Fase 2).
  - **Stock por Contrato (`reports/contract-stock`):** el filtro ahora escala la página
    COMPLETA — tarjetas de valorización, matriz material×contrato, detalle y kardex —
    en vez de solo detalle/kardex como antes: vista general, por cliente o por contrato.
    Verificado en navegador: elegir un cliente pasó la valorización de $400,7M (general)
    a los $850 de su único stock, y el select de contrato quedó acotado a los suyos.
- **Contrato al enrolar/crear personal** (Fase 2 del modelo Valar). Antes asignar un
  trabajador a su contrato exigía ir aparte a la ficha del contrato en Asistencia —
  inviable con 130 trabajadores. Ahora la asignación vive donde se gestiona a la persona:
  - **Wizard de enrolamiento** (`enrollment-wizard`): al registrar un trabajador NUEVO,
    el paso "Datos" incluye selector de **Contrato/Faena de destino** (solo contratos
    activos; opcional, default "pool general") + **Turno** (habilitado al elegir contrato).
    Aplica igual al flujo desktop y al QR móvil (el valor viaja con el "Guardar y Finalizar").
  - **API `/api/users/create`:** acepta `contractId` + `shiftScheduleId` y crea el
    `contract_workers` tras el perfil. Valida que contrato y turno pertenezcan al tenant
    (el service role salta RLS). No es fatal: si la asignación falla, el usuario queda
    creado y la respuesta trae `warning`, que el wizard muestra como toast.
  - **UserPanel → pestaña Contrato/RRHH:** nueva sección **"Contratos / Faenas asignadas"**
    para usuarios EXISTENTES: lista las asignaciones vigentes (con cliente del contrato),
    permite cambiar el turno inline, quitar la asignación (con confirmación) y asignar a
    un contrato activo no asignado. Guardado instantáneo (mutaciones `addContractWorker` /
    `updateContractWorker` / `removeContractWorker`), independiente del botón "Guardar
    cambios" del formulario. Visible para quien ve la pestaña; editable con `users:edit`,
    `hr_employees:edit` o `contracts:manage` (no en modo "Mi Perfil").
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

### Eliminado
- **"AI Diagnostic Core Engine" del dashboard Pagnol** (`dashboard/pagnol`). La tarjeta
  disparaba una llamada a Gemini AUTOMÁTICAMENTE en cada visita al panel (gasto de tokens
  sin que nadie lo pidiera). Se eliminó la tarjeta, el estado `insight`, el contexto y el
  fetch al montar; el gráfico "Tránsito Operativo" ocupa ahora el ancho completo.
  El asistente on-demand (`InventoryAssistant`, burbuja flotante) se mantiene intacto —
  esa es la vía correcta: la IA responde cuando se le pregunta. Verificado en navegador.

### Agregado
- **SEO on-page completo para www.pagnol.cl** (ya en producción):
  - `layout.tsx`: metadata rica — `metadataBase`, título con template, descripción y
    keywords orientadas a búsqueda ("ERP minero", "soluciones mineras", "control de
    inventario", "control de activos", "activos mineros", etc.), Open Graph `es_CL` +
    Twitter card con imagen del dashboard, `robots` index/follow, canonical por ruta.
  - **JSON-LD** (schema.org): `Organization` + `SoftwareApplication` con `featureList`
    de los módulos — habilita resultados enriquecidos en Google.
  - **`src/app/robots.ts`**: permite todo lo público, bloquea `/dashboard`, `/api/`,
    `/enroll/`, `/invite`, `/auth/`, reset/update-password; referencia el sitemap.
  - **`src/app/sitemap.ts`**: `/`, `/pricing`, `/demo`, `/register`, `/login`.
  - Verificado con curl: title/description/keywords/canonical/OG renderizan, y
    `/robots.txt` + `/sitemap.xml` responden. **Pendiente del usuario:** actualizar
    `NEXT_PUBLIC_APP_URL=https://www.pagnol.cl` en Vercel y dar de alta el dominio en
    Google Search Console + enviar el sitemap.

### Cambiado
- **Identidad de correo unificada a `contacto@pagnol.cl`** (estamos en vivo con
  www.pagnol.cl): remitente central (`EMAIL_FROM`, local actualizado — **falta Vercel**),
  destino de alertas internas (`FEEDBACK_ALERT_TO` y fallbacks de feedback/erp-request),
  correos de soporte visibles en login/registro/invitación/reset/pricing
  (antes `hola@teolabs.app` / `support@pagnol.app`), `VAPID_SUBJECT` de web-push, y
  fallbacks de URL `pagnol.teolabs.app` → `www.pagnol.cl` en las rutas de correo.
  **Pendiente del usuario:** en Zoho habilitar envío como `contacto@pagnol.cl`
  (alias/send-as) y SPF/DKIM del dominio pagnol.cl; en Vercel setear
  `EMAIL_FROM`/`FEEDBACK_ALERT_TO`/`NEXT_PUBLIC_APP_URL`.
- **Formulario de contrato extraído a componente compartido** `<ContractFormDialog>`
  (`src/components/contract-form-dialog.tsx`): fuente única del diálogo crear/editar
  contrato (con "+ Nuevo cliente" al vuelo y bloque subcontratista), usado por
  Asistencia → Contratos y Configuración → Clientes y Contratos. De paso se corrigió un
  bug latente: el select "Contrato padre" usaba `SelectItem value=""`, que Radix rechaza
  con excepción al abrir el dropdown — ahora usa el centinela `"none"`.
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
- **UserPanel — "Guardar cambios" descartaba la asignación de contrato pendiente**
  (pestaña Contrato/RRHH). Si se elegía un contrato en el select "Asignar a contrato…"
  y se apretaba el botón grande "Guardar cambios" (en vez del botón chico "Asignar"),
  la ficha se guardaba, el panel cerraba con toast de éxito y la asignación se perdía
  en silencio — el trabajador no aparecía en los filtros por contrato. Ahora "Guardar
  cambios" también confirma la selección pendiente (crea el `contract_workers`) y el
  toast lo dice explícitamente ("…asignado al contrato X"). Verificado en navegador
  reproduciendo el flujo exacto + recarga completa: la asignación persiste.
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
