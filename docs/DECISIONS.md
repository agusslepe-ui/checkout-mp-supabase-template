# Decisiones técnicas

## DEC-027 — Reconciliación operativa conservadora de shipping imports `unknown`

**Fecha:** 2026-09-19.
**Estado:** ACEPTADA COMO POLÍTICA OPERATIVA / IMPLEMENTACIÓN PENDIENTE.
**Tarea:** T-022.

### Contexto

`unknown` significa que el resultado externo puede haber ocurrido y no existe evidencia suficiente para afirmar `created` ni para repetir `/shipping/import`. El esquema actual lo deja sin lease y sin `next_attempt_at`; `claim_order_shipping_import` sólo reclama `queued` o `retryable` vencido. El worker no reclama, transforma ni reconcilia `unknown`.

`expire_order_shipping_import_leases` también lleva un `processing` vencido a `unknown`, porque el POST pudo haberse ejecutado antes de perderse el lease. Las RPC finales actuales sólo aceptan `processing` con lease vigente. No existe hoy una operación administrativa `unknown → created|queued|retryable|failed`.

La correlación estable para buscar el envío es `order_shipping_imports.ext_order_id = orders.external_reference`. Su valor real no debe aparecer en documentación ni logs ordinarios.

### Decisión

1. **Si el envío existe en MiCorreo:** no volver a importar. Una futura operación administrativa podrá ejecutar condicional e idempotentemente `unknown → created`, dejando evidencia de reconciliación manual. `provider_created_at` sólo se completará si MiCorreo ofrece una fecha verificable; nunca se inventará. El `imported_at` requerido por el estado `created` podrá registrar el cierre local, pero no se presentará como fecha del proveedor; un eventual `reconciled_at` haría explícita esa diferencia.
2. **Si no aparece inmediatamente:** la ausencia en el portal no prueba que no exista. Se mantiene `unknown`, no se agenda retry y el operador vuelve a verificar.
3. **Si una persona confirma explícitamente que no existe:** una futura operación administrativa podrá reencolar condicionalmente desde `unknown`. `queued` representará reintento manual inmediato; `retryable` sólo se usará si se define un `next_attempt_at` futuro. Se preservan `ext_order_id`, snapshot y `attempt_count`.
4. **Si sigue ambiguo:** permanece `unknown` indefinidamente. No se reintenta ni pasa automáticamente a `failed`.
5. `shipping:process-once` no es una herramienta de reconciliación. El claim no tomará la fila `unknown`, y no se debe alterar su estado por fuera de la futura interfaz administrativa.

### Requisitos de la futura herramienta

- Backend/admin only; nunca endpoint público ni acción desde el navegador del comprador.
- RPC dedicada con `SECURITY INVOKER`, `search_path` fijo, `EXECUTE` revocado a `PUBLIC`, `anon` y `authenticated`, y concedido sólo a `service_role` en la arquitectura actual o a un futuro rol backend aún más acotado.
- Transición atómica condicionada a `state = 'unknown'`, con lock de fila o UPDATE condicional equivalente.
- Idempotencia: repetir la misma acción no duplica importación ni modifica otro estado.
- No puede modificar filas `created`, `processing`, `queued`, `retryable`, `failed` o `not_requested`.
- No reinicia `attempt_count`, no cambia `ext_order_id` ni reconstruye el snapshot.
- Logs allowlisted, sin PII, payload, respuesta completa, dirección, contacto, token, customerId ni referencia real.
- Evidencia durable de fecha, acción y motivo de la reconciliación humana.

### Datos de auditoría a evaluar

Campos candidatos en la fila actual: `reconciled_at`, `reconciliation_action` y `reconciliation_reason`.

**Ventajas:** consulta operativa simple; evidencia junto al estado; validación e idempotencia más directas; permite distinguir una creación confirmada por provider de una reconciliación humana.

**Costos/riesgos:** requieren migración, constraints, grants y semántica de retención; una razón libre puede introducir PII o datos externos; una sola fila no conserva múltiples verificaciones. Si se adoptan, `reconciliation_action` y `reconciliation_reason` deben usar códigos controlados, no texto libre.

Una tabla de auditoría append-only preservaría varios eventos y actor/correlación operativa, pero agrega esquema, permisos, retención y consultas. La elección entre columnas y tabla queda para el diseño de implementación. **Esta decisión no crea columnas, RPC, endpoint ni transición.**

### Consecuencias

- Evita duplicados ante resultados externos ambiguos.
- Puede dejar filas `unknown` indefinidamente; es una propiedad de seguridad aceptada.
- Requiere verificación humana y una herramienta administrativa futura antes de cualquier mutación.
- T-022 conserva el núcleo HOME Classic productivo, pero no queda completamente cerrado mientras falten AGENCY Classic E2E, Express, perfiles físicos y la implementación de esta reconciliación.

## T-022.6-C — despliegue aislado mediante Dockerfile dedicado

**Estado:** DESPLEGADA / VALIDADA EN PRODUCCIÓN - PROCESO AISLADO / `Dockerfile.worker` (2026-09-19).

- Web y worker usan el mismo repositorio y construcción base, pero se ejecutan como servicios EasyPanel separados.
- `Dockerfile` mantiene `npm start` y el puerto HTTP; `Dockerfile.worker` no expone puerto y ejecuta exclusivamente `npm run shipping:worker`.
- La guarda de activación se configura sólo en el servicio worker. No se incorporan variables ni secretos a las imágenes.
- La separación quedó validada mediante operación sostenida e importación automática real.

## T-022.6-B — polling aislado y fail-stop acotado

**Estado:** DESPLEGADA / VALIDADA EN PRODUCCIÓN - WORKER AUTOMÁTICO (2026-09-19).

- El worker automático se despliega como proceso Node separado; nunca se mezcla con `npm start`, Express o webhook.
- Se elige primera iteración inmediata y scheduling recursivo 60 s después de completar; intervalo configurable con mínimo 10 s.
- Se procesa una sola fila por ciclo. No existe drain loop, overlap, retry inmediato de `unknown`/`lease_lost` ni espera Node de `next_attempt_at`.
- PostgreSQL conserva autoridad multi-instancia con `FOR UPDATE SKIP LOCKED` y lease; no se implementan locks distribuidos en Node.
- Cinco errores inesperados consecutivos producen fail-stop: core marca fatal y detiene scheduling; tras limpiar el ciclo, el entrypoint recibe un único callback y termina con exit 1. Cualquier outcome controlado resetea el contador.
- SIGTERM/SIGINT esperan la operación activa hasta 30 s. Timeout significa `shutdown_timeout` + exit 1, no `stopped`, no cancelación artificial y no success tardío. Expire permanece manual y no se ejecuta en cada tick.
- La guarda deshabilitada y la configuración inválida usan exit 1 para hacer visible una mala configuración de servicio.
- La validación real confirmó polling de 60 s durante horas, múltiples `outcome=idle` y procesamiento automático HOME Classic hasta `created`, sin CLI manual, retry ni resultado ambiguo.

## T-022.6 — cierre de QA real y límite de activación

**Estado:** QA REAL MANUAL Y AUTOMÁTICO MICORREO VALIDADO END-TO-END (2026-09-19).

- Se acepta como evidencia suficiente una única ejecución productiva controlada: HOME Classic, pago/webhook, `paid + queued`, claim/lease, un POST, `createdAt` válido y cierre `created` con attempt 1.
- La verificación visual del portal confirma el envío como **Validado** y la correspondencia del snapshot QA 0,3 kg / 35 × 25 × 5 cm.
- La validación manual cerró T-022.6-A. Una compra posterior validó el flujo automático completo mediante el servicio aislado T-022.6-B/C, sin `shipping:process-once` ni intervención manual.
- Express sigue bloqueado. Perfiles definitivos, reconciliación de `unknown`, tracking API, label API y hardening comercial requieren decisiones posteriores.
- La evidencia documental se mantiene deliberadamente libre de PII, IDs de pago, referencias, credenciales y payloads.

## T-022.6-A — activación manual con doble consentimiento

**Estado:** DESPLEGADA / VALIDADA EN PRODUCCIÓN MEDIANTE EJECUCIÓN MANUAL ONE-SHOT (2026-09-18).

- Se separan process-once y expire-once; nunca se encadenan y cada invocación llama como máximo una vez la operación elegida.
- Se exige doble consentimiento exacto (`--execute` + `SHIPPING_IMPORT_MANUAL_EXECUTION=true`) antes de cargar dependencias con capacidad de mutación.
- Una guarda ausente se trata como error operativo (exit 1). Todos los outcomes controlados del worker, incluso `unknown`, `failed` y `lease_lost`, usan exit 0 porque representan decisiones de dominio persistidas.
- Se prefiere texto key/value allowlisted sobre JSON del resultado para impedir filtraciones accidentales al crecer los objetos internos.
- No se modifica la política Classic-only: Express continúa en `UNSUPPORTED_SERVICE → failed`; no se agregan CP/EP.

## T-022.5 — pago autoritativo y cola logística opcional

**Estado:** DESPLEGADA / VALIDADA EN PRODUCCIÓN (2026-09-18).

- Se adopta una RPC v2 aditiva en migración 010 aplicada; la función de 009 se preserva durante el cutover.
- La confirmación financiera es autoritativa: una order válida pasa de `pending` a `paid` aunque falte el snapshot o éste no esté en `not_requested`.
- Cuando el snapshot elegible existe, `paid + queued` comparte transacción. La cola se intenta después del pago en un subbloque para que una excepción logística no revierta la confirmación.
- No hay backfill ni reconstrucción. `shipping_queued=false` representa legacy, estado logístico no elegible o anomalía; no convierte el pago en fallo.
- PostgreSQL serializa webhooks concurrentes con `FOR UPDATE`; Node conserva las comparaciones previas y consume el resultado mínimo de la RPC.
- La migración 010 y el flujo paid+queue están validados en producción; la automatización posterior quedó validada en T-022.6-B/C. Quedan pendientes Express, perfiles reales y reconciliación de `unknown`.

## T-022.4 — política del worker durable local

**Fecha:** 2026-09-18. **Estado vigente:** IMPLEMENTADO / DESPLEGADO / CONSUMIDO POR T-022.6-B.

- Una invocación procesa como máximo un claim. La DB/RPC mantiene la exclusión concurrente; Node no agrega locks.
- Lease 60 s; backoff determinista 1/5/15 min; máximo cuatro attempts. Sin jitter por ahora.
- `RATE_LIMIT`, AUTH previo al POST y transporte marcado con certeza como previo al POST son retryable hasta el límite. VALIDATION, servicio no soportado y rechazo del provider son failed. Todo resultado ambiguo es unknown.
- El primer fallo AUTH antes del POST puede reintentarse; POST 401 seguido por fallo de renovación y segundo POST 401 son unknown. No existe retry logístico ni tercer POST en esa iteración.
- `numeric` string se normaliza exclusivamente en el borde worker mediante formato decimal canónico. El servicio conserva contrato number estricto.
- Cierre holder-only nulo produce `lease_lost` sin otra escritura. Recovery de leases vencidos usa sólo la RPC existente y no se agenda.
- El one-shot manual fue la primera activación validada. Posteriormente, T-022.6-B/C desplegó el caller automático como proceso separado; no se integra polling en startup web ni webhook.

## T-022.3 — política contractual local (sin número DEC asignado)

**Fecha:** 2026-09-18. **Estado:** DESPLEGADA / VALIDADA.

- Se conserva `ShippingImportService → ShippingProvider → MiCorreoProvider`; las transiciones durables y el worker aislado fueron agregados posteriormente sin cambiar estas capas.
- Sólo Classic puede construirse localmente. Express falla con `UNSUPPORTED_SERVICE` y no se asume `classic → CP` ni `express → EP`; se omite `productType` hasta confirmar contrato.
- `shipping_apartment` no se trunca ni divide: floor/apartment se omiten temporalmente.
- HOME usa el domicilio de la order; AGENCY usa `shipping_agency_code`. Ambos consumen medidas y declared value congelados.
- Sólo 2xx + `createdAt` válido confirma creación; resultados inciertos quedan ambiguos para el worker futuro.
- HOME Classic fue validado primero mediante llamada manual y después mediante worker automático real. Quedan pendientes AGENCY Classic E2E, contrato Express, perfiles reales e implementación de DEC-027.
- La auditoría independiente de Grok aprobó con observaciones y sin bloqueantes las validaciones sin coerción, calendario estricto, HTTP 408 ambiguo y timeout separado sólo mediante opt-in de import; los contratos históricos de timeout de token/rates/agencies permanecen intactos.
- Observaciones para T-022.4: interpretar conservadoramente el fallo de renovación posterior a un POST 401; normalizar de forma explícita un posible `numeric` string en el borde repository/worker; ampliar cobertura de tipos/whitespace; y considerar la exportación de `normalizeProvince` como API interna de riesgo bajo.

## T-022 — arquitectura durable aprobada (sin número DEC asignado)

**Estado:** T-022 EN PROGRESO; T-022.2 DESPLEGADA / VALIDADA EN PRODUCCIÓN (2026-09-17).

- Estado financiero y logístico independientes; un error de importación nunca revierte una order `paid`.
- Una fila por order y `ext_order_id = orders.external_reference`, estable e inmutable entre retries.
- Snapshot físico en el checkout y `declared_value = products_subtotal`, excluyendo shipping. Perfiles actuales exclusivamente TEMPORAL/QA.
- `unknown` representa resultado externo incierto y no se reintenta automáticamente. Un lease expirado termina en `unknown`.
- El claim es durable, concurrente-seguro y holder-only. Las RPC anteriores se conservan; v3 agrega el snapshot sin romper RPC 26/v2.
- La migración 009 está aplicada y el runtime v3 desplegado. El QA real validó atomicidad, rollback, grants/RLS, state machine hasta claim y checkout productivo `pending/not_requested`, sin crear envíos.
- Este cierre no autoriza ni activa provider, `/shipping/import`, worker o integración webhook paid+queue. Esta última requiere antes una solución legacy-safe para orders sin snapshot.
- Pendientes de decisión/cierre: T-022.1, Classic/Express, reconciliación práctica de duplicados por `extOrderId`, perfiles reales y contrato final del proveedor. No se asumen tracking, shipment ID ni labels.

## DEC-026 — Selección autoritativa de agencia

**Fecha:** 2026-09-15.
**Estado:** ACEPTADA. **Cierre:** 2026-09-16.
**Tarea:** T-021 COMPLETADA.

- API exclusiva MiCorreo `GET /agencies`, autenticada con el JWT/cache existente. Query autoritativa: customerId backend + provinceCode derivado de `delivery.province`; sin CP ni services.
- `response[].code` es la identidad. El browser recibe agencias normalizadas y envía solo `shippingAgencyCode`.
- Solo agencias ACTIVE; si `services.pickupAvailability` existe debe ser true. Lista vacía es resultado válido.
- HOME no consulta agencias, ignora code extra y persiste snapshot null. AGENCY Classic/Express exige code y revalida rate + agencia antes de RPC.
- Snapshot: code, name, streetName, streetNumber, locality y postalCode provenientes de MiCorreo. No manager/email/phone/coordenadas/customerId/hours/raw.
- Migración 006: columnas nullable, checks HOME/AGENCY y firma RPC única. Aplicada y validada durante el cierre de T-021.
- Total, preferencia MP, external_reference, webhook y HMAC no cambian. `/shipping/import` queda futuro y usará agency code.
- Perfiles continúan TEMPORAL/QA; la tienda no queda lista para público.

## DEC-025 — Cobro autoritativo del envío

**Fecha de propuesta:** 2026-09-15. **Fecha de aceptación:** 2026-09-17.
**Estado:** ACEPTADA.
**Tarea:** T-020 COMPLETADA / AUDITADA / VALIDADA EN PRODUCCIÓN.

- Persistencia aditiva en `orders`: `products_subtotal`, `shipping_amount`, `shipping_provider`, `shipping_option_id`, `shipping_delivery_type` y `shipping_service`. No se crea `order_shipping`.
- `orders.amount` es el total final: `products_subtotal + shipping_amount`; el subtotal coincide con `SUM(order_items.line_total)`.
- El navegador envía solo `shippingOptionId`; backend resuelve otra vez el carrito, recotiza MiCorreo y toma la tarifa vigente. Precios y totales del cliente se ignoran.
- Solo `micorreo:home:classic` y `micorreo:home:express` son cobrables. Agency permanece informativa y no se persiste ni se envía a Mercado Pago.
- Si la opción desaparece, checkout responde 409. Fallos de MiCorreo responden 503 sin crear orden. Carritos de 5+ unidades responden 400 sin cotizar ni crear orden/preferencia.
- Rates con el mismo ID/precio se colapsan; con el mismo ID y precios distintos se descartan por ambigüedad.
- Mercado Pago recibe los productos y un único ítem adicional `Envío`; no se usa `shipments`.
- La migración `005_add_order_shipping_snapshot.sql` y la firma RPC fueron desplegadas como parte de T-020.
- Evidencia de aceptación: un pago real en producción validó `checkout → shipping incluido → Mercado Pago → webhook → validación → orders.status=paid`. El paid QA pendiente quedó completado.
- Los perfiles 1–4 continúan en 300 g / 5 × 25 × 35 cm, exclusivamente TEMPORAL/QA. No habilitan lanzamiento comercial.
- En T-020, T-017/DEC-022, `/shipping/import`, agencias, tracking y stock permanecían fuera de alcance. T-021 agrega selección de agencia, sin implementar import/tracking/stock.

## DEC-024 — Perfiles de paquete + cotización informativa multítem

**Estado:** ACEPTADA.
**Tarea:** T-019. **Cierre formal:** 2026-09-15, tras auditoría (APROBADO CON OBSERVACIONES) y prueba real `POST /rates` PROD.

- D1/B1: cotizar solo 1–4 unidades totales del carrito resuelto/agrupado. Es independiente del máximo por SKU; 5+ devuelve 400 genérico sin llamar MiCorreo.
- D2: cuatro perfiles editables en `src/packageProfiles.js`. Cada perfil 1/2/3/4 usa **300 g / 5 × 25 × 35 cm**, TEMPORAL/QA, no packaging definitivo de producción ni multiplicación de medidas individuales.
- D3: frontend mínimo multítem en `envio.js` y `entrega.js`; cotización informativa, sin incorporarla al pago.
- D4: mostrar domicilio/sucursal devueltos; sin selección de agencia ni `/agencies`.
- D5: CP → Clásico, EP → Express solo si está en la respuesta; no solicitar EP ni enviar `deliveredType`. Descartar servicios desconocidos.
- Backend autoritativo: contrato dual `items[]` o `sku+quantity`, sin mezcla, resuelto con `resolveCart`. CustomerId/origen desde entorno, dimensiones desde perfil, destino validado; ignorar campos comerciales/logísticos del cliente.
- Origen de producción acordado: **CP 5465 — Rodeo, San Juan**. Configurarlo privadamente mediante `SHIPPING_ORIGIN_POSTAL_CODE`; no se cambió `.env`. Fixtures pueden usar 1000.
- Respuesta normalizada: id/provider/type/deliveryType/service/label/price. Sin customerId, validTo ni respuesta cruda; sin persistir tarifas ni secretos.
- Etapa B = saber costo; Etapa C = cobrar costo. Mercado Pago, webhook, HMAC, RPC, migraciones, `orders.amount` y `preference.items` intactos.
- Prueba real `POST /rates` PROD (2026-09-15): `micorreo_rates_ok options=4`. Origen CP 5465 (Rodeo, San Juan). Destino QA CP 5400. No se imprimió JWT, password, Basic Auth, Bearer, `customerId` ni respuesta cruda. No se llamó `/shipping/import`. No se creó envío. Mercado Pago intacto. Envío no cobrado.
- Los perfiles 1–4 siguen TEMPORAL/QA. Las medidas actuales **no** están aprobadas para producción.
- En el cierre histórico de T-019, Etapa C (cobrar el envío) seguía PENDIENTE. Ese estado fue superado: T-020 quedó validada con pago real y DEC-025 fue aceptada el 2026-09-17.

## DEC-023 — ShippingService / ShippingProvider / MiCorreoProvider

**Fecha:** 2026-09-14. **Estado:** ACEPTADA.
**Cierre formal:** 2026-09-15, tras auditoría de T-018 (APROBADO CON OBSERVACIONES) y prueba real de `POST /token` PROD.

- Separación mínima: servicio → contrato interno con `authenticate()` y `quoteRates(...)` → MiCorreoProvider.
- Etapa A (T-018) COMPLETADA: autenticación y provider. Variables MiCorreo opcionales al startup.
- Contrato oficial aportado por el usuario: `POST {MICORREO_BASE_URL}/token`, HTTP Basic Auth, respuesta `{ token, expires }`; parseo de fecha, fallback JWT `exp`, margen, caché en memoria, solicitud compartida, timeout y un retry de tarifas ante 401.
- Hook interno exportado; nunca endpoint público ni secretos en logs/respuestas HTTP.
- Prueba real ejecutada por el usuario: `POST /token` contra API MiCorreo PROD → `micorreo_auth_ok`. No se imprimió ni persistió JWT, contraseña, Basic Auth ni `customerId`. No se invocó `/rates` ni `/shipping/import`.
- `/cotizar-envio` conserva quantity estrictamente 1, dimensiones TEMPORAL/QA y tarifa informativa sin persistencia ni inclusión en el total.
- Fuera de alcance hasta definición y autorización posteriores: Etapas B/C/D, cotización real multítem, paquete real, sucursal, Express, `/shipping/import`, shipments, emails y devoluciones. Etiquetas/tracking no se implementan: según el usuario, no están documentados oficialmente en el PDF actual.
- Checkout, Mercado Pago, webhook, HMAC, migraciones, frontend de compra y DEC-022/T-017 intactos.

Este registro distingue decisiones observadas en el código de decisiones todavía pendientes. Las alternativas indicadas como inferidas deben confirmarse antes de rediseñar el sistema.

---

## D-001 Usar Checkout Pro

- Estado: vigente.
- Decisión: redirigir al comprador al checkout alojado por Mercado Pago.
- Motivo inferido: reducir el alcance del frontend y delegar la experiencia de pago al proveedor.
- Alternativas: Checkout API o una integración personalizada.
- Consecuencia: el sistema depende de preferencias, retornos y webhooks de Mercado Pago.

## D-002 Confirmar pagos desde el backend

- Estado: vigente.
- Decisión: consultar `Payment.get` ante un webhook y usar esa respuesta para confirmar el estado.
- Motivo: no confiar únicamente en el cuerpo recibido ni en la redirección del comprador.
- Alternativas: confiar en el evento o el retorno, descartadas por menor integridad.
- Pendiente: añadir validación criptográfica del webhook (ver DEC-009).

## D-003 Correlacionar mediante `external_reference`

- Estado: vigente.
- Decisión: guardar la misma referencia en el pedido y la preferencia.
- Motivo: relacionar el pago externo con el pedido interno sin depender solo del `payment_id`.
- Alternativas: tabla de relaciones por ID de preferencia o pago.
- Implementación: T-008 introdujo UUID en Node en 2026-06-25. DEC-020 lo reemplazó para pedidos: PostgreSQL genera la referencia con prefijo `LEMONT-ORDER-` dentro de la RPC y Node la reutiliza exactamente en Mercado Pago.

## D-004 Persistir un pedido antes del checkout

- Estado: vigente.
- Decisión: crear el pedido en estado `pending` antes de crear la preferencia.
- Motivo: disponer de una entidad interna que pueda conciliarse posteriormente.
- Implementación: T-002 completada (2026-06-24). Desde DEC-020, la persistencia usa una RPC atómica para `orders` + `order_items`. Si falla, el flujo se detiene y Mercado Pago no es llamado.

## D-005 Mantener producto y precio en backend

- Estado: vigente para la demostración.
- Decisión: definir producto, cantidad, importe y moneda en el servidor.
- Motivo: impedir que el navegador sea la fuente autoritativa del importe.
- Alternativas: catálogo en base de datos o servicio de productos.
- Pendiente: elegir una fuente de catálogo real (ver DEC-013).

## D-006 Usar Supabase con clave de servicio

- Estado: vigente.
- Decisión: acceder a `orders` desde el backend con `SUPABASE_SERVICE_ROLE_KEY`.
- Motivo inferido: simplificar el prototipo y mantener la credencial fuera del navegador.
- Alternativas: cliente autenticado con RLS, API propia sobre otra base o funciones de Supabase.
- Consecuencia: una exposición de la clave tiene impacto elevado; deben revisarse permisos y RLS.

## D-007 Servir frontend y API desde Express

- Estado: vigente.
- Decisión: usar un único proceso para archivos estáticos, rutas y webhook.
- Motivo inferido: simplicidad operativa del prototipo.
- Alternativas: frontend y backend desplegados por separado.

## D-008 Usar JavaScript, CommonJS y frontend sin framework

- Estado: vigente.
- Motivo inferido: mantener la plantilla pequeña y con pocas herramientas.
- Alternativas: ES modules, TypeScript o framework frontend.
- Revisión: no necesaria hasta que la complejidad o requisitos de tipado lo justifiquen.

---

## Registro histórico de decisiones

Las siguientes decisiones se registraron inicialmente como pendientes. El estado vigente de cada una está indicado en su propia sección y en `docs/STATUS.md`.

---

## DEC-009 — Estrategia de validación de firma del webhook

**Fecha:** 2026-06-24  
**Estado:** aceptada

### Contexto
El endpoint `/webhook` acepta eventos sin validar la firma criptográfica. La consulta posterior a Mercado Pago reduce el riesgo, pero no sustituye la validación requerida. Mercado Pago provee los headers `x-signature` y `x-request-id` para esta verificación.

### Decisión

- El secreto de validación debe obtenerse exclusivamente de la variable de entorno `MERCADO_PAGO_WEBHOOK_SECRET`.
- Si la firma del webhook es inválida, el servidor debe responder HTTP `401`.
- Si la firma está ausente, el servidor también debe responder HTTP `401`.
- En ambos casos, la respuesta debe ser genérica: `Webhook inválido`.
- No se deben exponer secretos, firmas completas, headers sensibles ni detalles internos en respuestas o logs.
- Los logs solo pueden registrar eventos genéricos como `firma de webhook ausente` o `firma de webhook inválida`.

La implementación debe seguir el algoritmo oficial vigente de Mercado Pago y validar la firma antes de consultar pagos o actualizar pedidos.

### Motivo
Sin validación criptográfica, cualquier cliente puede enviar una notificación falsa que dispare consultas a la API de Mercado Pago o actualizaciones de pedidos. La validación es una precondición de seguridad, no una mejora opcional.

### Alternativas consideradas
- Confiar únicamente en la consulta posterior a `Payment.get` sin validar la firma: reduce el riesgo pero no elimina el procesamiento innecesario ante notificaciones falsas. Descartada.
- Responder HTTP `400` en lugar de `401` para firma inválida o ausente: semánticamente menos preciso; `401` indica falla de autenticación, que es el caso exacto. Descartada.
- Registrar la firma o los headers de autenticación completos para debugging: descartada por política de seguridad. Los logs solo deben registrar eventos genéricos sin valores sensibles.

### Consecuencias
- Relacionada con T-001.
- Requiere agregar `MERCADO_PAGO_WEBHOOK_SECRET` al contrato de configuración (`.env.example`), sin incluir ningún valor real.
- T-001 queda desbloqueada.

---

## DEC-010 — Mecanismo atómico para la transición de estado a pagado

**Fecha:** 2026-06-24  
**Estado:** aceptada

### Contexto
La lectura del pedido y su actualización son operaciones separadas. Dos webhooks concurrentes pueden superar la comprobación de estado antes de que uno de ellos complete la actualización. Mercado Pago puede enviar más de un webhook para el mismo pago.

### Decisión

- La transición a `paid` se ejecuta solo si el estado actual del pedido es `pending`. Si la actualización no afecta ninguna fila, el pedido ya transicionó; el webhook se trata como duplicado idempotente sin interrumpir el flujo.
- Si el pedido no existe, no se crea un pedido nuevo; se registra un log genérico y se responde sin error catastrófico al cliente.
- Si el importe del pago no coincide con el del pedido, no se marca como `paid`.
- Si el estado del pago consultado a Mercado Pago no es `approved`, no se marca como `paid`.
- No se exponen secretos, firmas completas, headers sensibles ni datos internos en logs ni en respuestas al cliente.
- La estrategia se implementa desde el backend usando la API de Supabase; no requiere dependencias adicionales ni funciones SQL personalizadas.

### Motivo
Una actualización no condicional permite que dos webhooks concurrentes lean el estado `pending`, ambos lo superen y ambos ejecuten la transición a `paid`. La condición `WHERE status = 'pending'` convierte la operación en atómica a nivel de fila en Supabase/PostgreSQL: solo uno puede completar la actualización; el otro recibe cero filas afectadas y lo trata como duplicado.

### Alternativas consideradas
- Usar una función SQL de Supabase con lógica transaccional explícita: más control, pero agrega complejidad de infraestructura y requiere permisos adicionales. Descartada para esta etapa.
- Usar un lock a nivel de aplicación (mutex en memoria): no funciona con múltiples instancias del servidor. Descartada.
- Confiar en `payment_id` como única garantía de idempotencia sin condición de estado: no previene la carrera entre dos webhooks antes de la primera actualización. Descartada como garantía única.

### Consecuencias
- Relacionada con T-003.
- La actualización condicional garantiza idempotencia sin dependencias adicionales.
- T-003 queda desbloqueada.

---

## DEC-011 — Representación de importes y reglas de redondeo

**Fecha:** 2026-06-25  
**Estado:** aceptada

### Contexto
La comparación de importes usa `Number`, lo que puede producir errores de precisión con valores decimales. El importe actual es 100 ARS (sin decimales), pero el catálogo puede crecer hacia precios con centavos. Mercado Pago devuelve `transaction_amount` como decimal en la unidad principal de la moneda (pesos ARS). El campo `amount` en Supabase está definido como `numeric` y almacena pesos.

### Decisión

**1. Formato interno recomendado para importes**

Los importes circulan en la unidad principal de la moneda (pesos ARS) entre el backend, la base de datos y Mercado Pago. La conversión a centavos enteros ocurre exclusivamente en el momento de comparación, usando `Math.round(importe * 100)`. No se usa una representación en centavos como convención global del sistema.

**2. Esquema de Supabase: sin migración en esta etapa**

La columna `amount numeric` de la migración ya aplicada conserva su tipo y semántica actual (valor en pesos, ej: `100` para 100 ARS). No se requiere migración a `amount_cents integer`. Si el catálogo crece y se detecta necesidad de mayor control, una migración futura puede reconsiderarse como decisión separada.

**3. Conversión a Mercado Pago**

El precio del producto se pasa como `unit_price` en pesos (ej: `100`). Mercado Pago espera y devuelve importes en la unidad principal de la moneda; no se convierte a centavos al construir la preferencia ni al leer el pago.

**4. Comparación de transaction_amount contra el pedido**

La comparación usa enteros en centavos en ambos lados:

```js
Math.round(payment.transaction_amount * 100) === Math.round(order.amount * 100)
```

Si no coinciden, el pedido no pasa a `paid`. Esta función debe encapsularse como una utilidad nombrada en `index.js` para que sea fácil de testear y auditar.

**5. Manejo de moneda**

La moneda esperada se define exclusivamente en el backend (constante `'ARS'`). Al procesar el webhook, se valida que `payment.currency_id` coincida con la moneda registrada en el pedido. Si no coincide, el pedido no pasa a `paid`.

**6. Logs permitidos**

- Permitido: eventos genéricos como `"importe no coincide"`, `"moneda no coincide"`, `"pago no aprobado"`.
- No permitido: valores reales de importe (`transaction_amount`, `order.amount`), identificadores de moneda, `external_reference` ni datos del pago en texto libre.

**7. Tareas desbloqueadas**

T-007.

**8. Riesgos del punto flotante sin control**

En JavaScript, `0.1 + 0.2 === 0.3` devuelve `false`. Una comparación directa con `===` sobre valores decimales puede rechazar pagos válidos o aprobar importes erróneos cuando los valores difieren en fracciones de centavo por representación binaria. La multiplicación por 100 seguida de `Math.round` elimina este riesgo para valores con hasta dos decimales, que es el caso de ARS y de Checkout Pro.

### Motivo
No se requieren nuevas dependencias. La estrategia de multiplicación por 100 y comparación entera es suficiente para pagos con hasta dos decimales, no requiere autorización adicional de paquetes y es fácil de auditar y testear. `decimal.js` u otras librerías están justificadas solo si el proyecto maneja múltiples monedas o más de dos decimales significativos.

### Alternativas consideradas
- Usar `decimal.js` u otra librería de aritmética decimal: más robusta para múltiples monedas o más de dos decimales, pero requiere autorización de instalación y agrega una dependencia. Descartada por complejidad innecesaria para ARS en esta etapa.
- Comparar directamente con `===` usando `Number`: riesgo conocido de fallos con decimales. Descartada.
- Cambiar `amount` en Supabase a `amount_cents integer` y almacenar centavos: requiere nueva migración, cambio de convención en el backend y ajuste del valor enviado a Mercado Pago. Descartada para esta etapa; puede reconsiderarse si el catálogo crece.

### Consecuencias
- Relacionada con T-007.
- Codex debe encapsular la comparación en una función nombrada (ej: `importesCoinciden(a, b)`) y usarla al procesar el webhook.
- La validación de moneda debe agregarse en el mismo bloque de validación del importe.
- Los tests de T-007 deben cubrir: importe exacto, importe con diferencia mínima (ej: 99.99 vs 100.00), decimales (ej: 99.995 redondeado), moneda incorrecta y moneda correcta.
- Los logs del bloque de validación deben emitir solo eventos genéricos sin valores reales.
- T-007 queda desbloqueada.

---

## DEC-012 — Esquema versionado de Supabase: restricciones, índices y RLS

**Fecha:** 2026-06-24  
**Estado:** aceptada

### Contexto
El esquema de `orders` existe solo como DDL en el README. No hay migraciones versionadas, índices documentados ni política RLS definida. La clave `service_role` puede evitar controles de RLS según la configuración.

### Decisión

- Usar archivos SQL manuales versionados; no se adopta Supabase CLI en esta etapa.
- El archivo de migración será `supabase/migrations/001_create_orders.sql`.
- Codex crea el archivo SQL en el repositorio; el usuario lo aplica manualmente en Supabase cuando corresponda.
- El archivo debe contener: DDL de `orders`, restricciones de dominio, índices y política RLS mínima.
- El archivo no debe contener: credenciales, API keys, datos reales ni valores de variables de entorno.
- Si el proyecto crece, se puede adoptar Supabase CLI en una decisión futura sin conflicto.

### Motivo
El proyecto es pequeño y controlado. No se requieren herramientas adicionales en esta etapa. Un archivo SQL revisable en el repositorio es suficiente para versionar el esquema y permite que el usuario lo aplique de forma controlada en el momento que elija.

### Alternativas consideradas
- Supabase CLI (`supabase migration new`, `supabase db diff`): más automatizado y genera diffs, pero requiere instalar y configurar la herramienta localmente. Descartada para esta etapa; puede reconsiderarse si el proyecto escala.

### Consecuencias
- Relacionada con T-006.
- Codex puede crear `supabase/migrations/001_create_orders.sql` directamente sin herramientas adicionales.
- El usuario es responsable de revisar y aplicar el archivo en Supabase de forma manual; Codex no ejecuta ningún comando de base de datos.
- No aplicar en base compartida o productiva sin autorización explícita.
- T-006 queda desbloqueada.

---

## DEC-013 — Fuente de catálogo, stock y precios

**Fecha:** 2026-06-25  
**Estado:** aceptada

### Contexto

El producto (Remera LEMONT, 1 unidad, 100 ARS) está definido directamente en el código de `src/app.js`. Esta definición no proviene de ninguna fuente configurable ni validada externamente. El problema central de seguridad es que si el frontend tuviera algún mecanismo para influir sobre el importe final, un usuario malicioso podría enviar un precio arbitrario y provocar un cobro incorrecto.

El flujo actual ya protege el importe en la etapa de confirmación (DEC-011/T-007): compara `transaction_amount` del pago contra `order.amount` almacenado en Supabase. Sin embargo, `order.amount` se origina hoy en valores hardcodeados. Si esa constante no está aislada en una fuente autoritativa, el modelo de seguridad queda incompleto: el importe en el pedido podría quedar desincronizado con cualquier lógica futura que resuelva el precio.

### Decisión

**Catálogo como módulo de configuración versionado en el servidor (`src/catalog.js`).**

El catálogo se define como un objeto JavaScript en un archivo `src/catalog.js` dedicado. El backend lee el catálogo al resolver cada pedido y calcula el importe final. El frontend solo envía el identificador del producto (`sku`) y la cantidad (`quantity`). El backend no acepta un importe enviado por el cliente.

**Estructura mínima del catálogo:**

```js
// src/catalog.js
const CATALOG = {
  'REMERA-LEMONT-001': {
    name: 'Remera LEMONT',
    unitPrice: 100,
    currency: 'ARS',
    maxQuantity: 10,
  },
};

function getProduct(sku) {
  return CATALOG[sku] || null;
}

module.exports = { getProduct };
```

**Reglas de validación en el handler `POST /crear-preferencia`:**

1. El cliente envía `{ sku, quantity }`. No envía `price`, `amount` ni `currency`.
2. El backend resuelve el producto con `getProduct(sku)`.
3. Si el SKU no existe → respuesta genérica HTTP 400. No exponer detalles del catálogo.
4. `quantity` debe ser un entero entre 1 y `product.maxQuantity` inclusive. Fuera de rango → HTTP 400.
5. El backend calcula: `total = product.unitPrice * quantity`.
6. El campo `amount` del pedido en Supabase se almacena como `product.unitPrice * quantity` (en pesos ARS).
7. La moneda del pedido proviene de `product.currency`, no del cliente.
8. Mercado Pago recibe `unit_price: product.unitPrice`, `quantity`, `title: product.name` y `currency_id: product.currency`.

**Estrategia de migración futura:**

Esta estructura es reemplazable en el futuro por una tabla `products` en Supabase sin cambiar el contrato del handler. La firma de `getProduct(sku)` puede mantenerse aunque la fuente cambie. Cuando el proyecto crezca, se puede crear DEC-018 para formalizar esa migración.

### Motivo

- Un módulo `src/catalog.js` en código es suficiente para esta etapa: el proyecto tiene un producto y no requiere panel de administración ni base de datos adicional.
- Centralizar la definición en un módulo dedicado aísla el catálogo del resto de la lógica de pagos, facilita los tests unitarios y hace explícito el contrato del servidor.
- No requiere nuevas dependencias, nuevas tablas en Supabase ni cambios en `.env.example`.
- La validación de `sku` y `quantity` en el handler protege el sistema ante solicitudes malformadas o manipuladas.
- El importe calculado en backend es la continuación coherente de la política ya implementada en DEC-011: el servidor siempre es fuente de verdad del importe.

### Alternativas consideradas

- **Tabla `products` en Supabase**: flexible y administrable sin redeploy, pero agrega una nueva tabla, una nueva migración (DEC-018 futura), queries adicionales en el flujo crítico de pago y superficie de error. Descartada para esta etapa; puede adoptarse si el catálogo crece.
- **Servicio externo o CMS**: mayor separación de responsabilidades, pero introduce dependencia externa en el flujo de pago. Una caída del CMS podría bloquear la creación de preferencias. Descartada por complejidad innecesaria en esta etapa.
- **Mantener hardcoding distribuido en `src/app.js` sin módulo dedicado**: simple pero no aislable, no testeable de forma independiente y dificulta la migración futura. Descartada.

### Consecuencias

- Relacionada con T-012.
- Codex debe crear `src/catalog.js` con la estructura definida.
- Codex debe modificar el handler `POST /crear-preferencia` en `src/app.js` para aceptar `{ sku, quantity }` y calcular el importe desde el catálogo.
- Codex debe agregar tests en `tests/index.test.js` para: SKU inválido, cantidad fuera de rango, cantidad válida con precio calculado correctamente.
- No se acepta `amount` enviado por el cliente en ningún endpoint.
- La validación de importe en el webhook (DEC-011) sigue vigente e inalterada.
- T-012 queda desbloqueada.

---

## DEC-014 — Autenticación y autorización de compradores u operadores

**Fecha:** pendiente de definir  
**Estado:** pendiente

### Contexto
No existe autenticación ni usuario administrador. El flujo actual es completamente anónimo para el comprador. Si el proyecto escala, se necesitará identificar compradores o restringir acceso a operadores.

### Decisión
> Pendiente de confirmar con el usuario.

### Opciones a evaluar
- Mantener flujo anónimo (solo para demostración técnica).
- Autenticación de compradores con Supabase Auth.
- Panel administrativo con acceso restringido por rol.
- Autenticación externa (OAuth, magic link, etc.).

### Consecuencias
- El alcance de esta decisión puede afectar el esquema de `orders`, los requisitos y el diseño general.
- No implementar hasta tener definición de usuarios y objetivo comercial real (ver `docs/REQUIREMENTS.md`).

---

## DEC-015 — Reembolsos, cancelaciones, expiración y conciliación

**Fecha:** pendiente de definir  
**Estado:** pendiente

### Contexto
Solo existe la transición `pending → paid`. No hay estados adicionales ni procesos definidos para reembolsos, cancelaciones, pagos expirados o conciliación periódica.

### Decisión
> Pendiente de confirmar con el usuario.

### Opciones a evaluar
- Definir estados adicionales: `refunded`, `cancelled`, `expired`, `failed`.
- Definir reglas de transición entre estados.
- Integrar la API de reembolsos de Mercado Pago.
- Definir proceso de conciliación periódica (reconciliación entre Supabase y Mercado Pago).

### Consecuencias
- Afecta el esquema de la tabla `orders` y el documento de requisitos.
- No implementar hasta definir los casos de negocio reales.

---

## DEC-016 — Proveedor de despliegue, entornos y rollback

**Fecha:** 2026-06-25  
**Estado:** aceptada

### Contexto

El backend está completo, seguro y cubierto con 29 tests. No existía configuración de despliegue documentada. El proyecto usa ngrok para desarrollo local, pero no tiene infraestructura de staging ni producción definida. El objetivo es llegar a un primer deploy funcional en staging antes de cualquier uso con dinero real.

El proyecto es una plantilla reutilizable de backend. La primera instancia se despliega como staging sobre la infraestructura EasyPanel/VPS existente del usuario, usando Mercado Pago sandbox y el mismo proyecto Supabase actual.

### Decisión

**El primer entorno será staging en EasyPanel sobre el VPS actual del usuario.**

1. **Plataforma**: EasyPanel sobre el VPS ya creado y preparado por el usuario.
2. **URL pública**: usar la URL HTTPS gratuita generada por EasyPanel para el servicio. El dominio `lemont01.com` existe pero queda fuera del alcance inmediato hasta que sea recuperado y localizado.
3. **`NODE_ENV`**: establecer `NODE_ENV=production` desde el primer despliegue, incluso en staging. Esto activa el comportamiento correcto del servidor (por ejemplo, `GET /webhook` no disponible) y valida el entorno real antes de cualquier uso con dinero real.
4. **`BASE_URL`**: la URL HTTPS pública asignada por EasyPanel, sin barra final ni ruta adicional. Ejemplo de formato: `https://mi-servicio.easypanel.host`. Este valor se usa en `notification_url` de la preferencia y en las `back_urls`.
5. **Mercado Pago**: usar credenciales sandbox para el entorno staging. El `MERCADOPAGO_ACCESS_TOKEN` en EasyPanel debe ser el token de prueba, no el real.
6. **Webhook sandbox**: configurar manualmente en el panel de desarrolladores de Mercado Pago la URL `{BASE_URL}/webhook` como destino de notificaciones para el ambiente sandbox. Esta configuración es manual y queda como tarea pendiente del usuario; sin ella el webhook no llegará al servidor.
7. **Supabase**: usar el mismo proyecto Supabase actual. La tabla `orders` ya está creada, verificada y con RLS activo. No se requiere nueva migración ni nuevo proyecto de Supabase.
8. **Variables de entorno**: cargarse exclusivamente en EasyPanel. Nunca en el repositorio ni en archivos versionados. El `.env` real queda ignorado por Git.
9. **Frontend**: el frontend mínimo actual se sigue sirviendo desde el mismo proceso Express, mediante `public/`. Sin cambios en esta arquitectura.
10. **Producción real**: queda fuera del alcance inmediato. Solo se considera después de pasar la checklist de staging completa y la checklist explícita de producción definida en esta decisión.

### Variables obligatorias en EasyPanel

Solo nombres; nunca cargar valores reales en documentación, código, commits ni mensajes.

| Variable | Propósito |
|---|---|
| `MERCADOPAGO_ACCESS_TOKEN` | Token de prueba (sandbox) de Mercado Pago. Exclusivo del backend. |
| `MERCADO_PAGO_WEBHOOK_SECRET` | Secreto para validar firma HMAC-SHA256 del webhook. Exclusivo del backend. |
| `BASE_URL` | URL HTTPS pública de EasyPanel, sin barra final ni ruta. |
| `SUPABASE_URL` | URL del proyecto Supabase actual. |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave privilegiada de Supabase. Exclusiva del backend. **Nunca exponer al frontend ni al navegador.** |
| `LOG_LEVEL` | Nivel de logs estructurados. Usar `info` en staging y producción. |
| `NODE_ENV` | Establecer `production` para activar comportamiento correcto del servidor. |

### Reglas de seguridad

- **`.env` real**: debe permanecer ignorado por Git (`.gitignore`). Nunca subir valores al repositorio.
- **`.env.example`**: visible en el repositorio como plantilla con nombres y valores vacíos o ficticios. Sin secretos reales.
- **`SUPABASE_SERVICE_ROLE_KEY`**: uso exclusivo desde el backend Node.js. Nunca exponer en código servido al navegador, variables de entorno de cliente, archivos bajo `public/` ni en `index.html`.
- **Variables en EasyPanel**: configurarlas desde el panel de EasyPanel, una sola vez por entorno. No compartirlas por mensajes, documentos ni capturas de pantalla.
- **Rotación ante exposición**: si una variable queda expuesta, revocar y rotar inmediatamente desde el proveedor. Ver `docs/SECURITY.md`.

### Checklist de staging

Ejecutar en orden. Todos los ítems deben estar verificados antes de considerar el staging validado.

1. Variables cargadas en EasyPanel según la lista de variables obligatorias de esta decisión.
2. Servicio arranca sin errores (log inicial sin mensajes de variable faltante).
3. Abrir la URL HTTPS pública de EasyPanel → el frontend carga correctamente.
4. `POST /crear-preferencia` con `{ "sku": "REMERA-LEMONT-001", "quantity": 1 }` → responde con `preference_id` y una URL de checkout.
5. Supabase muestra un pedido con `status = 'pending'` y la referencia `LEMONT-ORDER-...` correcta.
6. Redirección al checkout de Mercado Pago sandbox funciona.
7. Completar el pago en el ambiente sandbox de Mercado Pago usando credenciales de prueba.
8. Mercado Pago llama a `POST /webhook` en la URL HTTPS pública (requiere webhook sandbox configurado manualmente).
9. Supabase muestra el pedido con `status = 'paid'`.
10. `GET /webhook` devuelve 404 (confirma que `NODE_ENV=production` está activo).
11. Logs del servicio en EasyPanel muestran JSON estructurado sin campos sensibles visibles.

### Checklist previa a producción real

No pasar a producción real sin completar todos los ítems:

1. Los 11 ítems de la checklist de staging están verificados y documentados.
2. `MERCADOPAGO_ACCESS_TOKEN` real (no sandbox) disponible y sin exposición previa.
3. `MERCADO_PAGO_WEBHOOK_SECRET` para producción generado y configurado en EasyPanel y en el panel de Mercado Pago.
4. Webhook de producción registrado: URL `{BASE_URL}/webhook` configurada en la cuenta de Mercado Pago real.
5. `BASE_URL` apunta a una URL HTTPS estable que no cambia entre reinicios del servicio.
6. Si se usa `lemont01.com`: dominio recuperado, DNS apuntando al VPS y HTTPS activo antes de registrar el webhook.
7. Variables actualizadas en EasyPanel: token sandbox reemplazado por token real; `BASE_URL` actualizada si el dominio cambió.
8. RLS de Supabase verificado: sin policies para `anon` ni `authenticated`.
9. Sin secretos en el repositorio: revisar `git log` y `git diff` antes de cualquier push.
10. Prueba con pago real mínimo verificada: flujo completo con tarjeta real y monto mínimo antes de publicar.
11. Plan de rollback conocido por el usuario y ejecutable sin asistencia.

### Estrategia de rollback

En orden de preferencia, del menor al mayor impacto:

1. **Variable incorrecta o faltante**: corregir el valor en EasyPanel y reiniciar el servicio. Sin afectar código ni datos.
2. **Problema al pasar a producción real**: revertir `MERCADOPAGO_ACCESS_TOKEN` al token sandbox en EasyPanel y reiniciar. El flujo vuelve a sandbox sin pérdida de pedidos.
3. **Fallo grave del servicio** (crash, error no controlado): pausar o detener el servicio en EasyPanel para evitar tráfico. Investigar logs en EasyPanel, corregir y reiniciar.
4. **Error de código** (bug en un commit reciente): identificar el commit problemático con `git log`, revertir a la versión anterior en GitHub y redesplegar desde EasyPanel. Aplicar solo si el problema no se resuelve con configuración.

No eliminar filas de Supabase como parte del rollback salvo autorización explícita del usuario.

### Alternativas consideradas

- **Railway, Render o Fly.io**: PaaS con deploy desde GitHub más automatizado, pero el usuario ya tiene VPS y EasyPanel configurados. Descartadas por complejidad innecesaria y costo adicional.
- **Docker/Dockerfile**: mayor control y portabilidad, pero agrega complejidad de configuración. Descartado para esta etapa; puede adoptarse en una decisión futura si el proyecto escala.
- **Proyecto Supabase separado para staging**: más aislamiento entre entornos, pero requiere crear un segundo proyecto y migrar el esquema. Descartado; el proyecto actual ya tiene la tabla y RLS verificados, y staging con sandbox no tiene riesgo de contaminar datos reales.

### Qué implementa T-013

- Actualizar `docs/SKILLS.md`: reemplazar la sección de deploy genérica por pasos concretos de staging en EasyPanel.
- Actualizar `README.md`: corregir secciones desactualizadas (base de datos, limitaciones) y agregar referencia al proceso de deploy.
- No se requieren cambios en código JavaScript.
- No se requieren nuevas dependencias.
- El deploy real lo ejecuta el usuario siguiendo la checklist de staging de esta decisión.

### Qué queda fuera del alcance de T-013

- Configurar el webhook sandbox en el panel de Mercado Pago (manual; responsabilidad del usuario).
- Recuperar o redirigir el dominio `lemont01.com`.
- Configurar HTTPS con dominio propio.
- Pasar a producción real con credenciales reales.
- Autenticación de compradores o panel administrativo.
- CI/CD automatizado.
- Infraestructura como código (Terraform, Ansible, etc.).

### Consecuencias

- Relacionada con T-013.
- Codex actualiza `docs/SKILLS.md` y `README.md` con la documentación de staging.
- El deploy real lo ejecuta el usuario siguiendo la checklist de staging.
- No se realizan cambios en código JavaScript ni en la lógica de pagos.
- T-013 queda desbloqueada.

---

## DEC-017 — Formato, destino y política de retención de logs

**Fecha:** 2026-06-25  
**Estado:** aceptada

### Contexto
Los logs actuales usan `console.log` con diferentes niveles de detalle, incluyendo campos del webhook y del pago. No hay estructura, correlación ni política de retención definida. El backend ya tiene validación de firma, comparación de importes y transición atómica; los logs de esos flujos deben revisarse para eliminar campos sensibles antes de crecer más.

### Decisión

**1. Librería externa o logging propio**

No se instala librería externa. Se usa un helper propio `log(level, event, extra)` que serializa un objeto JSON con `console.log`, `console.warn` o `console.error` según el nivel. Sin dependencias nuevas, sin cambios en `package.json`.

Estructura del helper (referencia para Codex):

```js
function log(level, event, extra = {}) {
  const entry = { level, event, timestamp: new Date().toISOString(), ...extra };
  if (level === 'error') console.error(JSON.stringify(entry));
  else if (level === 'warn') console.warn(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}
```

Uso: `log('warn', 'importe no coincide', { request_id, route: '/webhook', method: 'POST' })`

**2. Formato mínimo de log**

Todos los logs emiten un objeto JSON con al menos estos campos:

```json
{
  "level": "info",
  "event": "descripción genérica",
  "request_id": "uuid-o-x-request-id",
  "route": "/webhook",
  "method": "POST",
  "timestamp": "2026-06-25T12:00:00.000Z"
}
```

`status_code` se agrega únicamente cuando la respuesta HTTP ya fue determinada y es relevante para el evento.

**3. Niveles permitidos**

- `info`: flujo normal completado (pedido creado, pago procesado correctamente, webhook duplicado ignorado sin error).
- `warn`: situación esperada pero rechazada (firma ausente, firma inválida, importe no coincide, moneda no coincide, pago no aprobado, pedido no encontrado).
- `error`: fallo inesperado (Supabase no responde, MP no responde, excepción no controlada).

**4. Campos permitidos**

Siempre presentes: `level`, `event`, `request_id`, `route`, `method`, `timestamp`.

Opcionales según contexto:
- `status_code` — código HTTP de la respuesta (ej: `401`, `200`).
- `payment_status` — estado genérico del pago (ej: `"approved"`, `"pending"`). Solo el estado, sin ID ni importes.
- `order_status` — estado genérico del pedido (ej: `"pending"`, `"paid"`).
- `error_type` — categoría del error (ej: `"supabase_error"`, `"mp_api_error"`). Sin detalles internos del SDK.

**5. Campos prohibidos en todos los logs**

- Valores de cualquier variable de entorno (`MERCADO_PAGO_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `MERCADO_PAGO_WEBHOOK_SECRET`, etc.).
- Header `x-signature` completo ni parcial.
- Headers completos de requests o responses.
- Body completo del webhook recibido.
- Payload completo de `Payment.get` (incluyendo datos personales del comprador: email, nombre, documento).
- Valores reales de importes (`transaction_amount`, `order.amount`).
- Valor de `external_reference`.
- IDs internos de Supabase.
- Datos personales del comprador.

**6. Estrategia de correlación (request_id)**

- En `POST /webhook`: usar el header `x-request-id` de Mercado Pago si está presente; si no, generar `crypto.randomUUID()`.
- En otros endpoints (`POST /crear-preferencia`, `GET /`): generar `crypto.randomUUID()` al inicio del handler.
- El `request_id` se propaga como campo a todos los logs del mismo request.
- `x-request-id` se usa solo como correlator; nunca se loguea su valor fuera de este campo `request_id`.

**7. Política de retención**

- Los logs se emiten a `stdout` (captura del proveedor de hosting).
- No retener logs en archivos locales ni en Supabase.
- En producción: configurar retención máxima de 30 días en el proveedor. Los logs de `warn` y `error` pueden retenerse hasta 90 días para auditoría.
- No reutilizar logs de desarrollo en producción.
- Si el proveedor de hosting captura logs automáticamente, revisar su política de privacidad antes de poner en producción.

**8. Verbosidad adicional de forma segura**

- Variable de entorno opcional: `LOG_LEVEL` (valores: `debug`, `info`, `warn`, `error`). Valor por defecto: `info`.
- En desarrollo local, `LOG_LEVEL=debug` puede activar logs adicionales de flujo (por ejemplo, confirmar que se entró al handler del webhook).
- Los logs de nivel `debug` **nunca** pueden incluir campos prohibidos listados en el punto 5.
- Agregar `LOG_LEVEL=info` a `.env.example`.
- En producción, `LOG_LEVEL` debe ser `info` o superior.

**9. Tareas desbloqueadas**

T-010.

**10. Riesgos de logs inseguros**

- Exposición de `SUPABASE_SERVICE_ROLE_KEY` o `MERCADO_PAGO_ACCESS_TOKEN` en logs → acceso no autorizado a la base de datos o a la cuenta de Mercado Pago.
- Exposición del header `x-signature` completo → permite a un atacante con acceso a los logs construir firmas válidas y falsificar webhooks.
- Exposición del body completo del webhook → puede incluir datos personales del comprador (nombre, email, número de documento).
- Exposición de `transaction_amount` y `external_reference` → permite enumerar pedidos y montos; riesgo de privacidad y reconocimiento.
- Logs persistidos sin límite de retención → acumulación de datos sensibles históricos con riesgo ante brechas futuras.

### Motivo
No se requieren dependencias nuevas. Un helper propio que serializa JSON es suficiente para estructurar logs y aplicar la lista de campos prohibidos de forma controlada. Las librerías como `pino` o `winston` aportan valor en proyectos más grandes o con múltiples destinos; pueden adoptarse en una decisión futura si la observabilidad lo justifica.

### Alternativas consideradas
- Usar `pino` o `winston`: más funcionalidad (transports, niveles configurables, redacción automática), pero agrega dependencia y configuración. Descartada para esta etapa; puede reconsiderarse si el proyecto crece o se adopta un servicio externo de logs.
- Destino externo (Datadog, Logtail, etc.): relevante solo si el proveedor de hosting no captura stdout adecuadamente. Descartada sin proveedor de deploy definido (ver DEC-016).
- Mantener `console.log` sin estructura: no permite filtrado, correlación ni auditoría. Descartada.

### Consecuencias
- Relacionada con T-010.
- Codex debe crear la función `log(level, event, extra)` en `index.js` y reemplazar todos los `console.log` existentes por llamadas a esa función.
- Agregar `LOG_LEVEL=info` a `.env.example`.
- Los tests de T-010 deben verificar que ningún log emite campos prohibidos en los flujos críticos (webhook, creación de preferencia).
- Cualquier log en producción debe cumplir con la política de privacidad vigente.
- T-010 queda desbloqueada.

---

## DEC-018 — Estrategia para verificar y probar el flujo de webhook con firma válida

**Fecha:** 2026-06-26
**Estado:** resuelta

### Contexto

El diagnóstico técnico avanzado de la sesión 2026-06-26 descartó la infraestructura (Traefik/EasyPanel) y la implementación HMAC como causas del `POST /webhook` retornando 401 en staging. Hechos confirmados del diagnóstico:

- La simulación desde el panel de Webhooks de Mercado Pago valida firma correctamente.
- Los webhooks reales sandbox enviados por `notification_url` con credenciales de prueba llegan con firma inválida.
- El SDK oficial (`WebhookSignatureValidator` de `mercadopago` v3.1.0) también rechaza esas firmas.
- Traefik/EasyPanel preserva `x-request-id` (descartado como causa).
- Sin `notification_url` en la preferencia no llegan webhooks útiles con `data.id`.

**Respuesta de soporte/consulta técnica de Mercado Pago (2026-06-26):**

1. El Webhook Secret se genera en "Tus integraciones" y es por aplicación y por modo (pruebas vs productivo).
2. `notification_url` en la preferencia tiene prioridad sobre la URL del panel para esa transacción. No es un conflicto, pero manda para esa transacción.
3. **Confirmado**: los pagos de prueba con credenciales de prueba no envían notificaciones reales. La vía recomendada para testear recepción en sandbox es la simulación desde "Tus integraciones".
4. Para construir el manifiesto HMAC, `data.id` debe tomarse desde query params; en la documentación se denomina `data.id_url`.
5. Si falta algún valor del template del manifiesto, debe excluirse antes de calcular el HMAC, no incluirse como cadena vacía.
6. Verificar que el secret corresponda al mismo modo: pruebas o productivo.
7. No desactivar la validación de firma.

**Consecuencia del punto 3**: el 401 observado en staging con credenciales de prueba puede ser comportamiento esperado del sandbox de Mercado Pago, no un bug de implementación. La simulación del panel valida correctamente porque es la vía oficial de prueba.

**Puntos técnicos pendientes de verificación** (identificados en puntos 4 y 5 de la respuesta de soporte):
- (a) ¿En `src/webhookSignature.js`, `data.id` se lee de los query params del request con la denominación correcta? Los logs muestran `signature_data_source="query_data_id"` pero el nombre del campo en el template puede diferir de lo esperado por MP.
- (b) ¿Si algún campo del template del manifiesto no está presente en el request, se excluye antes del HMAC? Si se incluye como cadena vacía, el manifiesto calculado no coincidirá con el esperado.

Estos dos puntos deben verificarse antes de cualquier prueba productiva.

La validación de firma (DEC-009) está activa. No se debe modificar ni desactivar sin que esta decisión esté aceptada.

### Opciones a evaluar

**Prerequisito para Opción A:** antes de la prueba productiva, Codex debe revisar los dos puntos técnicos del HMAC descritos arriba en `src/webhookSignature.js`. Si se detecta un error, corregirlo y registrar en DECISIONS.md antes de hacer commit.

**Opción A — Verificación técnica + prueba productiva controlada:**
1. Codex revisa los dos puntos técnicos (data.id_url y exclusión de valores faltantes) en `src/webhookSignature.js`.
2. Si se detecta diferencia respecto a la documentación oficial, corregir y deployar.
3. Usar credenciales productivas reales con un pago real mínimo controlado, manteniendo la validación de firma activa.
- Requiere: rotación previa de credenciales de prueba expuestas; checklist previa a producción de DEC-016 completada; pago real mínimo controlado.
- Riesgo: implica dinero real. No usar si la checklist de DEC-016 no está completa.

**Opción B — Solo simulación del panel (sandbox suficiente):**
Aceptar que sandbox con credenciales de prueba no envía webhooks firmados reales (confirmado por soporte) y validar el flujo completo exclusivamente mediante la simulación desde "Tus integraciones". No hacer prueba productiva en esta etapa.
- Ventaja: no implica dinero real; la simulación del panel ya valida.
- Riesgo: no confirma el flujo con pago real; la producción real puede tener diferencias.

**Opción C — Estrategia alternativa de validación (alto riesgo; solo si A y B no son viables):**
Modificar el flujo de `POST /webhook` para que, ante firma inválida, realice una consulta directa a la API de Mercado Pago para validar el pago por estado, importe y referencia.
- Riesgo alto: debilita la seguridad implementada en DEC-009. No implementar en producción sin acotar el alcance explícitamente.
- Requiere que esta DEC esté aceptada y que el alcance esté definido antes de cualquier modificación de código.
- No recomendado como primera opción.

### Restricción vigente

No modificar la validación de firma (DEC-009) ni ningún archivo de código hasta que esta DEC esté aceptada. Claude Code no prepara tareas de código para ninguna opción sin confirmación explícita del usuario.

### Resolución (2026-06-26)

**Opción ejecutada:** Opción A — verificación técnica + prueba productiva controlada.

**Causa raíz principal identificada:** la `notification_url` de la preferencia no incluía el parámetro `?source_news=webhooks`. Sin ese parámetro, Mercado Pago envía notificaciones de tipo IPN en lugar de Webhooks. Las notificaciones IPN usan un mecanismo de firma diferente al HMAC-SHA256 configurado en "Tus integraciones". El backend rechazaba correctamente las firmas IPN con HTTP 401 porque no corresponden al algoritmo de Webhook. La simulación del panel siempre envía Webhooks (firma correcta) porque usa directamente el mecanismo de Webhooks, razón por la cual el panel siempre validaba y los webhooks reales de sandbox no.

**Causa raíz adicional (frontend):** el frontend priorizaba `sandbox_init_point` sobre `init_point` en el retorno de la preferencia creada. Esto podía enviar el checkout al ambiente sandbox aunque se estuviera intentando realizar una compra productiva. Corregido priorizando `init_point` para el flujo de checkout productivo (commit `04c8112`).

**Solución aplicada (Codex):** se agregó `?source_news=webhooks` a la `notification_url` de la preferencia en `src/app.js`. Esto fuerza a Mercado Pago a enviar exclusivamente notificaciones de tipo Webhook con firma HMAC-SHA256 válida.

**Resultado verificado en producción real (2026-06-26):**
1. `POST /crear-preferencia` creó preferencia con `notification_url` correcta.
2. Pedido creado en Supabase con `status = 'pending'`.
3. Pago real realizado en Mercado Pago Checkout Pro.
4. Webhook recibido en `POST /webhook` con firma HMAC-SHA256 válida.
5. Firma validada correctamente con `MERCADO_PAGO_WEBHOOK_SECRET` productivo.
6. Pago consultado a la API de Mercado Pago y confirmado como aprobado.
7. Pedido actualizado a `status = 'paid'` en Supabase.

**Pendientes al cierre:**
- Rotar credenciales productivas expuestas en capturas/chats (ver `docs/SECURITY.md`).
- La captura completa asociada a `MP_SUPPORT_CAPTURE_FULL_WEBHOOK` fue retirada de `src/app.js` el 2026-08-20; configurar la variable ya no activa ningún comportamiento.
- Retirar los demás diagnósticos temporales de `src/webhookSignature.js` y `src/config.js` permanece como una tarea separada.

---

## DEC-019 — Política de respuestas HTTP de `POST /webhook`

**Fecha:** 2026-08-21
**Estado:** aceptada

### Contexto

Esta integración ya operó en producción con credenciales productivas de Mercado Pago y procesó pagos reales, incluyendo transferencias efectivas desde compradores hacia la cuenta productiva del comercio. El trabajo actual es el endurecimiento de una integración productiva existente, no la preparación inicial de un prototipo exclusivamente sandbox.

Actualmente `POST /webhook` puede responder HTTP 200 después de capturar errores al consultar un pago en Mercado Pago o al consultar/actualizar un pedido en Supabase. Un 200 confirma la recepción al proveedor aunque el procesamiento necesario no haya finalizado y puede dejar pedidos en `pending` sin un nuevo intento automático.

### Decisión

`POST /webhook` aplicará la siguiente política:

1. **Firma ausente o inválida — HTTP 401.** Se conserva el comportamiento definido por DEC-009. La validación HMAC existente no se modifica.
2. **Procesamiento exitoso — HTTP 200.** Incluye la consulta autoritativa del pago y, cuando corresponde, la transición confirmada del pedido a `paid`.
3. **Resultados definitivos o idempotentes — HTTP 200.** Repetir la misma notificación no resolvería ni cambiaría estos resultados:
   - evento irrelevante;
   - pago no aprobado;
   - pedido ya `paid`;
   - duplicado concurrente;
   - diferencia de importe;
   - diferencia de moneda;
   - pedido inexistente después de una consulta exitosa;
   - pago aprobado sin `external_reference`;
   - evento firmado sin ID utilizable.
4. **Fallos temporales o recuperables — HTTP 503.** Se permite que Mercado Pago reintente cuando el procesamiento no pudo completarse por:
   - timeout o error de red consultando Mercado Pago;
   - respuesta 429 de Mercado Pago;
   - respuesta 5xx de Mercado Pago;
   - respuesta 401/403 de Mercado Pago por credenciales o configuración, acompañada de un log crítico seguro;
   - error de conexión o consulta con Supabase;
   - error durante el `UPDATE pending → paid`;
   - resultado ambiguo de una dependencia.
5. **Excepciones internas inesperadas durante el procesamiento — HTTP 503.** La respuesta será genérica y segura para permitir un reintento del proveedor.

Las respuestas HTTP nunca incluirán secretos, firmas, datos sensibles, referencias internas completas, payloads externos ni mensajes internos de los SDK de Mercado Pago o Supabase. Los logs conservarán la política segura de DEC-017.

La transición atómica `pending → paid` y la idempotencia establecidas por DEC-010 deben conservarse. Un cambio de código derivado de esta decisión no debe debilitar esos controles ni la validación HMAC de DEC-009.

### Alcance actual

Esta decisión desbloqueó T-015. La implementación se completó el 2026-08-21: el handler clasifica los resultados del procesamiento, devuelve 503 ante fallos recuperables o inesperados y conserva 200 para resultados exitosos, definitivos o idempotentes.

No se implementarán en esta etapa colas, workers ni persistencia adicional de webhooks. Una arquitectura que persista durablemente la notificación antes de responder y la procese de forma asíncrona queda registrada solo como posible endurecimiento futuro y requerirá una decisión y autorización separadas.

### Consecuencias y riesgos

- Los fallos temporales dejarán de confirmarse falsamente con HTTP 200 y podrán recibir reintentos de Mercado Pago.
- Pueden aumentar las entregas duplicadas durante caídas de dependencias; la idempotencia y la transición atómica existentes son obligatorias para absorberlas con seguridad.
- Clasificar erróneamente un fallo definitivo como temporal puede provocar reintentos prolongados; clasificar un fallo temporal como definitivo puede dejar un pedido en `pending`.
- Las credenciales productivas documentadas como expuestas se consideran comprometidas y deben rotarse antes del próximo despliegue productivo.

### Implementación verificada (2026-08-21)

- `src/app.js` implementa la matriz 401/200/503 sin modificar la validación HMAC, la creación de preferencias ni la transición atómica.
- `tests/index.test.js` cubre eventos definitivos, errores de Mercado Pago, errores de consulta/actualización de Supabase, excepciones inesperadas y ausencia de datos sensibles en respuestas 503.
- La suite completa pasó con 50 tests.
- No se agregaron colas, workers, persistencia, migraciones ni dependencias.

---

## DEC-020 — Creación atómica de pedidos e items mediante RPC

**Estado:** aceptada, implementada y validada el 2026-08-22.

### Contexto

El modelo original guardaba un solo producto directamente en `orders`. La evolución necesita representar items separados sin romper el webhook ni completar artificialmente pedidos históricos. El runtime actual todavía compra una sola Remera LEMONT por pedido, pero el contrato debe admitir múltiples items en el futuro.

### Decisión

- `src/catalog.js` conserva toda autoridad comercial: SKU, nombre, talle, precio, moneda y cantidad máxima.
- Node construye autoritativamente `p_items`; el navegador no puede enviar precio, moneda, nombre, total, estado ni `external_reference`.
- `public.create_pending_order_with_items` recibe parámetros escalares de pedido/cliente/entrega y `p_items jsonb` estrictamente validado.
- PostgreSQL calcula la suma de items, exige coincidencia con `p_expected_amount`, genera `external_reference` y crea `orders` + `order_items` en una sola transacción.
- La RPC usa `SECURITY INVOKER`, `search_path = pg_catalog, public` y ejecución reservada a `service_role`; `public`, `anon` y `authenticated` no pueden ejecutarla.
- `order_items.order_id` referencia `orders.id` con `ON DELETE CASCADE`.
- Durante la transición, la RPC completa las columnas legacy de producto en `orders` desde el primer item. `orders.amount`, `orders.currency` y `orders.status` continúan disponibles para el webhook.
- Mercado Pago recibe exactamente el `external_reference` devuelto por PostgreSQL. Node deja de generar UUID para pedidos, pero conserva `crypto.randomUUID()` para `request_id`.

### Validación

- Migración 004 aplicada y RPC probada manualmente en Supabase real.
- Verificados pedido, item, total, moneda, estado, columnas legacy, `line_total`, relación y cascada.
- Runtime local verificado creando pedido e item mediante RPC y una preferencia con la misma referencia.
- Suite Jest: 79/79 tests.
- Webhook, HMAC, comparación de importe/moneda, idempotencia y `pending → paid` no se modificaron.

### Regla operativa derivada del incidente QA

Después de modificar archivos backend/runtime en `src/`, se debe reiniciar el proceso Node antes de realizar pruebas manuales. Una instancia antigua iniciada con `npm start` provocó durante QA que pedidos nuevos siguieran el runtime legacy y mostraran `customer_*`/`shipping_*` en `NULL`; la definición activa de la RPC era correcta.

### Fuera de alcance

- Carrito y múltiples productos en la interfaz.
- Stock y reservas.
- Backfill de pedidos históricos.
- Eliminación inmediata de columnas legacy.
- Cambios al webhook o a Mercado Pago.

---

## DEC-021 — Carrito multítem y checkout autoritativo preparado para logística

**Fecha:** 2026-09-11
**Estado:** aceptada e implementada por T-016 Pasos 1–4 (cierre 2026-09-13)
**Tarea desbloqueada:** T-016

### Aceptación (2026-09-11)

El usuario aceptó esta decisión con cuatro resoluciones explícitas:

1. **`maxQuantity` por SKU:** para T-016 usar temporalmente `maxQuantity: 4` en `src/catalog.js`. Es un techo transitorio. **No sustituye un sistema real de stock.** Más adelante debe reemplazarse por validación de stock real del backend (disponibilidad, reserva, concurrencia, liberación y confirmación). Ese trabajo no forma parte de T-016.
2. **Máximo de entradas (aclaración autorizada en la corrección del Paso 1):** máximo 50 entradas originales recibidas en `items`, validado antes de agrupar. Después se agrupan SKUs duplicados y se valida la cantidad acumulada contra `maxQuantity`. La RPC conserva su límite de 50 ítems.
3. **Compatibilidad legacy:** aprobada. Conservar temporalmente `{ sku, quantity, customer, delivery }`. No aceptar requests que mezclen ese formato con `items[]`. Retirar el legacy cuando el carrito sea el único flujo activo.
4. **Idempotencia durable:** fuera de T-016. Queda como DEC-022 (propuesta) y T-017 (bloqueada).

### Resoluciones de interfaz aprobadas e implementadas

- **D1-A:** Agregar al carrito (principal, sin navegar) y Comprar ahora (secundario, legacy sin agregar); ambos requieren talle.
- **D2-A:** el carrito solo se vacía a mano; crear preferencia, redirigir o visitar retornos no lo vacía. `/success` no confirma el pago.

### Contexto verificado (2026-09-11)

Esta sección es la foto previa a la implementación; se conserva como antecedente histórico.

Auditoría contra código, migraciones, tests y documentación. No se asume el análisis previo de Codex.

Estado real actual:

- El checkout vigente compra **un solo SKU** por request. El frontend envía `{ sku, quantity, customer, delivery }` con `quantity: 1`. `src/app.js` resuelve un producto con `getProduct(sku)` y construye un array de un ítem.
- `src/catalog.js` es la única autoridad de precio, moneda, nombre, talle y `maxQuantity`. Los cuatro SKUs (`LEM-REM-001-S/M/L/XL`) tienen `unitPrice: 1000`, `currency: "ARS"` y `maxQuantity: 1`.
- La migración `004_create_order_items.sql` ya creó `public.order_items` y la RPC `create_pending_order_with_items`. PostgreSQL valida `p_items`, calcula el total, exige coincidencia con `p_expected_amount`, genera `external_reference` y crea atómicamente `orders` + `order_items`.
- La RPC **ya admite múltiples ítems** (1 a 50). El runtime actual solo envía uno. Mercado Pago recibe un array `items` de un elemento y un único `external_reference`.
- El webhook compara `payment.transaction_amount` y `payment.currency_id` contra `orders.amount` y `orders.currency` persistidos (DEC-011). **No** vuelve a consultar el catálogo vigente.
- No existe carrito, `localStorage` de compra, ni `POST /carrito/resumen`.
- Etapa 6A cotiza envío de forma informativa para un solo SKU. Un fallo de cotización responde 503 genérico; **no** se asume envío gratis. Correo Argentino no se implementa en esta decisión.
- No hace falta una migración nueva para el carrito básico.

DEC-020 dejó el carrito explícitamente fuera de alcance. Esta decisión lo define antes de programar.

### Decisión

#### 1. Representación del carrito en el frontend

El navegador guarda únicamente datos no autoritativos:

```json
{
  "version": 1,
  "items": [
    {
      "sku": "LEM-REM-001-S",
      "quantity": 1
    }
  ]
}
```

- El SKU identifica la variante.
- `quantity` es un entero positivo.
- Prohibido persistir en el carrito: precio, subtotal, total, moneda, nombre comercial, talle, estado, `external_reference`, domicilio o datos personales.
- Cualquier otro campo se descarta al recuperar el carrito.
- `localStorage` es manipulable y **nunca** es fuente de verdad.

#### 2. Autoridad del backend

El frontend no decide precio, subtotal, total, moneda, estado del pedido, nombre comercial definitivo ni datos autoritativos del producto.

Antes de persistir o cobrar, el backend debe:

1. Validar la estructura del request y el máximo de 50 entradas originales en `items` antes de agrupar.
2. Rechazar el carrito completo si hay SKU inválido, cantidad inválida o estructura inválida.
3. Agrupar SKUs duplicados sumando cantidades **antes** de validar máximos.
4. Resolver cada SKU con `getProduct(sku)` en `src/catalog.js`.
5. Validar que la cantidad agrupada sea un entero entre 1 y `product.maxQuantity`.
6. Obtener precio unitario, nombre, talle y moneda del catálogo.
7. Calcular cada línea y el subtotal con la estrategia monetaria de esta decisión.
8. Construir `p_items` para la RPC y `items` de Mercado Pago desde **el mismo** cálculo.

La misma representación autoritativa alimenta Supabase y Mercado Pago. El navegador no envía `price`, `amount`, `currency`, `unit_price`, `product_name`, `status` ni `external_reference` con efecto alguno.

#### 3. Carrito inválido

Si el carrito es inválido no se crea pedido, no se insertan `order_items` y no se crea preferencia de Mercado Pago.

Son inválidos, entre otros:

- cuerpo que no es un objeto;
- `items` ausente, no array, vacío, o con más de 50 entradas originales recibidas, comprobadas **antes** de agrupar;
- ítem que no es objeto, SKU no string canónico, SKU desconocido en el catálogo;
- cantidad no entera, no numérica, negativa, cero, o mayor a `product.maxQuantity` tras agrupar;
- mezcla del contrato legacy con el contrato `items` (ver punto 6).

Respuesta pública genérica: HTTP 400 con `{ "error": "Carrito inválido" }` en el contrato nuevo. No enumerar SKUs válidos ni devolver el catálogo.

El contrato legacy `{ sku, quantity, customer, delivery }` conserva sus mensajes actuales (`Producto no encontrado`, `Cantidad inválida`, `Revisá los datos del comprador y la entrega`) para no cambiar el comportamiento observable del flujo vigente.

#### 4. Persistencia frontend

- Clave de `localStorage` dedicada, por ejemplo `lemont.cart`.
- Una línea por SKU.
- Agregar un SKU existente incrementa `quantity`; si el resultado supera `maxQuantity` del catálogo **representado en el cliente de forma informativa**, no se persiste un valor inválido: se deja la cantidad previa o se rechaza la operación en UI. La autoridad sigue siendo el backend.
- Se puede modificar cantidad y eliminar un SKU.
- Al recuperar: si `version` no es 1, si la estructura es inválida o si un ítem no tiene `sku` string y `quantity` entero ≥ 1, se descarta el carrito corrupto y se parte de un carrito vacío. No se intenta “reparar” precios.
- No guardar cliente ni domicilio en el carrito. Esos datos viven en el formulario de entrega y se envían solo en el checkout.

El frontend puede mostrar un precio informativo desde `public/js/productos.js`, pero el resumen visible de checkout debe poder alinearse con `POST /carrito/resumen`.

#### 5. Endpoint de resumen

Se agrega:

```text
POST /carrito/resumen
```

Entrada:

```json
{
  "items": [
    { "sku": "LEM-REM-001-S", "quantity": 1 }
  ]
}
```

Salida, si el carrito es válido:

```json
{
  "currency": "ARS",
  "subtotal": 1000,
  "items": [
    {
      "sku": "LEM-REM-001-S",
      "productName": "Remera LEMONT",
      "variant": "S",
      "quantity": 1,
      "unitPrice": 1000,
      "lineSubtotal": 1000
    }
  ]
}
```

Este endpoint:

- valida y agrupa igual que el checkout;
- **no** crea pedidos, `order_items` ni preferencias;
- **no** modifica estados;
- **no** requiere `customer` ni `delivery`;
- **no** incluye costo de envío;
- rechaza un carrito inválido con HTTP 400 genérico.

No usar GET: el carrito no debe viajar en query string ni logs de URL.

#### 6. Checkout multítem y compatibilidad legacy

`POST /crear-preferencia` evoluciona para aceptar el contrato nuevo:

```json
{
  "items": [
    { "sku": "LEM-REM-001-S", "quantity": 1 }
  ],
  "customer": {},
  "delivery": {}
}
```

**Compatibilidad temporal con el contrato vigente real**, que no es `{ sku, quantity }` sino:

```json
{
  "sku": "LEM-REM-001-S",
  "quantity": 1,
  "customer": {},
  "delivery": {}
}
```

Reglas:

- Si existe `items` (array) y **no** existen `sku` ni `quantity` de producto en el nivel raíz → contrato nuevo.
- Si existen `sku` y `quantity` de producto en el nivel raíz y **no** existe `items` → contrato legacy, equivalente a un único ítem. Sigue exigiendo `customer` y `delivery`.
- Si el request mezcla ambos formatos → HTTP 400 `{ "error": "Carrito inválido" }`. No se persiste ni se cobra.
- `{ sku, quantity }` **sin** `customer`/`delivery` permanece rechazado, como hoy.
- Retiro del contrato legacy: cuando el único flujo de compra en `public/` use `items` y se haya verificado en el entorno desplegado. Queda como seguimiento documental; no se retira en el mismo cambio que introduce el carrito.

`customer` y `delivery` siguen validándose con `parseCheckoutInput` antes de Supabase o Mercado Pago.

#### 7. Base de datos

El carrito básico **no requiere una migración nueva**.

Ya existen:

- `orders` (identidad, cliente, entrega, total, moneda, estado, correlación);
- `order_items` (snapshot de SKU, nombre, talle nullable, cantidad, `unit_price`, `line_total` generado);
- RPC `create_pending_order_with_items` con validación de 1 a 50 ítems, cálculo en `numeric` y transacción única.

La RPC no consulta el catálogo: confía en `p_items` construido por Node. Node sigue siendo la autoridad comercial.

No hay `UNIQUE (order_id, product_sku)`. Node **debe** agrupar SKUs duplicados. Un índice único no forma parte de T-016; sería endurecimiento futuro con migración propia.

Las columnas legacy de producto en `orders` siguen completándose desde el **primer ítem** del array ya agrupado. El webhook continúa usando `orders.amount` y `orders.currency`.

#### 8. Mercado Pago

Una orden multítem produce:

- una sola preferencia;
- un `items` de Mercado Pago con **una entrada por línea autoritativa** (SKU agrupado);
- un único `external_reference`, exactamente el devuelto por la RPC.

`title`, `quantity`, `unit_price` y `currency_id` salen del mismo cálculo usado para `p_items`. No se reenvía el array crudo del navegador.

#### 9. Webhook

Se mantiene:

```text
pending → Mercado Pago → webhook → validación HMAC → Payment.get → paid
```

El webhook compara el pago contra el pedido **persistido**. No recalcula el precio con el catálogo actual para decidir si un pago histórico es correcto. DEC-009, DEC-010, DEC-011 y DEC-019 no se modifican.

#### 10. Cálculo monetario (continúa DEC-011)

DEC-011 permanece vigente: los importes circulan en pesos ARS; la comparación del webhook usa centavos enteros con `Math.round(Number(valor) * 100)`.

Para el carrito, Node calcula en centavos enteros y vuelve a pesos con dos decimales:

1. `unitPriceCents = Math.round(Number(product.unitPrice) * 100)`
2. `lineSubtotalCents = unitPriceCents * quantity` (`quantity` ya es entero validado)
3. `subtotalCents = suma de lineSubtotalCents`
4. Pesos enviados a RPC/MP: `cents / 100`

No se usa `decimal.js`. No se comparan floats con `===` para decidir un pago. PostgreSQL sigue recalculando la suma en `numeric` y debe coincidir con `p_expected_amount`.

El webhook no cambia su función `importesCoinciden`.

#### 11. Límites

Límites aceptados el 2026-09-11:

| Caso | Comportamiento |
|---|---|
| Carrito vacío | Rechazo total. La RPC ya exige al menos un ítem. |
| Más de 50 entradas originales en `items` | Rechazo total antes de agrupar. Luego se agrupan duplicados y se valida la cantidad acumulada contra `maxQuantity`. |
| SKUs duplicados | Se agrupan; no se persisten dos líneas del mismo SKU. |
| Cantidad no entera, negativa, cero, no numérica | Rechazo total. |
| SKU desconocido | Rechazo total. |
| Cantidad mayor a `product.maxQuantity` | Rechazo total. |

**`maxQuantity: 4` es temporal y rige solo para T-016.** T-016 debe actualizar los cuatro SKUs de `src/catalog.js` de `maxQuantity: 1` a `maxQuantity: 4`, con un comentario explícito de que el valor es transitorio y **no representa stock**. No reserva inventario, no evita sobreventa y no sustituye disponibilidad real. El reemplazo por stock de backend requiere una decisión y una tarea futuras, distintas de T-016 y de DEC-022.

#### 12. Logística futura

La arquitectura debe poder evolucionar a:

```text
carrito → dirección → cotización de envío → subtotal → costo de envío → total final → Mercado Pago
```

En T-016:

- el total cobrado sigue siendo solo el subtotal de productos;
- `POST /cotizar-envio` permanece como cotización informativa de un SKU con `quantity: 1` exclusivamente; el límite logístico es independiente de `maxQuantity: 4` y rechaza varias unidades antes de llamar a MiCorreo;
- no se implementa Correo Argentino adicional;
- no se suma el envío a `orders.amount` ni a Mercado Pago;
- un fallo de cotización **no** se interpreta como envío gratis. El código actual ya responde 503 genérico.

Una cotización multítem, la persistencia de la tarifa y su inclusión en el total requieren una decisión posterior. No se diseña “error de logística = $0”.

#### 13. Idempotencia del botón de pago

Deshabilitar el botón evita el doble clic visual. **No** garantiza idempotencia durable.

Timeouts, reintentos del navegador y requests duplicados pueden crear múltiples pedidos `pending` y múltiples preferencias.

Esto **no** se implementa en T-016. Queda como **DEC-022** (propuesta) y **T-017** (bloqueada hasta aceptar DEC-022). No adelantar colas ni claves de idempotencia en el carrito.

#### 14. Seguridad

Riesgos y controles de esta decisión:

- Manipular `localStorage` o el body HTTP no cambia precios: el backend ignora importes del cliente.
- SKUs desconocidos, cantidades manipuladas o estructura rota rechazan toda la compra.
- El resumen y el checkout no registran PII, importes reales, `external_reference`, SKUs en errores públicos ni el body completo (DEC-017).
- Al renderizar el carrito: usar `textContent` / DOM seguro. No interpolar SKUs ni nombres provenientes de `localStorage` con `innerHTML`.
- `POST /carrito/resumen` no crea recursos; igual no debe devolver el catálogo completo ni mensajes que permitan enumerar SKUs.
- Datos personales siguen viajando solo en el checkout, nunca en el carrito persistido.
- Rate limiting sigue siendo un pendiente operativo transversal (`docs/SECURITY.md`); no se inventa en T-016.

#### 15. Tests mínimos de T-016

Cubrir, como mínimo:

- carrito vacío;
- un producto;
- varios productos / varias variantes;
- SKU repetido (agrupación e incremento);
- reducción de cantidad y eliminación (frontend);
- SKU inválido y cantidad inválida (rechazo total, sin RPC ni MP);
- precio, `amount`, `currency` o `unit_price` enviados por el cliente (ignorados);
- `localStorage` corrupto (se descarta);
- `POST /carrito/resumen` no persiste;
- pedido multítem con `order_items` y `p_expected_amount` igual a la suma autoritativa;
- una sola preferencia de Mercado Pago con múltiples `items` y un `external_reference`;
- request que mezcla `items` y `sku` raíz;
- contrato legacy de un SKU sigue funcionando;
- fallo de Supabase: no hay preferencia;
- fallo de Mercado Pago: error genérico;
- regresiones del webhook: HMAC, importe, moneda, duplicado, atómico, `pending → paid`.

### Motivo

El modelo de persistencia ya soporta múltiples ítems. Falta el contrato de carrito, la autoridad única de cálculo y un frontend que no pretenda ser fuente de precios. Definir esto antes de programar evita mezclar formatos, migraciones innecesarias y un recálculo peligroso en el webhook.

### Alternativas consideradas

- Nueva tabla `carts` en Supabase: innecesaria sin autenticación de comprador (DEC-014 pendiente). Descartada.
- Confiar en precios del frontend y “verificarlos” después: contradice DEC-013. Descartada.
- Recalcular el pago del webhook con el catálogo actual: rompería pedidos históricos si cambia el precio. Descartada.
- Migración para UNIQUE de SKU o columnas de envío: no hace falta para el carrito básico. Descartada en esta etapa.
- Retirar el contrato legacy en el mismo cambio: rompería `entrega.html` y `public/js/checkout.js` vigentes. Descartada.

### Fuera de alcance de T-016

- Correo Argentino / inclusión del envío en el total.
- Stock real, reservas e inventario. `maxQuantity: 4` no los sustituye.
- Nueva migración SQL.
- Idempotencia durable del checkout (DEC-022 / T-017).
- Autenticación de compradores.
- Rotación de credenciales.
- Retiro inmediato del contrato legacy y de las columnas legacy de `orders`.

### Consecuencias

- Relacionada con T-016, ahora desbloqueada.
- T-016 debe poner `maxQuantity: 4` en el catálogo, documentarlo como temporal y ajustar las regresiones que hoy rechazan cantidad 2.
- `docs/REQUIREMENTS.md`, `README.md` y `docs/SKILLS.md` siguen describiendo en parte el contrato viejo `{ sku, quantity }` / `REMERA-LEMONT-001`; actualizarlos forma parte del Paso 4 de T-016.
- DEC-022 queda propuesta; no se implementa junto con el carrito.

---

## DEC-022 — Idempotencia durable del checkout

**Fecha de aceptación:** 2026-09-16.
**Estado:** ACEPTADA.
**Tarea:** T-017 COMPLETADA / VALIDADA EN PRODUCCIÓN (2026-09-17).

### Contexto

T-016 solo mitiga el doble clic visual deshabilitando el botón. Eso no cubre timeouts, reintentos del navegador, requests duplicados ni respuestas ambiguas. Esos casos pueden crear varios pedidos `pending` y varias preferencias de Mercado Pago para un mismo intento lógico.

DEC-021 dejó este problema fuera de alcance a propósito. El usuario pidió registrarlo como decisión y tarea independientes.

### Decisión

- Cada intento lógico usa un `checkoutAttemptId` UUID no secreto como clave durable.
- PostgreSQL es la última barrera de concurrencia mediante `public.checkout_attempts.checkout_attempt_id UNIQUE`.
- `checkout_attempts` relaciona un intento con una única orden y con la futura preferencia de Mercado Pago, sin duplicar customer/delivery ni PII.
- La orden, sus items y la reserva del intento se crean en la misma RPC/transacción. Un UUID duplicado provoca una violación UNIQUE y rollback total; no se usa `ON CONFLICT DO NOTHING`.
- No se almacena `request_fingerprint`: T-017.2 compara retries con el snapshot autoritativo ya persistido en `orders` y `order_items`.
- Estados iniciales: `reserved`, `creating_preference`, `ready`, `unknown`; lease y datos de preferencia quedan preparados para fases posteriores.
- T-017.1–T-017.4 están completadas. El runtime y frontend T-017 fueron desplegados y el QA real validó reutilización del mismo intento, separación de una intención distinta, ausencia de duplicado ante doble clic/retry normal y rechazo seguro de READY + order `paid`.

### Consecuencias

- T-017 queda COMPLETADA / VALIDADA EN PRODUCCIÓN. Un attempt real `ready` asociado a una order `paid` respondió HTTP 409 con `checkout_attempt_already_paid`; no redirigió, no creó order/preference y no modificó el attempt ni la order.
- Las migraciones 007 y 008 están aplicadas en producción. El exceso de privilegios de `service_role` descubierto durante el cutover fue corregido manualmente y quedó reproducido por la 008.
- El runtime T-017 usa la firma v2 de 27 parámetros y `checkoutAttemptId`; la RPC anterior de 26 parámetros permanece disponible.
- La idempotencia durable está ACTIVA EN PRODUCCIÓN después del deploy en EasyPanel y del QA real descrito arriba.
- La verificación final reconstruyó la intención desde `order_items` reales; `max(order.id)` permaneció igual, el attempt siguió `ready` y la order siguió `paid`. Un request previo basado en columnas legacy produjo el mismatch esperado sin efectos secundarios.
- El recovery usa `Preference.search` por `external_reference` y `Preference.get({ preferenceId: ... })` cuando necesita completar una preferencia. Este contrato corrige el hallazgo bloqueante inicial de auditoría.
