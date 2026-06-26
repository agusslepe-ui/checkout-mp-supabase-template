# Contexto actual del proyecto

> Resumen compacto para agentes. Última actualización: 2026-06-26 (14/14 tareas completadas — staging activo en EasyPanel con dominio propio, diagnóstico avanzado de webhook 401 completado, hipótesis de tipo de notificación, credenciales de prueba a rotar).
> Si el chat fue compactado, este archivo es el punto de entrada.
> Metodología: Claude documenta — Codex programa — Usuario aprueba — GitHub guarda.

---

## Estado de la fase actual: P2 COMPLETADA

Las tareas P0 de seguridad (T-001 a T-004), la suite de tests (T-005), la migración SQL (T-006), la estrategia monetaria explícita (T-007), los identificadores robustos de pedidos (T-008), el refactor modular del backend (T-009), la observabilidad segura (T-010), la restricción de `GET /webhook` fuera de producción (T-011), el catálogo seguro del servidor (T-012), la documentación de deploy a staging (T-013) y la corrección UTF-8 del error HTTP 400 (T-014) están **completadas** (14/14). T-013 es una tarea documental: el deploy real a EasyPanel fue ejecutado por el usuario. Staging está activo. El webhook HMAC retorna 401; la investigación está en curso.

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

### P2 — Operación y producto (todas completadas)

| Tarea | Descripción |
|---|---|
| T-011 | `GET /webhook` registrado solo cuando `NODE_ENV !== "production"`. `POST /webhook` sin cambios. |
| T-012 | Catálogo seguro en `src/catalog.js`; el frontend envía solo `{ sku, quantity }` y el backend calcula precio, total y moneda. (DEC-013) |
| T-013 | Deploy a staging en EasyPanel documentado con variables por nombre, checklists y rollback. (DEC-016) |
| T-014 | Respuesta HTTP 400 para JSON inválido con `Content-Type: application/json; charset=utf-8`. |

---

## Tareas pendientes

No quedan tareas T-001 a T-014 pendientes.

**Pendiente de seguridad (acción inmediata):** el Access Token de prueba y el Webhook Secret de prueba fueron compartidos en el chat de la sesión de diagnóstico. Deben regenerarse en el panel de Mercado Pago y actualizarse en EasyPanel antes de continuar con cualquier prueba.

**Pendiente operativo:** el webhook de Mercado Pago retorna 401 en staging vía `notification_url`. Diagnóstico avanzado completado: Traefik/EasyPanel descartado como causa (preserva `x-request-id`); SDK oficial (`WebhookSignatureValidator` de `mercadopago` v3.1.0) también rechaza firmas reales sandbox (`official_sdk_validator_matches=false`); simulación desde el panel de Webhooks sí valida firma correctamente. Hipótesis principal: Mercado Pago usa firma o contexto diferente para `notification_url` de preferencia vs el webhook global del panel. El próximo camino requiere decisión del usuario (Opción A/B/C — ver "Próximo paso recomendado").

**Pendiente de limpieza:** los diagnósticos temporales en `src/webhookSignature.js`, `src/app.js` y `src/config.js` deben retirarse antes de producción real.

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
- **Deploy**: staging activo en EasyPanel/VPS según DEC-016. Dockerfile Node.js 22 en uso. Dominio propio `checkout.lemont01.com` con SSL activo. Frontend, `POST /crear-preferencia` y persistencia Supabase funcionan. `POST /webhook` retorna 401 vía `notification_url` sandbox: diagnóstico avanzado completado (SDK oficial también rechaza; simulación del panel valida). Producción real requiere checklist previa de DEC-016 y rotación previa de credenciales de prueba expuestas.

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

### Próximos pasos después del diagnóstico avanzado

Staging activo. Diagnóstico avanzado concluido: la infraestructura y la implementación HMAC no son el problema. La diferencia de firma es entre tipos de notificación (panel vs `notification_url` de preferencia).

**Paso 1 — Inmediato (antes de cualquier otro paso):**
Rotar el Access Token de prueba y el Webhook Secret de prueba expuestos en el chat. Actualizar `MERCADOPAGO_ACCESS_TOKEN` y `MERCADO_PAGO_WEBHOOK_SECRET` en EasyPanel y verificar que el staging sigue funcionando.

**Paso 2 — Decidir camino técnico (requiere aprobación del usuario):**

- **Opción A** — Prueba en producción real: usar credenciales productivas y un pago mínimo controlado para confirmar si el problema es exclusivo del sandbox.
- **Opción B** — Investigación formal: consultar documentación oficial o soporte de Mercado Pago sobre la diferencia de firma entre `notification_url` de preferencia y webhook global del panel.
- **Opción C** — Estrategia alternativa (requiere DEC formal previa): validación posterior por consulta directa a la API de Mercado Pago, sin depender de la firma del webhook para el flujo sandbox. Implica cambio de arquitectura; requiere DEC en `docs/DECISIONS.md` antes de que Codex toque código.

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
