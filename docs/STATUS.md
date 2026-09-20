# Estado vigente del proyecto

**Última actualización:** 2026-09-19

Este archivo resume el estado real vigente. Los bloques históricos de otros documentos que describan T-017 sin desplegar, las migraciones 007/008 sin aplicar, producción en runtime T-021, T-020 sin paid QA o T-021 pendiente deben leerse como antecedentes superados por este corte.

## T-022 — estado productivo vigente

- **T-022: EN PROGRESO.**
- **T-022 CORE / NÚCLEO LOGÍSTICO: FUNCIONAL Y VALIDADO EN PRODUCCIÓN.** HOME Classic completó automáticamente checkout real, pago, webhook, `paid → queued`, claim, `/shipping/import` y `created` con attempt 1, sin intervención manual; el envío fue visible en MiCorreo.
- **AGENCY Classic automático: IMPLEMENTADO / E2E REAL PENDIENTE.** Existen selección de sucursal, checkout/backend y mapping, pero no se declara validación automática real.
- **MiCorreo `orderNumber`: IMPLEMENTADO LOCALMENTE / NO DESPLEGADO** (2026-09-19). `ShippingImportService` valida `snapshot.order_id` como entero positivo seguro y envía `orderNumber = String(order_id)` para HOME y AGENCY Classic. `extOrderId` conserva exactamente su valor y función de correlación técnica/idempotente.
- **DEC-027: PRODUCTIVA / DESPLEGADA / GUARDA OPERATIVA VALIDADA** (2026-09-19). La migración 011, la tabla de auditoría y las RPC condicionales `unknown → created|queued` están productivas. El runtime con `npm run shipping:reconcile-unknown` está desplegado en `shipping-worker`; `unknown` continúa fuera del claim automático.
- **QA PostgreSQL real DEC-027: COMPLETADO.** Se verificaron tabla, RLS activa, cero policies, grants append-only de `service_role`, ausencia de acceso para `anon`/`authenticated`, RPC `SECURITY INVOKER`, `search_path = pg_catalog, public` y EXECUTE restringido. Pruebas sintéticas transaccionales validaron ambas transiciones y fueron revertidas con `ROLLBACK`.
- **Smoke test seguro del CLI: VALIDADO.** `SHIPPING_IMPORT_RECONCILIATION_ENABLED` no está configurada permanentemente. Una invocación sin variable, `--execute`, order ID ni acción terminó con `[shipping-reconciliation] disabled`: cero RPC, cambios de DB, requests a MiCorreo o reconciliaciones reales.
- **Política A de attempts:** el máximo 4 limita sólo retries automáticos. Una requeue humana preserva el contador y autoriza un claim adicional; 4 pasa a 5 al reclamar. No recupera cuatro retries, y cada nueva requeue desde otro `unknown` exige nueva confirmación y auditoría.
- **Checkout público Classic-only: IMPLEMENTADO LOCALMENTE / NO DESPLEGADO** (2026-09-19). La UI filtra antes del render y ofrece sólo `micorreo:home:classic` y `micorreo:agency:classic`; si MiCorreo devuelve exclusivamente Express, muestra la ausencia controlada de opciones. Express conserva soporte interno en rates, snapshots, backend y worker, pero queda oculto temporalmente hasta confirmar el contrato exacto de `/shipping/import`.
- **T-022.6-C: DESPLEGADA / VALIDADA EN PRODUCCIÓN - PROCESO AISLADO / `Dockerfile.worker`** (2026-09-19). EasyPanel ejecuta el worker como servicio separado, sin puerto HTTP; `Dockerfile` y `npm start` continúan dedicados a la web.
- **T-022.6-B: DESPLEGADA / VALIDADA EN PRODUCCIÓN - WORKER AUTOMÁTICO** (2026-09-19). El polling de 60 s permaneció activo durante horas, registró múltiples `outcome=idle` y procesó automáticamente una nueva order HOME Classic sin CLI ni intervención manual.
- **T-022.6-A: DESPLEGADA / VALIDADA EN PRODUCCIÓN - MANUAL ONE-SHOT** (2026-09-18). Una única invocación autorizada realizó un claim, un lease, un POST real y una transición final `created`; permanece como antecedente de validación manual.
- **T-022.5: DESPLEGADA / VALIDADA EN PRODUCCIÓN** (2026-09-18). La migración 010 y el runtime paid+queue legacy-safe confirmaron un pago real y llevaron el snapshot de `not_requested` a `queued`.
- **T-022.4: WORKER DURABLE IMPLEMENTADO / DESPLEGADO / CONSUMIDO POR T-022.6-B.** La ejecución real confirmó lease, attempt y cierre holder-only; el scheduling vive exclusivamente en el proceso aislado.
- **T-022.3: DESPLEGADA / VALIDADA** (2026-09-18). El mapping HOME Classic y `MiCorreoProvider.importShipment` fueron validados con un envío real. Express continúa bloqueado y no se asume CP/EP.
- **T-022.2: DESPLEGADA / VALIDADA EN PRODUCCIÓN** (2026-09-17). La migración 009 y el runtime v3 fueron desplegados en ese orden. Un checkout productivo real sin pago creó order `pending`, `order_items`, `checkout_attempt` y `order_shipping_imports/not_requested`, y llegó correctamente a Mercado Pago.
- **Migración 009: APLICADA EN PRODUCCIÓN.** Existen RPC 26, v2, v3, paid+queue, claim y transiciones/recovery. RPC 26 y v2 permanecen disponibles. El QA PostgreSQL real validó atomicidad y rollback sin residuos, snapshot 300/5/25/35, `declared_value = products_subtotal`, `ext_order_id = orders.external_reference` y la secuencia `pending+not_requested → paid+queued → processing+lease`, sin llamar MiCorreo.
- RLS, ausencia de policies públicas, denegación a `anon`/`authenticated`, EXECUTE exclusivo de `service_role` y UPDATE limitado a las nueve columnas operativas fueron verificados en producción. No hubo backfill: la tabla quedó inicialmente con cero filas.
- **QA AUTOMÁTICO REAL: VALIDADO END-TO-END.** Una nueva compra HOME Classic recorrió `Mercado Pago → webhook → paid → queued → shipping-worker → MiCorreo → created` sin ejecutar `shipping:process-once` ni intervenir manualmente sobre el envío.
- Estado final de esa nueva order: order `paid`, import `created`, attempt 1, timestamps de provider/import presentes y `last_error_type` nulo; no hubo retry, `unknown`, `failed` ni `lease_lost`.
- **`POST /shipping/import`: VALIDADO REALMENTE mediante ejecución manual previa y posteriormente mediante worker automático.** `npm start` continúa sin worker; producción ejecuta `npm run shipping:worker` sólo en el servicio EasyPanel separado, con `SHIPPING_IMPORT_WORKER_ENABLED=true` exclusivamente allí.
- Continúan pendientes los perfiles físicos definitivos para 1–4 remeras, AGENCY Classic E2E, Express, tracking API y label API. `orderNumber` requiere despliegue y validación posterior; no forma parte todavía del runtime productivo.

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

- **MiCorreo `orderNumber`: IMPLEMENTADO LOCALMENTE / NO DESPLEGADO.** El payload local agrega el string decimal de `order_id`, sin prefijo y sin coercionar valores de entrada. `extOrderId` permanece intacto. Pendiente desplegar y validar en una importación futura controlada.
- Sustituir los perfiles TEMPORAL/QA de `300 g / 5 × 25 × 35 cm` por medidas reales y repetir QA.
- Completar T-022: validar AGENCY Classic E2E real, confirmar el contrato de importación Express, sustituir perfiles TEMPORAL/QA y cerrar el hardening comercial.
- Implementar catálogo y stock reales desde Supabase, con imágenes y descripciones dinámicas.
- Completar el hardening comercial: restaurar el precio definitivo, rotar credenciales privadas previamente expuestas, ejecutar la auditoría npm y abordar dominio definitivo, frontend final y SEO.

## Regla de alcance

La validación productiva de pagos e idempotencia no equivale a autorización de lanzamiento comercial. Siguen pendientes medidas reales, precio comercial, rotación de credenciales, stock y demás controles operativos enumerados arriba. GitHub/source tree actual continúa siendo la fuente de verdad del código.
