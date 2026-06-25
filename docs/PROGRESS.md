# Progreso

Última revisión documental: 2026-06-24.

## Estado actual

El proyecto tiene un flujo completo de pago implementado y cubierto con tests. Las cuatro tareas P0 de seguridad (T-001 a T-004) y la suite de pruebas automatizadas (T-005) están completadas. La siguiente tarea accionable es T-006 (migración SQL de Supabase).

- **Backend**: Node.js + CommonJS + Express 5. Mercado Pago Checkout Pro. Supabase con `service_role`.
- **Tests**: Jest instalado. `npm test` pasa con 11 tests.
- **Seguridad implementada**: validación de firma webhook (DEC-009), transición atómica (DEC-010), validación de variables al iniciar.
- **Pendiente más urgente**: T-006 — crear `supabase/migrations/001_create_orders.sql` (DEC-012 aceptada, sin bloqueo).

Ver resumen compacto para agentes en `docs/CURRENT_CONTEXT.md`.

## Avances detectados

**Base original:**
- Servidor Express y frontend estático implementados.
- Pedido `pending` asociado mediante `external_reference`.
- Preferencia con webhook y tres URLs de retorno.
- Confirmación del pago mediante consulta a la API oficial.
- Validación básica de pedido existente, duplicado e importe.
- `.env` ignorado y `.env.example` disponible como contrato.

**Implementado en sesión 2026-06-24:**
- T-001: validación HMAC-SHA256 de firma webhook con HTTP 401 para firma ausente o inválida.
- T-002: creación de preferencia detenida si Supabase falla.
- T-003: transición `pending → paid` atómica e idempotente.
- T-004: validación de variables de entorno obligatorias al arrancar.
- T-005: suite Jest con 11 tests; `npm test` pasa sin llamadas externas.
- T-006: migración SQL manual versionada para `orders`, con restricciones, índices y RLS habilitada.
- Documentación completa: TASKS.md (T-001 a T-014), DECISIONS.md (DEC-009 a DEC-017), CURRENT_CONTEXT.md.

## Problemas resueltos documentados

- Uso de variables de entorno para credenciales.
- URL pública de desarrollo mediante ngrok.
- Separación entre páginas de retorno y confirmación autoritativa.
- Asociación de pagos y pedidos mediante referencia externa.
- Consulta a Mercado Pago en lugar de confiar únicamente en el webhook.
- Tratamiento básico de notificaciones duplicadas y montos diferentes.

## Pendientes principales

- Definir una estrategia monetaria segura (T-007, requiere DEC-011).
- Reducir logs sensibles y retirar diagnóstico temporal de producción (T-010, T-011).
- Definir catálogo, autenticación y requisitos comerciales (T-012).
- Seleccionar y documentar un despliegue de producción (T-013).

El detalle verificable está en `docs/TASKS.md`.

## Próxima acción recomendada

**Fase P0 + P1 inicial cerrada.** T-001 a T-006 completadas y commiteadas.

Opciones para continuar:

**A — Modo aprendizaje** (recomendado antes de la próxima fase): pedir explicación conceptual de HMAC-SHA256, transición atómica, Jest mocks y RLS.

**B — Próxima fase técnica**: confirmar DEC-011 (estrategia de importes sin punto flotante) para desbloquear T-007. Sin esa decisión, T-007 no puede implementarse. Las tareas T-008, T-009, T-011 y T-014 no tienen bloqueos y pueden abordarse en cualquier orden.

## Bitácora

### 2026-06-24 — T-006 completada

- Se creó `supabase/migrations/001_create_orders.sql` con DDL de `public.orders`, restricciones `status in ('pending', 'paid')` y `amount > 0`, índices para `status` y `mercadopago_payment_id`, y RLS habilitada.
- No se crearon policies para `anon` ni `authenticated`; el archivo documenta que `SUPABASE_SERVICE_ROLE_KEY` debe permanecer solo en backend.
- La migración no fue aplicada en ninguna base de datos. El usuario debe revisarla y aplicarla manualmente cuando corresponda.
- Verificación: `git diff --check`.

### 2026-06-24 — Cierre de fase P0 + P1 inicial

- T-001 a T-006 completadas y commiteadas. La primera fase de seguridad, calidad y versionado está cerrada.
- Estado técnico final: validación HMAC-SHA256, transición atómica, tests Jest (11 tests), migración SQL versionada, variables de entorno validadas.
- `docs/CURRENT_CONTEXT.md` actualizado como resumen compacto de cierre.
- Próxima fase sugerida: modo aprendizaje → definir DEC-011 → implementar T-007 (estrategia monetaria).

### 2026-06-24 — Contexto estable consolidado

- Se creó `docs/CURRENT_CONTEXT.md` como resumen compacto para agentes: metodología, estado de tareas, decisiones aceptadas, estado técnico y próximo paso.
- Se actualizaron "Estado actual" y "Avances detectados" en este archivo para reflejar el estado real post T-001 a T-005.

### 2026-06-24 — DEC-012 aceptada

- Estrategia elegida: SQL manual versionado en `supabase/migrations/`, sin Supabase CLI.
- El usuario aplicará el archivo manualmente; Codex no ejecuta comandos de base de datos.
- T-006 queda desbloqueada.

### 2026-06-24 — T-006 alcance definido

- Se documentó el esquema real de `orders` (fuente: README.md), las restricciones a agregar (CHECK status, CHECK amount > 0), los índices recomendados (status, mercadopago_payment_id), la estrategia RLS mínima y las reglas de versionado SQL.
- Se identificó que DEC-012 ya existe en `docs/DECISIONS.md` como decisión pendiente sobre estrategia de versionado; no fue necesario crear DEC-011 (ya ocupada por importes/redondeo).
- Pendiente: el usuario debe confirmar DEC-012 antes de que Codex implemente.

### 2026-06-24 — T-005 completada

- Se agregó Jest como dependencia de desarrollo y el comando reproducible `npm test`.
- Se creó `tests/index.test.js` con mocks de Express, Mercado Pago, Supabase y dotenv para evitar llamadas reales y acceso a `.env`.
- Casos cubiertos: configuración obligatoria, fallo de Supabase antes de crear preferencia, firma ausente, firma inválida, firma válida, pago aprobado con importe correcto e incorrecto, pago no aprobado, pedido inexistente, pedido ya pagado, webhooks concurrentes y transición atómica.
- Verificación: `npm test`, `node --check index.js` y `git diff --check`.

### 2026-06-24 — T-005 alcance definido

- Se definieron los 13 casos de prueba (TC-01 a TC-13), el framework recomendado (Jest, con `node:test` como alternativa sin dependencias), los archivos involucrados, los criterios de aceptación y qué no testear todavía.
- Pendiente: el usuario debe confirmar el framework y autorizar la modificación de `package.json` antes de que Codex implemente.

### 2026-06-24 — T-003 completada

- La transición `pending` → `paid` ahora usa una actualización condicional por referencia y estado; cero filas actualizadas se trata como webhook duplicado idempotente.
- Se preservan los controles de pedido inexistente, pago aprobado e importe coincidente, con logs genéricos en este flujo.
- Verificación: sintaxis correcta y pruebas aisladas de pedido inexistente, ya pagado, importe distinto, pago no aprobado, transición exitosa y dos webhooks concurrentes con una sola actualización efectiva.

### 2026-06-24 — DEC-010 aceptada

- Se definió la estrategia de transición atómica `pending` → `paid`: actualización condicional desde el backend con Supabase, idempotencia por estado, manejo de pedido inexistente, importe diferente y pago no aprobado.
- DEC-010 quedó aceptada y T-003 está desbloqueada para su implementación.

### 2026-06-24 — T-001 completada

- Se implementó la validación oficial HMAC-SHA256 de Mercado Pago antes de procesar el webhook, usando `x-signature`, `x-request-id`, `data.id` y `MERCADO_PAGO_WEBHOOK_SECRET` según DEC-009.
- Las firmas ausentes o inválidas reciben HTTP `401` con una respuesta genérica y únicamente los logs autorizados; una firma válida conserva el flujo existente.
- Verificación: sintaxis correcta y pruebas aisladas de firma ausente, inválida y válida, sin cargar `.env`, realizar llamadas externas ni mostrar datos sensibles.

### 2026-06-24 — DEC-009 definida

- Se definieron la variable `MERCADO_PAGO_WEBHOOK_SECRET`, la respuesta HTTP `401` con mensaje genérico y las restricciones de exposición y logs para firmas ausentes o inválidas.
- DEC-009 quedó definida y T-001 está desbloqueada para su planificación e implementación.

### 2026-06-24 — T-004 completada

- El inicio valida las cuatro variables obligatorias antes de crear clientes externos o aceptar tráfico; los valores ausentes o vacíos detienen el proceso mostrando solo sus nombres.
- Archivos modificados: `index.js`, `docs/TASKS.md` y `docs/PROGRESS.md`.
- Verificación: sintaxis correcta y pruebas aisladas de variable ausente, vacía y configuración completa, sin cargar `.env` ni realizar llamadas externas.

### 2026-06-24 — T-002 completada

- Se detiene `POST /crear-preferencia` si Supabase no puede crear el pedido `pending`; el cliente recibe un error HTTP genérico y Mercado Pago no es llamado.
- Archivos modificados: `index.js`, `docs/TASKS.md` y `docs/PROGRESS.md`.
- Verificación: sintaxis de Node.js y pruebas aisladas en memoria de los flujos fallido y exitoso; sin llamadas externas ni acceso a secretos.

### 2026-06-24 — Enriquecimiento de documentación para Codex

- Objetivo: completar el formato de tareas, formalizar decisiones pendientes y actualizar la bitácora.
- Tipo de sesión: revisión documental y edición de Markdown. Sin ejecución de código, instalación de dependencias ni acceso a secretos.
- Archivos revisados: `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/REQUIREMENTS.md`, `docs/DESIGN.md`, `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/DECISIONS.md`, `docs/SKILLS.md`, `docs/SECURITY.md`.
- Archivos modificados: `docs/TASKS.md`, `docs/DECISIONS.md`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `docs/TASKS.md`: cada tarea (T-001 a T-014) recibió los campos `Estado`, `Prioridad`, `Archivos involucrados`, `Instrucciones para Codex`, `Riesgos` y `Resultado esperado`. Los criterios de aceptación existentes se conservaron sin modificación.
  - `docs/DECISIONS.md`: la lista libre "Decisiones pendientes" fue convertida en nueve entradas formales (DEC-009 a DEC-017), cada una con contexto, opciones a evaluar y estado `pendiente`. Las decisiones vigentes D-001 a D-008 no fueron modificadas.
  - `docs/PROGRESS.md`: se agregó esta entrada de bitácora.
- Inconsistencias detectadas y registradas:
  - Las tareas no tenían los campos requeridos por el formato de `CLAUDE.md`.
  - Las decisiones pendientes existían como lista libre sin estructura DEC-XXX.
  - T-003 referenciaba una decisión en `DECISIONS.md` que no existía formalmente; ahora existe como DEC-010.
- Decisiones tomadas: ninguna decisión de código. Solo formalización de documentación existente.
- Pendientes: las nueve decisiones (DEC-009 a DEC-017) requieren confirmación del usuario antes de que Codex pueda implementar las tareas relacionadas.
- Próximos pasos: ver sección "Próxima acción recomendada".

### 2026-06-24 — Base documental para agentes

- Objetivo: crear contexto estable para agentes sin modificar código.
- Revisión: estructura, README, package.json, backend, frontend, integración de pagos, webhook y persistencia.
- Archivos: `README.md`, `AGENTS.md` y documentos bajo `docs/`.
- Resultado: arquitectura, requisitos, tareas, decisiones, procedimientos y seguridad quedaron documentados.
- Verificación: revisión estática; sin ejecución, instalación, cambios de configuración ni acceso a secretos.

### Plantilla para futuras sesiones

```markdown
### AAAA-MM-DD — Título breve

- Objetivo:
- Tarea relacionada:
- Archivos afectados:
- Cambios realizados:
- Verificaciones:
- Resultado:
- Pendientes o riesgos:
```
