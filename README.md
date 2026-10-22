<div align="center">

# PAGNOL

**Control total en el corazón de la faena**

Software de gestión operativa para faenas mineras y de construcción.

Un producto de **[Teo Labs](https://www.teolabs.app)** ®

</div>

---

## De qué se trata

En una faena, el **pañol** es la bodega donde vive todo lo que hace falta para trabajar:
las herramientas, los equipos, los repuestos, el EPP. Y durante décadas se administró
igual — con un cuaderno, un pañolero de memoria prodigiosa y una firma garabateada en
una hoja que después nadie encuentra.

El problema no es el cuaderno. El problema es lo que el cuaderno no puede responder:

> ¿Dónde está hoy ese generador: en el contrato de la mina o en la oficina central?
> ¿Cuánto dinero en guantes ya entregamos este mes, y cuánto gastamos al comprarlos?
> ¿Quién retiró ese equipo, y cómo lo probamos tres meses después ante el mandante?
> ¿Esta compra ya se comprometió contra el presupuesto o todavía no?
> Este trabajador renunció: ¿cómo lo saco de la nómina sin perder lo que hizo?

**Pagnol responde esas preguntas.** Sigue el ciclo completo de un material o un equipo: la
solicitud desde terreno, la autorización, la orden de compra, la recepción, la entrega al
trabajador con verificación facial, el reporte de obra, el estado de pago y el margen del
contrato. Cada paso deja un registro con autor, fecha y contrato.

No es un inventario con login. Es la trazabilidad de la plata y de los fierros, desde que
alguien los pide hasta que alguien los factura.

---

## Lo que hace

**Pañol y activos**

| Módulo | Qué hace |
|---|---|
| **Gestión de Activos** | Catálogo único de equipos, herramientas, repuestos y consumibles. Cada activo con su código y QR: se graba en el fierro con pistola de marcado o se imprime como etiqueta adhesiva (para EPP, arrendados y lo del cliente). |
| **Entregas y Devoluciones** | La entrega al trabajador se cierra con su cara. La persona se identifica con su credencial QR, con la cédula o por búsqueda. |
| **Pañoles** | Varios pañoles por empresa, una oficina central, y traslados entre ellos que dejan registro. |
| **Stock por Contrato** | Cuántas unidades hay en cada contrato y en cada pañol, valorizadas, con el kardex del período y el dinero entregado. Exporta a Excel. |
| **Mantenimiento** | Órdenes de trabajo y reportes de terreno en cascada (OT → diario → semanal), con PDF y firmas en cada nivel. |

**Compras y plata**

| Módulo | Qué hace |
|---|---|
| **Abastecimiento** | Requerimientos, solicitudes de compra, cotizaciones con comparador, órdenes de compra, recepción contra la OC, proveedores y alertas. |
| **Arriendos** | Contratos de arriendo, arrendadores y calendario de pagos. Lo que se arrienda entra al pañol como un activo más. |
| **Pagos** | Facturas, adelantos y pagos a proveedores. |
| **Finanzas** | Margen por contrato (ingreso contra costo) y presupuesto contra ejecutado, calculados desde el libro de hechos económicos. |
| **Estado de Pago** | Estados de pago de los contratos con el mandante. |
| **Autorizaciones** | Una puerta previa a Abastecimiento: las solicitudes de material, compra y arriendo pasan primero por quien las autoriza. |

**Personas y seguridad**

| Módulo | Qué hace |
|---|---|
| **Usuarios y Personal** | Alta, edición, credenciales QR, permisos y **desvinculación que conserva el historial**. 24 roles, con permisos ajustables por empresa. |
| **Asistencia y remuneraciones** | Asistencia diaria, turnos, reportes, liquidaciones, horas extra y finiquitos. |
| **RRHH** | Fichas, documentos y solicitudes de los trabajadores. |
| **Seguridad (CPHS)** | Charlas diarias con firma, checklists, inspecciones y observaciones de conducta. |
| **Control de Obra** | Carta Gantt, estructura de partidas (WBS) y protocolos de calidad. |

**Para conectar con otros sistemas**

| Pieza | Qué hace |
|---|---|
| **API pública `/api/v1`** | Materiales, productos, activos, proveedores, pañoles, movimientos y compras esperadas. Llaves por empresa con permisos acotados; documentación OpenAPI en `/api/v1/openapi.json`. |
| **Webhooks** | Avisan eventos (activo creado, stock bajo el mínimo, compra recibida…) con firma [Standard Webhooks](https://www.standardwebhooks.com) y reintentos. |
| **Servidor MCP `/api/mcp`** | Deja que un asistente de IA consulte los datos de la empresa con las mismas reglas de permisos que una persona. |
| **Asistente interno** | Un chat que responde sobre el inventario usando esas mismas herramientas. |

---

## El recorrido de una entrega

La forma más rápida de entender el sistema es seguir un dato real. Un trabajador va al
pañol a retirar guantes:

```
  Identificación ──►  el pañolero lee su credencial QR o su cédula
        │
  Verificación   ──►  la cámara toma el rostro de quien está parado ahí; el navegador
   facial             extrae 128 números y los manda al servidor, que los compara con
        │             la plantilla guardada. Vuelve un veredicto, nunca la plantilla.
        │
  Contrato       ──►  el trabajador está asignado a un contrato (o a un área interna).
                      Uno solo: se completa solo. Varios: el pañolero elige.
        │
  Existencias    ──►  se descuenta del contrato pedido; si no alcanza, del pool de la
                      empresa; si no, de otros contratos. El total siempre cuadra.
        │
  Kardex         ──►  queda el movimiento con contrato, pañol, autor y hora.
        │
  Costo          ──►  el gasto ya ocurrió al comprar, a nombre del contrato de la compra.
                      Si las unidades venían de otro contrato, el costo pasa al que las
                      consume; lo que ya estaba ahí no se cuenta dos veces.
```

Una sola acción para el usuario (mirar a la cámara) y seis registros detrás.

---

## Las decisiones que sostienen el sistema

Si vas a tocar este código, esto conviene entenderlo antes que la carpeta `src/`.

**1. Las empresas están separadas en la base de datos, no solo en la aplicación.**
Cada tabla del negocio filtra por empresa con las reglas de seguridad de Postgres (RLS). Si
mañana alguien escribe una consulta y olvida el filtro, la base igual no entrega filas
ajenas. La seguridad no depende de que todos se acuerden siempre.

**2. Lo económico no se edita: se corrige con un asiento nuevo.**
Una OC emitida deja el gasto *comprometido*; la recepción lo deja *devengado*; el pago lo
deja *pagado*. Cada paso escribe un hecho que no se modifica. ¿Te equivocaste? Entra un
asiento de reversa. Un estado de pago que cambia solo, hacia atrás en el tiempo, es una
conversación muy incómoda con el mandante.

**3. Las existencias tienen que cuadrar, y "de quién es" no es "dónde está".**
`materials.stock` dice cuántas unidades hay en total; `material_stocks` dice dónde están,
por contrato y por pañol, y la suma del desglose es igual al total. El **contrato** de una
unidad dice de quién es el costo (el que la compró); el **pañol** dice dónde está
físicamente. Mover un guante de la oficina central a un pañol no cambia de quién es.
Cambiarlo de contrato sí, y por eso se pide una justificación.

**4. La plantilla de la cara no sale del servidor.**
El navegador usa la cámara y calcula un descriptor de 128 números de quien está enfrente;
solo eso viaja. La plantilla guardada vive en el servidor y la comparación ocurre allá, así
que ningún compañero de la empresa puede descargar la cara de otro. Al enrolar a una
persona también se guardan las fotos de su cédula y de su rostro, en una tabla aparte que
solo puede leer la propia persona o un administrador de su empresa.

**5. Quien se va se desvincula; no se borra.**
Desvincular saca a la persona de la nómina y le cierra el acceso, pero deja a la vista sus
entregas, firmas y solicitudes. Eliminar existe y es otra cosa: marca el perfil como
eliminado y lo saca de todas las listas, y desde la aplicación no se puede deshacer. Por eso
el botón de desvincular está a la mano y el diálogo de eliminar lo sugiere primero.

---

## Lo que funciona y lo que todavía no

Esto no es un folleto, así que también va lo que falta:

| Tema | Estado real |
|---|---|
| Facturación electrónica (DTE) | **Solo interfaz.** Las pantallas están, pero no hay conexión con el SII. |
| Modo sin conexión | **Solo órdenes de trabajo.** Se guardan en el dispositivo y se sincronizan al volver la red. El resto de la app necesita internet. |
| Prueba de vida facial | **En observación.** Se mide y se registra, pero todavía no bloquea una entrega. |
| Pruebas automáticas | Unas 800, concentradas en la lógica de cálculo (existencias, finanzas, remuneraciones, offline, API). **Las pantallas se verifican a mano**, no hay pruebas de interfaz. |
| Migraciones de base de datos | **No se aplican solas.** Hay que correrlas a mano, en orden. |
| Despacho de webhooks | El cron de Vercel corre **una vez al día**. Para entregas casi inmediatas hay que llamar a `/api/cron/webhooks` cada minuto desde un programador externo. |

---

## Stack

| Capa | Tecnología |
|---|---|
| Aplicación | Next.js 16 (App Router), React 19, TypeScript, Tailwind, Radix / shadcn |
| Estado | `react-tracked` sobre un `useReducer` central; cada módulo carga solo las colecciones que usa |
| Base de datos | PostgreSQL en Supabase, con RLS por empresa |
| Autenticación | Supabase Auth: se entra con correo **o con RUT** |
| Tiempo real | Supabase Realtime |
| IA | Google Genkit + Gemini; servidor MCP con las mismas herramientas |
| Rostro | `@vladmandic/face-api` en el navegador (extracción); comparación en el servidor |
| Credenciales | Códigos QR (`html5-qrcode`, `qrcode.react`) y enlaces de enrolamiento |
| Documentos | jsPDF y ExcelJS en el navegador; `puppeteer-core` + `@sparticuz/chromium` en el servidor |
| Sin conexión | Dexie (IndexedDB) + cola de salida + service worker |
| Avisos | Web Push (VAPID) y correo SMTP |
| Pruebas | Vitest |
| Despliegue | Vercel |

---

## Puesta en marcha

```bash
git clone https://github.com/StevenNunez/Pagnol.git
cd Pagnol
npm install            # el .npmrc ya activa legacy-peer-deps
cp .env.example .env.local
npm run dev
```

Necesitas un proyecto de **Supabase** y completar `.env.local` (cada variable está
explicada en `.env.example`). Los modelos de reconocimiento facial ya viajan en
`public/models`, así que no hay que descargar nada aparte.

**Las migraciones no se aplican solas.** Están en `supabase/migrations/` (155 archivos con
fecha en el nombre) y se ejecutan a mano en el editor SQL de Supabase, de la más antigua a la
más nueva.

```bash
npm run build      # build de producción
npm run lint       # ESLint
npm test           # Vitest
npx tsc --noEmit   # chequeo de tipos
```

Algo que muerde: un `UPDATE` hecho con el cliente anónimo que la RLS bloquea **no lanza
error**; afecta cero filas y responde éxito. Si el cambio tiene que ocurrir, encadena
`.select()` y verifica que volvieron filas.

---

## Estructura

```
src/
├── app/
│   ├── dashboard/        las pantallas, una carpeta por módulo
│   └── api/              rutas del servidor: /v1 (API pública), /mcp, /cron, /biometric…
├── components/           interfaz compartida; ui/ son los primitivos shadcn/Radix
├── modules/
│   ├── auth/             sesión, cambio de empresa
│   ├── core/             tipos, permisos y roles, hooks
│   ├── data/             estado global, mapeadores y mutaciones por dominio
│   │   └── mutations/    stockLedger.ts y financeLedger.ts guardan los invariantes
│   └── offline/          IndexedDB, cola de salida y sincronización
├── ai/                   flujos de Genkit y definición de las herramientas de consulta
└── lib/                  rostro, PDF, API pública y webhooks, utilidades

supabase/migrations/      el esquema de la base, en orden
public/models/            modelos de reconocimiento facial
```

---

## Despliegue

La app corre en **Vercel** y la base en **Supabase**.

1. Importa el repositorio en Vercel. `vercel.json` ya fija el comando de instalación y el build.
2. Carga en Vercel las variables de `.env.example`. Sin `CRON_SECRET` ninguna tarea
   programada corre; sin `SUPABASE_SERVICE_ROLE_KEY` no funcionan las rutas de servidor.
3. Aplica las migraciones en Supabase.
4. Las tareas programadas (`vercel.json`) son: alertas de arriendo, tasa de la UF, costo de
   mano de obra, revisión de retiros y despacho de webhooks, una vez al día cada una.
5. Los PDF se generan en el servidor con Chromium. Los binarios de `@sparticuz/chromium`
   están listados en `outputFileTracingIncludes` de `next.config.js`; si los quitas, el
   despliegue falla.

---

## Seguridad

- `.env`, `.env.local` y similares **nunca** se suben al repositorio; las variables viven en
  Vercel.
- `SUPABASE_SERVICE_ROLE_KEY` se usa solo en rutas del servidor. Es la única llave que salta
  la RLS, y cada consulta que la usa filtra por empresa de forma explícita.
- La API pública se autentica con llaves por empresa. Solo se guarda su huella (SHA-256); la
  llave se muestra una única vez al crearla.
- El servidor MCP usa un token propio, guardado con hash, y resuelve la misma empresa y los
  mismos permisos que tendría una persona.
- Las contraseñas nuevas se revisan contra filtraciones conocidas antes de aceptarse.
- La comparación facial y su umbral viven en el servidor, no en el navegador.

---

<div align="center">

### Construido por Teo Labs

Diseño, arquitectura e ingeniería de **[Teo Labs](https://www.teolabs.app)** ®

*Hacemos software que aguanta la faena.*

</div>
