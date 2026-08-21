# Contexto actual del proyecto

> Resumen compacto para agentes. Última actualización: 2026-08-21 (auditoría y endurecimiento de una integración con operación productiva real; DEC-019 y T-015 implementadas).
> Si el chat fue compactado, este archivo es el punto de entrada.
> Metodología: Claude documenta — Codex programa — Usuario aprueba — GitHub guarda.

---

## Estado de la fase actual: ENDURECIMIENTO DE INTEGRACIÓN PRODUCTIVA EXISTENTE

Las tareas T-001 a T-015 están completadas. El flujo `pending → paid` fue verificado en producción con pagos reales. El proyecto no es exclusivamente una demo o sandbox: la fase actual audita y endurece una integración productiva existente. DEC-019 y T-015 implementan la política HTTP resiliente de `POST /webhook`.

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
| T-005 | Suite Jest; la suite actual pasa con 50 tests. Cubre todos los flujos críticos sin llamadas externas. |
| T-006 | `supabase/migrations/001_create_orders.sql` con DDL, restricciones, índices y RLS. Aplicada y verificada en Supabase el 2026-06-25. (DEC-012) |
| T-007 | Comparación de importes normalizada a centavos (`Math.round`), validación de moneda contra `order.currency`, logs genéricos. (DEC-011) |
| T-008 | Identificadores de pedido con `LEMONT-ORDER-${crypto.randomUUID()}` para unicidad bajo concurrencia. |
| T-009 | Backend separado en módulos `src/`: `app.js`, `config.js`, `logger.js`, `payments.js`, `orders.js`, `webhookSignature.js`. |
| T-010 | Logs estructurados JSON con `request_id`, niveles `info`/`warn`/`error`, whitelist de campos y `LOG_LEVEL=info`. (DEC-017) |

### P2 — Operación y producto (todas completadas)

| Tarea | Descripción |
|---|---|
| T-011 | `GET /webhook` registrado solo cuando `NODE_ENV !== "production"`. `POST /webhook` sin cambios. |
| T-012 | Catálogo seguro en `src/catalog.js`; el frontend envía solo `{ sku, quantity }` y el backend calcula precio, total y moneda. (DEC-013) |
| T-013 | Deploy a staging en EasyPanel documentado con variables por nombre, checklists y rollback. (DEC-016) |
| T-014 | Respuesta HTTP 400 para JSON inválido con `Content-Type: application/json; charset=utf-8`. |

---

## Tareas pendientes

No quedan tareas T-001 a T-015 pendientes. T-015 fue completada el 2026-08-21: `POST /webhook` responde 503 ante fallos temporales o inesperados y conserva 200 para resultados exitosos, definitivos o idempotentes.

**Pendiente de seguridad (acción inmediata — usuario):** credenciales productivas de Mercado Pago (Access Token y Webhook Secret) fueron visibles en capturas/chats de la sesión. Deben revocarse y regenerarse en el panel de Mercado Pago y actualizarse en EasyPanel antes de continuar operando en producción. Ver `docs/SECURITY.md`.

**Captura completa retirada (2026-08-20):** `MP_SUPPORT_CAPTURE_FULL_WEBHOOK` ya no se lee en runtime y no puede activar el registro de la URL ni de headers completos. Los demás diagnósticos temporales de `src/webhookSignature.js` y `src/config.js` no fueron modificados.

---

## Decisiones técnicas aceptadas

| Decisión | Resumen |
|---|---|
| DEC-009 | Validar firma webhook con `MERCADO_PAGO_WEBHOOK_SECRET`. HTTP 401 + mensaje genérico para firma ausente o inválida. Sin exponer secretos en logs. |
| DEC-010 | Transición `pending → paid` con `UPDATE WHERE status = 'pending'`. Cero filas afectadas = duplicado idempotente. Sin dependencias adicionales. |
| DEC-011 | Comparar importes como enteros en centavos: `Math.round(a * 100) === Math.round(b * 100)`. Validar `currency_id` contra `order.currency`. Logs solo genéricos. Sin dependencias nuevas. |
| DEC-012 | SQL manual versionado en `supabase/migrations/`. Sin Supabase CLI. El usuario aplica el archivo manualmente. |
| DEC-013 | Catálogo como módulo `src/catalog.js`. Frontend envía solo `{ sku, quantity }`. Backend resuelve precio, moneda y valida cantidad. Sin dependencias nuevas ni tabla Supabase adicional. |
| DEC-016 | Staging en EasyPanel/VPS. URL HTTPS de EasyPanel. `NODE_ENV=production`. MP sandbox. Supabase actual. Variables solo en EasyPanel. Rollback en 4 niveles. Producción real con checklist obligatoria. |
| DEC-017 | Helper `log(level, event, extra)` propio. Formato JSON. Niveles: `info`, `warn`, `error`. Campos fijos + `request_id` por correlación. Lista explícita de campos prohibidos. Sin librería externa. |
| DEC-018 | **Resuelta.** Causa raíz del 401: `notification_url` sin `?source_news=webhooks` hacía que MP enviara IPN en lugar de Webhooks (firma diferente). Fix: agregar `?source_news=webhooks`. Flujo pending → paid verificado en producción real el 2026-06-26. |
| DEC-019 | **Implementada por T-015.** Política HTTP de `POST /webhook`: 401 para firma ausente/inválida; 200 para éxito y resultados definitivos/idempotentes; 503 para fallos temporales o excepciones inesperadas. Conserva HMAC, transición atómica e idempotencia. |

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
- **Tests**: Jest. La suite actual pasa con **50 tests**. Sin llamadas externas ni acceso a `.env`.
- **Dependencias**: `npm audit` detectó 2 vulnerabilidades high; `npm audit fix` actualizó únicamente dependencias transitivas compatibles. Estado verificado al cierre: **0 vulnerabilidades conocidas** y 50/50 tests pasando.
- **Diagnóstico**: `GET /webhook` disponible solo fuera de producción (`NODE_ENV !== "production"`). `POST /webhook` disponible en todos los entornos.
- **Deploy**: productivo activo en EasyPanel/VPS según DEC-016. Dockerfile Node.js 22 en uso. Dominio propio `checkout.lemont01.com` con SSL activo. Flujo completo verificado en producción real (2026-06-26): preferencia → pago real → webhook con firma HMAC-SHA256 válida → pedido actualizado a `paid` en Supabase. La captura completa asociada a `MP_SUPPORT_CAPTURE_FULL_WEBHOOK` fue retirada del código el 2026-08-20. Credenciales productivas expuestas en capturas/chats requieren rotación inmediata (ver `docs/SECURITY.md`).

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
| `tests/index.test.js` | Suite Jest con **50 tests**. Mocks de MP, Supabase, dotenv y Express. |
| `supabase/migrations/001_create_orders.sql` | Migración SQL versionada: DDL, restricciones, índices y RLS. Aplicada el 2026-06-25. |
| `Dockerfile` | Build de staging con Node.js 22; instala con `npm ci`, expone `3003` y ejecuta `npm start`. |
| `.dockerignore` | Excluye `.env`, `.env.*`, `.git`, `node_modules`, logs y temporales del contexto Docker. |
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

1. Reconstruir el `.env` local usando exclusivamente `.env.example` como contrato, sin reutilizar credenciales documentadas como expuestas.
2. Configurar: `MERCADOPAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET`, `BASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `LOG_LEVEL`.
3. Reconectar primero Supabase y verificar que la tabla `orders` corresponda al esquema versionado.
4. Rotar/configurar credenciales nuevas de Mercado Pago; las credenciales productivas antiguas expuestas se consideran comprometidas y no deben reutilizarse.
5. Configurar el webhook y `BASE_URL` con la URL HTTPS del entorno.
6. Ejecutar una prueba end-to-end controlada: `pending → preferencia → pago → webhook → paid`.
7. Después de verificar el backend completo, conectar el nuevo frontend de LEMONT.

> Codex no debe leer `.env`, exponer secretos, hacer commit ni push sin autorización explícita del usuario.

---

## Reglas vigentes para todos los agentes

- No leer ni mostrar `.env`.
- No exponer secretos, tokens, credenciales ni claves en documentación, logs, commits ni mensajes.
- No usar `git add .` sin revisar qué archivos se incluyen.
- No aplicar la migración SQL en ninguna base de datos sin autorización explícita del usuario.
- No hacer commit ni push sin instrucción del usuario.
- GitHub es la fuente de verdad del código.
- Claude Code documenta. Codex programa. Usuario aprueba.
