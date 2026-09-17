# Estado vigente del proyecto

**Última actualización:** 2026-09-16

Este archivo es la referencia rápida del estado actual. Los bloques históricos en `TASKS.md`, `PROGRESS.md` o `DECISIONS.md` que describan T-021 como local, pendiente de auditoría o con la migración 006 sin aplicar deben leerse como antecedentes previos al cierre del 2026-09-16.

## Completado y validado

- **T-021 — Selección real de sucursal MiCorreo: COMPLETADA.**
- **DEC-026 — Selección autoritativa de agencia: ACEPTADA.**
- Auditoría previa: APROBADA CON OBSERVACIONES, sin bloqueadores de implementación.
- Suite local: **276/276 tests**, 4 suites.
- `supabase/migrations/006_add_order_shipping_agency.sql`: **APLICADA EN PRODUCCIÓN**.
- Runtime T-021: **DESPLEGADO EN EASYPANEL**.
- RPC `create_pending_order_with_items`: **26 parámetros**.
- Seis columnas `shipping_agency_*`: presentes, `text`, nullable.
- Permisos de la RPC verificados: `EXECUTE` solo para `postgres` y `service_role`; no `anon`, `authenticated` ni `PUBLIC`.
- QA HOME real hasta Mercado Pago: orden `pending`, subtotal + shipping = total y snapshot de agencia en null.
- QA AGENCY real hasta Mercado Pago: `GET /agencies` real de MiCorreo confirmado, sucursal seleccionada y revalidada por backend, snapshot autoritativo persistido.

El detalle del cierre está en `docs/T021_DEC026_CLOSURE_2026-09-16.md`.

## Estado de T-020

- **T-020 está implementada y desplegada.**
- La migración 005 está aplicada.
- El costo de envío se recotiza en backend y se incluye en `orders.amount` y en Mercado Pago.
- El **paid QA completo de T-020 sigue pendiente como tarea separada**.
- **DEC-025 no se considera aceptada automáticamente por el cierre de T-021.**

## Pendientes principales

- T-017.1–T-017.3 están completadas y auditadas. T-017.4 está en ejecución: la migración 007 fue aplicada y verificada, pero el deploy y QA continúan pendientes.
- Etapa D: crear el envío post-pago con MiCorreo `/shipping/import`; no implementada todavía.
- Tracking/etiquetas: no implementados; el PDF oficial disponible no documenta esos endpoints.
- Stock real por SKU; `maxQuantity: 4` sigue siendo un límite temporal y no inventario.
- Sustituir perfiles TEMPORAL/QA de `300 g / 5 × 25 × 35 cm` por peso y dimensiones reales del paquete para 1–4 unidades y repetir cotizaciones.
- Restaurar precio comercial definitivo; ARS 1.000 sigue siendo precio de prueba.
- Rotar credenciales privadas previamente expuestas antes del lanzamiento público.
- Auditar vulnerabilidades npm registradas en tareas anteriores.

## Regla de alcance

No declarar la tienda lista para lanzamiento comercial mientras sigan pendientes las medidas reales, la rotación de credenciales, el precio comercial y los controles operativos acordados.

GitHub sigue siendo la fuente de verdad del código. El cierre T-021/DEC-026 de 2026-09-16 prevalece sobre referencias históricas anteriores.

## Trabajo local posterior al cierre T-021

- **DEC-022 — Idempotencia durable del checkout: ACEPTADA** el 2026-09-16.
- **T-017: EN PROGRESO.**
- **T-017.1: COMPLETADA / AUDITADA.**
- **T-017.2: COMPLETADA / AUDITADA.** Backend exige `checkoutAttemptId`, reutiliza el snapshot persistido, aplica lease de 30 segundos, recupera preferencias por `external_reference` y persiste `ready`/`unknown` sin recotizar retries existentes.
- **T-017.3: COMPLETADA / AUDITADA.** El frontend calcula un SHA-256 de la intención normalizada, guarda solo `{ version: 1, checkoutAttemptId, intentDigest }` bajo `lemont.checkoutAttempt.v1` en `sessionStorage` y reutiliza el UUID en retries sin cambios.
- **T-017.4-A: CUTOVER PREPARADO LOCALMENTE / AUDITADO / APROBADO CON OBSERVACIONES.** La migración 007 conserva la RPC productiva `create_pending_order_with_items` de 26 parámetros y agrega `create_pending_order_with_items_v2` con 27 parámetros y `p_checkout_attempt_id uuid` primero.
- **T-017.4 ejecución: EN PROGRESO.** La migración 007 **FUE APLICADA EN PRODUCCIÓN**. Se verificaron `checkout_attempts`, RPC 26, RPC v2, `claim_checkout_attempt`, `SECURITY INVOKER`, `search_path`, permisos de ejecución y RLS. El deploy T-017 y los QA siguen pendientes; T-017 no está completa ni productiva.
- Hallazgo real: los default privileges de Supabase otorgaron a `service_role` privilegios de tabla y UPDATE más amplios que los previstos. Producción fue corregida manualmente con éxito: tabla solo SELECT/INSERT, UPDATE limitado a seis columnas operativas y sequence solo USAGE.
- **Migración 008: PREPARADA LOCALMENTE / AUDITADA / APROBADA CON OBSERVACIONES.** La auditoría no encontró hallazgos críticos. Reproduce el hardening de forma idempotente, no modifica RPCs, claim, tablas ni constraints y **NO fue aplicada**.
- El bloqueo inicial del recovery fue corregido: después de `Preference.search` por `external_reference`, el SDK 3.1.0 recibe `Preference.get({ preferenceId: ... })` cuando necesita completar el resultado.
- Verificación final T-017.2: **345/345 tests**, 8 suites, 0 fallos; `npm test`, `node --check` y `git diff --check` correctos.
- No hubo deploy de T-017. Producción sigue usando el runtime T-021 y la RPC de **26 parámetros**.
- Verificación final T-017.3: **369/369 tests**, 9 suites, 0 fallos; `npm test`, sintaxis frontend y `git diff --check` correctos.
- Verificación local T-017.4-A: **372/372 tests**, 9 suites, 0 fallos; `npm.cmd test`, `node --check src/orders.js` y `git diff --check` correctos. El runtime T-017 llama exclusivamente `create_pending_order_with_items_v2`; `markOrderAsPaid` permanece intacto.
- Verificación local del hardening 008: **377/377 tests**, 9 suites, 0 fallos. La 007 permanece byte-for-byte intacta.
- Observaciones no bloqueantes para T-017.4: diferencias raras de normalización de espacios y orden de SKU; faltan casos nominales explícitos de HTTP 500 y errores de storage; los tests VM no sustituyen ESM/Web Crypto/storage reales; y debe validarse el record conservado tras redirect, browser back, READY reutilizada, order ya paid y doble click/concurrencia real.
- La infraestructura de base de datos T-017 ya existe, pero la idempotencia todavía **no está activa en el runtime productivo**: producción continúa ejecutando T-021 contra RPC 26. Pendiente: deploy runtime/frontend T-017 → smoke QA → idempotency QA → payment QA → cleanup futuro de RPC 26 mediante otra migración.
- Observaciones no bloqueantes: puede existir una ventana breve de schema cache tras `NOTIFY pgrst`; nunca desplegar Node T-017 antes de 007; los tests SQL actuales son mayormente estáticos; el QA real debe cubrir concurrencia, recovery Mercado Pago, browser back/READY, sessionStorage/Web Crypto reales, paid order y doble click.
- Observaciones de auditoría 008: el hash test de 007 depende de la normalización LF/CRLF; los tests no afirman `BEGIN`/`COMMIT` explícitamente; 008 no necesita `NOTIFY pgrst`; endurece únicamente `service_role`; y el archivo 008 estaba untracked durante `git diff --check`.
