# ADR-001 — Manifiesto en tres capas (Constitución / Arquitectura / Rápida)

**Fecha:** 2026-07-15
**Estado:** Aceptado
**Decisores:** Steven Nuñez (dispone) + Claude  o otra IA o modelo , Chief Software Architect (propone)
**Documentos relacionados:** `docs/research/ARCHITECTURAL_MANIFESTO.md` (v2.0), RFC-001, RFC-002

## Contexto

El Manifiesto v1.0 declaraba toda decisión arquitectónica como temporal y exigía que cada
implementación dejara el sistema "más flexible, nunca más rígido", con cuestionamiento
arquitectónico por cada funcionalidad. El desafío deliberado del documento (solicitado por Steven)
encontró: (a) contradicción interna — "las reglas del negocio son permanentes" vs "cada cliente
aporta nuevas reglas"; (b) el principio de flexibilidad perpetua contradice las mejores decisiones
ya tomadas (RLS, ledgers que cuadran, hechos inmutables — todas rigideces deliberadas);
(c) ausencia total de: invariantes innegociables, disciplina de migración de datos, memoria de
decisiones y arbitraje.

## Decisión

Reescribir el manifiesto como v2.0 con tres capas clasificadas por el test "¿quién sufre si
esto cambia?":

1. **Constitución** (5 artículos: aislamiento de tenants, hechos inmutables, ledgers cuadran,
   biometría en dispositivo, todo hecho tiene autor). Enmienda solo con dos firmas: decisión de
   Steven + justificación técnica documentada de la IA.
2. **Arquitectura y dominios** — cambia vía RFC con tres peajes: carga de la prueba proporcional
   a datos/usuarios en producción, camino de migración de datos, y ADR. Incluye decisiones
   estratégicas ("Pagnol no es contabilidad general").
3. **Capa rápida** — módulos/UI/reglas siguen convenciones sin cuestionarlas; lo que no cabe
   dispara un RFC.

El mecanismo de conexión es el "ascensor del descubrimiento": todo entra por Capa 3 y asciende
cuando la realidad lo revela repetido (patrón→arquitectura, invariante universal→constitución).

## Alternativas rechazadas

- **Mantener v1.0 (flexibilidad total):** rechazada — sin invariantes protegidos, "todo puede
  cambiar cuando el negocio lo justifique" permite accidentalmente cuestionar el aislamiento
  multi-tenant; y el cuestionamiento por-feature produce fatiga de decisión y pérdida de las
  convenciones que hacen mantenible el sistema.
- **Constitución inmutable sin proceso de enmienda:** rechazada por Steven — se optó por enmienda
  de dos firmas (fundador + justificación técnica de la IA) en vez de inmutabilidad absoluta.
- **"No contabilidad general" como artículo constitucional:** rechazada — es estrategia de
  producto revisable a futuro, no protección al cliente/ley/confianza. Queda en Capa 2.
- **RFC + CHANGELOG sin ADRs:** opción quedó sin respuesta explícita de Steven; se adoptó el
  registro ADR ligero (recomendado) por ser reversible y de bajo costo. Si estorba, se elimina.

## Consecuencias

- Todo RFC futuro debe declarar en qué capa opera y pagar los peajes de esa capa.
- Los RFC que contradigan un ADR deben citarlo y refutarlo, nunca ignorarlo.
- Todo cambio arquitectónico aceptado debe finalizar con la creación o actualización de un ADR. La IA asistirá en su redacción, pero el registro pertenece al proyecto, no al modelo utilizado.
- El dominio financiero (RFC-002) queda regido por los Artículos 2, 3 y 5 desde su diseño.
