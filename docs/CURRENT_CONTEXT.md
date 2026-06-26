# Contexto actual del proyecto

> Resumen compacto para agentes. Última actualización: 2026-06-25 (13/14 tareas completadas — DEC-016 aceptada, T-013 desbloqueada).
> Si el chat fue compactado, este archivo es el punto de entrada.
> Metodología: Claude documenta — Codex programa — Usuario aprueba — GitHub guarda.

---

## Estado de la fase actual: P2 EN CURSO

Las tareas P0 de seguridad (T-001 a T-004), la suite de tests (T-005), la migración SQL (T-006), la estrategia monetaria explícita (T-007), los identificadores robustos de pedidos (T-008), el refactor modular del backend (T-009), la observabilidad segura (T-010), la restricción de `GET /webhook` fuera de producción (T-011), el catálogo seguro del servidor (T-012) y la corrección UTF-8 del error HTTP 400 (T-014) están **completadas** (13/14). T-001 a T-010 y T-014 están commiteadas y pusheadas a `origin/main`. T-011 y T-012 están completadas localmente sin commit.

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

### P1 — Calidad y mantenibilidad (todas completadas)

| Tarea | Descripción |
|---|---|
| T-005 | Suite Jest; `npm test` pasa con 29 tests. Cubre todos los flujos críticos sin llamadas externas. |
| T-006 | `supabase/migrations/001_create_orders.sql` con DDL, restricciones, índices y RLS. Aplicada y verificada en Supabase el 2026-06-25. (DEC-012) |
| T-007 | Comparación de importes normalizada a centavos (`Math.round`), validación de moneda contra `order.currency`, logs genéricos. (DEC-011) |
| T-008 | Identificadores de pedido con `LEMONT-ORDER-${crypto.randomUUID()}` para unicidad bajo concurrencia. |
| T-009 | Backend separado en módulos `src/`: `app.js`, `config.js`, `logger.js`, `payments.js`, `orders.js`, `webhookSignature.js`. |
| T-010 | Logs estructurados JSON con `request_id`, niveles `info`/`warn`/`error`, whitelist de campos y `LOG_LEVEL=info`. (DEC-017) |

### P2 — Operación y producto (completadas)

| Tarea | Descripción |
|---|---|
| T-011 | `GET /webhook` registrado solo cuando `NODE_ENV !== "production"`. `POST /webhook` sin cambios. |
| T-012 | Catálogo seguro en `src/catalog.js`; el frontend envía solo `{ sku, quantity }` y el backend calcula precio, total y moneda. (DEC-013) |
| T-014 | Respuesta HTTP 400 para JSON inválido con `Content-Type: application/json; charset=utf-8`. |

---

## Tareas pendientes

| Tarea | Descripción | Bloqueador |
|---|---|---|
| T-013 | Documentar y validar deploy a staging en EasyPanel. | **DEC-016 aceptada.** Lista para implementar. |

---

## Decisiones técnicas aceptadas

| Decisión | Resumen |
|---|---|
| DEC-009 | Validar firma webhook con `MERCADO_PAGO_WEBHOOK_SECRET`. HTTP 401 + mensaje genérico para firma ausente o inválida. Sin exponer secretos en logs. |
| DEC-010 | Transición `pending → paid` con `UPDATE WHERE status = 'pending'`. Cero filas afectadas = duplicado idempotente. Sin dependencias adicionales. |
| DEC-011 | Comparar importes como enteros en centavos: `Math.round(a * 100) === Math.round(b * 100)`. Validar `currency_id` contra `order.currency`. Logs solo genéricos. Sin dependencias nuevas. |
| DEC-012 | SQL manual versionado en `supabase/migrations/`. Sin Supabase CLI. El usuario aplica el archivo manualmente. |
| DEC-013 | Catálogo como módulo `src/catalog.js`. Frontend envía solo `{ sku, quantity }`. Backend resuelve precio, moneda y valida cantidad. Sin dependencias nuevas ni tabla Supabase adicional. |
| DEC-017 | Helper `log(level, event, extra)` propio. Formato JSON. Niveles: `info`, `warn`, `error`. Campos fijos + `request_id` por correlación. Lista explícita de campos prohibidos. Sin librería externa. |

## Decisiones técnicas aceptadas (continuación)

| Decisión | Resumen |
|---|---|
| DEC-016 | Staging en EasyPanel/VPS. URL HTTPS de EasyPanel. `NODE_ENV=production`. MP sandbox. Supabase actual. Variables solo en EasyPanel. Rollback en 4 niveles. Producción real con checklist obligatoria. |

---

## Estado técnico actual

- **Backend**: Node.js + CommonJS + Express 5. Módulos separados en `src/`.
- **Pagos**: Mercado Pago Checkout Pro (SDK oficial). Webhook protegido con validación HMAC-SHA256 y confirmación real a la API.
- **Validaciones**: importe normalizado a centavos, moneda validada, transición atómica e idempotente.
- **Identificadores**: `LEMONT-ORDER-${crypto.randomUUID()}` — únicos bajo concurrencia.
- **Logs**: JSON estructurado por helper propio `log()`, con `request_id`, niveles y lista explícita de campos prohibidos.
- **Base de datos**: Supabase, tabla `orders`, acceso con `service_role` solo desde backend. RLS habilitada. Sin policies públicas para `anon` ni `authenticated`.
- **Migración SQL**: `supabase/migrations/001_create_orders.sql` aplicada y verificada el 2026-06-25.
- **Catálogo**: `src/catalog.js` es fuente autoritativa del producto, precio unitario, moneda y cantidad máxima. El cliente no controla importe ni moneda.
- **Tests**: Jest. `npm test` pasa con **29 tests**. Sin llamadas externas ni acceso a `.env`.
- **Diagnóstico**: `GET /webhook` disponible solo fuera de producción (`NODE_ENV !== "production"`). `POST /webhook` disponible en todos los entornos.
- **Versionado**: Git + GitHub. Sin deploy documentado (T-013 pendiente).

---

## Archivos clave del proyecto

| Archivo | Propósito |
|---|---|
| `index.js` | Entrypoint mínimo: carga config, importa app, arranca servidor. |
| `src/app.js` | Express, middlewares, rutas y handlers. `GET /webhook` condicionado por `NODE_ENV`. |
| `src/catalog.js` | Catálogo versionado del servidor y `getProduct(sku)`. |
| `src/config.js` | Validación y export de variables de entorno. |
| `src/logger.js` | Helper `log()` de DEC-017. |
| `src/payments.js` | Integración Mercado Pago: `createPreference`, `Payment.get`. |
| `src/orders.js` | Operaciones Supabase: `createPendingOrder`, `markOrderAsPaid`. Validación importe/moneda. |
| `src/webhookSignature.js` | Validación de firma HMAC-SHA256 de Mercado Pago. |
| `tests/index.test.js` | Suite Jest con **29 tests**. Mocks de MP, Supabase, dotenv y Express. |
| `supabase/migrations/001_create_orders.sql` | Migración SQL versionada: DDL, restricciones, índices y RLS. Aplicada el 2026-06-25. |
| `.env.example` | Contrato de variables de entorno (sin valores reales). Incluye `LOG_LEVEL=info`. |
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

### T-013 lista para implementar — DEC-016 aceptada

**T-013 — Documentar y validar deploy a staging en EasyPanel**

> Codex debe actualizar `docs/SKILLS.md` (sección "Deploy") y `README.md` (secciones desactualizadas) con la documentación concreta de staging en EasyPanel.
> Ver instrucciones detalladas en `docs/TASKS.md` (T-013) y `docs/DECISIONS.md` (DEC-016).
> El deploy real lo ejecuta el usuario siguiendo la checklist de staging de DEC-016.

---

## Reglas vigentes para todos los agentes

- No leer ni mostrar `.env`.
- No exponer secretos, tokens, credenciales ni claves en documentación, logs, commits ni mensajes.
- No usar `git add .` sin revisar qué archivos se incluyen.
- No aplicar la migración SQL en ninguna base de datos sin autorización explícita del usuario.
- No hacer commit ni push sin instrucción del usuario.
- GitHub es la fuente de verdad del código.
- Claude Code documenta. Codex programa. Usuario aprueba.
