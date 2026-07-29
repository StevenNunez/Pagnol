# RFC-002 · F4 — Flujo de caja y cierre de período

**Fecha:** 2026-07-28
**Estado:** propuesto (pendiente de aprobación de Steven)
**Decisores:** Steven Nuñez (dispone) + Chief Software Architect IA (propone)
**Precedentes:** RFC-002 §"Flujo de caja proyectado" y §"Cierre de período"; ADR-002…005

---

## Punto de partida: lo que el terreno desmiente del RFC

Tres supuestos del RFC no se sostienen contra el código real. El plan los corrige.

1. **«El flujo de caja es una consulta sobre el ledger».** `finance_entries` no guarda
   vencimientos, solo `entry_date` (fecha contable). Hoy los vencimientos viven en
   `supplier_payments.due_date` y `rental_payments.due_date`.
2. **«Proyección de remuneraciones».** No existe emisor de `paid` para mano de obra: la MO
   entra devengada y ahí se queda. Además la liquidación de sueldo es hoy una **calculadora
   client-side sin persistencia** (`attendance/monthly-report`: `useState` → PDF, no guarda
   nada). No hay ninguna entidad de remuneración pagada que consultar.
3. **«El soft-lock basta para congelar el pasado».** Cuatro emisores fechan hacia atrás
   —`labor_day` (ventana móvil de 35 días), devengo de ciclos de arriendo, cobro de EP y
   pago de arriendo—, así que el cierre no es un guard pasivo: cambia el comportamiento de
   un cron que corre todos los días. Los reversos, en cambio, ya usan `CURRENT_DATE` y son
   compatibles sin tocar nada.

## Decisiones de Steven (2026-07-28)

| # | Pregunta | Decisión |
|---|---|---|
| D1 | ¿Qué hace el cierre con un materializador que quiere emitir en un mes cerrado? | **Rechazar + reportar**, con chequeo previo antes de cerrar |
| D2 | ¿De dónde sale el flujo de caja? | **Agregar `due_date` al ledger** (no leer documentos) |
| D3 | ¿Cómo entran las remuneraciones? | **Construir el pago de remuneraciones** (emisor `paid` real) |

D2 y D3 son las opciones de mayor alcance de cada pregunta. El plan las asume y las
ordena para que ninguna bloquee el valor de las otras.

---

## F4.1 — Cierre de período (soft-lock)

**Entidad.** `finance_periods` (tenant, year, month, `closed_at`, `closed_by`,
`closed_by_name`, `reopened_at`/`reopened_by` para el caso excepcional). Append-only en
espíritu; reabrir es un hecho registrado, no un DELETE.

**El guard.** Trigger `BEFORE INSERT` sobre `finance_entries`: si `entry_date` cae en un
mes cerrado del tenant → `RAISE EXCEPTION`. Va en la base, no en los emisores: hay nueve
emisores y dos crons, y el Art. 2 no puede depender de que todos recuerden chequear.

**Chequeo previo al cerrar** (lo que evita cerrar sobre datos incompletos):
- días con asistencia y sin sueldo base configurado en el período (la alerta de ADR-003 ya
  calcula esto),
- ciclos de arriendo vencidos y no devengados,
- recepciones sin precio conocible (hoy se saltan en silencio: `if (!price) continue`),
- EP aprobados sin cobrar (informativo, no bloquea).

Se muestran antes de confirmar. Se puede cerrar igual — pero con la foto delante.

**Reporte de bloqueados.** `/api/cron/labor-cost` y el materializador de arriendos suman
`blocked: n` a su respuesta con el detalle; el panel de Finanzas muestra una alerta
persistente mientras haya hechos que no pudieron emitirse. **Nada desaparece en silencio**
— es justo el modo de falla que D1 descarta.

**Interacción con la ventana de MO.** No se acota la ventana (D1 rechazó eso): el cron
sigue mirando 35 días, intenta, es rechazado y lo reporta. Idempotencia intacta.

---

## F4.2 — `due_date` en el ledger + flujo de caja proyectado

**La fricción que hay que resolver primero.** El vencimiento nace con la **factura**, que
llega *después* del devengo por recepción — y hoy `addSupplierPayment` crea la factura como
`pending` **sin emitir ningún hecho** (solo emite al pagarse). Es decir: el hecho que tiene
vencimiento no existe en el ledger, y el que existe no conocía el vencimiento al nacer.
Como los hechos son inmutables (Art. 2), no se puede "rellenar" el `due_date` después.

**Propuesta — la factura reemplaza la estimación de la recepción.** Al registrar una
factura ligada a una OC: reversar el devengo de esa OC y re-emitirlo con el monto real de
la factura y su `due_date`. No es plomería: la recepción devenga a **precio estimado** (el
de la OC, o el de catálogo cuando la OC no está valorizada — ya lo anota en sus notas), y
la factura es el monto real. Sustituir estimación por realidad es mejor dato, y el patrón
reverso + re-emisión ya existe (`reverseEntriesForSource`, usado en toda la cadena de F0).

Consecuencia aceptada: más filas en el ledger. Beneficio: el ledger se vuelve autosuficiente
para el flujo, que es exactamente lo que pide D2.

**Dónde se llena `due_date`:**

| Emisor | `due_date` |
|---|---|
| `rental_contract` (comprometido) | vencimiento de cada cuota del calendario (ya existe) |
| factura de proveedor (devengado re-emitido) | `supplier_payments.due_date` |
| EP aprobado (ingreso devengado) | vencimiento de cobro del mandante |
| pago de remuneraciones (F4.3) | fecha de pago del período |
| resto | `NULL` — sin vencimiento conocido, no entra al flujo |

**El flujo.** RPC `finance_cash_flow(p_from, p_to)`: agrupa por semana/mes los hechos con
`due_date` en el rango cuya obligación sigue viva (devengado no pagado, comprometido no
devengado), separando entradas (ingresos) de salidas (costos), con saldo neto acumulado.
Página `/dashboard/finanzas/flujo`, misma firma que el resto del módulo.

---

## F4.3 — Pago de remuneraciones

**Advertencia de alcance:** esto no es una pieza de F4, es una fase propia. Hoy **no existe
nada persistente**: la liquidación es una calculadora en memoria. Construirlo implica una
entidad nueva, su UI, su relación con anticipos (`SalaryAdvance`, que ya descuenta) y el
emisor. Es comparable a F1 completa.

**Recomendación: hacerlo después de F4.1 y F4.2, no en paralelo.** Ambas entregan valor sin
él —el cierre protege el histórico, el flujo cubre proveedores, arriendos e ingresos— y el
flujo puede mostrar entretanto la MO devengada no pagada como **proyección marcada**, que se
reemplaza por el dato real cuando F4.3 exista. Si se hace todo junto, F4 se convierte en un
lote grande sin verificar, que es exactamente cómo F3 llegó a producción con dos bugs.

**Contenido cuando se haga:** entidad `payroll_runs` (período, tenant, estado, totales) +
`payroll_lines` (trabajador, haberes, descuentos, anticipos, líquido) alimentada por lo que
hoy calcula `monthly-report`; al marcarse pagada emite `stage='paid'`, `category='labor'`,
imputado por `contract_workers` igual que F1, con `due_date` = fecha de pago.

---

## Orden propuesto

1. **F4.1 cierre** — autónomo, protege todo lo construido en F0–F3.
2. **F4.2 flujo** — depende de `due_date`; el reemplazo factura↔recepción se verifica E2E
   antes de seguir.
3. **F4.3 remuneraciones** — fase propia, con su plan y su ADR.

Cada tanda: migración → código → **E2E antes del commit** (lección de F3).

## Permisos

`finance:manage` ya dice literalmente *"Administrar Finanzas (presupuestos, **cierres**)"* —
no hace falta un permiso nuevo. Cerrar/reabrir queda bajo él; ver el flujo, bajo
`module_finance:view`.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El trigger de cierre rompe una operación cotidiana (recepcionar, pagar) con fecha retroactiva | El chequeo previo y el mensaje de error nombran el período y quién lo cerró; reabrir es un click con permiso |
| El reemplazo factura↔recepción descuadra si una factura cubre varias OC o llega parcial | Se reversa por `source_id` de OC, no global; caso multi-OC se resuelve por prorrateo o se deja fuera de v1 (decisión al implementar) |
| F4.3 se traga la fase | Va en tanda propia, con plan y ADR aparte |
