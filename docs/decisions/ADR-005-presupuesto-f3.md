# ADR-005 — F3: presupuesto de costo por contrato

**Fecha:** 2026-07-16
**Estado:** Aceptado
**Decisores:** Steven Nuñez (dispone) + Chief Software Architect IA (propone)
**Documentos relacionados:** RFC-002, RFC-002-F3-Plan, ADR-002/003/004

## Contexto

El panel de Finanzas ya muestra costos (F0-F2) e ingresos/margen (F2), pero sin
referencia: no dice si un contrato va bien o mal. F3 agrega el presupuesto de COSTO.
En el sistema ya existían dos "presupuestos" que NO son este: `CostCenter.budget`
(compras por centro administrativo — queda como está, RFC-002) y
`WorkItem.unitPrice×quantity` (presupuesto de VENTA al mandante).

## Decisiones

1. **Granularidad de captura: contrato × categoría** (Steven). Los hechos del ledger
   llevan contrato y categoría pero NO partida (eso llega cuando work-reports
   distribuya HH×OT): capturar por partida hoy sería detalle incontrastable.
   La entidad deja `work_item_id` nullable para esa evolución (F5/EVM).
2. **Solo CLP en v1** (Steven). Sin moneda origen ni tasa en las líneas de
   presupuesto; UF se agrega si duele (los HECHOS sí siguen guardando UF, ADR-002).
3. **Versionado = append-only** (mismo ADN del ledger, Art. 2): la tabla
   `finance_budget_entries` solo INSERTa. Línea inicial + modificaciones
   (aumentos/rebajas con MOTIVO obligatorio y autor); presupuesto vigente = SUM.
   El historial de modificaciones presupuestarias —la pregunta original de
   RFC-001— sale gratis.
4. **El presupuesto NO es un hecho económico**: tabla propia, jamás entra a
   `finance_entries` (comprometido/devengado/pagado registran realidad; el
   presupuesto es intención).
5. **Visibilidad**: SELECT e INSERT solo para visores financieros
   (`is_finance_viewer()` — el presupuesto revela estructura de costos); en el
   cliente, editar exige `finance:manage` (permiso ya existente de F0).
6. **Convenciones del panel**: disponible = presupuesto − comprometido;
   % ejecución = devengado / presupuesto. La comparación vive en
   `/dashboard/finanzas/presupuesto` (el panel principal conserva su foco en
   margen y enlaza allí).
7. **Carga**: manual (diálogo) + importación Excel/CSV (papaparse, patrón
   existente) con columnas Contrato | Categoría | Monto | Motivo.

## Consecuencias

- El panel puede responder "¿cómo vamos contra el plan?" por contrato y categoría,
  la mitad que faltaba de "presupuesto vs real" del RFC-001.
- Deuda consciente: presupuesto por partida y su comparación (requiere hechos con
  `work_item_id`); APU como generador (fase posterior, RFC-002).

---

## Addendum 2026-07-28 — corrección de las decisiones 5 y 6

**Origen:** el E2E de F3 (pendiente desde el cierre de la fase; F3 fue la única
fase que se commiteó antes de verificarse). Migración `20260724000000`.

### Qué estaba mal en la decisión 6

`disponible = presupuesto − comprometido` asumía que **todo costo pasa por
COMPROMETIDO antes de DEVENGADO**. Es falso, y el propio sistema lo desmiente:

| Cadena | committed | accrued |
|---|---|---|
| `purchase_order` → `goods_receipt` | ✅ | ✅ |
| `rental_contract` → `rental_payment` | ✅ | ✅ |
| `labor_day` (MO, ADR-003) | ❌ | ✅ |
| `material_request` / `stock_transfer` (consumo de pañol, ADR-004) | ❌ | ✅ |

La mano de obra **nace devengada**: el trabajador trabajó, no hay OC que
comprometer. Resultado en producción: el mayor costo de una faena era invisible
para el control presupuestario, y la misma fila mostraba *"49% ejecutado"* junto
a *"disponible: el 100% del presupuesto"*. Medido en DEMO: sobreestimación de
$108.000 sobre un presupuesto de $220.000 de MO.

**Nueva convención:**

```
consumido  = comprometido + devengado de fuentes sin compromiso previo
disponible = presupuesto − consumido
```

La tabla gana una columna **Consumido**, y el badge "sobre-comprometido" pasa a
evaluarse contra ella. `% ejecución = devengado / presupuesto` no cambia.

**Dónde vive la regla:** en `financeMath.budgetConsumption()` — TypeScript puro y
testeado (8 tests), no en SQL. El RPC `finance_contract_summary` solo agrega: se
le agregó `source_type` al `GROUP BY` para que el dominio pueda decidir. La lista
`UNCOMMITTED_SOURCES` es el punto único de verdad: **al escribir un emisor nuevo
hay que decidir si entra ahí**.

Se descartó `max(comprometido, devengado)` (más simple, sin migración) porque
subestima cuando una categoría mezcla orígenes — p.ej. `materials` con una OC
pendiente de $1.000.000 más consumo de pañol por $500.000 da $1.000.000 en vez
de $1.500.000. Hay un test que fija justamente ese caso.

### Qué estaba mal en la decisión 5

El gate de escritura estaba desalineado: la mutación exige `finance:manage` pero
la RLS exigía `is_finance_viewer()` (rol `administrador`/`soporte-pagnol`).
Otorgar el permiso granular a otro rol pasaba el guard del cliente y lo rechazaba
la base. Fallaba ruidosamente —no en silencio—, pero el permiso era decorativo.

Nuevo helper `public.can_manage_finance()`, que replica la cadena real de `can()`:
super-admin → bypass admin/soporte → `profiles.granted_permissions` → fila de rol
por tenant. **Nota de mantenimiento:** `finance:manage` hoy no está en ningún
`ROLES_DEFAULT`; si algún día se agrega a un rol por defecto, el helper debe
seguirlo (en SQL no se puede leer `permissions.ts`).

#### Lo que faltaba: el dominio financiero estaba cerrado por ROL, no por permiso

Verificar el arreglo anterior mostró que no alcanzaba (migración `20260724010000`):

```
can_manage_finance()  = true
INSERT sin RETURNING  = ✅   la escritura ya estaba bien
INSERT ... RETURNING  = ❌   addBudgetEntry hace .insert().select()
SELECT                = 0 filas
```

Leer seguía exigiendo `is_finance_viewer()`, que solo mira el rol. Es decir: **los
permisos `module_finance:view` y `finance:manage` eran decorativos en la base**
aunque el cliente los evaluara — otorgarlos no habilitaba nada, y un usuario con
`finance:manage` habría visto la página de presupuesto con toda la ejecución en
cero (el RPC del ledger también respeta esa política).

`is_finance_viewer()` pasa a reconocer `module_finance:view` con la misma cadena
que `can()`. Se **amplía, nunca se restringe**: los tres roles que ya pasaban
siguen pasando. Al vivir en una sola función, alinea de una vez el ledger y el
presupuesto sin tocar sus políticas. Y la política de SELECT del presupuesto
admite además `can_manage_finance()`: administrar ⊃ ver, y exigir los dos permisos
juntos sería un acoplamiento que nadie recordaría al asignar un rol.

**Consecuencia deliberada:** el acceso a Finanzas ya no es exclusivo de
administrador/soporte-pagnol. Otorgar `module_finance:view` a un rol ahora
**sí** abre el margen y la estructura de costos — que es lo que el permiso decía
hacer desde F0, pero no hacía.
