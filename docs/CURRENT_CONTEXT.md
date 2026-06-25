# Contexto actual del proyecto

> Resumen compacto para agentes. Última actualización: 2026-06-25 (DEC-017 aceptada, T-010 desbloqueada).
> Si el chat fue compactado, este archivo es el punto de entrada.
> Metodología: Claude documenta — Codex programa — Usuario aprueba — GitHub guarda.

---

## Estado de la fase actual: CERRADA

Las tareas P0 de seguridad (T-001 a T-004), la suite de tests (T-005), la migración SQL (T-006), la estrategia monetaria explícita (T-007) y los identificadores robustos de pedidos (T-008) están **completadas**. T-001 a T-006 están commiteadas; T-007 y T-008 quedaron sin commit por instrucción del usuario.

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
| T-005 | Suite Jest; `npm test` pasa. Cubre todos los flujos críticos sin llamadas externas y quedó ampliada a 18 tests con T-007/T-008. |
| T-006 | `supabase/migrations/001_create_orders.sql` creado con DDL completo, restricciones (`status`, `amount`), índices (`status`, `mercadopago_payment_id`) y RLS habilitada. **Aplicada y verificada manualmente el 2026-06-25.** (DEC-012) |
| T-007 | Estrategia monetaria explícita: comparación de importes normalizada a centavos, validación de moneda contra `order.currency` y logs genéricos en `POST /webhook`. (DEC-011) |
| T-008 | Identificadores de pedido con `LEMONT-ORDER-${crypto.randomUUID()}` para unicidad bajo concurrencia. |

---

## Tareas pendientes para fases futuras

| Tarea | Descripción | Bloqueador |
|---|---|---|
| T-009 | Separar responsabilidades de `index.js` en módulos. | Sin bloqueo; conviene después de T-005. |
| T-010 | Logs estructurados y sin datos sensibles. | **Sin bloqueo.** DEC-017 aceptada el 2026-06-25. |
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
| DEC-017 | Helper `log(level, event, extra)` propio. Formato JSON. Niveles: `info`, `warn`, `error`. Campos fijos + `request_id` por correlación. Lista explícita de campos prohibidos. Sin librería externa. |

## Decisiones pendientes relevantes para la próxima fase

| Decisión | Tarea relacionada | Descripción |
|---|---|---|
| DEC-013 | T-012 | Fuente de catálogo y precios. |
| DEC-016 | T-013 | Proveedor de deploy y entornos. |

---

## Estado técnico actual

- **Backend**: Node.js + CommonJS + Express 5.
- **Pagos**: Mercado Pago Checkout Pro (SDK oficial). Webhook con validación HMAC-SHA256.
- **Base de datos**: Supabase, tabla `orders`, acceso con `service_role` solo desde backend. RLS habilitada en migración.
- **Transición de pagos**: Atómica e idempotente (`UPDATE WHERE status = 'pending'`).
- **Tests**: Jest instalado. `npm test` pasa con 18 tests. Sin llamadas externas ni acceso a `.env`.
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

**DEC-017 aceptada (2026-06-25).** T-010 está desbloqueada y lista para Codex.

Tareas sin bloqueo disponibles: T-009, T-010, T-011, T-014. Pueden abordarse en cualquier orden.

Para T-010, Codex debe:
1. Crear el helper `log(level, event, extra)` en `index.js`.
2. Reemplazar todos los `console.log/warn/error` directos.
3. Agregar `LOG_LEVEL=info` a `.env.example`.
4. Verificar ausencia de campos prohibidos en tests.

Ver instrucciones completas en `docs/TASKS.md` (T-010) y decisión en `docs/DECISIONS.md` (DEC-017).

---

## Reglas vigentes para todos los agentes

- No leer ni mostrar `.env`.
- No exponer secretos, tokens, credenciales ni claves en documentación, logs, commits ni mensajes.
- No usar `git add .` sin revisar qué archivos se incluyen.
- No aplicar la migración SQL en ninguna base de datos sin autorización explícita del usuario.
- No hacer commit ni push sin instrucción del usuario.
- GitHub es la fuente de verdad del código.
- Claude Code documenta. Codex programa. Usuario aprueba.
