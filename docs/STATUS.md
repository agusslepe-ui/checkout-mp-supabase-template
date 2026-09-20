# Estado vigente del proyecto

**Última actualización:** 2026-09-19

Este archivo resume el estado real vigente. Los bloques históricos de otros documentos que describan T-017 sin desplegar, las migraciones 007/008 sin aplicar, producción en runtime T-021, T-020 sin paid QA o T-021 pendiente deben leerse como antecedentes superados por este corte.

## T-022 — estado productivo vigente

- **T-022: EN PROGRESO.** El núcleo Classic HOME está operativo; el cierre de T-022 Classic exige todavía AGENCY E2E, `orderNumber` productivo, perfiles reales, QA final y hardening. Express y la automatización de etiqueta/tracking **no** forman parte de ese criterio (DEC-028).
- **T-022 CORE / NÚCLEO LOGÍSTICO: FUNCIONAL Y VALIDADO EN PRODUCCIÓN.** HOME Classic completó automáticamente checkout real, pago, webhook, `paid → queued`, claim, `/shipping/import` y `created` con attempt 1, sin intervención manual; el envío fue visible en MiCorreo.
- **Flujo productivo validado:** checkout → Mercado Pago → webhook → order `paid` → shipping `queued` → `shipping-worker` → `/shipping/import` MiCorreo → `created`.
- **Worker:** proceso aislado en EasyPanel, polling automático, producción validada.
- **AGENCY Classic automático: IMPLEMENTADO / E2E REAL PENDIENTE.** Existen selección de sucursal, checkout/backend y mapping (`deliveryType: S`). No se declara validado hasta el QA real de sucursal. No confundir con HOME.
- **MiCorreo `orderNumber`: IMPLEMENTADO / COMMIT + PUSH / DEPLOY PENDIENTE** (2026-09-19). Código y tests en `main` (`db889d0`). Regla: `orderNumber = String(order_id)` tras exigir un entero positivo seguro. Ejemplo: `orders.id = 72` → MiCorreo `orderNumber = "72"`. `extOrderId` permanece la correlación técnica estable/idempotente (`orders.external_reference`); no se deriva uno del otro. No hay evidencia documental de redeploy de `shipping-worker` posterior a este commit: **no está declarado productivo**.
- **DEC-027: PRODUCTIVA / DESPLEGADA / GUARDA OPERATIVA VALIDADA** (2026-09-19). Migración 011 aplicada. Tabla de auditoría productiva. RPC `unknown → created` y `unknown → queued` productivas. RLS, grants, `SECURITY INVOKER` y `search_path` verificados. QA PostgreSQL real con `BEGIN/ROLLBACK` validado. CLI administrativo desplegado. Guarda operativa validada. Reconciliación deshabilitada por defecto. No existen casos `unknown` reales actualmente.
- **QA PostgreSQL real DEC-027: COMPLETADO.** Se verificaron tabla, RLS activa, cero policies, grants append-only de `service_role`, ausencia de acceso para `anon`/`authenticated`, RPC `SECURITY INVOKER`, `search_path = pg_catalog, public` y EXECUTE restringido. Pruebas sintéticas transaccionales validaron ambas transiciones y fueron revertidas con `ROLLBACK`.
- **Smoke test seguro del CLI: VALIDADO.** `SHIPPING_IMPORT_RECONCILIATION_ENABLED` no está configurada permanentemente. Una invocación sin variable, `--execute`, order ID ni acción terminó con `[shipping-reconciliation] disabled`: cero RPC, cambios de DB, requests a MiCorreo o reconciliaciones reales.
- **Política A de attempts / unknown:** no hay retry automático. Verificación humana en MiCorreo. Existe → `unknown → created`. Ausencia no confirmada → mantener `unknown`. Ausencia confirmada → requeue humana. Cada requeue autoriza exactamente un claim adicional. `attempt_count` nunca se resetea. `maxAttempts=4` limita retries automáticos. Nunca usar `shipping:process-once` como reconciliación.
- **DEC-028: ACEPTADA** (2026-09-19). Tras el import `created`, revisar el envío en MiCorreo, pagar el envío, generar/obtener etiqueta y las acciones de despacho/tracking en el portal **permanecen MANUAL POR DISEÑO**. Motivo: el pago del envío es una acción económica y se prefiere supervisión humana. Esto **no** es “automatización pendiente”. No automatizar sin una decisión futura nueva.
- **Express: MEJORA FUTURA / OPCIONAL.** Cotización y soporte interno parcial conservados; oculto del checkout público en `main`; `/shipping/import` bloquea Express con `UNSUPPORTED_SERVICE`. El contrato exacto de importación sigue pendiente. **No bloquea** la operación Classic actual ni el criterio de cierre Classic.
- **Checkout público Classic-only: IMPLEMENTADO / COMMIT + PUSH A MAIN; REDEPLOY WEB NO DOCUMENTADO** (commit `ba2e4fc`). La UI en código filtra antes del render y ofrece sólo HOME Classic y AGENCY Classic. No se afirma que el runtime web productivo ya sirva esa restricción.
- **Perfiles físicos: TEMPORAL / QA.** Valores actuales `300 g` y `5 × 25 × 35 cm`. No representan perfiles finales de producción.
- **T-022.6-C: DESPLEGADA / VALIDADA EN PRODUCCIÓN - PROCESO AISLADO / `Dockerfile.worker`** (2026-09-19). EasyPanel ejecuta el worker como servicio separado, sin puerto HTTP; `Dockerfile` y `npm start` continúan dedicados a la web.
- **T-022.6-B: DESPLEGADA / VALIDADA EN PRODUCCIÓN - WORKER AUTOMÁTICO** (2026-09-19). El polling de 60 s permaneció activo durante horas, registró múltiples `outcome=idle` y procesó automáticamente una nueva order HOME Classic sin CLI ni intervención manual.
- **T-022.6-A: DESPLEGADA / VALIDADA EN PRODUCCIÓN - MANUAL ONE-SHOT** (2026-09-18). Una única invocación autorizada realizó un claim, un lease, un POST real y una transición final `created`; permanece como antecedente de validación manual.
- **T-022.5: DESPLEGADA / VALIDADA EN PRODUCCIÓN** (2026-09-18). La migración 010 y el runtime paid+queue legacy-safe confirmaron un pago real y llevaron el snapshot de `not_requested` a `queued`.
- **T-022.4: WORKER DURABLE IMPLEMENTADO / DESPLEGADO / CONSUMIDO POR T-022.6-B.** La ejecución real confirmó lease, attempt y cierre holder-only; el scheduling vive exclusivamente en el proceso aislado.
- **T-022.3: DESPLEGADA / VALIDADA** (2026-09-18) para el contrato Classic previo. El agregado `orderNumber` está en `main` y **no** forma parte todavía del runtime productivo del worker.
- **T-022.2: DESPLEGADA / VALIDADA EN PRODUCCIÓN** (2026-09-17). La migración 009 y el runtime v3 fueron desplegados en ese orden. Un checkout productivo real sin pago creó order `pending`, `order_items`, `checkout_attempt` y `order_shipping_imports/not_requested`, y llegó correctamente a Mercado Pago.
- **Migración 009: APLICADA EN PRODUCCIÓN.** Existen RPC 26, v2, v3, paid+queue, claim y transiciones/recovery. RPC 26 y v2 permanecen disponibles. El QA PostgreSQL real validó atomicidad y rollback sin residuos, snapshot 300/5/25/35, `declared_value = products_subtotal`, `ext_order_id = orders.external_reference` y la secuencia `pending+not_requested → paid+queued → processing+lease`, sin llamar MiCorreo.
- RLS, ausencia de policies públicas, denegación a `anon`/`authenticated`, EXECUTE exclusivo de `service_role` y UPDATE limitado a las nueve columnas operativas fueron verificados en producción. No hubo backfill: la tabla quedó inicialmente con cero filas.
- **QA AUTOMÁTICO REAL: VALIDADO END-TO-END.** Una nueva compra HOME Classic recorrió `Mercado Pago → webhook → paid → queued → shipping-worker → MiCorreo → created` sin ejecutar `shipping:process-once` ni intervenir manualmente sobre el envío.
- Estado final de esa nueva order: order `paid`, import `created`, attempt 1, timestamps de provider/import presentes y `last_error_type` nulo; no hubo retry, `unknown`, `failed` ni `lease_lost`.
- **`POST /shipping/import`: VALIDADO REALMENTE mediante ejecución manual previa y posteriormente mediante worker automático.** `npm start` continúa sin worker; producción ejecuta `npm run shipping:worker` sólo en el servicio EasyPanel separado, con `SHIPPING_IMPORT_WORKER_ENABLED=true` exclusivamente allí.

## Criterio futuro de cierre Classic de T-022

T-022 Classic puede cerrarse cuando ocurran todos estos puntos. Express queda fuera del criterio obligatorio. Tracking, etiqueta y pago del envío son MANUAL POR DISEÑO (DEC-028) y también quedan fuera del criterio obligatorio.

- HOME Classic E2E validado — **cumplido**
- AGENCY Classic E2E validado — pendiente
- worker productivo — **cumplido**
- reconciliación `unknown` productiva (DEC-027) — **cumplido**
- `orderNumber` productivo y verificado en MiCorreo — pendiente de redeploy + compra real
- perfiles físicos reales 1–4 remeras — pendiente
- QA final Classic con esos perfiles — pendiente
- documentación y hardening comercial final — pendiente

## PRÓXIMOS PASOS DE LOGÍSTICA — ORDEN RECOMENDADO

1. Redeploy de `shipping-worker` con el `main` que incluye `orderNumber`.
2. Verificar `orderNumber` en la próxima compra real HOME Classic (MiCorreo debe mostrar Número de orden igual a `orders.id`).
3. QA E2E real AGENCY Classic.
4. Definir perfiles físicos reales para 1, 2, 3 y 4 remeras.
5. QA final Classic con perfiles reales.
6. Hardening comercial final.
7. Express sólo si se decide ofrecerlo.

Revisión / pago del envío / etiqueta / tracking: **MANUAL POR DISEÑO**. No entran en el camino crítico.

## Hardening comercial final — no ejecutar ahora

Antes de considerar el sistema listo para uso comercial continuo, sin implementar ahora:

- revisar y rotar credenciales que alguna vez pudieron quedar expuestas
- confirmar secrets separados por servicio (web vs `shipping-worker`)
- verificar que `SHIPPING_IMPORT_RECONCILIATION_ENABLED` no quede permanente
- smoke de web
- smoke de worker
- pago real
- webhook
- shipping import
- logs sin PII ni secrets
- estado limpio de Git
- documentación sincronizada

Pendientes de producto ya existentes y ajenos al camino crítico logístico: precio comercial definitivo, catálogo/stock dinámicos, auditoría npm, dominio/frontend/SEO.

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
- **DEC-027 — Reconciliación operativa conservadora de `unknown`: PRODUCTIVA / DESPLEGADA / GUARDA OPERATIVA VALIDADA** (2026-09-19).
- **DEC-028 — Operación manual posterior al import (pago del envío, etiqueta, tracking): ACEPTADA** (2026-09-19).

## Incidencia de infraestructura resuelta

- `checkout.lemont01.com` apuntaba por DNS a la IP anterior del VPS; se corrigió al VPS EasyPanel actual.
- El puerto 80 quedó accesible. HTTPS inicialmente entregó un certificado no confiable; el reinicio/regeneración de Traefik permitió emitir un certificado válido de Let's Encrypt.
- Se verificó HTTPS y la llegada completa a Express: un `POST /webhook` sin firma respondió correctamente `401 {"error":"Webhook inválido"}`.
- Mercado Pago entregó después la notificación válida y la orden pasó de `pending` a `paid`; HTTPS y webhook quedaron operativos.

## Pendientes reales

- **MiCorreo `orderNumber`: IMPLEMENTADO / COMMIT + PUSH / DEPLOY PENDIENTE.** Redeploy de `shipping-worker` con el último `main`; próxima compra real; confirmar en MiCorreo que Número de orden = `orders.id`. No declarar productivo hasta esa verificación.
- **AGENCY Classic: IMPLEMENTADO / E2E REAL PENDIENTE.** Compra controlada con sucursal, `paid → queued`, worker, `/shipping/import` con `deliveryType: S` y agencia seleccionada, `created` en DB, `attempt_count` esperado y `orderNumber` visible.
- Sustituir los perfiles TEMPORAL/QA de `300 g / 5 × 25 × 35 cm` por medidas reales de 1–4 remeras; actualizar mapping/perfiles, tests, cotización, snapshot y QA MiCorreo. No implementar ahora.
- Hardening comercial final (lista de esta página). No ejecutar ahora.
- **Express: MEJORA FUTURA / OPCIONAL.** Antes de exponerlo: contrato oficial exacto, mapping, tests, QA real y recién entonces habilitación pública.
- Implementar catálogo y stock reales desde Supabase, con imágenes y descripciones dinámicas (fuera del camino crítico de T-022 Classic).
- Precio comercial definitivo, auditoría npm, dominio definitivo, frontend final y SEO (fuera del camino crítico de T-022 Classic).

## Regla de alcance

La validación productiva de pagos, idempotencia y del núcleo HOME Classic no equivale a autorización de lanzamiento comercial ni al cierre de T-022. Siguen pendientes AGENCY E2E, `orderNumber` productivo, perfiles reales, QA final y hardening. GitHub/`main` es la fuente de verdad del código; el runtime del worker se considera productivo sólo cuando hay evidencia de redeploy.
