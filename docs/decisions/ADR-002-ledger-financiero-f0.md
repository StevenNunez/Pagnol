# ADR-002 — Ledger financiero F0: decisiones de implementación

**Fecha:** 2026-07-16
**Estado:** Aceptado
**Decisores:** Steven Nuñez (dispone) + Chief Software Architect IA (propone)
**Documentos relacionados:** RFC-002, RFC-002-F0-Plan, ADR-001 (Constitución, Arts. 2/3/5)

## Contexto

F0 materializa el núcleo del dominio Resultado por Contrato: tabla de hechos + emisores de
compras + panel. Durante la planificación y la implementación se tomaron decisiones que
condicionan todo el dominio y quedan registradas aquí.

## Decisiones

1. **Corte limpio** (Steven, 2026-07-16): el ledger parte vacío al activarse; sin backfill.
   Rechazado: reconstruir hechos históricos desde OC/pagos existentes — huecos (OC sin precio,
   recepciones sin valorizar) generarían desconfianza en el número desde el día uno.
2. **Toda OC nace valorizada + retroalimentación de precios** (Steven — superó las opciones
   propuestas): `generatePurchaseOrder` exige precios (precargados del catálogo, confirmados
   por el usuario) y las recepciones actualizan `materials.unit_cost` con el precio real.
   Compras es la fuente viva de precios. Rechazados: "OC sin monto no emite hecho + alerta"
   (dejaba hoyos permanentes) y "fallback silencioso a unitCost" (mezclaba estimado y real
   sin distinguirlos).
3. **Semántica de 'generated'**: la cotización valorizada emite *comprometido estimado* — el
   sistema ya la trataba como compromiso (página de costos) y no existe evento intermedio de
   confirmación en ese flujo. Si algún día se agrega (enviada→aceptada), el hecho se moverá a
   ese evento vía RFC.
4. **Convención de dinero**: el ledger guarda NETO CLP entero congelado; `supplier_payments.
   amount` se asume BRUTO IVA 19% y el emisor deriva el neto. Facturas exentas: cuando el
   documento tenga el dato (hoy no existe la columna).
5. **Visibilidad cerrada** (Steven): SELECT de `finance_entries` solo administrador/
   soporte-pagnol (helper `is_finance_viewer()`; NO se usó `is_tenant_admin()` porque incluye
   director-faena). Crítico porque los hechos de MO (F1) revelarán sueldos individuales.
6. **Reverso vía RPC SECURITY DEFINER** (`finance_reverse_source`): el usuario operativo puede
   provocar reversos (cancelar OC) sin poder leer el ledger. Idempotente (documento neteado en
   0 no emite nada). Rechazado: abrir SELECT a todo el tenant para reversar client-side.
7. **UF global escrita solo server-side** (Steven eligió cron automático): mindicador.cl
   diario + botón que RE-CONSULTA la fuente (nunca digitación) — un admin de un tenant no
   puede introducir un valor UF inventado que afecte a todos los tenants. Desviación
   consciente del plan original que proponía "carga manual del valor" como fallback.
8. **Emisores fallan en voz alta**: si el hecho no puede registrarse, la operación aborta —
   el hecho ES parte de la operación, no un log. Consecuencia operativa: la migración
   `20260722000000` debe aplicarse ANTES de usar compras con este código. Rechazado: degradar
   en silencio (drift invisible del ledger, lo contrario del Art. 3).
9. **Fixes de integridad aprovechando el paso** (registrados en CHANGELOG): soft-cancel de OC
   (antes DELETE) y reverso completo de stock al eliminar recepciones (antes quedaba inflado).

## Consecuencias

- Todo módulo futuro que genere costo/ingreso emite hechos vía `financeLedger.ts` en sus
  transiciones de estado; jamás escribe `finance_entries` a mano.
- Los dashboards financieros consumen RPCs de agregación; `finance_entries` nunca entra al
  DataProvider ni a Realtime.
- F1 (MO) hereda: factor costo-empresa (`tenants.labor_cost_factor`, ya en Configuración),
  la visibilidad cerrada y la convención de dinero.
