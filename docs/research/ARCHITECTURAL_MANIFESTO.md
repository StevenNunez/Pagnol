# Architectural Manifesto
## La filosofía de evolución de Pagnol

**Versión:** 2.0

**Estado:** Activo

**Autores:** Steven Nuñez + Claude (Chief Software Architect)

**Historia:** la v1.0 (Steven, 2026-07-15) planteó la filosofía evolutiva. La v2.0 (mismo día)
nace de su desafío deliberado: conserva el espíritu y le agrega lo que le faltaba — la distinción
entre lo que nunca cambia, lo que cambia lento y lo que cambia rápido. Las razones de cada cambio
están registradas en `docs/decisions/ADR-001-manifiesto-tres-capas.md`.

---

# Antes de continuar...

Este documento NO define la arquitectura de Pagnol.

Define cómo debe evolucionar su arquitectura.

Y define, por primera vez, qué partes no evolucionan jamás.

La diferencia es fundamental.

---

# Qué es Pagnol

Pagnol NO es un software terminado.

Pagnol es una plataforma en evolución.

Cada módulo existente nació porque apareció un problema real durante la operación de empresas
contratistas. Ningún módulo fue creado porque "un ERP debería tenerlo".

Pagnol no está siendo desarrollado.

**Pagnol está siendo descubierto.**

Cada nuevo cliente aporta reglas. Cada contrato descubre necesidades. Cada módulo cambia la
comprensión del sistema completo. Asumir que hoy conocemos la arquitectura definitiva sería un error.

Pero el descubrimiento sin estructura es turbulencia. Este manifiesto le da al descubrimiento
su estructura: **las tres capas y el ascensor entre ellas.**

---

# El test que decide todo

Ante cualquier elemento del sistema, una sola pregunta lo clasifica:

> **¿Quién sufre si esto cambia?**

- El **cliente, la ley o la confianza** → Capa 1: Constitución. Ningún negocio lo justifica.
- El **sistema y quienes lo construyen** (coherencia, deuda, re-aprendizaje) → Capa 2: Arquitectura.
  Cambia lento, con proceso.
- Solo hay **retrabajo local** → Capa 3: cambia rápido, sin pedir permiso.

---

# CAPA 1 — La Constitución

Cinco artículos. Ninguno fue inventado: cada uno fue **descubierto**, apareciendo repetidamente
en el sistema hasta revelarse como innegociable.

**Artículo 1 — Aislamiento absoluto entre tenants.**
Ningún dato de una empresa es visible para otra, jamás, bajo ninguna funcionalidad futura.
(Encarnado hoy: RLS en cada tabla; el cliente admin solo existe server-side.)

**Artículo 2 — Los hechos registrados son inmutables.**
Lo que ocurrió, ocurrió: kardex, asistencia, firmas, hechos financieros. Las correcciones son
hechos nuevos de reverso; nunca ediciones ni borrados.
(Descubierto tres veces: snapshots de work-reports, kardex, ledger financiero de RFC-002.)

**Artículo 3 — Los ledgers cuadran.**
Todo total es igual a la suma verificable de sus partes, en todo momento.
(Encarnado hoy: `sum(material_stocks.qty) == materials.stock`.)

**Artículo 4 — La biometría no sale del dispositivo.**
Solo descriptores matemáticos, nunca imágenes; el procesamiento ocurre en el navegador del usuario.

**Artículo 5 — Todo hecho tiene autor.**
Quién y cuándo, en cada registro, sin excepciones.

## Enmiendas

La Constitución puede enmendarse solo con **dos firmas**: la decisión explícita de Steven **y**
una justificación técnica documentada de la IA que confronte el artículo original y sus razones.
Ninguna de las dos partes puede enmendar sola. Una funcionalidad que exige violar un artículo
no es una funcionalidad: es una propuesta de enmienda, y se discute como tal.

---

# CAPA 2 — Arquitectura y dominios

Aquí vive lo que da coherencia: los **límites de dominio** (qué módulo es dueño de qué dato),
el **esquema de datos**, los **patrones estructurales** (mutaciones con `Context`, mappers,
colecciones del DataProvider, emisores→ledger, agregación server-side para dominios de hechos),
el **mecanismo** de permisos, el **design system** como sistema, y el **stack**.

Esta capa cambia más lento que las reglas de negocio. Ese es su trabajo: ser el marco estable
que permite que lo volátil cambie barato.

## Protocolo de cambio: el RFC y sus tres peajes

Todo cambio de Capa 2 nace de un RFC, y el RFC paga tres peajes:

**1. Carga de la prueba proporcional.**
Reemplazar arquitectura que carga datos y usuarios reales exige demostrar que la alternativa es
mejor *incluyendo el costo de migración* — no mejor en terreno virgen. Mientras más produce una
pieza, más evidencia exige su reemplazo.

**2. Los datos sobreviven al código.**
Ningún dominio "desaparece": se migra. Toda evolución incluye el camino de migración de los datos
ya capturados. El esquema es 10 veces más permanente que el código, y se trata como tal.

**3. Memoria de decisión.**
Qué se decidió, por qué, y qué alternativas se rechazaron, registrado en `docs/decisions/` (ADR).
Nadie derriba una cerca sin poder explicar por qué se construyó — y nadie re-argumenta un debate
ya zanjado sin traer evidencia nueva. Reversible, sí. Amnésico, no.

## Decisiones estratégicas vigentes (Capa 2, revisables solo por RFC)

- **Pagnol no es contabilidad general.** Es control de gestión de obra. Registra pagos y exporta
  hacia el sistema contable del cliente; no compite con él. (Contexto: RFC-002.)
- **La dimensión de costo vertebral es el contrato**, no un árbol de centros de costo multinivel.
- **Cada módulo es dueño de su captura**; los dominios transversales materializan hechos, no
  duplican capturas.

---

# CAPA 3 — Lo que cambia rápido

Páginas y UI, workflows, reglas de negocio por tenant, permisos concretos, reportes, campos
aditivos, flows de IA, integraciones, y módulos nuevos que siguen las recetas existentes.

Aquí entra **todo problema nuevo de un cliente**. Siempre. Barato, rápido, reversible.

Una sola obligación: **seguir las convenciones de la Capa 2 sin cuestionarlas.** El camino por
defecto no pregunta nada — esa es su velocidad. Y si una funcionalidad genuinamente no cabe en
las convenciones, eso no autoriza a improvisar: **dispara un RFC.** Ahí, y solo ahí, se cuestiona
la arquitectura.

La versión 1.0 decía "toda nueva funcionalidad debe cuestionar la arquitectura". La corrección:
cuestionar todo siempre equivale a no cuestionar nada bien. El cuestionamiento es un acto
deliberado a nivel RFC, no un peaje por feature.

---

# El ascensor del descubrimiento

Esta es la idea central de la v1.0, ahora con estructura. Las cosas no se clasifican por decreto:
**ascienden de capa cuando la realidad las revela.**

- Un problema real entra por la **Capa 3** (un módulo, una regla, una página). Así nacieron todos
  los módulos de Pagnol y así seguirá siendo.
- Cuando un patrón se repite — tercera vez que módulos distintos necesitan lo mismo — se descubre
  que era **arquitectura**: se promueve a Capa 2 vía RFC. (Así bodega reveló el dominio de stock
  por contrato.)
- Cuando un invariante aparece en todos los dominios — "esto jamás debe poder violarse" — se
  descubre que era **constitucional**. (Así la inmutabilidad de hechos apareció en work-reports,
  luego en kardex, luego en finanzas: tres apariciones, un principio.)

El ascensor también baja: un módulo sin uso se degrada y muere — con la migración de sus datos.
La Constitución es el único piso sin ascensor de bajada.

---

# Flexibilidad y rigidez

La versión 1.0 exigía que toda implementación dejara el sistema "más flexible, nunca más rígido".
La corrección: **flexible en los bordes, rígido en el núcleo.**

Las mejores decisiones de Pagnol son rigideces deliberadas: el RLS, los ledgers que cuadran, los
hechos inmutables. Un sistema donde todo es flexible es un sistema donde nada es confiable.
La flexibilidad no usada no es una virtud: es complejidad que se paga todos los días.

La coherencia ES restricción. Cuando flexibilidad y coherencia compitan: en la Capa 3 gana la
flexibilidad; en las Capas 1 y 2 gana la coherencia.

---

# El rol de la IA

La IA es el Chief Software Architect del proyecto. Su responsabilidad principal no es escribir
código: es **proteger la capacidad de evolución del sistema** — lo que incluye proteger sus
rigideces constitucionales.

Puede cuestionar cualquier decisión, proponer cambios radicales, recomendar eliminar módulos,
contradecir RFC anteriores y contradecir este mismo documento — siempre con justificación técnica
y funcional, y pagando los peajes de la capa correspondiente.

Tiene dos modos de falla simétricos, y ambos están prohibidos:

- **Complacencia**: validar ideas porque son del fundador. El objetivo nunca es confirmar ideas,
  es mejorarlas.
- **Sesgo de novedad**: proponer reescrituras perpetuas porque la IA no siente el dolor de la
  migración. "Mejor" significa mejor incluyendo el costo de cambiar.

**La IA propone. Steven dispone.** El dueño económico del riesgo desempata, siempre.

---

# Sobre los RFC y los ADR

Los RFC no son decisiones: son el mejor conocimiento disponible en su momento. Pueden modificarse,
reemplazarse o descartarse si aparece mejor comprensión del negocio.

Los ADR (`docs/decisions/`) son lo contrario: el registro de lo que SÍ se decidió, por qué, y qué
se rechazó. Los RFC proponen; los ADR recuerdan. Un RFC que contradice un ADR debe citarlo y
refutarlo — nunca ignorarlo.

---

# Las preguntas permanentes

Al analizar toda iniciativa de nivel RFC (no cada feature de Capa 3), responder antes de hablar
de código:

1. ¿Qué problema de negocio estamos resolviendo realmente?
2. ¿Existe un problema más grande detrás de esta solicitud?
3. ¿En qué capa vive esto — y estamos creando un módulo cuando en realidad estamos descubriendo un dominio?
4. ¿Qué artículos constitucionales o decisiones estratégicas se ven tocados?
5. ¿Qué pasará con esta decisión con 10× más clientes, 10× más módulos, 10× más datos?
6. ¿Cuál es el camino de migración de los datos ya capturados?
7. ¿Qué alternativas existen y por qué se rechazan? (Esto se convierte en el ADR.)
8. ¿Qué riesgos trae este camino y qué oportunidades abre cambiar el enfoque?
9. ¿La arquitectura que se resiste está equivocada — o nos está avisando algo? (La resistencia es información, no culpabilidad.)
10. ¿Qué haría el arquitecto responsable de Pagnol durante los próximos diez años?

No responder rápido. Primero comprender el problema. Después cuestionar el problema.
Finalmente proponer una dirección.

---

# Definición de éxito

El éxito NO consiste en terminar el ERP.

Consiste en construir una plataforma capaz de evolucionar continuamente sin perder coherencia
ni violar su Constitución.

Si en cinco años: la arquitectura sigue incorporando ideas nuevas sin grandes reescrituras,
los cinco artículos siguen intactos, y las decisiones viejas pueden explicarse leyendo
`docs/decisions/` — entonces habremos tomado las decisiones correctas.

Y si este manifiesto mismo necesita una v3.0, eso no será una falla.

Será el ascensor funcionando.
