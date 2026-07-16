# RFC-002 — Resultado por Contrato

**Estado:** Aprobado — F0 ejecutada en código (2026-07-16; ver RFC-002-F0-Plan y ADR-002).
Pendientes: aplicar migración 20260722000000 + E2E; luego F1 (MO).

**Prioridad:** Alta

**Autor:** Claude (Chief Software Architect) — en revisión con Steven Nuñez

**Fecha:** 2026-07-15

---

# Relación con RFC-001

RFC-001 planteó el "Dominio Financiero" como investigación abierta. Este documento es la respuesta:
contradice al RFC-001 donde corresponde, adopta lo que está bien planteado, y fija la arquitectura
propuesta para revisión antes de ejecutar.

**Decisiones ya tomadas** (2026-07-15, con Steven):

1. **Alcance v1:** Resultado por Contrato (costos + ingresos + presupuesto vs real + flujo proyectado).
   Tesorería (caja/bancos) fuera de v1. Contabilidad general fuera para siempre.
2. **Costo de mano de obra:** Asistencia × factor costo-empresa (configurable por tenant, ~1.35 sobre
   `baseSalary`). Las HH×OT de work-reports son llave de *distribución* entre partidas, no fuente del monto.
3. **Moneda:** CLP + UF desde v1. Cada hecho guarda moneda origen, tasa y monto CLP congelado.
4. **Presupuesto de costo:** manual / importación Excel por partida en v1. APU llega en fase posterior
   como *generador* del presupuesto, no como prerequisito.

---

# Veredicto sobre RFC-001

## Lo que está bien

- La dirección: Pagnol tiene el dato operacional más granular del mercado (HH biométricas, kardex por
  contrato, avance físico) y no puede responder "¿cuánto me cuesta este contrato?".
- La filosofía de propiedad: cada módulo sigue siendo dueño de su captura.
- El formato: preguntas antes que respuestas.

## Lo que se corrige

**1. "Nunca duplicar información" estaba mal calibrado.** Tomado literal (derivar todo en vivo desde
las tablas operacionales) produce números financieros que cambian retroactivamente cuando alguien edita
una OT de hace tres meses. Un reporte de marzo debe decir lo mismo para siempre. La lección ya está
aprendida en este mismo repo: la auditoría de work-reports (2026-07-11) terminó agregando snapshots
anti-mutación-retroactiva en toda la cascada. El principio corregido:

> **No duplicar la captura. Sí materializar el hecho.**

Un hecho económico ("el 12-03, la OC-042 comprometió $4.2M contra Novandino, partida 03.02") es un
snapshot inmutable, no una copia del dato operacional.

**2. Los 15 "centros de costos" confunden dimensiones con jerarquía.** La jerarquía de imputación es
Contrato → Partida, y ya existe (`Contract` + árbol de `WorkItem`). Trabajador, cuadrilla, activo,
proveedor, material y OT son **dimensiones** del hecho (columnas), y "costo por trabajador" es un
`GROUP BY`, no una estructura. Un árbol de 15 niveles muere por calidad de imputación (el KPI
"Sin imputar" de la página de costos actual ya lo demuestra a nivel 1).

**3. El RFC no tenía lado INGRESOS.** Toda pregunta de utilidad/rentabilidad es imposible con puro
costo. El lado venta ya existe a medias: `WorkItem.unitPrice` (presupuesto de venta al mandante) y
estado-pago (reconocimiento de ingreso por avance). Por eso el dominio se llama **Resultado por
Contrato**, no "costos".

**4. La sección "Pagos" coqueteaba con volverse contabilidad general.** Plan de cuentas, conciliación
bancaria, F29, libros SII: territorio de Nubox/Softland/Defontana, regulado, y no es el diferenciador.
Pagnol registra pagos y exporta hacia el contable del cliente; no ES el contable.

## Hallazgo clave: el dominio ya existe, fragmentado en 4 piezas que no se hablan

| Fragmento | Qué sabe hoy | Qué ignora |
|---|---|---|
| `CostCenter` + imputación de OC (abastecimiento/costos) | Presupuesto de compras vs comprometido | Solo compras; rollup en el navegador |
| `WorkItem` (control de obra) | Partidas con `quantity × unitPrice` = presupuesto de **venta** | Nada de costos |
| `PaymentState` (estado-pago) | Valor ganado por avance = ingreso devengado | Desconectado de costos |
| `SupplierPayment` + `RentalPayment` (payments/rentals) | Cuentas por pagar reales | Ligadas a OC por string; sin dimensión contrato |

La dimensión de costo natural de Pagnol ya es `contract_id` (ledger de stock, kardex,
`contract_workers`, solicitudes). El `CostCenter` actual queda como dimensión *administrativa*
(gasto no imputable a contrato: TI, administración), no como columna vertebral.

---

# Arquitectura propuesta

## Núcleo: ledger financiero append-only

Una sola tabla de hechos económicos (`finance_entries`, nombre tentativo), alimentada por los módulos
existentes en transiciones de estado bien definidas. Mismo patrón ya probado con `stockLedger.ts`,
elevado a dinero. Cada hecho lleva:

- **Naturaleza:** ingreso | costo.
- **Etapa:** comprometido | devengado | pagado (ver máquina de estados abajo).
- **Monto:** neto CLP congelado al momento del hecho + moneda origen + monto origen + tasa (UF del día).
- **Dimensiones:** `contract_id`, `work_item_id` (partida, opcional), categoría
  (MO | materiales | equipos | subcontrato | arriendo | indirecto), `cost_center_id` (opcional,
  gasto administrativo), documento origen (tipo + id — trazabilidad total), contraparte
  (proveedor / trabajador / activo, opcionales).
- **Inmutabilidad:** los hechos no se editan. Una corrección es un hecho de reverso + un hecho nuevo
  (patrón kardex). RLS: INSERT para roles operativos, UPDATE/DELETE para nadie (ni admin).

`sin contrato` es un valor de primera clase, visible y alarmado (mismo patrón que "sin asignar" en
áreas internas): la calidad de imputación se gestiona, no se esconde.

## Máquina de estados del costo (responde "¿cuándo nace un costo?")

```
Presupuesto → Comprometido → Devengado → Pagado
```

No es un momento: es una progresión, y cada documento existente ya tiene los gatillos:

| Emisor (módulo dueño) | Evento existente | Hecho emitido |
|---|---|---|
| Purchasing | OC emitida/confirmada | costo **comprometido** (materiales) |
| Abastecimiento/Recepción | Recepción ligada a OC | costo **devengado** (materiales) |
| Payments | `SupplierPayment` pagada | costo **pagado** |
| Rentals | OC arriendo confirmada | comprometido por todo el plazo |
| Rentals | Ciclo transcurrido (`RentalPayment` due) | devengado del ciclo; pagado al pagarse |
| Asistencia | Día/HH registrada | costo **devengado** MO = tiempo × `baseSalary` proporcional × factor costo-empresa |
| Mantenciones | Mantención ejecutada con repuestos/HH | devengado (equipos) |
| Bodega/Pañol | Consumo de stock a contrato (kardex) | devengado (materiales, qty × `unitCost`) — solo consumibles, para no duplicar con la compra* |
| Estado de Pago | EP aprobado | **ingreso devengado** |
| Estado de Pago / DTE | EP pagado / factura cobrada | ingreso **pagado** |

\* Regla anti-doble-conteo materiales (a validar en diseño de detalle): la compra deveña al contrato
solo si la OC está imputada a contrato; el consumo de bodega deveña solo lo que salió del pool central.
Un material no puede costear dos veces.

Los emisores son llamadas explícitas dentro de las mutaciones existentes (mismo patrón que
`addToLedger`/`consumeFromLedger`), no triggers mágicos: visibles, testeables, con contexto de usuario.

## Presupuesto de costo por partida

Entidad ligera de presupuesto: monto de costo presupuestado por `work_item_id` (o por contrato si no
hay partidas), por categoría. Carga manual o importación Excel (papaparse, patrón existente).
**Versionado simple:** un presupuesto vigente + historial de modificaciones presupuestarias
(aumentos/decrementos con motivo y fecha) — responde la pregunta de RFC-001 sobre modificaciones sin
construir versionado completo.

Con esto el panel responde: presupuesto | comprometido | devengado | pagado | disponible | % ejecución,
por contrato y por partida. Margen = venta (partidas × avance) − costo devengado.

## Flujo de caja proyectado

No es un módulo: es una consulta sobre el ledger — comprometido y devengado no pagado, ordenado por
fecha de vencimiento (`dueDate` de `SupplierPayment`, calendario de `RentalPayment`, proyección de
remuneraciones del mes en curso), neto de ingresos esperados (EP aprobados no cobrados).

## Cierre de período

Soft-lock mensual: al cerrar un mes, el ledger rechaza hechos con fecha contable dentro del período
cerrado (correcciones entran con fecha del período abierto, referenciando el hecho original).
Sin esto, los reportes históricos siguen siendo mutables y todo lo anterior pierde valor.

## Agregación server-side — ruptura consciente del patrón actual

El ledger será la tabla más grande del sistema (cada recepción, cada día-persona, cada ciclo).
**No entra a `useSupabaseCollection`/`DataProvider`**: los dashboards financieros consumen vistas/RPC
de Postgres con agregación en el servidor (por contrato, por partida, por período, por categoría).
Es la primera vez que Pagnol rompe el patrón "cargar colección al navegador", y se hace a propósito.
Realtime no aplica al ledger (los KPI financieros no necesitan latencia de subsegundo; refetch al
navegar es suficiente).

## Permisos — el margen es el dato más sensible del sistema

Nuevo grupo de permisos (`finance:*`): ver costos ≠ ver márgenes ≠ administrar presupuestos ≠ cerrar
períodos. Un supervisor puede ver ejecución de su contrato sin ver la utilidad de la empresa.
Sigue el patrón `ALL_PERMISSIONS`/`ROLES_DEFAULT` existente.

## Configuración por tenant

- Factor costo-empresa (default 1.35, editable en `/dashboard/configuracion`).
- Tarifa hora-máquina por activo propio (campo en `Material`, opcional; sin tarifa = activo no
  deveña por uso, solo por mantención/combustible).
- Fecha de corte del ledger (desde cuándo se registran hechos — ver pregunta abierta de backfill).

---

# Qué NO se construye

- **Contabilidad general** (plan de cuentas, libro mayor, conciliación, F29): nunca. Exportación
  Excel/CSV hacia el contable, sí.
- **Tesorería** (saldos de caja/bancos): fuera de v1; evaluar en v2 con demanda real.
- **APU:** fase posterior. En v1 el presupuesto por partida se carga; el APU será su generador.
- **Remuneraciones completas (liquidaciones):** el módulo asistencia ya calcula; el ledger solo
  consume el costo. No se reconstruye payroll.
- **Árbol de centros de costo multinivel:** no existe. Contrato → Partida + dimensiones planas.

---

# Fases de implementación (para planificar en detalle tras aprobar este RFC)

- **F0 — Fundaciones:** tabla de hechos + RLS + config tenant (factor, corte) + emisores de compras
  (OC → comprometido, recepción → devengado, pago → pagado). Primer panel mínimo por contrato.
- **F1 — Mano de obra:** emisor desde asistencia (día-persona × costo-empresa), imputación por
  `contract_workers`; distribución opcional a partidas vía HH×OT cuando exista work-report.
- **F2 — Equipos e ingresos:** arriendos (comprometido + ciclos), mantenciones, consumo de pañol;
  ingresos desde estado-pago.
- **F3 — Presupuesto y resultado:** presupuesto de costo por partida (manual/Excel) + panel Resultado
  por Contrato completo (presupuesto vs comprometido vs devengado vs pagado, margen por partida).
- **F4 — Flujo y cierre:** flujo de caja proyectado + cierre mensual de período.
- **F5 — Inteligencia (futuro):** EVM (CPI/SPI/EAC por partida cruzando avance físico de control de
  obra), alertas de desviación temprana, proyecciones IA ("la partida 03.02 lleva CPI 0.82 tres
  semanas; el contrato cierra con margen −4%"). Aquí está la evolución más allá del ERP tradicional.

Cada fase entrega valor usable por sí sola y ninguna requiere la siguiente.

---

# Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Calidad de imputación (hechos sin contrato) | "Sin contrato" de primera clase + alerta + autocompletado desde `contract_workers` (patrón ya existente) |
| Doble conteo de materiales (compra + consumo) | Regla explícita OC-a-contrato vs consumo-de-pool; test de invariante |
| Asistencia y HH×OT no cuadran | Decidido: asistencia manda el monto; HH×OT solo distribuye. La diferencia se reporta, no se esconde |
| Rendimiento de agregación | Server-side desde el día 0 (vistas/RPC); jamás cargar el ledger al navegador |
| Retroactividad | Hechos inmutables + reversos + cierre de período |
| Datos históricos pre-ledger | Decisión pendiente (abajo) |

# Preguntas abiertas (para la sesión de planificación de F0)

1. **Backfill:** ¿el ledger parte de una fecha de corte (recomendado) o intentamos reconstruir
   hechos desde datos históricos (OC/recepciones/asistencia existentes)? Un backfill best-effort de
   OC y pagos es viable; asistencia histórica es más dudosa.
2. **Factor costo-empresa real:** ¿1.35 es razonable para tus contratos actuales o lo calibramos
   con el dato real de leyes sociales de un mes?
3. **Visibilidad de márgenes:** ¿qué roles ven utilidad? (propuesta: solo administrador/gerencia;
   supervisor ve costos de su contrato sin lado venta).
4. **Valor UF:** ¿fuente automática (API CMF/mindicador.cl vía cron existente) o carga manual mensual?
