# Diseño técnico

## T-022.6-B — proceso automático aislado

```text
npm start
  → node index.js
  → Express solamente

npm run shipping:worker
  → node scripts/shipping-worker.js
  → guard SHIPPING_IMPORT_WORKER_ENABLED=true
  → ciclo inmediato: processNextShippingImport() × 1
  → al terminar: setTimeout(siguiente ciclo, intervalMs)
```

El scheduler es recursivo y post-completion: nunca hay dos invocaciones activas dentro del mismo proceso. Cada tick conserva el límite T-022.4 de un claim, una operación provider y una transición. Veinte trabajos se consumen gradualmente, no mediante `while`.

`unknown` queda fuera de futuros claims; `retryable` depende de `next_attempt_at` en DB; `created`, `failed`, `lease_lost` e `idle` esperan el próximo ciclo. El proceso no ejecuta recovery de leases. Dos instancias accidentales pueden trabajar en paralelo, pero `FOR UPDATE SKIP LOCKED` y lease siguen siendo la autoridad para impedir la misma fila; esto aún no agrega QA PostgreSQL multi-instancia.

El quinto error inesperado consecutivo marca fatal y detiene scheduling. El controlador primero deja finalizar el ciclo y limpia `activeCycle`; después notifica una sola vez. Sólo `scripts/shipping-worker.js` decide ejecutar `process.exit(1)`, cuando ya no existe operación provider/DB activa.

SIGTERM/SIGINT cancelan el timer, no inician otro claim y esperan la operación activa hasta 30 s. Si termina, registran `stopped` y exit 0. Si vence, registran `shutdown_timeout`, mantienen exit 1 y no imprimen `stopped`; no abortan el provider y una finalización tardía no reactiva scheduling ni convierte el shutdown en success. El proceso está preparado para un futuro servicio EasyPanel separado, pero no está desplegado.

## T-022.6 — flujo validado en producción

```text
checkout HOME Classic
  → pago aprobado + webhook
  → orders: paid
  → shipping import: queued (attempt 0, sin lease)
  → CLI manual one-shot
  → processing + lease (attempt 1)
  → POST /shipping/import
  → createdAt válido
  → shipping import: created (lease limpio)
```

La validación real confirmó una sola operación de provider y una sola transición final. El estado persistido terminó sin lease, retry ni error. La observación visual en MiCorreo confirmó estado **Validado** y correspondencia con el snapshot QA 0,3 kg / 35 × 25 × 5 cm.

Este flujo manual validado no cambia la arquitectura de activación: `npm start`, `index.js`, `app.js` y webhook no ejecutan el worker. Automatización, reconciliación de `unknown`, Express, tracking y labels requieren decisiones posteriores.

## T-022.6-A — composición manual one-shot

Los entrypoints `scripts/shipping-process-once.js` y `scripts/shipping-expire-once.js` delegan en `shippingImportCli`. La capa valida `--execute` y `SHIPPING_IMPORT_MANUAL_EXECUTION=true` antes del `require` diferido del worker; por eso una invocación deshabilitada no carga configuración, no crea cliente Supabase y no puede reclamar filas.

Process y expire permanecen operaciones distintas. Cada entrypoint hace una llamada y termina; no hay loop, sleep, timer, polling o retry de proceso. El worker conserva toda la lógica T-022.4 y la composición existente repository/service/provider. `npm start` sigue siendo exclusivamente `node index.js`.

El formatter reconstruye la salida desde una allowlist, sin serializar resultados o errores completos. Process admite `idle|created|retryable|unknown|failed|lease_lost`; expire admite `expired` y count no negativo.

## T-022.5 — paid + queue legacy-safe desplegada

`mark_order_paid_and_queue_shipping_import_v2` es una RPC aditiva aplicada por la migración 010. Bajo un lock `FOR UPDATE` de la order, revalida que siga `pending` y que moneda/importe coincidan. Después persiste `paid` y, si existe el snapshot elegible, ejecuta `not_requested → queued` en la misma transacción.

La cola es subordinada al pago. Su actualización vive en un subbloque PL/pgSQL: snapshot ausente, snapshot `queued`/`processing` u otra anomalía logística producen `shipping_queued=false` sin inventar filas y sin revertir la confirmación financiera. La respuesta mínima no contiene PII: `order_id`, `status`, `shipping_queued`.

Dos webhooks simultáneos se serializan en PostgreSQL; sólo el primero puede observar `pending`. La RPC anterior queda preservada para un cutover reversible. La migración 010 y `paid + queued` fueron validados con un pago real. El worker no tiene activación automática; `/shipping/import` se validó mediante one-shot manual.

## T-022.4 — worker durable desplegado y no activado

```text
processNextShippingImport (máximo una fila)
  → UUID + lease 60 s
  → ShippingImportsRepository.claimNextShippingImport
  → normalización decimal explícita
  → ShippingImportService.importShipment
  → repository: created | retryable | unknown | failed
```

El worker no construye payloads, recalcula paquetes, toca orders ni ejecuta SQL directo. Un resultado holder-only nulo produce `lease_lost`; una excepción de persistencia no provoca transición alternativa. `expireStaleShippingImportLeases` está separada y sin scheduler; el repository interpreta `null` como cero filas, valida arrays y rechaza otros tipos.

Backoff determinista: 1, 5 y 15 minutos para attempts 1–3; el cuarto termina failed. No hay jitter en esta etapa para mantener operación y tests reproducibles. Red/timeout sólo son retryable con evidencia explícita de que ocurrieron antes del POST; errores ambiguos nunca entran en retry automático. El caso 401 + fallo de renovación y el segundo POST 401 terminan unknown conservadoramente.

El módulo no es alcanzable desde el startup ni el webhook. Sólo es alcanzable desde el CLI interno con doble guarda; automatización y frecuencia pertenecen a etapas posteriores.

## T-022.3 — importación desplegada y validada manualmente

`claim/snapshot → ShippingImportService → ShippingProvider.importShipment → MiCorreoProvider → POST /shipping/import`.

El servicio valida y arma el payload; el provider conoce autenticación, Bearer, timeout, retry único de 401 y clasificación HTTP/transporte. Ninguna pieza modifica SQL. El worker T-022.4 traducirá resultados a `created|retryable|unknown|failed`.

HOME usa `deliveryType: D`, domicilio y `AR-J → J`; no incluye agency. AGENCY usa `deliveryType: S` y `agency = shipping_agency_code`; no incluye domicilio. Ambos usan recipient mínimo y snapshot físico/económico. `shipping_apartment` se omite porque combina piso/departamento y no se separa heurísticamente.

Sólo Classic atraviesa el mapping y el payload omite `productType`; Express retorna `UNSUPPORTED_SERVICE` antes de red. Un éxito exige 2xx y `createdAt` válido. Red, timeout o 5xx luego del POST y 2xx inválido son potencialmente ambiguos y no disparan retry logístico.

El servicio no está enlazado a Express ni webhook. El CLI one-shot validó Classic en producción; no existe polling ni scheduler.

Corrección posterior a auditoría: `declared_value` acepta sólo `number` finito no negativo y el perfil físico sólo enteros positivos; `createdAt` valida componentes de calendario y offset sin depender de la normalización de `Date.parse`. El transporte compartido conserva por defecto `micorreo_network_error`; únicamente import opta por distinguir timeout. HTTP 408 se clasifica `TIMEOUT` ambiguo sin retry. Los errores no tipados se propagan como internos y no se inventa que el POST fue intentado.

La auditoría independiente cerró **APROBADA CON OBSERVACIONES**, sin bloqueantes. Para T-022.4, un fallo al renovar después de un POST 401 debe interpretarse conservadoramente: `requestAttempted: false` sólo describe el retry que no se ejecutó. El borde repository/worker deberá normalizar explícitamente cualquier `numeric` recibido como string antes del servicio. `normalizeProvince` se exporta como API interna reutilizada, con riesgo bajo.

## T-022.2 — outbox durable desplegado y validado

La migración 009 modela el estado financiero y el logístico por separado. Cada order nueva obtiene exactamente una fila `order_shipping_imports`; no existe backfill automático. `ext_order_id` copia `orders.external_reference`, que es `NOT NULL`, `UNIQUE` y no se actualiza en el flujo, evitando generar otro UUID en retries.

```text
create_pending_order_with_items_v3
  └─ llama v2: order + order_items + checkout_attempt
  └─ inserta order_shipping_imports/not_requested
     └─ ext_order_id + peso/dimensiones + products_subtotal congelados

T-022.5 futuro
  Mercado Pago approved
    → RPC: order pending→paid + import not_requested→queued
    → webhook 200

worker futuro (inactivo)
  queued | retryable vencido
    → claim SKIP LOCKED + lease + attempt_count
    → provider futuro
    → created | retryable | unknown | failed
```

**HISTÓRICO T-022.2 / infraestructura:** los perfiles provienen de `packageProfiles.js` según la cantidad total, se pasan a v3 y quedan congelados. Los valores siguen siendo 300 g / 5 × 25 × 35 cm TEMPORAL/QA. `declared_value` congela solo `products_subtotal`; excluye shipping. T-022.3 consume ese snapshot y no vuelve a llamar `getPackageProfile()`.

El claim solo toma una order `paid` en `queued` o `retryable` con `next_attempt_at <= now()`, usa `FOR UPDATE SKIP LOCKED`, incrementa intentos y devuelve snapshot, destinatario y selección logística mínimos. Las transiciones desde `processing` comparan `lease_token` y lease no vencido. Un proceso antiguo recibe cero filas y no puede sobrescribir al nuevo. Expirar un lease produce `unknown`, nunca `queued`, porque el request externo pudo haber sido enviado. `unknown` no participa del claim automático.

**HISTÓRICO T-022.2 / SUPERADO sólo respecto del payload local:** la migración 009 está aplicada y el runtime productivo usa v3; RPC 26 y v2 permanecen intactas. El QA PostgreSQL validó atomicidad, rollback, snapshot y state machine hasta claim, y un checkout productivo sin pago confirmó la creación `pending/not_requested`. La RPC paid+queue existe, pero no está conectada a `markOrderAsPaid`; el repositorio no tiene scheduler/worker activo. Classic/Express, reconciliación real, worker y QA real del import siguen pendientes; el payload local fue implementado después en T-022.3.

T-022.5 debe tratar explícitamente las orders `pending` creadas antes de v3: por decisión no recibieron backfill y, al no tener snapshot logístico, no pueden usar paid+queue. Debe conservarse una ruta financiera segura para esas orders legacy, sin fabricar snapshots retrospectivos. Por este motivo paid+queue no debe conectarse todavía al webhook.

El despliegue de esta infraestructura no activa `/shipping/import`: no existe provider real de importación, worker, retries externos ni reconciliación operativa de `unknown`, y no se crean envíos en MiCorreo.

## Post-pago UX — diseño productivo validado

`GET /success` continúa sirviendo una vista estática y no participa en la confirmación del pago. La página no lee parámetros de retorno ni consulta backend, Mercado Pago o Supabase; `POST /webhook` y `Payment.get` conservan la autoridad sobre `orders.status`.

Al cargar, `successCleanup.js` elimina `localStorage["lemont.cart"]` mediante `CART_KEY` exportada por `cartStore.js` y limpia `sessionStorage["lemont.checkoutAttempt.v1"]` mediante `checkoutAttemptClient.clearCheckoutAttempt`. Las operaciones están aisladas para que el fallo de un storage no impida intentar la otra. No se tocan otras keys.

La página usa header/footer, tipografías, colores y botones del frontend LEMONT; su card central es responsive, tiene jerarquía semántica y foco visible. Una visita manual a `/success` también ejecuta el cleanup: es un riesgo UX aceptado para evitar introducir tokens, consultas o estados frontend que simulen autoridad de pago. Una protección futura mediante flag de `sessionStorage` queda como mejora no bloqueante.

La implementación fue auditada por Grok, enviada al repositorio, desplegada en EasyPanel y validada manualmente en navegador real el 2026-09-17. El QA confirmó carga, diseño, textos, navegación al inicio y cleanup de ambas keys. Estado: COMPLETADO / DESPLEGADO / VALIDADO EN PRODUCCIÓN.

## T-017 — hardening READY + order `paid` productivo

Cuando el retry coincide con el snapshot y el intento está `ready`, el backend inspecciona el estado de la order ya cargada antes de construir la respuesta durable. Si la order está `paid`, responde HTTP 409 con `type: checkout_attempt_already_paid` y el mensaje público `Esta compra ya fue pagada.`. El corte ocurre antes de cualquier cotización, RPC de creación, claim, recovery o llamada a Mercado Pago; tampoco modifica el attempt ni la order. READY + `pending` conserva la reutilización existente.

El frontend clasifica este caso por el `type` estable, no redirige a Mercado Pago, elimina únicamente `sessionStorage["lemont.checkoutAttempt.v1"]`, conserva `localStorage["lemont.cart"]` y muestra el mensaje de compra pagada. Los demás HTTP 409 conservan su comportamiento. La implementación local pasó 380/380 tests y luego fue desplegada y validada con un attempt/order real: no creó recursos ni alteró los estados `ready`/`paid`. T-017 está COMPLETADA / VALIDADA EN PRODUCCIÓN.

## T-017.4 — hardening reproducible de privilegios efectivos

La migración 007 ya fue aplicada en producción y confirmó la coexistencia de RPC 26, RPC v2 y claim. La verificación efectiva mostró que los default privileges de Supabase podían ampliar los grants declarados en 007, incluyendo UPDATE de tabla completo y privilegios DELETE/TRUNCATE/TRIGGER/REFERENCES.

La corrección productiva se aplicó manualmente. La migración 008 la hace reproducible con este patrón idempotente:

```text
checkout_attempts
  → REVOKE ALL service_role
  → GRANT SELECT, INSERT
  → GRANT UPDATE (seis columnas operativas)

checkout_attempts_id_seq
  → REVOKE ALL service_role
  → GRANT USAGE
```

La 008 no modifica funciones, tablas ni constraints. Los permisos RPC, RLS y policies permanecen fuera de su alcance. Fue aplicada en producción después de la corrección manual. El runtime/frontend T-017 está desplegado, usa RPC v2 y conserva RPC 26 disponible.

Auditoría 008: **APROBADO CON OBSERVACIONES**, sin hallazgos críticos. Observaciones históricas: el hash test de 007 depende de LF/CRLF; los tests no afirman `BEGIN`/`COMMIT` explícitamente; no se requiere `NOTIFY pgrst` al cambiar solo privilegios; el hardening se limita a `service_role`; y 008 estaba untracked durante aquel `git diff --check`.

## T-017.4-A — preparado localmente / auditado / APROBADO CON OBSERVACIONES

```text
migración 007
  ├─ conserva create_pending_order_with_items (26) ← runtime T-021
  ├─ crea create_pending_order_with_items_v2 (27) ← runtime T-017
  ├─ crea checkout_attempts
  └─ crea claim_checkout_attempt
```

La v2 conserva exactamente la semántica idempotente auditada: `p_checkout_attempt_id uuid` primero, order + `order_items` + `checkout_attempts` en una sola función PL/pgSQL y conflicto UNIQUE sin `ON CONFLICT`, de modo que PostgreSQL revierte toda la transacción. Usa `SECURITY INVOKER`, `search_path` fijo y `EXECUTE` solo para `service_role`. `orders.js` llama exclusivamente v2; la RPC 26 no se elimina ni redefine.

La auditoría no encontró hallazgos críticos y aprobó el diseño con observaciones. Confirmó que `claim_checkout_attempt`, RLS y permisos mínimos permanecen seguros y que el rollback a T-021 es viable porque RPC 26 continúa disponible.

Resultado del cutover:

1. **Precheck:** completado para la aplicación real de 007.
2. **Aplicar 007:** completado en producción.
3. **Schema reload:** completado/verificado.
4. **Verificación SQL:** RPC 26, v2, claim y RLS verificados; privilegios amplios detectados y corregidos manualmente. La migración 008 registra el hardening.
5. **Deploy:** completado en EasyPanel; las creaciones nuevas usan v2.
6. **Smoke/checkout QA:** completado dentro del flujo productivo informado.
7. **Idempotency QA:** mismo intent/retry conservó attempt/order/preference; nueva intención creó nuevas entidades; doble clic/retry normal no duplicó la orden.
8. **Payment QA:** pago real con shipping, webhook y `pending → paid` completado. El hardening READY con order ya `paid` fue desplegado y validado posteriormente.
9. **Cleanup futuro:** tras estabilidad, una migración separada podrá retirar RPC 26. No forma parte de T-017.4-A.

Rollback: si 007 ya fue aplicada pero el deploy aún no, el runtime viejo continúa mediante RPC 26 y no se revierte por compatibilidad. Si falla el runtime nuevo, se restaura el deployment T-021, que sigue teniendo RPC 26. No se automatizan operaciones destructivas.

Observaciones históricas de preparación: podía existir una ventana breve de schema cache tras `NOTIFY pgrst`, Node T-017 no debía desplegarse antes de 007 y los tests SQL eran mayormente estáticos. El orden de cutover se respetó y el QA real cubrió reutilización, cambio de intención, doble clic/retry y, en el cierre final, order `paid` + attempt READY.

## T-017.3 — identidad durable en frontend local

```text
body lógico del checkout
  → identidad normalizada y serialización determinista
  → SHA-256 con Web Crypto
  → sessionStorage lemont.checkoutAttempt.v1
  → reutilizar UUID si digest coincide | crypto.randomUUID() si cambia
  → POST /crear-preferencia con checkoutAttemptId (sin intentDigest)
```

Productos duplicados se agrupan y ordenan por SKU. Customer/delivery se normalizan aproximadamente como backend; agency code solo forma identidad para AGENCY. El record contiene exactamente versión, UUID y digest, por lo que la PII no queda en texto claro.

Red, 500/503 y checkout busy conservan el UUID. Mismatch o attempt inválido limpian solo el record. Éxito conserva el record antes de redirigir. No hay retry automático. La ausencia de Web Crypto bloquea el fetch de forma controlada.

Los HTTP 409 se clasifican por código: `shipping_changed`, `agency_changed`, `checkout_busy`, `checkout_mismatch`, `checkout_attempt_already_paid` y `checkout_unavailable`. Un 409 genérico ya no se interpreta como cambio de envío.

T-017.3 está completada y auditada. El frontend/runtime T-017 está desplegado y la idempotencia durable está activa en producción; RPC 26 se conserva por compatibilidad.

Observaciones históricas de auditoría de T-017.3: normalización rara de email/`streetNumber`, sort de SKU, cobertura nominal de HTTP 500/storage y límites de los tests VM. El estado productivo del 2026-09-17 prevalece: READY + order `paid` ya está cerrado; la limpieza segura tras el retorno continúa como evolución separada.

## T-017.2 / DEC-022 — integración backend durable local

```text
checkoutAttemptId UUID
  → buscar checkout_attempts + order + order_items
  → si no existe: RPC v2 de 27 parámetros crea order + items + reserved
  → comparar identidad lógica contra snapshot persistido
  → claim atómico con lease backend de 30 s
  → crear o recuperar preference por external_reference
  → ready (preference_id + checkout_url) | unknown
```

`checkout_attempts.checkout_attempt_id` y `order_id` son UNIQUE. Dos transacciones concurrentes con el mismo UUID pueden construir trabajo provisional, pero solo una inserta el intento; la otra recibe unique violation y PostgreSQL revierte su order e items dentro de la misma llamada. No se usa `ON CONFLICT DO NOTHING`.

`checkoutAttemptId` es requerido por el backend y nunca se genera allí. La comparación usa SKU/cantidad agrupados, customer y delivery normalizados, shipping option y agency code solo para AGENCY; no usa nombres/precios actuales ni recotiza retries. Un mismatch responde 409 genérico.

El claim es una función SQL con un único UPDATE condicional: admite `reserved`, `unknown` o `creating_preference` vencido. READY y leases activos no son reclamables. Todas las transiciones actualizan `updated_at`; READY/UNKNOWN limpian lease; los UPDATE de runtime están condicionados por attempt + estado + lease token.

UNKNOWN y leases vencidas consultan primero `Preference.search` por `external_reference`: cero resultados permite crear; uno exacto/utilizable se persiste READY; más de uno queda ambiguo y no se elige. Si el summary único necesita completarse, el SDK 3.1.0 recibe `Preference.get({ preferenceId: ... })`. La preferencia se reconstruye desde `orders` + `order_items`, incluido el envío, y su total se valida en centavos contra `orders.amount`.

La migración 007 contiene la RPC v2 de 27 parámetros, coherencia de estados y claim atómico; fue aplicada en producción y conserva RPC 26. El hardening efectivo de columnas se corrigió manualmente y quedó reproducido por la migración 008, también aplicada. T-017.1–T-017.4 están completadas; el runtime y el hardening READY + order `paid` fueron validados en producción.

Observaciones no bloqueantes de diseño para las fases restantes: el reconocimiento `23505` conserva fallback por nombre de constraint en `message/details`; una lease vencida combinada con una búsqueda todavía no indexada tiene riesgo teórico de segunda preference; `Preference.search` puede modificar opciones de timeout del cliente SDK compartido; el matching de SKU no agrega `trim`; y el claim concurrente aún no tiene prueba SQL real. T-017.4 debe probar recovery y concurrencia de forma real/controlada.

## T-021 / DEC-026 — COMPLETADA / ACEPTADA

```text
POST /sucursales-envio { province: AR-J }
  → ShippingService → provinceCode J + customerId backend
  → MiCorreoProvider.listAgencies → GET /agencies
  → ACTIVE + pickupAvailability → respuesta pública normalizada

checkout AGENCY { shippingOptionId, shippingAgencyCode }
  → resolver carrito → recotizar /rates → validar opción actual
  → listar agencias por delivery.province → validar code actual
  → snapshot autoritativo → RPC → preferencia productos + Envío
```

HOME no llama `/agencies`, ignora cualquier code extra y persiste agency null. La migración 006 reemplaza allowlists/constraints y la firma T-020 sin overload; conserva `SECURITY INVOKER`, `search_path` fijo y `EXECUTE` solo para `service_role`. Fue aplicada durante el cierre de T-021. `/shipping/import` permanece pendiente.

## T-020 / DEC-025 — COMPLETADA / ACEPTADA

```text
checkout { items|legacy, customer, delivery, shippingOptionId }
  → resolver carrito y subtotal en centavos
  → rechazar 5+ sin MiCorreo/RPC/MP
  → recalcular perfil y POST /rates
  → normalizar/deduplicar rates y buscar el ID home exacto
  → tomar tarifa actual y calcular total en centavos
  → construir productos + Envío y validar su total exacto en centavos
  → RPC atómica: order pending + N items + shipping snapshot + total
  → validar respuesta RPC
  → preferencia MP: N productos + ítem Envío
```

El browser solo elige `shippingOptionId`. No decide tarifa, subtotal, total, moneda, provider, service, customerId, origen ni dimensiones. Son cobrables `micorreo:home:classic` y `micorreo:home:express`; agency se muestra sin control seleccionable. Un ID válido desaparecido responde 409; fallos de MiCorreo, 503 antes de persistir.

Node trabaja en centavos: `totalCents = subtotalCents + shippingCents`. La RPC valida `products_subtotal` contra los items, el snapshot home y `p_expected_amount` contra subtotal + envío. `orders.amount` pasa a ser el total final. El webhook no cambia: compara `Payment.get` contra ese snapshot total y la moneda persistida.

La migración 005 agrega seis columnas nullable y checks de cohesión/allowlist/aritmética, elimina la firma anterior y crea una única firma nueva `SECURITY INVOKER`, con `search_path` fijo y `EXECUTE` solo para `service_role`. Fue aplicada como parte del despliegue T-020 informado al iniciar T-021.

Frontend mantiene la tarifa solo en memoria para mostrar Subtotal/Envío/Total; envía únicamente el ID y la invalida al cambiar CP/carrito o ante 409. En T-020, agencias quedaban fuera; T-021 las incorpora sin `/shipping/import`, tracking ni stock. Los perfiles continúan TEMPORAL/QA.

El diseño fue validado en producción el 2026-09-17 mediante un pago real: shipping incluido en la preferencia, webhook válido y transición final de la orden de `pending` a `paid`. DEC-025 quedó aceptada. Esta evidencia no aprueba los perfiles TEMPORAL/QA para uso comercial.

## T-019 / DEC-024 — antecedente (COMPLETADA / ACEPTADA)

`POST /cotizar-envio → ShippingService → ShippingProvider → MiCorreoProvider` conserva las capas de T-018.

El servicio acepta `{ items: [{ sku, quantity }], postalCodeDestination }` o legacy `{ sku, quantity, postalCodeDestination }`. Mezcla/ausencia de contratos devuelve 400 genérico. `resolveCart` agrupa y valida; sumar quantities resueltas da `totalUnits`. Solo 1–4 unidades totales: 5+ se rechazan antes de autenticación/tarifas.

`packageProfiles.js` es la autoridad editable de dimensiones: cuatro perfiles TEMPORAL/QA, todos 300 g / 5 × 25 × 35 cm. `catalog.shipping` queda obsoleto/no autoritativo. Peso entero 1–25000 g y dimensiones enteras 1–150 cm; perfil ausente/inválido falla con 503 sin red. No inferir packaging real.

Payload de `/rates`: customerId y CP origen del entorno, CP destino validado y dimensions del perfil. Sin `deliveredType` ni `productType`. Origen de producción acordado: **5465, Rodeo, San Juan**; fixture 1000. No se cambia configuración privada.

Opciones: D/S → home/agency; CP/EP → classic/express; id `micorreo:<deliveryType>:<service>`, provider, type (compatibilidad), deliveryType, service, label controlado y price numérico finito no negativo. Se descartan tipos desconocidos y precios inválidos. No exponer customerId/validTo/productName crudo. El frontend usa texto seguro, admite items y legacy, invalida respuestas tardías al cambiar CP/carrito y no envía datos autoritativos.

En el cierre histórico de T-019, la cotización era informativa y Etapa C estaba pendiente. Sin selección de agencia/importación. Prueba real `POST /rates` PROD (2026-09-15): `micorreo_rates_ok options=4`; origen 5465, destino QA 5400; sin JWT/secretos impresos; sin `/shipping/import`. Perfiles 1–4 TEMPORAL/QA; medidas **no** aprobadas para producción. El estado vigente de cobro local está descrito arriba. Las referencias a quantity 1 de las secciones siguientes describen el estado anterior a T-019.

## Arquitectura general

La aplicación es un monolito pequeño de Node.js. Express sirve el frontend estático y expone las rutas de API. El backend se comunica directamente con Mercado Pago y Supabase.

```text
Producto → Agregar al carrito → lemont.cart (version 1, sku + quantity)
  → POST /carrito/resumen → backend autoritativo → entrega.html
  → POST /crear-preferencia { items, customer, delivery, shippingOptionId }
Producto → Comprar ahora → entrega.html?id&sku&quantity=1
  → POST /crear-preferencia { sku, quantity, customer, delivery, shippingOptionId }
Ambos → recotización home → validar productos + Envío antes de persistir
  → 1 RPC → orden pending + N order_items + snapshot de shipping
  → 1 preferencia MP, N productos + Envío, 1 external_reference de la RPC
  → Checkout Pro → webhook HMAC → Payment.get
  → pending → paid contra orders.amount/currency persistidos
```

## Módulos principales

- `index.js`: entrypoint mínimo; carga configuración, importa `app` y arranca el servidor.
- `src/app.js`: instancia Express, middlewares, rutas y handlers HTTP.
- `src/config.js`: valida variables de entorno obligatorias y exporta configuración de backend.
- `src/catalog.js`: catálogo versionado del servidor y helper `getProduct(sku)` (DEC-013).
- `src/logger.js`: helper `log(level, event, extra)` de DEC-017.
- `src/payments.js`: clientes de Mercado Pago, creación de preferencias y consulta de pagos.
- `src/orders.js`: cliente Supabase, persistencia de pedidos y transición `pending → paid`.
- `src/webhookSignature.js`: validación HMAC-SHA256 de firma webhook (DEC-009).
- `src/cart.js`: resolver común, validación, agrupación y cálculo en centavos; resumen y arrays RPC/MP.
- `public/index.html`: inicio LEMONT.
- `public/carrito.html`: página de carrito.
- `public/js/app.js`: header/footer y contador por unidades, visible en móvil.
- `public/js/producto.js`: talle, Agregar al carrito y Comprar ahora.
- `public/js/cartStore.js`: persistencia `lemont.cart`, versión 1, solo SKU + quantity, sin PII.
- `public/js/carrito.js`: DOM seguro, edición y resumen backend.
- `public/js/entrega.js`: formulario y aside; caminos carrito y legacy.
- `public/js/checkout.js`: envía uno de los dos contratos y redirige a MP.
- `public/app.js`: stub histórico; no ejecuta el checkout vigente.
- `public/css/reset.css`, `styles.css`, `components.css`: presentación visual compartida.
- `public/success.html`, `failure.html`, `pending.html`: páginas de retorno.
- `package.json`: scripts y dependencias de ejecución.
- `.env.example`: contrato de configuración, sin valores reales.
- `tests/index.test.js`: suite Jest con 158 tests.

## Estructura de archivos backend (implementada — T-009 completada)

```
index.js                      # Entrypoint: carga config, crea app, arranca servidor
src/
  app.js                      # Instancia Express: middlewares, rutas, handlers
  catalog.js                  # Catálogo versionado del servidor — DEC-013
  config.js                   # Lee y valida variables de entorno; exporta constantes
  logger.js                   # Helper log(level, event, extra) — DEC-017
  payments.js                 # Crear preferencia, consultar Payment.get — Mercado Pago
  orders.js                   # createPendingOrder, markOrderAsPaid — Supabase
  webhookSignature.js         # Validación HMAC-SHA256 de x-signature — DEC-009
tests/
  index.test.js               # Suite Jest actual: 158 tests
```

## Flujo de creación de pago

1. Seleccionar S/M/L/XL habilita ambos CTA. Agregar al carrito no navega; Comprar ahora no modifica el carrito (D1-A).
2. El carrito almacena solo SKU y quantity. `POST /carrito/resumen` alimenta el resumen del carrito y el aside de entrega sin persistir ni cobrar.
3. Entrega valida cliente/domicilio y envía `{ items, customer, delivery, shippingOptionId }`; el camino temporal conserva `{ sku, quantity, customer, delivery, shippingOptionId }`. Ambos requieren datos y una opción home válidos.
4. El handler detecta propiedades propias: `items` combinado con `sku` o `quantity` raíz devuelve HTTP 400 `{ "error": "Carrito inválido" }`, sin RPC ni MP. El legacy conserva el orden y mensajes de validación.
5. `src/cart.js` limita a 50 entradas originales, agrupa SKUs y valida cantidad acumulada hasta 4. Es un máximo temporal, no stock. Resuelve precios/moneda desde `src/catalog.js`.
6. Calcula precios unitarios, líneas y subtotal en centavos enteros; recotiza y obtiene `shippingCents`. Construye N productos + `Envío` y comprueba que su suma en centavos coincide con `subtotalCents + shippingCents` **antes de la RPC**.
7. Una llamada a `create_pending_order_with_items` crea una orden `pending` y N `order_items`, con subtotal, shipping snapshot y total. PostgreSQL valida `p_items`, calcula `SUM(quantity * unit_price)`, compara el subtotal y genera `external_reference`. Node comprueba importe, moneda y estado de la respuesta.
8. Una preferencia MP recibe los N productos + `Envío` y exactamente esa referencia; conserva URLs de retorno, notificación y `auto_return: "approved"`.
9. Se devuelven `preference_id`, `init_point` y `sandbox_init_point`; el frontend prioriza `init_point` y deshabilita el botón durante el request.

Si falla la RPC o su respuesta es inconsistente, no se llama MP. Si falla MP, la orden puede quedar pending: no se compensa ni borra. La idempotencia durable pertenece a DEC-022/T-017, fuera de T-016.

## Flujo del webhook

Antes de procesar, el webhook valida HMAC-SHA256. No recalcula precios del catálogo: compara contra `orders.amount` y `orders.currency` persistidos.

1. `POST /webhook` obtiene el tipo desde `topic` o `type`.
2. Obtiene el identificador desde `id`, `resource`, `data.id` o `data.id` en query.
3. Los eventos distintos de `payment` se confirman e ignoran.
4. Para pagos, `Payment.get` consulta la fuente autoritativa.
5. Solo se procesa `status === "approved"`.
6. Se exige `external_reference`.
7. `markOrderAsPaid` busca el pedido, descarta duplicados y valida moneda e importe normalizado a centavos.
8. Actualiza estado, ID de pago, estado externo y fecha.
9. Según DEC-019/T-015, el endpoint responde 200 para éxito y resultados definitivos/idempotentes, 401 para firma ausente/inválida y 503 genérico para fallos temporales o inesperados, permitiendo reintentos.

## Rutas

| Método | Ruta | Propósito |
|---|---|---|
| GET | `/` | Frontend estático principal |
| POST | `/carrito/resumen` | Resumen autoritativo sin persistencia |
| POST | `/cotizar-envio` | Cotización autoritativa para 1–4 unidades totales |
| POST | `/sucursales-envio` | Agencias MiCorreo normalizadas por provincia |
| POST | `/crear-preferencia` | Crear pedido y preferencia de pago |
| POST | `/webhook` | Recibir eventos de Mercado Pago |
| GET | `/webhook` | Diagnóstico temporal, solo con `NODE_ENV !== "production"` |
| GET | `/success` | Retorno visual de pago aprobado |
| GET | `/failure` | Retorno visual de pago rechazado |
| GET | `/pending` | Retorno visual de pago pendiente |

## Persistencia

La tabla `orders` usa `external_reference` como clave de correlación única. El estado inicial es `pending` y el único cambio financiero implementado es a `paid`. Las migraciones 001–004 definen pedidos, variantes, cliente/entrega, `order_items` y la RPC atómica; la 005 aplicada agrega subtotal, envío y snapshot HOME. La 006 está aplicada en producción: las columnas nullable `shipping_agency_*` existen y T-021 persiste el snapshot autoritativo para AGENCY sin completar pedidos históricos. Las migraciones 007 y 008 agregan `checkout_attempts`, RPC v2, claim y hardening reproducible de privilegios. La 009 también está aplicada: agrega el outbox logístico y RPC v3, que es la usada por el checkout productivo y envuelve v2; RPC 26 y v2 permanecen disponibles. Los pedidos nuevos guardan cliente, destino, uno o más items y el snapshot logístico `not_requested`; durante la transición, el primer item también completa las columnas legacy de producto en `orders`. El webhook conserva por ahora la transición `pending → paid` existente; paid+queue no está conectado hasta resolver el caso legacy-safe de T-022.5.

## Flujo de compra con entrega

Carrito continúa a `entrega.html` sin query de producto. Un carrito vacío bloquea la compra; un resumen inválido muestra error genérico y permite volver a editar/eliminar. El aside contiene N líneas del backend, renderizadas con DOM seguro. Comprar ahora conserva `entrega.html?id=…&sku=…&quantity=1` y sus validaciones legacy.

Cliente y domicilio viven en el formulario, nunca en localStorage ni en la URL. El frontend no controla precio, moneda, total, estado ni `external_reference`. La cotización admite el carrito resuelto de 1–4 unidades totales. Si se elige AGENCY, el frontend lista sucursales por provincia y exige una antes de habilitar el pago; backend vuelve a validar rate y code.

## Cotización logística local — Etapa 6A

### Actualización T-018 / DEC-023 — 2026-09-14

`POST /cotizar-envio → ShippingService (shipping.js) → ShippingProvider (contrato estructural en shippingProvider.js) → MiCorreoProvider (micorreo.js)`.

El servicio valida entrada y construye el payload desde catálogo/configuración; admite inyección del provider mediante `createShippingService`. El contrato contiene `authenticate` y `quoteRates`, con un error común; no hay registro de providers ni jerarquía de implementaciones. MiCorreo conserva autenticación/transporte. La exportación `getShippingQuotes` mantiene el handler existente sin cambiar `app.js`.

`authenticate()` exportada devuelve el token solo al backend. Prioridad de vencimiento: `Date.parse(expires)` → JWT `exp` → compatibilidad legacy `expires_in`/`expiresIn`. Margen de 30 segundos, sin cachear vencimientos desconocidos ni extender tokens vencidos. La lectura de `exp` no valida la firma del JWT. Se comparte una autenticación en vuelo y se libera también al fallar. Un 401 de tarifas permite un solo retry; un 401 tardío no invalida un token distinto renovado concurrentemente. Se conserva timeout de fetch de 8 segundos.

**Prueba real (2026-09-15):** el usuario ejecutó `POST /token` contra API MiCorreo PROD. Resultado: `micorreo_auth_ok`. No se imprimió ni persistió JWT, contraseña, Basic Auth ni `customerId`. No se invocó `quoteRates`, `/rates` ni `/shipping/import`. `authenticate()` no se monta en Express. No hay scripts de ejecución automática.

Las descripciones de Etapa 6A siguientes son antecedentes de contrato de cotización (quantity 1, medidas QA, tarifa informativa). `/rates` y `/shipping/import` siguen sin prueba real.

La Etapa 5 prepara el destino y la Etapa 6A agrega cotización informativa mediante MiCorreo:

```text
Entrega → POST /cotizar-envio → shipping.js → micorreo.js → /token → /rates → opciones normalizadas
```

Solo admite 1 SKU × quantity 1; cantidades 2 y 4 se rechazan antes de MiCorreo. El request del navegador contiene solo `sku`, `quantity` y `postalCodeDestination`. `src/catalog.js` aporta medidas; configuración aporta `customerId` y CP de origen. `micorreo.js` mantiene JWT únicamente en memoria, comparte una obtención en curso, aplica expiración/timeout y renueva una sola vez ante 401.

La respuesta pública expone `type`, `label` y `price`. Domicilio es informativo y sucursal aclara que su selección está pendiente. No existen `/agencies`, `/shipping/import`, tracking, etiquetas, creación de envío ni estados logísticos. La tarifa no se persiste ni forma parte del total.

Las medidas 300 g / 5 × 25 × 35 cm son temporales de QA y deben reemplazarse por datos reales. T-018 validó únicamente `POST /token` PROD; `/rates` y `/shipping/import` no fueron probados.

## Modelo `orders` + `order_items` implementado

`orders` conserva identidad, cliente, entrega, total, moneda, estado y correlación de pago. `order_items` conserva snapshots autoritativos de SKU, nombre, talle nullable, cantidad, precio unitario y `line_total` generado. La FK `order_items.order_id → orders.id` usa `ON DELETE CASCADE`.

La RPC `create_pending_order_with_items` recibe datos escalares estrictos y `p_items jsonb` validado: array obligatorio, propiedades permitidas explícitas, tipos y rangos controlados, y rechazo de items vacíos o importes inconsistentes. La suma se calcula en PostgreSQL y debe coincidir con `p_expected_amount`. El checkout vigente envía N ítems agrupados desde el carrito, o uno en el camino legacy.

La RPC usa `SECURITY INVOKER`, `search_path` fijo y ejecución reservada a `service_role`. Navegadores, `anon` y `authenticated` no pueden ejecutarla directamente.

## Variantes y limitaciones comerciales actuales

- Remera LEMONT: SKUs `LEM-REM-001-S`, `LEM-REM-001-M`, `LEM-REM-001-L` y `LEM-REM-001-XL`.
- `REMERA-LEMONT-001` fue retirado y no se acepta.
- Precio vigente: ARS 1.000 temporal para pruebas controladas; debe reemplazarse antes del lanzamiento comercial.
- `src/catalog.js` es la única autoridad sobre precio, moneda, nombre y máximo.
- El carrito permite editar cantidades hasta `maxQuantity: 4` temporal. No existe stock real; un SKU no representa disponibilidad.
- El stock futuro requiere disponibilidad, reserva atómica, concurrencia, liberación por abandono y confirmación tras el pago.

## Servicios externos

- Mercado Pago Checkout Pro: checkout, preferencias, pagos y webhook.
- Supabase: almacenamiento de pedidos mediante una clave `service_role`.
- ngrok: túnel HTTPS opcional de desarrollo; no forma parte de una arquitectura de producción.

## Decisiones técnicas actuales

- Backend y frontend servidos por el mismo proceso Express.
- Producto, cantidad, precio y moneda definidos en backend.
- Correlación por `external_reference`.
- Confirmación mediante consulta a Mercado Pago en lugar de confiar solo en el evento.
- Retornos estáticos separados del estado autoritativo del pedido.
- CommonJS en backend; vanilla + ES modules en `public/js/`.
- Configuración sensible mediante variables de entorno.

## Limitaciones estructurales

- Puerto fijo y catálogo versionado en backend; sin fuente administrable externa todavía.
- La ruta `GET /webhook` queda restringida a entornos no productivos.
- La idempotencia durable está activa y T-017 está COMPLETADA / VALIDADA EN PRODUCCIÓN, incluido el caso READY asociado a una order ya `paid`. El rate limiting continúa pendiente y no forma parte de T-017.
- La UX y el cleanup de `/success` están desplegados y validados. La visita manual también limpia carrito/attempt; el riesgo está aceptado y un flag previo en `sessionStorage` es una mejora futura no bloqueante.
- MiCorreo `POST /shipping/import`, catálogo dinámico y stock real por SKU todavía no están implementados.
- El backend endurecido está desplegado en EasyPanel/VPS desde la rama `main` de `checkout-mp-supabase-template`, bajo `checkout.lemont01.com`; no hay infraestructura como código.

## Implementado y vigente

- Validación criptográfica HMAC-SHA256 de firma webhook (T-001, DEC-009).
- Creación de preferencia bloqueada si Supabase falla (T-002).
- Transición `pending → paid` atómica e idempotente (T-003, DEC-010).
- Validación de variables de entorno al iniciar (T-004).
- Comparación monetaria normalizada a centavos; validación de moneda (T-007, DEC-011).
- Identificadores de pedido generados por PostgreSQL dentro de la RPC; `crypto.randomUUID()` permanece para correlación segura de logs.
- Separación de responsabilidades en módulos `src/` (T-009).
- Logs estructurados JSON con `request_id` y lista de campos prohibidos (T-010, DEC-017).
- Migración SQL versionada aplicada en Supabase con RLS habilitada (T-006, DEC-012).
- `GET /webhook` condicionado a `NODE_ENV !== "production"` (T-011).
- Catálogo autoritativo en `src/catalog.js` (T-012/DEC-013); el handler acepta `items[]` (T-016) y conserva legacy `{ sku, quantity, customer, delivery }`. Precio, total y moneda se calculan en backend.
- T-016 COMPLETADA, Pasos 1–4: carrito, checkout dual y documentación alineada.
- Deploy a staging documentado para EasyPanel/VPS con checklists y rollback (T-013, DEC-016).
- Política resiliente 401/200/503 del webhook implementada y validada en producción (T-015, DEC-019).
- T-020/DEC-025 completadas y validadas con pago real, shipping incluido y transición `pending → paid`.
- T-021/DEC-026 productivas con migración 006 aplicada y snapshot autoritativo de agencia.
- Runtime T-017 desplegado con RPC v2 e idempotencia durable activa; migraciones 007/008 aplicadas y RPC 26 conservada temporalmente.

## Frontend actual de LEMONT

Vanilla + ES modules en `public/js/`; header/footer inyectados por `app.js`. Home, Catálogo, Producto, Carrito, Entrega y Contacto comparten el cromado LEMONT. Las tarjetas conservan Ver producto/Próximamente; solo Remera LEMONT es comprable. Las imágenes externas son temporales.

- **D1-A:** Agregar al carrito es principal, no navega y muestra feedback; Comprar ahora es secundario y conserva legacy sin agregar. Ambos requieren talle.
- `cartStore` agrupa, descarta campos extra y recupera un carrito vacío si la estructura/JSON es inválida. Guarda solo `{ version: 1, items: [{ sku, quantity }] }` en `lemont.cart`, nunca PII. Sus límites son informativos.
- Contador = suma de cantidades, visible también en móvil; se actualiza con mutaciones, carga y eventos storage.
- Carrito y resumen usan `createElement`, `textContent` y `replaceChildren`; no interpolan datos locales ni del resumen en innerHTML.
- **Evolución de D2-A:** crear preferencia y redirigir no vacían. `/failure` y `/pending` tampoco. `/success` ahora elimina carrito y checkout attempt como cleanup UX, pero no confirma ni modifica el pago.
- QA visual/manual del Paso 3 correcto y aprobado. Sin tests DOM a propósito, sin jsdom/Playwright. Suite backend: **158/158**, verificada nuevamente el 2026-09-13.

El cierre documental no acredita un nuevo despliegue ni pagos reales. Credenciales, stock, logística, deuda npm e idempotencia durable siguen fuera de T-016.

## Regla operativa de recarga del runtime

Node no recarga automáticamente los módulos CommonJS del proceso iniciado con `npm start`. Después de modificar archivos backend/runtime en `src/`, se debe reiniciar el proceso Node antes de cualquier prueba manual. El incidente QA de campos `customer_*` y `shipping_*` en `NULL` se debió a una instancia antigua que seguía ejecutando el mecanismo legacy; la función activa en PostgreSQL estaba correcta.
