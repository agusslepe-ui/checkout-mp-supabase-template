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

- **DEC-022 — Idempotencia durable del checkout: ACEPTADA** (2026-09-16).
- **T-017: EN PROGRESO.** T-017.1, T-017.2 y T-017.3 están completadas/auditadas; T-017.4-A está completada/auditada; el cutover y el QA real de idempotencia se ejecutaron correctamente. Falta resolver y validar la reutilización de un attempt `ready` cuando su orden asociada ya está `paid`.
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

- Impedir que un `checkout_attempt` `ready` reutilice una preferencia vieja cuando la orden asociada ya está `paid`.
- Convertir `success.html` en una página real de “Gracias por tu compra”.
- Definir limpieza segura del carrito y `sessionStorage` después del retorno exitoso.
- Etapa D: crear el envío post-pago mediante MiCorreo `POST /shipping/import`.
- Implementar stock real por SKU y catálogo dinámico desde Supabase.
- Hacer dinámicas las imágenes y descripciones.
- Sustituir los perfiles TEMPORAL/QA de `300 g / 5 × 25 × 35 cm` por medidas reales y repetir QA.
- Restaurar el precio comercial definitivo.
- Rotar credenciales privadas previamente expuestas antes del lanzamiento.
- Ejecutar la auditoría npm pendiente.
- Abordar dominio definitivo, frontend final y SEO en etapas posteriores.

## Regla de alcance

La validación productiva de pagos e idempotencia no equivale a autorización de lanzamiento comercial. Siguen pendientes medidas reales, precio comercial, rotación de credenciales, stock y demás controles operativos enumerados arriba. GitHub/source tree actual continúa siendo la fuente de verdad del código.
