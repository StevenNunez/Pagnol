# RFC-001 - Dominio Financiero de Pagnol

**Estado:** Investigación

**Prioridad:** Alta

**Autor:** Steven Nuñez

**Objetivo:** Investigación Arquitectónica

---

# Contexto

Pagnol ha evolucionado desde un sistema de control de bodega hasta una plataforma que actualmente administra gran parte de la operación de empresas contratistas de minería y construcción.

Actualmente existen módulos para:

- Abastecimiento
- Bodega
- Activos
- Personal
- Asistencia
- Contratos
- Proveedores
- Reportes
- Control de Obra
- IA
- Biometría
- Inventario
- Mantenciones
- entre otros.

La información operacional existe.

Sin embargo aún no existe un dominio capaz de transformar toda esa información en conocimiento financiero y gerencial.

---

# Problema

Hoy el sistema registra información.

Pero todavía no puede responder preguntas como:

- ¿Cuánto cuesta realmente ejecutar un contrato?
- ¿Cuál es la utilidad esperada?
- ¿Cuál es la utilidad proyectada?
- ¿Qué partida está perdiendo dinero?
- ¿Qué trabajador representa el mayor costo?
- ¿Cuál es el costo real de una cuadrilla?
- ¿Cuánto cuesta mantener un activo?
- ¿Qué proveedor genera mayor gasto?
- ¿Qué porcentaje del presupuesto ya está comprometido?
- ¿Qué gastos aún no han sido pagados?
- ¿Cuál será el flujo financiero esperado durante los próximos meses?
- ¿Cuál es la rentabilidad real por contrato?
- ¿Cuál es el costo por metro cuadrado ejecutado?
- ¿Cuál es el costo por actividad?
- ¿Cuál es el costo por orden de trabajo?
- ¿Cuál es el costo por centro de costo?

Actualmente esas respuestas no pueden obtenerse automáticamente.

---

# Objetivo

Diseñar el Dominio Financiero de Pagnol.

Este dominio deberá convertirse en el núcleo financiero-operacional del sistema.

No se busca construir simplemente un Centro de Costos.

Se busca diseñar la arquitectura que permita integrar:

- Presupuestos
- APU
- Costos reales
- Costos comprometidos
- Gastos
- Pagos
- Estados de Pago
- Rentabilidad
- Flujo financiero
- Indicadores
- Proyecciones
- Dashboards ejecutivos

Todo reutilizando la información operacional existente.

---

# Filosofía

La filosofía principal del proyecto es:

**Nunca duplicar información existente.**

Cada módulo debe seguir siendo dueño de sus propios datos.

Ejemplos:

Compras generan compras.

Inventario administra stock.

Asistencia administra horas trabajadas.

Control de Obra administra avance físico.

El Dominio Financiero debe consumir esa información.

No volver a capturarla.

---

# Ideas Iniciales

Actualmente se consideran algunas ideas.

Estas NO representan una decisión.

Simplemente son hipótesis.

## Centro de Costos

Posibilidad de controlar costos por:

- Empresa
- Cliente
- Contrato
- Frente
- Sector
- Partida
- Subpartida
- Actividad
- Trabajador
- Cuadrilla
- Activo
- Material
- EPP
- Herramienta
- Vehículo
- Orden de Trabajo

---

## Presupuesto

Cada contrato podría poseer un presupuesto propio.

Ese presupuesto podría dividirse por partidas.

---

## APU

Posibilidad de incorporar Análisis de Precio Unitario.

Los presupuestos podrían originarse desde APU.

---

## Estados de Pago

Los estados de pago podrían obtener información automáticamente desde las partidas ejecutadas.

---

## Costos

Todos los módulos existentes podrían generar costos automáticamente.

Ejemplos:

- Compras
- Inventario
- Activos
- Mantenciones
- Arriendos
- Personal
- Asistencia
- Subcontratos
- Combustible
- Herramientas

---

## Pagos

Actualmente aún no existe un dominio para administrar:

- Pago a proveedores
- Pago de remuneraciones
- Gastos generales
- Costos administrativos
- Costos indirectos
- Caja
- Bancos

No está definido si estos elementos deben pertenecer al mismo dominio o formar módulos independientes.

---

# Preguntas Abiertas

Esta sección es la más importante del documento.

No contiene respuestas.

Contiene problemas.

## Arquitectura

¿Debe existir un Motor de Costos?

¿O el sistema puede reutilizar completamente la arquitectura actual?

---

¿Debe existir un Centro de Costos?

¿O los contratos ya cumplen esa función?

---

¿Debe existir un Dominio Financiero?

¿O basta con extender módulos existentes?

---

¿Qué entidades actuales deberían reutilizarse?

---

¿Qué entidades nuevas serían realmente necesarias?

---

¿Cómo evitar duplicidad de información?

---

¿Qué riesgos tiene centralizar todos los costos?

---

## Presupuestos

¿Cómo deberían construirse?

¿Desde APU?

¿Manual?

¿Importación Excel?

¿Versionados?

---

¿Cómo manejar modificaciones presupuestarias?

---

## APU

¿Cómo deberían relacionarse con las partidas?

¿Con contratos?

¿Con plantillas reutilizables?

---

¿Cómo controlar versiones?

---

## Costos

¿Cuándo nace realmente un costo?

¿Cuándo un costo está comprometido?

¿Cuándo un costo pasa a ser costo real?

---

¿Cómo calcular depreciaciones?

---

¿Cómo calcular costos de activos compartidos?

---

¿Cómo distribuir costos indirectos?

---

¿Cómo distribuir gastos administrativos?

---

¿Cómo calcular costos de trabajadores que participan en varios contratos?

---

¿Cómo distribuir maquinaria utilizada en distintas obras?

---

## Estados de Pago

¿Deben depender del presupuesto?

¿Del avance físico?

¿De ambos?

---

¿Cómo controlar estados de pago extraordinarios?

---

## Pagos

¿Debe existir un módulo financiero completo?

¿O solamente registrar pagos?

---

¿Cómo relacionar pagos con órdenes de compra?

---

¿Cómo controlar cuentas por pagar?

---

¿Cómo controlar cuentas por cobrar?

---

¿Cómo controlar flujo de caja futuro?

---

## IA

¿Cómo podría utilizar la IA toda esta información?

¿Qué análisis podría entregar?

¿Qué alertas automáticas podrían existir?

¿Qué predicciones serían útiles?

---

# Desafío para Claude Code

Tu misión NO es implementar este módulo.

Tu misión es analizar completamente el proyecto existente.

Debes actuar como:

- Software Architect
- ERP Architect
- Financial Systems Architect
- Construction ERP Specialist

Analiza:

- Toda la arquitectura existente.
- El modelo de datos.
- Las migraciones.
- El CHANGELOG.
- El CLAUDE.md.
- Los módulos actuales.
- Las reglas de negocio existentes.

Luego responde las siguientes preguntas:

1. ¿Es correcta esta visión?
2. ¿Existe una mejor arquitectura?
3. ¿Qué estamos pasando por alto?
4. ¿Qué riesgos existen?
5. ¿Qué módulos faltan?
6. ¿Qué módulos sobran?
7. ¿Qué funcionalidades agregarías?
8. ¿Qué eliminarías?
9. ¿Qué reutilizarías?
10. ¿Cómo evolucionarías Pagnol durante los próximos cinco años?

No escribas código.

No propongas migraciones.

No diseñes interfaces.

No propongas tablas.

Primero comprende completamente el proyecto.

Después piensa.

Finalmente genera una propuesta arquitectónica completamente nueva si consideras que existe una mejor solución.

No tengas miedo de contradecir las ideas planteadas en este documento.

El objetivo de esta investigación no es validar ideas.

Es descubrir la mejor arquitectura posible para el futuro de Pagnol.