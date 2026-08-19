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

> ¿Cuántas horas hombre lleva imputadas este contrato?
> ¿Dónde está físicamente ese generador — en el Contrato 4 o en el pañol central?
> ¿Este consumo ya se comprometió contra el presupuesto o todavía no?
> ¿Quién retiró ese equipo, y cómo lo probamos tres meses después ante el mandante?

**Pagnol responde esas preguntas.** Es un SaaS multi-tenant que sigue el ciclo completo:
la solicitud de terreno, la autorización, la orden de compra, la recepción, la entrega al
trabajador con verificación biométrica, el reporte de obra, el estado de pago y el margen
final del contrato. Cada eslabón deja un hecho registrado, y cada hecho tiene autor, fecha
y contrato.

No es un inventario con login. Es la trazabilidad de la plata y de los fierros, desde que
alguien los pide hasta que alguien los factura.

---

## Las cinco ideas que sostienen el sistema

Si vas a tocar este código, esto es lo que conviene entender antes que la carpeta `src/`.

**1. El aislamiento entre empresas vive en la base de datos, no en la aplicación.**
Cada tabla tiene RLS de Postgres filtrando por `tenant_id`. Si mañana alguien escribe una
query y olvida el `where`, Postgres igual no le entrega filas ajenas. La seguridad no
depende de que todos los programadores se acuerden siempre.

**2. Los hechos económicos no se editan: se reversan.**
Cuando se emite una OC el gasto queda *comprometido*; cuando llega la recepción queda
*devengado*; cuando se paga la factura queda *pagado*. Cada transición escribe un asiento
inmutable en `finance_entries`. ¿Te equivocaste? Entra un asiento de reversa. Nunca un
`UPDATE` sobre el pasado — porque un estado de pago que cambia solo, retroactivamente, es
una conversación muy incómoda con el mandante.

**3. Un ledger que no cuadra no es un ledger.**
`materials.stock` dice cuántas unidades hay en total. `material_stocks` dice dónde están,
desglosadas por contrato y por pañol. La suma del desglose debe ser igual al total,
siempre. `stockLedger.ts` es el único lugar autorizado a mover esa aguja, justamente para
que el invariante tenga un solo dueño.

**4. La biometría no sale del dispositivo.**
La cámara corre en el navegador del pañolero. Lo que se guarda no es una foto: es un
descriptor de 128 números del que no se puede reconstruir un rostro. La comparación es 1:1
contra el descriptor del trabajador que dice ser. Nunca viaja una imagen al servidor,
porque el dato biométrico que no se transmite es el que no se puede filtrar.

**5. En terreno no siempre hay señal.**
Las Órdenes de Trabajo funcionan sin conexión: se guardan en IndexedDB y esperan en una
cola de salida hasta que vuelve la red. El supervisor que está en el fondo de un rajo no
tiene por qué saber que el sistema está offline.

---

## El recorrido de una entrega

La forma más rápida de entender la arquitectura es seguir un dato real de punta a punta.
Un trabajador va al pañol a retirar un taladro:

```
  Credencial QR  ──►  el pañolero la escanea; identifica al trabajador
        │
  Verificación   ──►  face-api compara el rostro en vivo contra el descriptor
   biométrica         almacenado. Todo en el navegador, sin subir la imagen.
        │
  Contrato       ──►  contract_workers dice a qué contrato está asignado.
                      Uno solo → se autocompleta. Varios → el pañolero elige.
        │
  Ledger         ──►  consumeFromLedger descuenta primero del contrato pedido,
                      luego del pool de empresa, luego de otros contratos.
        │
  Kardex         ──►  stock_movements graba el movimiento con contrato, pañol,
                      autor y hora. Este registro ya no se toca nunca más.
        │
  Costo          ──►  la valorización imputa el consumo al centro de costo y
                      aparece en el margen del contrato.
```

Seis capas, una sola acción del usuario: escanear y mirar a la cámara.

---

## Módulos

**Núcleo operacional**

| Módulo | Qué hace |
|---|---|
| **Pagnol** | Pañol digital y superficie única de activos (ISO 55001): activos, movimientos con cierre biométrico, personal, mantenimiento, órdenes de trabajo. Es además la referencia del sistema de diseño. |
| **Bodega** | Materiales, stock y solicitudes. Stock desglosado por contrato y por pañol, con valorización. |
| **Reportes de Trabajo** | Reportes de terreno en cascada: OT → Diario → Semanal (formato SQM de 4 páginas), con PDF y firmas en cada nivel. |
| **Reportes** | Tableros de entregas, inventario, estadísticas y valorización de stock por contrato, con exportación a Excel. |

**Abastecimiento y finanzas**

| Módulo | Qué hace |
|---|---|
| **Abastecimiento** | Hub de compras: solicitudes, RFQ con comparador de cotizaciones, órdenes, recepción ligada a OC, proveedores 360°, centros de costo, alertas. |
| **Compras · Pagos** | Solicitudes y órdenes de compra, proveedores, lotes; facturas, adelantos y pagos a proveedores. |
| **Arriendos** | Contratos, arrendadores (unificados con proveedores) y pagos. Las OC de arriendo materializan cada equipo como un activo del pañol. |
| **Finanzas** | Margen por contrato y presupuesto contra ejecutado, construidos sobre el ledger de `finance_entries`. |
| **Estado de Pago · DTE** | Estados de pago de contratos; facturación electrónica chilena (UI lista, backend pendiente). |

**Personas, seguridad y control**

| Módulo | Qué hace |
|---|---|
| **Asistencia** | Registro diario, reportes semanales y mensuales, cálculo de remuneraciones, finiquitos. |
| **RRHH** | Fichas de empleados, documentos y solicitudes de trabajadores. |
| **Seguridad (CPHS)** | Charlas diarias, checklists, inspecciones y observaciones de conducta. |
| **Control de Obra** | WBS, carta Gantt y protocolos de calidad. |
| **Autorizaciones (ADC)** | Puerta previa a Abastecimiento para solicitudes de material, compra y arriendo. |

**Administración** — Usuarios y credenciales QR, permisos por tenant, configuración de
empresa, wallet de anticipos, y consola de super-admin para la operación de la plataforma.

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind, Radix / shadcn, Framer Motion |
| Estado | `react-tracked` sobre un `useReducer` central — cada componente se re-renderiza solo por lo que lee |
| Base de datos | PostgreSQL en Supabase, con RLS multi-tenant en todas las tablas |
| Auth | Supabase Auth — login por email **o RUT** |
| Tiempo real | Supabase Realtime |
| IA | Google Genkit + Gemini, con un servidor **MCP** que expone las mismas herramientas a clientes externos |
| Biometría | `@vladmandic/face-api` ejecutándose 100% en el navegador |
| Credenciales | QR (`html5-qrcode` / `qrcode.react`) y tokens de enrolamiento |
| Documentos | jsPDF y ExcelJS en cliente; `puppeteer-core` + `@sparticuz/chromium` en servidor |
| Offline | Dexie (IndexedDB) + cola de salida + service worker |
| Notificaciones | Web Push con VAPID |
| Deploy | Vercel |

---

## Puesta en marcha

```bash
git clone https://github.com/StevenNunez/Pagnol.git
cd Pagnol
npm install --legacy-peer-deps

cp .env.example .env.local      # Supabase, Gemini, SMTP y VAPID
node scripts/download-models.js # modelos de face-api → public/models

npm run dev
```

Las **migraciones no se aplican solas**. Viven en `supabase/migrations/` (114 archivos con
marca de tiempo) y se ejecutan a mano en el editor SQL de Supabase, en orden.

```bash
npm run build       # build de producción
npm run lint        # ESLint
npm test            # Vitest — motor offline y matemática del ledger financiero
npx tsc --noEmit    # chequeo de tipos, la herramienta principal de corrección
npm run demo:create # siembra un tenant de demostración
```

---

## Estructura

```
src/
├── app/                  App Router: páginas de /dashboard y API routes
│   └── api/mcp/          servidor MCP (JSON-RPC 2.0) para clientes externos
├── components/           UI compartida; ui/ son los primitivos shadcn/Radix
├── modules/
│   ├── auth/             AuthProvider, permisos, cambio de tenant
│   ├── core/             tipos de dominio, catálogo de permisos, hooks de datos
│   ├── data/             DataProvider, mappers y mutations por dominio
│   │   └── mutations/    stockLedger.ts y financeLedger.ts son los guardianes
│   │                     de los invariantes descritos más arriba
│   └── offline/          Dexie + outbox + sync (el único módulo con tests)
├── ai/                   flujos Genkit y definiciones de herramientas
└── lib/                  biometría, PDF, push, utilidades

supabase/migrations/      114 migraciones SQL con timestamp
```

El historial de cambios se lleva en [`CHANGELOG.md`](CHANGELOG.md), en formato
Keep a Changelog.

---

## Seguridad

- `.env`, `.env.local` y `.env.production` **nunca** se suben al repositorio; las
  variables se configuran en el dashboard de Vercel.
- La `SERVICE_ROLE_KEY` de Supabase se usa solo en API routes del servidor, jamás en el
  cliente. Es la única llave que salta la RLS.
- Cuidado con un detalle que muerde: un `UPDATE` del cliente anónimo que la RLS bloquea
  **no lanza error** — afecta cero filas y devuelve éxito. Encadena `.select()` y verifica
  que hayan vuelto filas cuando el update tenía que ocurrir.
- El servidor MCP se autentica con un token propio (tabla `api_tokens`, guardado hasheado)
  y resuelve el mismo contexto de tenant y permisos que tendría una persona.

---

<div align="center">

### Construido por Teo Labs

Diseño, arquitectura e ingeniería de **[Teo Labs](https://www.teolabs.app)** ®

*Hacemos software que aguanta la faena.*

</div>
