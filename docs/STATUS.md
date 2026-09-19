# Estado vigente del proyecto

**Última actualización:** 2026-09-19

Este archivo resume el estado real vigente. Los bloques históricos de otros documentos que describan T-017 sin desplegar, las migraciones 007/008 sin aplicar, producción en runtime T-021, T-020 sin paid QA o T-021 pendiente deben leerse como antecedentes superados por este corte.

## T-022 — estado productivo vigente

- **T-022: EN PROGRESO.**
- **T-022.6-C: PREPARADA LOCALMENTE / NO PRODUCTIVA** (2026-09-19). `Dockerfile` conserva el proceso web con `npm start`; el nuevo `Dockerfile.worker` reutiliza la misma construcción y ejecuta exclusivamente `npm run shipping:worker`, sin exponer un puerto. No fue construido, ejecutado ni desplegado.
- **T-022.6-B: IMPLEMENTADA LOCALMENTE / NO PRODUCTIVA** (2026-09-18). Existe un entrypoint Node aislado para polling cada 60 s, protegido por `SHIPPING_IMPORT_WORKER_ENABLED=true`, con primera iteración inmediata, ciclos no superpuestos, umbral fatal de cinco errores consecutivos y shutdown por señales. No fue ejecutado ni desplegado.
- **T-022.6-A: DESPLEGADA / VALIDADA EN PRODUCCIÓN MEDIANTE EJECUCIÓN MANUAL ONE-SHOT** (2026-09-18). Una única invocación autorizada realizó un claim, un lease, un POST real y una transición final `created`. No existe activación automática.
- **T-022.5: DESPLEGADA / VALIDADA EN PRODUCCIÓN** (2026-09-18). La migración 010 y el runtime paid+queue legacy-safe confirmaron un pago real y llevaron el snapshot de `not_requested` a `queued`.
- **T-022.4: WORKER IMPLEMENTADO / DESPLEGADO / SIN ACTIVACIÓN AUTOMÁTICA** (2026-09-18). La ejecución real confirmó lease, attempt y cierre holder-only; no hay timer, polling, cron ni scheduler.
- **T-022.3: DESPLEGADA / VALIDADA** (2026-09-18). El mapping HOME Classic y `MiCorreoProvider.importShipment` fueron validados con un envío real. Express continúa bloqueado y no se asume CP/EP.
- **T-022.2: DESPLEGADA / VALIDADA EN PRODUCCIÓN** (2026-09-17). La migración 009 y el runtime v3 fueron desplegados en ese orden. Un checkout productivo real sin pago creó order `pending`, `order_items`, `checkout_attempt` y `order_shipping_imports/not_requested`, y llegó correctamente a Mercado Pago.
- **Migración 009: APLICADA EN PRODUCCIÓN.** Existen RPC 26, v2, v3, paid+queue, claim y transiciones/recovery. RPC 26 y v2 permanecen disponibles. El QA PostgreSQL real validó atomicidad y rollback sin residuos, snapshot 300/5/25/35, `declared_value = products_subtotal`, `ext_order_id = orders.external_reference` y la secuencia `pending+not_requested → paid+queued → processing+lease`, sin llamar MiCorreo.
- RLS, ausencia de policies públicas, denegación a `anon`/`authenticated`, EXECUTE exclusivo de `service_role` y UPDATE limitado a las nueve columnas operativas fueron verificados en producción. No hubo backfill: la tabla quedó inicialmente con cero filas.
- **QA REAL MICORREO: VALIDADO END-TO-END.** Checkout HOME Classic, pago aprobado, webhook, `paid + queued`, claim/lease, import real y cierre `created` fueron comprobados en producción. El portal real mostró el envío como **Validado** y las medidas QA 0,3 kg / 35 × 25 × 5 cm.
- **`POST /shipping/import`: VALIDADO REALMENTE mediante ejecución manual controlada.** Esto no declara worker automático: no existe scheduler, cron, polling ni endpoint HTTP de operación.
- El polling automático pertenece sólo a T-022.6-B local. `npm start` continúa sin worker y producción no ejecuta `npm run shipping:worker`.

## Producción

- **Runtime T-017: DESPLEGADO EN EASYPANEL.** La idempotencia durable sigue apoyada en la lógica v2; el checkout productivo actual llama la RPC v3, que envuelve v2 y agrega el snapshot logístico. Las RPC de 26 parámetros y v2 permanecen disponibles.
- **Idempotencia durable: ACTIVA EN PRODUCCIÓN.** El mismo intento/intención reutilizó la misma `checkout_attempt`, orden y preferencia Mercado Pago; una intención distinta creó un intento, orden y preferencia nuevos; doble clic y retry normal no duplicaron la orden.
- **Migraciones 007 y 008: APLICADAS EN PRODUCCIÓN.** Se verificaron `checkout_attempts`, ambas RPC de creación, `claim_checkout_attempt`, `SECURITY INVOKER`, `search_path`, RLS y permisos.
- Los default privileges de Supabase habían dado a `service_role` privilegios excesivos sobre `checkout_attempts`. El acceso fue corregido manualmente y la migración 008 aplicada después para dejar el hardening reproducible.
- **T-020: paid QA COMPLETADO EN PRODUCCIÓN.** Un pago real validó `checkout → shipping incluido → Mercado Pago → webhook → validación → orders.status=paid`.
- **T-021 permanece COMPLETADA y DEC-026 ACEPTADA.** La migración 006 y el runtime de selección autoritativa de agencia ya formaban parte del estado productivo previo.

## Estado de tareas y decisiones

- **Post-pago UX: COMPLETADO / DESPLEGADO / VALIDADO EN PRODUCCIÓN** (2026-09-17). La implementación fue auditada por Grok, enviada al repositorio y desplegada en EasyPanel. El QA manual en navegador real confirmó el diseño y textos de `/success`, el funcionamiento de “Volver al inicio” y la eliminación de `lemont.cart` y `lemont.checkoutAttempt.v1`. No consulta servicios ni altera el estado del pago; el webhook continúa siendo la autoridad.
- **DEC-022 — Idempotencia durable del checkout: ACEPTADA** (2026-09-16).
- **T-017: COMPLETADA / VALIDADA EN PRODUCCIÓN** (2026-09-17). T-017.1–T-017.4, el cutover y el QA real quedaron cerrados. El hardening READY + order `paid` está desplegado y devolvió 409 `checkout_attempt_already_paid` sobre un intento real sin crear ni modificar recursos.
- **DEC-025 — Cobro autoritativo del envío: ACEPTADA** (2026-09-17), después de la evidencia productiva de pago real con shipping incluido y transición final a `paid`.
- **T-020: COMPLETADA / AUDITADA / VALIDADA EN PRODUCCIÓN.** La migración 005 está aplicada y el paid QA quedó cerrado.
- **DEC-026 — Selección autoritativa de agencia: ACEPTADA.**
- **T-021 — Selección real de sucursal MiCorreo: COMPLETADA.** El detalle de su cierre está en `docs/T021_DEC026_CLOSURE_2026-09-16.md`.

## Incidencia de infraestructura resuelta

- `checkout.lemont01.com` apuntaba por DNS a la IP anterior del VPS; se corrigió al VPS EasyPanel actual.
- El puerto 80 quedó accesible. HTTPS inicialmente entregó un certificado no confiable; el reinicio/regeneración de Traefik permitió emitir un certificado válido de Let's Encrypt.
- Se verificó HTTPS y la llegada completa a Express: un `POST /webhook` sin firma respondió correctamente `401 {"error":"Webhook inválido"}`.
- Mercado Pago entregó después la notificación válida y la orden pasó de `pending` a `paid`; HTTPS y webhook quedaron operativos.

## Pendientes reales

- Sustituir los perfiles TEMPORAL/QA de `300 g / 5 × 25 × 35 cm` por medidas reales y repetir QA.
- T-022.1: cerrar el contrato restante, incluido Classic/Express y la reconciliación práctica por `extOrderId`.
- Completar T-022: confirmar Classic/Express y perfiles físicos reales; diseñar automatización controlada del worker; definir reconciliación real de `unknown`; y cerrar el hardening comercial.
- Implementar catálogo y stock reales desde Supabase, con imágenes y descripciones dinámicas.
- Completar el hardening comercial: restaurar el precio definitivo, rotar credenciales privadas previamente expuestas, ejecutar la auditoría npm y abordar dominio definitivo, frontend final y SEO.

## Regla de alcance

La validación productiva de pagos e idempotencia no equivale a autorización de lanzamiento comercial. Siguen pendientes medidas reales, precio comercial, rotación de credenciales, stock y demás controles operativos enumerados arriba. GitHub/source tree actual continúa siendo la fuente de verdad del código.
