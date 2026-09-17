# Estado vigente del proyecto

**Última actualización:** 2026-09-17

Este archivo resume el estado real vigente. Los bloques históricos de otros documentos que describan T-017 sin desplegar, las migraciones 007/008 sin aplicar, producción en runtime T-021, T-020 sin paid QA o T-021 pendiente deben leerse como antecedentes superados por este corte.

## Producción

- **Runtime T-017: DESPLEGADO EN EASYPANEL.** La creación durable usa `create_pending_order_with_items_v2` (27 parámetros); la RPC anterior `create_pending_order_with_items` (26 parámetros) permanece disponible.
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
- Etapa D: crear el envío post-pago mediante MiCorreo `POST /shipping/import`.
- Implementar catálogo y stock reales desde Supabase, con imágenes y descripciones dinámicas.
- Completar el hardening comercial: restaurar el precio definitivo, rotar credenciales privadas previamente expuestas, ejecutar la auditoría npm y abordar dominio definitivo, frontend final y SEO.

## Regla de alcance

La validación productiva de pagos e idempotencia no equivale a autorización de lanzamiento comercial. Siguen pendientes medidas reales, precio comercial, rotación de credenciales, stock y demás controles operativos enumerados arriba. GitHub/source tree actual continúa siendo la fuente de verdad del código.
