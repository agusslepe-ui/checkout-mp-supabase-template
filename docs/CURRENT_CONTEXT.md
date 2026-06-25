# Contexto actual del proyecto

> Resumen compacto para agentes. Última actualización: 2026-06-25 (DEC-011 aceptada, T-007 desbloqueada).
> Si el chat fue compactado, este archivo es el punto de entrada.
> Metodología: Claude documenta — Codex programa — Usuario aprueba — GitHub guarda.

---

## Estado de la fase actual: CERRADA

Las tareas P0 de seguridad (T-001 a T-004), la suite de tests (T-005) y la migración SQL (T-006) están **completadas y commiteadas**. La fase inicial está cerrada.

---

## Metodología de trabajo

| Rol | Responsabilidad |
|---|---|
| **Claude Code** | Documenta, organiza contexto y prepara tareas para Codex. No modifica código salvo autorización explícita. |
| **Codex** | Implementa cambios de código según las tareas en `docs/TASKS.md`. |
| **Usuario** | Aprueba decisiones técnicas y cambios antes de que se apliquen. |
| **GitHub** | Fuente de verdad del código. |
| **Markdown** | Memoria estable del proyecto. |

---

## Estado de tareas completadas

### P0 — Seguridad e integridad (todas completadas)

| Tarea | Descripción |
|---|---|
| T-001 | Validación de firma webhook HMAC-SHA256 con `MERCADO_PAGO_WEBHOOK_SECRET`. HTTP 401 para firma ausente o inválida. (DEC-009) |
| T-002 | Creación de preferencia detenida si Supabase falla al insertar el pedido. |
| T-003 | Transición `pending → paid` atómica e idempotente con `UPDATE WHERE status = 'pending'`. (DEC-010) |
| T-004 | Validación de las cuatro variables de entorno obligatorias antes de aceptar tráfico. |

### P1 — Calidad y mantenibilidad (completadas en esta fase)

| Tarea | Descripción |
|---|---|
| T-005 | Suite Jest con 11 tests; `npm test` pasa. Cubre todos los flujos críticos sin llamadas externas. |
| T-006 | `supabase/migrations/001_create_orders.sql` creado con DDL completo, restricciones (`status`, `amount`), índices (`status`, `mercadopago_payment_id`) y RLS habilitada. **Aplicada y verificada manualmente el 2026-06-25.** (DEC-012) |

---

## Tareas pendientes para fases futuras

| Tarea | Descripción | Bloqueador |
|---|---|---|
| T-007 | Estrategia monetaria segura (comparación sin `Number`, validación de moneda). | **Sin bloqueo.** DEC-011 aceptada el 2026-06-25. |
| T-008 | Identificadores de pedidos únicos bajo concurrencia. | Sin bloqueo. |
| T-009 | Separar responsabilidades de `index.js` en módulos. | Sin bloqueo; conviene después de T-005. |
| T-010 | Logs estructurados y sin datos sensibles. | DEC-017 pendiente. |
| T-011 | Retirar `GET /webhook` y herramientas de diagnóstico. | Sin bloqueo. |
| T-012 | Fuente autoritativa de catálogo y precios. | DEC-013 pendiente. |
| T-013 | Documentar y validar deploy. | DEC-016 pendiente. |
| T-014 | Corregir codificación UTF-8 en mensajes de error. | Sin bloqueo. |

---

## Decisiones técnicas aceptadas

| Decisión | Resumen |
|---|---|
| DEC-009 | Validar firma webhook con `MERCADO_PAGO_WEBHOOK_SECRET`. HTTP 401 + mensaje genérico para firma ausente o inválida. Sin exponer secretos en logs. |
| DEC-010 | Transición `pending → paid` con `UPDATE WHERE status = 'pending'`. Cero filas afectadas = duplicado idempotente. Sin dependencias adicionales. |
| DEC-011 | Comparar importes como enteros en centavos: `Math.round(a * 100) === Math.round(b * 100)`. Validar `currency_id` contra `order.currency`. Logs solo genéricos. Sin dependencias nuevas. |
| DEC-012 | SQL manual versionado en `supabase/migrations/`. Sin Supabase CLI. El usuario aplica el archivo manualmente. |

## Decisiones pendientes relevantes para la próxima fase

| Decisión | Tarea relacionada | Descripción |
|---|---|---|
| DEC-013 | T-012 | Fuente de catálogo y precios. |
| DEC-016 | T-013 | Proveedor de deploy y entornos. |
| DEC-017 | T-010 | Formato y política de retención de logs. |

---

## Estado técnico actual

- **Backend**: Node.js + CommonJS + Express 5.
- **Pagos**: Mercado Pago Checkout Pro (SDK oficial). Webhook con validación HMAC-SHA256.
- **Base de datos**: Supabase, tabla `orders`, acceso con `service_role` solo desde backend. RLS habilitada en migración.
- **Transición de pagos**: Atómica e idempotente (`UPDATE WHERE status = 'pending'`).
- **Tests**: Jest instalado. `npm test` pasa con 11 tests. Sin llamadas externas ni acceso a `.env`.
- **Migración SQL**: `supabase/migrations/001_create_orders.sql` versionado y **aplicado en Supabase el 2026-06-25**. Tabla `public.orders` confirmada: columnas, constraints, índices y RLS (`rowsecurity = true`) activa. Sin policies públicas.
- **Versionado**: Git + GitHub. No hay deploy documentado.

---

## Archivos clave del proyecto

| Archivo | Propósito |
|---|---|
| `index.js` | Backend completo: rutas, webhook, validación de firma, integración MP y Supabase. |
| `tests/index.test.js` | Suite Jest con 11 tests. Mocks de MP, Supabase, dotenv y Express. |
| `supabase/migrations/001_create_orders.sql` | Migración SQL versionada: DDL, restricciones, índices y RLS. **Aplicada el 2026-06-25.** |
| `.env.example` | Contrato de variables de entorno (sin valores reales). |
| `docs/CURRENT_CONTEXT.md` | Este archivo — resumen compacto para agentes. |
| `docs/TASKS.md` | Detalle de todas las tareas con criterios de aceptación. |
| `docs/DECISIONS.md` | Decisiones técnicas tomadas y pendientes. |
| `docs/PROGRESS.md` | Bitácora y estado histórico. |
| `docs/DESIGN.md` | Arquitectura y flujos. |
| `docs/SECURITY.md` | Controles y riesgos. |
| `AGENTS.md` | Reglas de trabajo para agentes. |
| `CLAUDE.md` | Rol y restricciones de Claude Code. |

---

## Próximo paso recomendado

### Opción A — Modo aprendizaje (antes de continuar)

Pedir a Claude o ChatGPT una explicación conceptual de lo construido:
- ¿Qué es HMAC-SHA256 y por qué valida el webhook?
- ¿Cómo funciona la transición atómica con `UPDATE WHERE status = 'pending'`?
- ¿Qué cubre la suite Jest y qué queda sin cubrir?
- ¿Qué hace exactamente la política RLS que se creó?

### Opción B — Continuar con la próxima fase

**DEC-011 aceptada (2026-06-25).** T-007 está desbloqueada y lista para que Codex la implemente.

Estrategia definida:
- Función `importesCoinciden(a, b)` con `Math.round(a * 100) === Math.round(b * 100)`.
- Validación de `payment.currency_id` contra `order.currency` en el mismo bloque.
- Logs genéricos sin valores reales.
- Sin dependencias nuevas.

Ver instrucciones completas en `docs/TASKS.md` (T-007) y decisión en `docs/DECISIONS.md` (DEC-011).

---

## Reglas vigentes para todos los agentes

- No leer ni mostrar `.env`.
- No exponer secretos, tokens, credenciales ni claves en documentación, logs, commits ni mensajes.
- No usar `git add .` sin revisar qué archivos se incluyen.
- No aplicar la migración SQL en ninguna base de datos sin autorización explícita del usuario.
- No hacer commit ni push sin instrucción del usuario.
- GitHub es la fuente de verdad del código.
- Claude Code documenta. Codex programa. Usuario aprueba.
