# ADR-007 — F4.2: flujo de caja proyectado (obligaciones en el ledger)

**Fecha:** 2026-07-28
**Estado:** Aceptado
**Decisores:** Steven Nuñez (dispone) + Chief Software Architect IA (propone)
**Documentos relacionados:** RFC-002 §"Flujo de caja proyectado", RFC-002-F4-Plan, ADR-002…006

## Contexto

El panel de Resultado responde *"¿cuánto gané?"*. Falta la pregunta que sigue y que decide
si la empresa sobrevive el mes: *"¿me alcanza la plata, y cuándo?"*.

El RFC-002 asumía que el flujo era "una consulta sobre el ledger". No lo era:
`finance_entries` no guardaba vencimientos, y las obligaciones que importan —una factura
recibida y no pagada— **no existían en el ledger** (`addSupplierPayment` creaba la factura
`pending` sin emitir ningún hecho; solo emitía al pagarse).

## El descarte que cambió el diseño

La primera propuesta (RFC-002-F4-Plan) era que la factura **reemplazara** el devengo de la
recepción: reversarlo y re-emitirlo con el monto real y su vencimiento. Se descartó al
mirar los datos reales:

- `purchase_order_id` es **opcional**: una factura sin OC no tiene qué reversar.
- Una OC puede recibir **varias facturas parciales**; reversar "el devengo de la OC" en la
  primera dejaba el costo subestimado hasta que llegara la segunda, y para siempre si
  nunca llegaba. Exigía prorrateo, que es delicado y silencioso cuando falla.

El problema de fondo era conceptual: **el ledger registra costos; el flujo necesita
obligaciones**. Una factura pendiente no vuelve a costear lo que la recepción ya devengó —
es una deuda con vencimiento. Son dimensiones distintas, y por eso `due_date` no encajaba
natural en el hecho de costo.

## Decisiones

1. **`nature` gana `payable` y `receivable`** (Steven). El ledger ya distinguía dimensiones
   con `nature`; la obligación entra como una propia. No duplica el resultado porque los
   paneles filtran por naturaleza, y soporta facturas parciales o sin OC sin prorrateo.
2. **Convención de monto invertida, a propósito:** `cost`/`income` en **NETO** (miden
   resultado); `payable`/`receivable` en **BRUTO** (miden caja: lo que sale del banco).
   Es el error más fácil de cometer en este módulo — está anotado en la migración, en el
   tipo `FinanceNature` y en el pie de la página.
3. **La obligación se apaga por REVERSO, nunca por UPDATE** (Art. 2): al pagar, eliminar o
   anular. Se re-emite al repactar monto o vencimiento, y **revive** si se des-marca un
   pago. `source_type` propio (`supplier_invoice`, `rental_installment`,
   `payment_state_receivable`) para que reversar la obligación no toque el hecho de costo.
4. **Los EP por cobrar entran sin `due_date`.** El EP no captura fecha de cobro
   comprometida, y estimarla (30 días) sería inventar un dato que nadie pactó. La página
   los muestra en un bloque "sin fecha comprometida" en vez de ocultarlos: esconderlos
   daría un flujo optimista.
5. **El saldo acumulado parte de cero.** Proyecta el movimiento del período, no el saldo
   bancario: Pagnol no lleva tesorería (RFC-002 §"Qué NO se construye").

## Dos bugs que el E2E destapó

**1. `finance_reverse_source` perdía el vencimiento** (migración `20260726010000`). Se
escribió en F0, antes de que `due_date` existiera, así que los reversos nacían con esa
columna en NULL y **no neteaban con su original** al agrupar por vencimiento. El neto
global siempre estuvo bien —por eso ninguna suma lo delataba—, pero el error era de
AGRUPACIÓN, que es de lo que vive un flujo de caja: se habrían mostrado **pagos que ya no
existen**, y una obligación repactada habría aparecido dos veces inflando el total por
pagar. `entry_date` sigue siendo `CURRENT_DATE` (la corrección ocurre hoy y así nunca choca
con un período cerrado — F4.1), pero `due_date` se **copia** del hecho reversado.

**2. El panel principal habría duplicado el margen.** Clasificaba con
`if (income) … else → costo`; ese `else` habría sumado las facturas pendientes como costo.
Se cambió a clasificación explícita por naturaleza **antes** de tocar el modelo.

## Consecuencias

- El ledger deja de ser solo de resultado: convive con la dimensión de caja. Todo consumidor
  nuevo **debe filtrar por `nature` explícitamente** — un `else` genérico ahora es un bug.
- Deuda consciente: sin fecha de cobro comprometida en los EP, el lado de ingresos del
  calendario queda incompleto. Si los mandantes pactan plazo, agregar el campo al EP.
- El costo de mano de obra sigue fuera del flujo hasta F4.3 (pago de remuneraciones), que
  es la mayor salida de caja de una faena.
