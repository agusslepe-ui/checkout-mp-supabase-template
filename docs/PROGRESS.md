# Progreso

## 2026-09-19 — cierre QA automático real T-022.6-B/C

- **QA AUTOMÁTICO REAL: VALIDADO END-TO-END EN PRODUCCIÓN.** Una nueva compra HOME Classic completó `Mercado Pago → webhook → paid → queued → shipping-worker → MiCorreo → created` sin ejecutar `shipping:process-once` ni intervenir manualmente sobre el envío.
- Estado final: order `paid`, shipping `created`, attempt 1, timestamps de provider/import presentes y `last_error_type` nulo; no hubo retry, `unknown`, `failed` ni `lease_lost`.
- El servicio EasyPanel `shipping-worker` permaneció activo durante horas. Se verificaron polling de 60 s y múltiples `outcome=idle`.
- T-022.6-B queda DESPLEGADA / VALIDADA EN PRODUCCIÓN - WORKER AUTOMÁTICO. T-022.6-C queda DESPLEGADA / VALIDADA EN PRODUCCIÓN - PROCESO AISLADO / `Dockerfile.worker`.
- `SHIPPING_IMPORT_WORKER_ENABLED=true` está sólo en el servicio worker; `Dockerfile`, `npm start` y el servidor web permanecen separados.
- Cierre exclusivamente documental: sin leer `.env`, ejecutar workers, hacer requests ni modificar código, tests, SQL o migraciones.
- Pendientes: perfiles físicos definitivos 1–4, reconciliación operativa/automática de `unknown`, Express, tracking API y label API.

## 2026-09-18 — HISTÓRICO: T-022.6-B worker automático aislado local

- Agregado entrypoint `shipping:worker`, separado de Express y sin cambios en `npm start`.
- Guarda exacta `SHIPPING_IMPORT_WORKER_ENABLED=true`; intervalo default 60 s y mínimo 10 s.
- Primera iteración inmediata; una order por ciclo; siguiente `setTimeout` sólo después de terminar, sin overlap.
- Outcomes controlados continúan; el quinto error inesperado detiene scheduling y notifica fatal una vez después de limpiar el ciclo activo; el entrypoint termina con exit 1. Un resultado controlado resetea contador.
- Shutdown cooperativo para SIGTERM/SIGINT con límite de 30 s y sin nuevo claim. Timeout registra `shutdown_timeout`, no `stopped`, y no fuerza `process.exit` sobre una operación activa.
- Logs allowlisted; no se serializan errores, payloads ni PII. Expire continúa manual y separado.
- Tests mock/inyección únicamente. Sin worker real, requests, SQL, migraciones, webhook, commit, push o deploy.

## 2026-09-18 — cierre QA real T-022.6

- **QA REAL MICORREO: VALIDADO END-TO-END EN PRODUCCIÓN.** Compra HOME Classic, pago real aprobado, webhook, `paid + queued`, claim/lease, POST real y cierre `created` confirmados.
- La única ejecución manual devolvió `outcome=created`, `attemptCount=1`; no hubo segunda ejecución.
- DB final: order `paid`; import `created`; attempt 1; lease nulo; timestamps de provider/import presentes; sin next attempt ni error.
- Portal MiCorreo: envío visible como **Validado**; 0,3 kg y 35 × 25 × 5 cm coinciden con el snapshot QA.
- T-022.3 queda DESPLEGADA / VALIDADA; T-022.5, DESPLEGADA / VALIDADA EN PRODUCCIÓN; T-022.6-A, DESPLEGADA / VALIDADA EN PRODUCCIÓN mediante one-shot manual.
- Sin PII ni identificadores sensibles en la evidencia. En ese corte la automatización seguía pendiente; fue desplegada y validada el 2026-09-19.

## 2026-09-18 — HISTÓRICO: T-022.6-A CLI manual one-shot local

- Implementados comandos separados `shipping:process-once` y `shipping:expire-once`, sin ejecución automática.
- Doble guarda exacta: argumento `--execute` y `SHIPPING_IMPORT_MANUAL_EXECUTION=true`. Una invocación bloqueada no carga el worker ni toca DB/provider.
- Process ejecuta como máximo un claim/provider/transición; expire ejecuta sólo recovery y nunca se encadena con process.
- Output allowlisted y errores sanitizados. Exit 0 para outcomes controlados; exit 1 para guarda ausente, configuración/resultado inválido o error inesperado.
- Tests totalmente inyectados/mock; ningún CLI real ejecutado, sin requests a MiCorreo, SQL, migraciones, webhook, endpoint, scheduler, commit, push o deploy.
- T-022.5 ya está desplegada y validada a nivel infraestructura; migración 010 aplicada.

## 2026-09-18 — HISTÓRICO: T-022.5 paid + queue antes del worker automático

- **T-022.5: DESPLEGADA / VALIDADA A NIVEL INFRAESTRUCTURA.** La migración 010 con RPC v2 aditiva está aplicada y `markOrderAsPaid` está desplegado.
- El pago válido ya no depende de que exista un snapshot logístico. Con snapshot `not_requested`, `paid + queued` ocurre en la misma transacción; sin snapshot o con otro estado, queda `paid` y `shipping_queued=false`.
- La order se bloquea con `FOR UPDATE`; importe, moneda y estado se vuelven a validar en PostgreSQL. Los duplicados no repiten la transición ni la cola.
- La RPC anterior permanece disponible. La nueva es `SECURITY INVOKER`, fija `search_path` y limita `EXECUTE` a `service_role`.
- Atomicidad y concurrencia fueron validadas en PostgreSQL. Worker y `/shipping/import` continúan inactivos.

## 2026-09-18 — HISTÓRICO: T-022.4 worker durable desplegado e inactivo

- Implementado módulo invocable de una iteración; idle, created, retryable, unknown, failed y lease_lost, sin activación automática.
- Lease 60 s; backoff determinista 1/5/15 min; cuarto attempt falla. Normalización decimal canónica en el borde y `attempt_count` del claim sin incrementarlo en Node.
- AUTH inicial previo al POST es retryable; fallo de renovación tras POST 401 y segundo POST 401 son unknown. Red, timeout, HTTP 408, server y respuesta ambigua posteriores al POST también son unknown.
- Hardening final: expiración tolera respuesta `null` como cero filas; arrays se validan y tipos inesperados fallan. Se ampliaron regresiones de tipos, fracciones y whitespace.
- Expiración de leases es una función separada que sólo llama la RPC de 009. Concurrencia permanece bajo autoridad DB/RPC, sin locks Node.
- En este corte T-022.4 está desplegada como capa inactiva: sin timer, scheduler ni caller productivo. `/shipping/import` sigue INACTIVO productivamente.

## 2026-09-18 — HISTÓRICO: T-022.3 provider + mapping local

- **Auditoría independiente Grok: APROBADO CON OBSERVACIONES, sin bloqueantes.** T-022.3 queda IMPLEMENTADA LOCALMENTE / AUDITADA / APROBADA CON OBSERVACIONES / NO PRODUCTIVA.
- Las correcciones aprobadas cubren validación numérica sin coerción, calendario RFC3339 real, timeout legacy sin regresión, 408 ambiguo y propagación de errores inesperados. Las observaciones no bloqueantes para T-022.4 están registradas en `TASKS.md`.

- Implementados `ShippingImportService` y `MiCorreoProvider.importShipment` sin conectar ejecución productiva.
- Mapping desde snapshot: HOME `D` con domicilio/provincia normalizada; AGENCY `S` con agency code y sin domicilio; recipient mínimo; declared value y medidas persistidas, sin `getPackageProfile()`.
- Classic-only temporal. Express se rechaza antes de transporte; `productType`, floor y apartment se omiten hasta resolver contrato/modelo.
- Éxito exige 2xx + `createdAt` parseable y retorna sólo ese campo. No hay retry logístico interno, sólo renovación única por 401.
- Tests exclusivamente mock. Sin llamadas externas, SQL, migraciones, worker, webhook, cambios financieros, deploy, commit o push. `/shipping/import` permanece INACTIVO.
- Pendientes: Classic/Express, perfiles reales, T-022.4, T-022.5, T-022.6, reconciliación de `unknown` y prueba real MiCorreo.

## 2026-09-17 — cierre productivo de T-022.2

- **T-022: EN PROGRESO. T-022.2: DESPLEGADA / VALIDADA EN PRODUCCIÓN.**
- Migración 009 aplicada correctamente; existen RPC 26, v2, v3, paid+queue, claim y transiciones/recovery. RPC 26 y v2 permanecen disponibles.
- Seguridad verificada: RLS activa, cero policies públicas, `anon`/`authenticated` sin acceso, EXECUTE de RPC solo para `service_role`; tabla con SELECT/INSERT y UPDATE limitado a `state`, `attempt_count`, leases, scheduling, timestamps/resultados y error. El snapshot no es actualizable.
- No hubo backfill: `order_shipping_imports` comenzó con cero filas.
- QA PostgreSQL transaccional real: v3 creó order, items, attempt e import atómicamente; snapshot 300/5/25/35, declared value igual al subtotal y estado `not_requested`; rollback completo sin residuos.
- QA real de state machine: `pending+not_requested → paid+queued → processing+lease`; se validaron intentos, token, expiración, snapshot del claim y rollback, sin llamada a MiCorreo.
- Runtime v3 desplegado después de 009. Un checkout productivo real sin pago creó order `pending` + import `not_requested`, correlación correcta y llegó a Mercado Pago.
- `/shipping/import` continúa INACTIVO: no hay provider/worker productivos, retries externos, reconciliación de `unknown` ni creación real de envíos. El webhook aún no usa paid+queue.
- Riesgo reservado a T-022.5: paid+queue exige snapshot y no puede conectarse al webhook hasta resolver orders legacy sin fila sin bloquear su transición financiera a `paid`.

## 2026-09-17 — HISTÓRICO: T-022.2 implementada localmente antes del cutover

- **Estado de ese corte:** T-022 EN PROGRESO; T-022.2 IMPLEMENTADA LOCALMENTE / NO PRODUCTIVA. Este estado fue superado por el cierre productivo registrado arriba.
- Nueva migración 009, no aplicada: tabla `order_shipping_imports`, snapshot físico y `declared_value = products_subtotal`, estados logísticos independientes, RLS y grants explícitos.
- Nueva RPC v3 envuelve la v2 para crear order/items/checkout attempt/import en una transacción. Conserva RPC 26 y v2. `ext_order_id` reutiliza el `external_reference` único e inmutable.
- Preparadas RPC de paid+queue atómica, claim con `SKIP LOCKED`, finalizaciones holder-only y expiración segura `processing → unknown`.
- Nuevo repositorio `shippingImports.js`; no está importado por el runtime, no ejecuta polling y no llama MiCorreo. El webhook permanece sin cambios y no encola todavía.
- `orders.js` local llama v3 y congela el perfil actual según unidades. Los valores 300/5/25/35 no cambiaron y siguen TEMPORAL/QA.
- Cobertura agregada para tabla/constraints, snapshots, declared value, compatibilidad, atomicidad preparada, claim/lease, stale worker, retry schedule, expiración, RLS/grants y ausencia de backfill/provider. Resultado: **402/402 tests, 11 suites, 0 fallos**.
- Limitación: la concurrencia y seguridad SQL se verificaron estáticamente/mocks; no se aplicó 009 ni se ejecutó una prueba PostgreSQL real.
- Pendientes: T-022.1, perfiles reales, Classic/Express, reconciliación práctica, provider, worker activo, webhook, deploy y QA.

## 2026-09-17 — cierre productivo de post-pago UX + cleanup

- **Estado: COMPLETADO / DESPLEGADO / VALIDADO EN PRODUCCIÓN.** La implementación fue auditada por Grok, tuvo commit y push, y fue desplegada en EasyPanel.
- QA manual en navegador real: `/success` carga correctamente, el diseño visual es correcto, muestra “¡Gracias por tu compra!” y “Estamos preparando tu pedido”, y “Volver al inicio” funciona.
- El cleanup productivo elimina `localStorage["lemont.cart"]` y `sessionStorage["lemont.checkoutAttempt.v1"]`; el carrito queda vacío y el checkout attempt eliminado.
- No hubo impacto en backend ni `orders`, ni llamadas a Mercado Pago o Supabase. El webhook conserva la autoridad del pago.
- Riesgo aceptado: visitar `/success` manualmente también limpia carrito y attempt. Una posible protección futura mediante flag de `sessionStorage` queda como mejora no bloqueante.
- Próximos bloques: perfiles físicos reales, MiCorreo `POST /shipping/import` post-pago, catálogo/stock/imágenes dinámicos y hardening comercial.

## 2026-09-17 — post-pago UX + cleanup implementados localmente

- `success.html` fue reemplazada por una página LEMONT responsive y accesible con agradecimiento, aprobación, preparación del pedido y enlace “Volver al inicio”. No muestra IDs, PII, tracking ni despacho.
- Nuevo `successCleanup.js`: elimina `lemont.cart` usando la constante real de `cartStore.js` y limpia `lemont.checkoutAttempt.v1` mediante el helper existente. Conserva otras keys y tolera storage bloqueado.
- `/success` no lee query params, no hace fetch, no consulta Mercado Pago/Supabase y no actualiza orders; el webhook conserva la autoridad exclusiva del pago.
- Riesgo aceptado: una visita manual a `/success` también limpia carrito y attempt. Se prefiere esta simplicidad hasta disponer de una confirmación frontend autoritativa sin ampliar el alcance.
- Tres regresiones dedicadas; suite completa **383/383 tests**, 10 suites, 0 fallos.
- Estado: IMPLEMENTADO LOCALMENTE / NO PRODUCTIVO. Pendiente deploy y QA real; sin commit, push ni deploy en esta sesión.

## 2026-09-17 — cierre definitivo T-017 validado en producción

- **T-017: COMPLETADA / VALIDADA EN PRODUCCIÓN. DEC-022: ACEPTADA.** Migraciones 007/008, `checkout_attempts`, RPC v2, claim y privilegios endurecidos están productivos; RPC 26 permanece temporalmente disponible.
- Frontend y backend T-017 están desplegados juntos en EasyPanel. El QA previo confirmó reutilización para la misma intención, separación para una intención nueva y ausencia de duplicados ante doble clic/retry normal.
- El hardening final se validó reutilizando una `checkout_attempt` real en `ready` cuya order estaba `paid`. `POST /crear-preferencia` con la intención original completa devolvió HTTP 409 con `type: checkout_attempt_already_paid` y `error: Esta compra ya fue pagada.`.
- No hubo redirección a Mercado Pago, nueva order ni nueva preference; `max(order.id)` no cambió, el attempt permaneció `ready` y la order permaneció `paid`.
- La reconstrucción correcta usó `order_items` reales. Un primer request armado con columnas legacy produjo correctamente mismatch y cero efectos secundarios.
- En ese cierre de T-017, `success.html`, cleanup post-pago, `/shipping/import`, catálogo/stock/imágenes, perfiles reales, precio, secretos, npm y dominio/frontend/SEO continuaban pendientes y quedaban fuera de T-017. Success/cleanup se cerraron productivamente después, como registra el bloque superior.

## 2026-09-17 — T-017 hardening READY + order paid implementado localmente

- Backend: un attempt `ready` con order `paid` responde 409 con `type: checkout_attempt_already_paid` y mensaje público `Esta compra ya fue pagada.`; READY + `pending` continúa reutilizando la preference durable.
- El rechazo ocurre sobre el intento persistido antes de cotizar o crear recursos. No llama MiCorreo/Mercado Pago, no crea order/preference/attempt y no modifica attempt/order.
- Frontend: el nuevo 409 elimina solo `sessionStorage["lemont.checkoutAttempt.v1"]`, conserva el carrito, no redirige y muestra el mensaje de compra pagada. Los demás 409 conservan su comportamiento.
- Regresiones agregadas en flujo, integración HTTP y frontend. Suite completa: **380/380 tests**, 9 suites, 0 fallos.
- Estado histórico de esa implementación: quedó local y pendiente de deploy/QA durante esa sesión. El cierre productivo posterior está registrado en el bloque superior.

## 2026-09-17 — estado productivo real: T-017 activo y T-020 cerrado

- Migraciones 007 y 008 aplicadas en producción. Se verificaron `checkout_attempts`, RPC 26 conservada, RPC v2 de 27 parámetros, `claim_checkout_attempt`, `SECURITY INVOKER`, `search_path`, RLS y permisos.
- El exceso de privilegios heredado por `service_role` desde default privileges de Supabase fue corregido manualmente; la 008 auditada y aplicada deja la corrección reproducible.
- Runtime T-017 desplegado en EasyPanel. QA real de idempotencia aprobado para los casos ejecutados: mismo intento/intención reutiliza attempt, order y preference; intención distinta crea nuevas entidades; doble clic/retry normal no duplicó la orden. La idempotencia durable está ACTIVA EN PRODUCCIÓN.
- Estado superado por el cierre posterior: en este corte previo T-017 seguía en progreso; el bloque superior registra su validación productiva definitiva.
- T-020 quedó COMPLETADA / AUDITADA / VALIDADA EN PRODUCCIÓN y DEC-025 ACEPTADA. Un pago real con shipping incluido llegó por webhook y llevó `orders.status` de `pending` a `paid`.
- Incidencia resuelta durante el pago: DNS de `checkout.lemont01.com` apuntaba a la IP anterior; se corrigió al VPS EasyPanel actual. Tras comprobar puerto 80 y regenerar Traefik, Let's Encrypt emitió un certificado válido. Un POST sin firma a `/webhook` respondió 401 controlado y la notificación válida posterior fue procesada.
- T-021/DEC-026 permanecen COMPLETADA/ACEPTADA.
- Pendientes posteriores y fuera de T-017: página de agradecimiento; limpieza segura de carrito/sessionStorage; `/shipping/import`; stock real; catálogo, imágenes y descripciones dinámicos; perfiles reales; precio comercial; rotación de credenciales; auditoría npm; dominio/frontend/SEO.

## 2026-09-16 — T-017.4 / migración 008 auditada y APROBADA CON OBSERVACIONES

- La migración 007 fue aplicada correctamente en producción. Se verificaron `checkout_attempts`, RPC 26, RPC v2, `claim_checkout_attempt`, seguridad invoker/search path, permisos de ejecución y RLS.
- La verificación efectiva descubrió default privileges amplios de `service_role`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE de tabla y UPDATE sobre todas las columnas. Los tests estáticos de 007 no lo detectaron.
- Producción fue corregida manualmente: tabla solo SELECT/INSERT; UPDATE solo sobre seis columnas operativas; sequence solo USAGE; RLS habilitada, cero policies públicas y sin SELECT para `anon`/`authenticated`.
- Nueva migración local `008_harden_checkout_attempts_privileges.sql`: revoca todo a `service_role` sobre tabla/sequence y reotorga exclusivamente los privilegios mínimos verificados. Es idempotente respecto del estado actual.
- La 008 no toca RPC 26, RPC v2, claim, tablas ni constraints. La 007 permanece byte-for-byte intacta.
- Nuevas regresiones: existencia y orden REVOKE→GRANT; SELECT/INSERT únicos a nivel tabla; UPDATE exacto de seis columnas; ausencia de DELETE/TRUNCATE/TRIGGER/REFERENCES; sequence solo USAGE; ausencia de RPC/claim en 008; hash SHA-256 fijo de 007.
- Verificación: **377/377 tests**, 9 suites, 0 fallos.
- Auditoría 008: **APROBADO CON OBSERVACIONES**, sin hallazgos críticos. Estado: PREPARADA LOCALMENTE / AUDITADA / APROBADA CON OBSERVACIONES.
- Observaciones no bloqueantes: hash test de 007 dependiente de LF/CRLF; ausencia de asserts explícitos para `BEGIN`/`COMMIT`; 008 no necesita `NOTIFY pgrst`; alcance limitado a `service_role`; archivo 008 untracked durante `git diff --check`.
- En ese corte histórico no hubo SQL real en la implementación local, deploy, commit, push, red real ni lectura de `.env`; producción todavía ejecutaba runtime T-021/RPC 26 y el deploy/QA T-017 permanecía pendiente. El bloque del 2026-09-17 documenta su ejecución posterior.

## 2026-09-16 — T-017.4-A preparado localmente / auditado / APROBADO CON OBSERVACIONES

- Migración 007 conserva `create_pending_order_with_items` de 26 parámetros sin DROP ni redefinición y crea `create_pending_order_with_items_v2` con el contrato auditado de 27 parámetros.
- RPC v2 mantiene `SECURITY INVOKER`, `search_path = pg_catalog, public`, revocación para `PUBLIC`/`anon`/`authenticated` y `EXECUTE` solo para `service_role`.
- Order + items + checkout attempt siguen siendo atómicos; un `checkoutAttemptId` duplicado revierte la llamada completa. State machine, lease, RLS, permisos de tabla y `claim_checkout_attempt` permanecen.
- `src/orders.js` llama exclusivamente `create_pending_order_with_items_v2`; argumentos, validación de respuesta y `markOrderAsPaid` no cambiaron.
- Regresiones SQL/runtime verifican ausencia de DROP/redefinición de RPC 26, firma v2 de 27 parámetros con UUID, atomicidad, permisos, claim, llamada exclusiva v2 y preservación del pago.
- Verificación: **372/372 tests**, 9 suites, 0 fallos; `npm.cmd test`, `node --check src/orders.js` y `git diff --check` correctos.
- Auditoría final: **APROBADO CON OBSERVACIONES**, sin hallazgos críticos. Confirmó RPC 26 intacta, v2 con 27 parámetros y UUID primero, uso exclusivo de v2, claim/RLS/permisos seguros, compatibilidad hacia atrás y rollback viable a T-021.
- Estado histórico de ese corte: T-017 seguía EN PROGRESO. T-017.4-A quedaba con CUTOVER PREPARADO LOCALMENTE / AUDITADO / APROBADO CON OBSERVACIONES; la ejecución T-017.4 permanecía PENDIENTE.
- Orden documentado en esa preparación: precheck → 007 → reload/verificación → deploy → QA. Los pasos hasta la verificación de base se completaron posteriormente; el estado vigente y el hallazgo de privilegios constan en el bloque superior.
- Rollback: antes del deploy, RPC 26 mantiene operativo el runtime viejo; si falla el deploy nuevo, volver al deployment T-021. No se implementaron comandos destructivos ni migración de limpieza.
- Observaciones no bloqueantes: posible ventana breve de schema cache tras `NOTIFY pgrst`; nunca desplegar Node T-017 antes de 007; tests SQL mayormente estáticos; QA real pendiente de concurrencia, recovery MP, browser back/READY, sessionStorage/Web Crypto, paid order y doble click.
- Estado histórico de la preparación local: en ese momento 007 no estaba aplicada y producción todavía continuaba con T-021/RPC 26. Ambos estados fueron superados posteriormente por el cutover T-017 documentado en el bloque del 2026-09-17.

## 2026-09-16 — T-017.3 completada localmente / auditada / APROBADA CON OBSERVACIONES

- Nuevo helper frontend `checkoutAttemptClient.js`: identidad canónica, SHA-256 nativo, validación del record y UUID exclusivo de `crypto.randomUUID()`.
- `sessionStorage` usa `lemont.checkoutAttempt.v1` y guarda únicamente `{ version: 1, checkoutAttemptId, intentDigest }`; no persiste carrito, PII ni notas en claro.
- El mismo digest reutiliza UUID. Cambios lógicos de productos, customer, delivery, shipping option o agency generan otro; HOME ignora agency code.
- El request agrega solo `checkoutAttemptId`; nunca envía `intentDigest` ni acepta un UUID desde el input externo.
- Red/500/503/busy conservan el record; mismatch y attempt inválido lo eliminan. Shipping/agency mantienen invalidación; 409 desconocido no se trata como shipping. Sin retry automático.
- Botón conserva estados busy/redirect y vuelve a habilitarse para busy/mismatch. Sin Web Crypto no hay fetch y se muestra error controlado.
- Auditoría final: **APROBADA CON OBSERVACIONES**.
- Verificación final: **369/369 tests**, 9 suites, 0 fallos; `npm test`, sintaxis frontend y `git diff --check` correctos. Mocks solamente; sin red real.
- Observaciones no bloqueantes para T-017.4: normalización de espacios internos de email/`streetNumber` no idéntica al backend; orden ASCII de SKU frente a `localeCompare`; sin test nominal explícito de HTTP 500 ni de `SecurityError`/`QuotaError` de storage; VM sin validar ESM real; y record conservado tras redirect pendiente de QA con browser back, READY, order paid y post-pago real.
- T-017.4 debe incluir doble click/concurrencia real, storage real y Web Crypto real en navegador.
- Estado histórico del cierre T-017.3: T-017 continuaba EN PROGRESO y la 007 todavía no estaba aplicada. El estado vigente consta en el bloque superior.

## 2026-09-16 — T-017.2 completada localmente / auditada / APROBADA CON OBSERVACIONES

- Backend de `POST /crear-preferencia` exige y normaliza `checkoutAttemptId`; no genera claves.
- Retry existente se compara solo por identidad lógica contra `orders` + `order_items`; HOME ignora agency code y AGENCY lo exige. READY responde desde persistencia sin catálogo, MiCorreo, nueva order ni Mercado Pago.
- Nuevo repositorio `src/checkoutAttempts.js`; lease backend de 30 s; claim atómico por `claim_checkout_attempt`; transiciones holder-only con `updated_at`; `checkout_attempt_id`/`order_id` no se actualizan.
- Carrera `23505` solo se trata como retry para `checkout_attempts_checkout_attempt_id_key`. Otros conflictos conservan el error normal.
- UNKNOWN y lease vencida buscan primero preferencias Mercado Pago por `external_reference`; 0 permite claim+create, 1 persiste READY, múltiples mantienen UNKNOWN. Errores ambiguos de creación pasan a UNKNOWN.
- Hallazgo bloqueante inicial corregido: el SDK 3.1.0 requiere `Preference.get({ preferenceId: ... })`, no la forma anterior con `id`. La re-auditoría final quedó APROBADA CON OBSERVACIONES.
- La preferencia se reconstruye desde el snapshot persistido, incluido `Envío`; el total debe coincidir en centavos con `orders.amount`.
- Migración 007 modificada localmente: coherencia de estados, permisos UPDATE por columnas mutables y función de claim. **NO aplicada**.
- Verificación final: **345/345 tests**, 8 suites, 0 fallos; `npm test`, `node --check` y `git diff --check` correctos. Sin red real, `.env`, SQL aplicado, deploy, commit ni push.
- En ese cierre histórico producción continuaba con runtime T-021 y RPC 26, y T-017.2 no era desplegable hasta coordinar 007 + runtime 27 + frontend T-017.3. Ese cutover fue ejecutado posteriormente; el estado vigente consta en el bloque del 2026-09-17.
- Observaciones no bloqueantes trasladadas a T-017.3/T-017.4: fallback de `23505` por constraint en `message/details`; riesgo teórico de lease vencida con búsqueda MP aún no indexada; posible modificación del timeout del cliente SDK compartido por `Preference.search`; SKU matching sin `trim` adicional; concurrencia del claim cubierta por mocks/lógica, no SQL real; QA real/controlado de recovery y concurrencia requerido en T-017.4.

## 2026-09-16 — T-017.1 auditada / APROBADA CON OBSERVACIONES

- Cierre documental post-auditoría. Sin código, SQL, tests, `.env`, commit ni push.
- T-017.1: IMPLEMENTADA LOCALMENTE / AUDITADA / APROBADA CON OBSERVACIONES. Sin hallazgos críticos.
- Estado histórico de ese corte: DEC-022 permanecía ACEPTADA (2026-09-16); T-017 estaba EN PROGRESO y T-017.2/.3/.4 seguían pendientes.
- Estado histórico del cierre T-017.1: la migración 007 todavía no estaba aplicada y producción usaba RPC 26. El estado vigente consta en el bloque superior.
- Observaciones no bloqueantes para T-017.2: `updated_at` explícito en UPDATEs; coherencia de `ready` con preference_id/checkout_url; coherencia de `creating_preference` con lease; no reescribir `checkout_attempt_id`; unique violation `23505` reutiliza el attempt existente; cutover 26→27 coordinado.

## 2026-09-16 — T-017.1 implementada localmente / pendiente de auditoría

- DEC-022 aceptada y T-017 desbloqueada/en progreso.
- Nuevo dominio `checkoutAttempt`: valida UUID canónico, normaliza lowercase y expone los cuatro estados aprobados.
- Migración 007 local: tabla `checkout_attempts`, RLS/permisos mínimos, unicidades, lease coherente e infraestructura futura de preferencia.
- RPC futura de 27 parámetros: conserva T-021 y crea order + items + intento `reserved` atómicamente; UUID duplicado provoca rollback completo.
- Por seguridad de cutover, `orders.js` y `app.js` no fueron conectados en esa fase: producción continuaba entonces con la RPC aplicada de 26 parámetros.
- Verificación: **294/294 tests**, 5 suites; sintaxis Node y `git diff --check` correctos.
- Sin SQL aplicado, red real, Mercado Pago, MiCorreo, `.env`, commit, push ni deploy. T-017.2–T-017.4 pendientes.

## 2026-09-15 — T-021 implementada localmente / pendiente de auditoría

- `GET /agencies` integrado mediante provider/service existentes; endpoint público por provincia y respuesta normalizada.
- AGENCY Classic/Express cobrables solo con code revalidado; snapshot autoritativo preparado para RPC. HOME no llama agencies.
- UX con radios/tarjetas, búsqueda local, pay gate e invalidación por provincia/CP/carrito/opción y respuestas tardías.
- Nueva migración 006, no aplicada. Sin modificar 001–005 ni implementar `/shipping/import`.
- Verificación: **276/276 tests**, 4 suites, sin red real. Estado: T-021 no completada; DEC-026 no aceptada.
- T-020 figura como desplegada según handoff; su paid QA completo continúa separado y no se cierra desde T-021.

## 2026-09-15 — T-020 correcciones post-auditoría

- Auditoría Grok: APROBADA CON OBSERVACIONES. Se corrigieron orden de validación pre-RPC, mensajes 400 controlados de shipping, logs genéricos y documentación vigente/histórica.
- Regresiones nuevas: tarifa 498,06 en centavos; `/rates` vacío; carrito 3+2; inconsistencia interna sin RPC/MP; allowlist de mensajes frontend.
- Verificación: **242/242 tests**, 4 suites, 0 fallos, sin red real. Migración 005 no aplicada.
- Estado: **IMPLEMENTADO LOCALMENTE + AUDITORÍA CORREGIDA + PENDIENTE DE CUTOVER**. T-020 no está COMPLETADA y DEC-025 no está ACEPTADA.
- Sin lectura de `.env`, llamadas reales, SQL aplicado, commit, push ni deploy.

## 2026-09-15 — T-020 implementada localmente (antes de auditoría)

- Se integró shipping autoritativo en checkout: recotización MiCorreo, selección por ID, solo home cobrable y tarifa vigente.
- Se agregaron subtotal/envío/total y snapshot de carrier a la RPC y a la migración local 005, sin ejecutar SQL.
- Mercado Pago recibe productos + ítem `Envío`; webhook y HMAC permanecen intactos y comparan contra `orders.amount` total.
- Frontend exige envío, muestra Subtotal/Envío/Total e invalida por cambio de CP/carrito o 409. Agency sigue informativa.
- Tests en ese punto: 211/211 antes; 236/236 después, sin red real. `git diff --check` correcto salvo avisos informativos LF/CRLF.
- Sin `.env`, llamadas reales, `/shipping/import`, SQL aplicado, commit, push ni deploy.
- Estado en ese punto: T-020 no completada; DEC-025 no aceptada. La auditoría posterior fue aprobada con observaciones y ya fue corregida localmente.

## 2026-09-15 — Cierre formal T-019 / DEC-024

- Objetivo: registrar la aprobación del usuario y la prueba real PROD. Sin código, tests, migraciones, `.env`, commit ni push.
- DEC-024 → ACEPTADA. T-019 → COMPLETADA.
- Implementación local COMPLETADA. Auditoría técnica: APROBADO CON OBSERVACIONES. Suite **211/211**, 4 suites.
- Prueba real `POST /rates` PROD: `micorreo_rates_ok options=4`. Origen CP 5465 (Rodeo, San Juan). Destino QA CP 5400.
- No se imprimió JWT, password, Basic Auth, Bearer, `customerId` ni respuesta cruda. No se llamó `/shipping/import`. No se creó envío. Mercado Pago intacto. Envío no cobrado.
- Perfiles 1–4 siguen TEMPORAL/QA. Las medidas actuales **no** están aprobadas para producción.
- En ese cierre histórico, Etapa C (cobrar el envío) seguía PENDIENTE. El estado vigente está en T-020.

## T-019 — IMPLEMENTADO LOCALMENTE / PENDIENTE DE AUDITORÍA (histórico de esa sesión)

- Objetivo: Etapa B bajo DEC-024 y D1–D5 aprobadas. En esa sesión no se declaraba T-019 COMPLETADA ni se implementaba Etapa C. El cierre formal es el de 2026-09-15.
- Nuevos: `src/packageProfiles.js`, `tests/packageProfiles.test.js`, `tests/envio.test.js`.
- Modificados: `src/cart.js` (solo export), `src/catalog.js` (comentario obsoleto), `src/shipping.js`, `public/js/envio.js`, `public/js/entrega.js`, `tests/index.test.js` y documentación README/REQUIREMENTS/DESIGN/SECURITY/DECISIONS/TASKS/CURRENT_CONTEXT/PROGRESS.
- Contrato dual con resolver común; tope de 4 unidades totales; perfiles editables 1–4 TEMPORAL/QA, todos 300 g / 5 × 25 × 35 cm; payload exclusivamente autoritativo y validación de límites de dimensiones.
- Normalización domicilio/sucursal y Clásico/Express solo según respuesta; sin pedir servicio ni agencia. Cotizaciones obsoletas se invalidan al cambiar CP/carrito.
- Verificación: **211/211 tests**, 4 suites, 0 fallos; sintaxis frontend correcta; `git diff --check` sin errores. Pruebas frontend con DOM mínimo en memoria, sin navegador ni QA visual real.
- Sin lectura de `.env`, dependencias, red real, commit/push ni cambios a pagos/webhook/HMAC/RPC/migraciones. Total comercial intacto.
- Origen acordado CP 5465 — Rodeo, San Juan, a configurar privadamente; fixtures 1000. En esa sesión `/rates` PROD aún no estaba probado.

## 2026-09-15 — Cierre formal T-018 / DEC-023

- Objetivo: registrar la aprobación del usuario. Sin código, tests, migraciones, `.env`, commit ni push.
- DEC-023 → ACEPTADA. T-018 → COMPLETADA.
- Implementación local COMPLETADA. Auditoría técnica: APROBADA CON OBSERVACIONES.
- Prueba contra API real PROD: `POST /token` → `micorreo_auth_ok`. No se imprimió ni persistió JWT, contraseña, Basic Auth ni `customerId`.
- No se invocó `/rates` ni `/shipping/import`. No se insinúa que esas rutas hayan sido probadas.
- Suite: **178/178** tests, 2 suites, 0 fallos.
- Etapas B/C/D pendientes. Próximo paso registrado: Etapa B — cotización real multítem, todavía no implementada. Antes hay que definir peso real de la remera, dimensiones reales del paquete, estrategia de paquete multítem, CP de origen y servicios iniciales.

## 2026-09-14 — T-018 Etapa A implementada localmente (histórico de esa sesión)

- Objetivo: autenticación y separación mínima bajo DEC-023; en esa sesión la decisión se registró desde el pedido porque DEC-023/T-018 no existían en estos archivos. El cierre formal es el de 2026-09-15.
- Archivos: `src/micorreo.js`, `src/shipping.js`, nuevo `src/shippingProvider.js`, `tests/index.test.js`, nuevo `tests/micorreo.test.js`, `docs/DECISIONS.md`, `docs/TASKS.md`, `docs/DESIGN.md`, `docs/SECURITY.md` y esta bitácora.
- Autenticación interna exportada, expiración oficial y fallback JWT, margen de 30 s, caché en memoria, request en vuelo compartido, timeout de 8 s y retry único ante 401 con protección frente a respuestas tardías.
- Verificación: suite completa 178/178, 2 suites, 0 fallos; `git diff --check` corregido y verificado sin errores de whitespace.
- Checkout, Mercado Pago, webhook, HMAC, migraciones, frontend y configuración de startup intactos. Contrato de cotización, límite quantity 1, medidas TEMPORAL/QA y total sin envío conservados.
- En esa sesión: sin lectura de `.env`, instalación de dependencias, llamadas reales, commit ni push.

Última revisión documental: 2026-09-17. T-017 COMPLETADA / VALIDADA EN PRODUCCIÓN con migraciones 007/008 aplicadas, runtime desplegado e idempotencia durable activa, incluido READY + order `paid`. RPC 26 permanece disponible. T-020 cerrada con paid QA real y DEC-025 aceptada; T-021/DEC-026 permanecen cerradas. El bloque cronológico superior prevalece sobre estados históricos posteriores de este archivo.

## T-016 Paso 4 — COMPLETADO — 2026-09-13

Cierre de regresiones y documentación final: README, REQUIREMENTS, DESIGN, SKILLS, SECURITY, DEC-021, TASKS, PROGRESS y CURRENT_CONTEXT alineados con main. Suite ejecutada: **158/158**, 1 suite, 0 fallos. Diff solo Markdown y `git diff --check` correcto. Sin código ni tests nuevos; QA frontend manual aprobado en Paso 3. Deudas fuera de T-016.

## T-016 Paso 3 — COMPLETADO — 2026-09-13 (histórico de ese cierre)

Cierre formal tras auditoría (APROBADO CON OBSERVACIONES: QA visual/manual pendiente), QA visual/manual correcto y aprobación del usuario. El Paso 3 no estaba completado antes de esa aprobación.

- Objetivo: carrito frontend + `localStorage`, usando el checkout multítem ya existente.
- Decisiones: **D1-A** (Agregar al carrito + Comprar ahora); **D2-A** (no auto-vaciar).
- Implementado: `public/carrito.html`, `public/js/cartStore.js`, `public/js/carrito.js`; persistencia `lemont.cart` solo SKU + quantity; contador global por unidades; agregar / varios talles / incrementar / reducir / eliminar / vaciar; resumen vía `POST /carrito/resumen`; checkout `{ items, customer, delivery }`; camino legacy “Comprar ahora”; cotización informativa solo 1 SKU × quantity 1; el carrito no se auto-vacía.
- Archivos de código (sin commit de este cierre documental): `public/carrito.html`, `public/js/cartStore.js`, `public/js/carrito.js`, `public/js/app.js`, `public/js/producto.js`, `public/js/entrega.js`, `public/js/checkout.js`, `public/css/components.css`.
- Sin cambios de backend, webhook, HMAC, migraciones, dependencias ni `.env`. Suite **158/158**.
- DEC-021 ACCEPTED. T-016 EN PROGRESO. Paso 1 COMPLETADO. Paso 2 COMPLETADO. Paso 3 COMPLETADO. Paso 4 PENDIENTE.

## T-016 Paso 2 — COMPLETADO — 2026-09-12 (histórico de ese cierre)

Cierre formal tras auditoría (APROBADO CON OBSERVACIONES, solo documentales) y aprobación del usuario. El Paso 2 no estaba completado antes de esa aprobación.

- Objetivo: checkout multítem + Mercado Pago, conservando el contrato legacy y rechazando mezcla de contratos.
- Implementado: contrato `{ items, customer, delivery }`; compatibilidad `{ sku, quantity, customer, delivery }`; rechazo de mezcla; una orden `pending`; N `order_items`; una preferencia de Mercado Pago; N ítems de Mercado Pago; un único `external_reference` exactamente el de la RPC; cálculo autoritativo desde el backend; envío no incluido en el total.
- Archivos de código (sin commit todavía): `src/app.js`, `src/cart.js`, `tests/index.test.js`.
- Resolver interno compartido en `src/cart.js`: agrupa y valida; calcula en centavos; genera `p_items` y `preference.items` desde la misma representación.
- 29 tests nuevos. Suite completa: **158/158**, 1 suite, 0 fallos.
- Webhook intacto. Sin migraciones. Sin frontend/`localStorage`. Sin Correo Argentino adicional. Sin DEC-022/T-017. Sin stock real. Sin lectura de `.env`, llamadas reales, commit, push ni deploy.
- DEC-021 ACCEPTED. T-016 EN PROGRESO. Paso 1 COMPLETADO. Paso 2 COMPLETADO. Paso 3 PENDIENTE. Paso 4 PENDIENTE.

## HISTÓRICO — estado al 2026-09-15

> Este bloque conserva el corte previo a las auditorías, migraciones y despliegues posteriores. No describe el estado vigente del 2026-09-17.

- **T-021 EN PROGRESO / IMPLEMENTADA LOCALMENTE / PENDIENTE AUDITORÍA.** **DEC-026 PROPUESTA / IMPLEMENTADA LOCALMENTE / PENDIENTE AUDITORÍA.** Migración 006 no aplicada.
- **T-020 IMPLEMENTADA Y DESPLEGADA** según el handoff de T-021; paid QA completo pendiente por separado. **DEC-025** no aceptada.
- **DEC-024 ACEPTADA.** **T-019 COMPLETADA** (2026-09-15).
- Prueba real `POST /rates` PROD: `micorreo_rates_ok options=4`. Origen 5465, destino QA 5400. JWT/secretos no impresos. Sin `/shipping/import`, sin envío creado, sin cobro de shipping.
- Perfiles 1–4 TEMPORAL/QA; medidas **no** aprobadas para producción. La referencia a Etapa C pendiente corresponde al cierre histórico de T-019.
- **DEC-023 ACEPTADA.** **T-018 COMPLETADA** (2026-09-15).
- Prueba real `POST /token` PROD: `micorreo_auth_ok`. JWT no impreso ni persistido.
- Suite vigente: **276/276**, 4 suites.
- **T-016 COMPLETADA**, Pasos 1–4 COMPLETADOS.
- Paso 1 COMPLETADO (en `main`).
- Paso 2 COMPLETADO (auditado y aprobado el 2026-09-12).
- Paso 3 COMPLETADO (auditado, QA visual/manual correcto y aprobado el 2026-09-13). D1-A y D2-A.
- Paso 4 COMPLETADO — regresiones y documentación final (2026-09-13).
- DEC-021 **aceptada e implementada**. DEC-022 / T-017 permanecen fuera de T-016 y de T-018.

### T-016 Paso 1 COMPLETADO — 2026-09-12 (histórico de ese cierre)

En el cierre del Paso 1, los Pasos 2–4 estaban pendientes. Eso ya no es el estado vigente: los Pasos 1–4 están COMPLETADOS.

- Dominio autoritativo en `src/cart.js`: parseo, tope de 50 entradas originales antes de agrupar, agrupación de SKUs duplicados, validación de cantidad acumulada contra `maxQuantity: 4`, cálculo en centavos.
- `POST /carrito/resumen` valida y resume. No persiste. No llama a Supabase, Mercado Pago ni logística.
- Catálogo: `TEMPORARY_MAX_QUANTITY = 4`. Es un techo **temporal**. **No representa stock real.** El stock real será una evolución futura.
- Precios, moneda e importes enviados por el navegador no son autoritativos. El backend calcula utilizando su catálogo.
- `/cotizar-envio` continúa limitado a `quantity: 1` hasta implementar logística multítem correctamente.
- Carrito inválido → HTTP 400 `{ "error": "Carrito inválido" }`.
- Verificación de ese cierre: suite completa **129/129**, 1 suite, 0 fallos; `git diff --check` correcto. Sin QA real ni lectura de `.env`.
- El código del Paso 1 ya fue commiteado y enviado a `main`. En ese cierre todavía no se implementaba el Paso 2, Correo Argentino, idempotencia durable, cambios al webhook ni migraciones nuevas.
- npm informó 4 vulnerabilidades (2 moderate, 2 high) durante `npm ci`. No se ejecutó `npm audit fix`. Queda como deuda/riesgo pendiente de una tarea separada; **no** forma parte de T-016.

### DEC-021 aceptada — 2026-09-11

- DEC-021 pasó de propuesta a **aceptada**.
- T-016 quedó **pendiente y desbloqueada**. El usuario todavía no autorizó código; el siguiente trabajo es solo el Paso 1.
- Resoluciones del usuario: `maxQuantity: 4` temporal (no es stock); máximo de líneas = 50 (RPC); compatibilidad legacy aprobada; idempotencia durable fuera de T-016.
- DEC-022 quedó **propuesta** (no aceptada). T-017 quedó **bloqueada**.
- Sin cambios de código, tests, migraciones, commit ni push.

### Auditoría de preparación del carrito — 2026-09-11 (histórica, previa a T-016)

#### VERIFICADO EN CÓDIGO / MIGRACIONES / TESTS

- Existe `public.order_items` y la RPC atómica `create_pending_order_with_items` (migración 004).
- `createPendingOrder` en `src/orders.js` llama esa RPC; si falla, no se crea la preferencia.
- El checkout HTTP vigente acepta un solo `sku` + `quantity` + `customer` + `delivery`. El frontend fija `quantity: 1`.
- `src/catalog.js` es la autoridad de precio. Los tests cubren SKU inválido, cantidad inválida e importes enviados por el cliente.
- El webhook compara el pago contra `orders.amount` / `orders.currency` persistidos y transiciona `pending → paid`.
- No hay carrito, `localStorage` de compra ni `POST /carrito/resumen`.
- La RPC ya acepta 1–50 ítems; el runtime solo envía uno. No hace falta migración nueva para el carrito básico.
- T-016 es el siguiente ID libre. DEC-021 es el siguiente ID de decisión.

#### DOCUMENTACIÓN PREPARADA (sin código)

- `DEC-021` aceptada el 2026-09-11.
- `T-016` desbloqueada; implementación no iniciada.
- `DEC-022` propuesta; `T-017` bloqueada.
- Correo Argentino no forma parte de T-016. La cotización informativa de Etapa 6A permanece.

#### PRÓXIMO PASO

Estado corregido tras auditoría: revisar las correcciones del Paso 1 con el usuario. No avanzar al Paso 2.

### Cierre de integración `orders` + `order_items` e incidente QA — 2026-08-22

#### COMPLETADO

- Migración 004 aplicada: `public.order_items`, FK a `orders.id`, `ON DELETE CASCADE`, constraints, RLS y permisos mínimos.
- RPC `public.create_pending_order_with_items(..., p_items jsonb)` aplicada con validación estricta, cálculo del total y transacción única.
- PostgreSQL genera `external_reference`; Node ya no genera el UUID de pedido y entrega a Mercado Pago exactamente la referencia devuelta.
- Runtime migrado del `INSERT` directo en `orders` a `supabase.rpc(...).single()`. `src/catalog.js` conserva autoridad sobre SKU, nombre, talle, precio, moneda y cantidad máxima.
- Compatibilidad temporal conservada: la RPC copia el primer item a las columnas legacy de producto en `orders`.

#### VALIDADO

- Prueba SQL manual real: creación de `orders` + `order_items`, importe ARS 1.000, estado `pending`, referencia PostgreSQL, columnas legacy, `line_total`, relación y borrado en cascada.
- Prueba real desde runtime local: `/crear-preferencia`, pedido, item, preferencia y redirección a Mercado Pago.
- Webhook, HMAC, validación de importe/moneda, idempotencia y `pending → paid` quedaron intactos.
- Suite final: **79/79 tests**, 1 suite, 0 fallos.

#### INCIDENTE QA RESUELTO

- Síntoma: pedidos de prueba creados después de la integración mostraban `customer_*` y `shipping_*` en `NULL`.
- Diagnóstico: se verificó una única RPC activa, firma y permisos correctos, definición activa coincidente e `INSERT INTO public.orders` incluyendo los parámetros de cliente y entrega.
- Causa raíz: seguía ejecutándose una instancia antigua iniciada con `npm start`; Node estaba usando el runtime anterior.
- Resolución: reiniciar el servidor cargó el runtime actualizado.
- Regla operativa incorporada: **después de modificar archivos backend/runtime en `src/`, reiniciar el proceso Node antes de realizar pruebas manuales.**

#### PENDIENTE / PRÓXIMO PASO

- Correo Argentino: solicitud de credenciales enviada; todavía no recibidas. No realizar llamadas reales hasta recibirlas.
- Cuando estén disponibles, configurar localmente MiCorreo y validar `/token` + `/rates` de forma controlada. No documentar valores.
- Las medidas QA temporales y las credenciales privadas pendientes de rotación continúan como requisitos previos a producción pública.

### Cierre documental de Etapa 6A — MiCorreo (2026-08-22)

- Integración local implementada: `Entrega → Calcular envío → /cotizar-envio → shipping.js → micorreo.js → JWT → /rates → opciones normalizadas`.
- El navegador envía solo `sku`, `quantity` y CP destino. Configuración, origen y medidas pertenecen al backend.
- JWT solo en memoria, con reutilización, margen de expiración, solicitud compartida, renovación única ante 401 y timeout.
- Respuesta pública limitada a opciones `home`/`agency`, etiqueta y precio. Sucursal es informativa; no existe selección real.
- Medidas QA temporales: 300 g, 5 cm de alto, 25 cm de ancho y 35 cm de largo. Deben medirse y reemplazarse antes de producción.
- Cotización estrictamente informativa: no modifica pedido, Mercado Pago, Supabase, webhook ni estados.
- Suite: **75/75 tests**, 1 suite, 0 fallos. Los 61 tests anteriores continúan pasando. Se verifican modalidades, autoridad del payload, entradas inválidas, configuración ausente, ciclo JWT, errores externos, respuesta inválida, vacío y ausencia de secretos/PII. El mecanismo de compartir una solicitud JWT concurrente está implementado, pero no se documenta como test concurrente aislado.
- `git diff --check` correcto, con advertencias informativas LF → CRLF.
- No se llamó a MiCorreo. Estado: **implementada/testeada localmente; pendiente de validación QA**.
- Acceso solicitado a Correo Argentino; pendientes usuario QA, contraseña QA, `customerId` y requisitos adicionales.
- Próxima validación: configurar valores localmente y ejecutar `CP → /cotizar-envio → /token → /rates → tarifa QA`.

### Cierre de Etapa 5 — datos de cliente y entrega (2026-08-22)

- Flujo implementado: `Producto → talle → Continuar → entrega.html → cliente/domicilio → validación → POST /crear-preferencia → pending → Checkout Pro → webhook → paid`.
- `entrega.html` está implementada y funcional. Campos obligatorios: nombre, apellido, email, teléfono, provincia, localidad, código postal, calle y número. Piso/departamento y referencia son opcionales.
- Entre Producto y Entrega viajan únicamente `product id`, `sku` y `quantity`; no se coloca PII en la URL.
- `/crear-preferencia` recibe solamente `sku`, `quantity`, `customer` y `delivery`. Precio, moneda, total, producto, variante, máximo, estado y `external_reference` siguen bajo autoridad del backend.
- `003_add_order_customer_delivery.sql` fue aplicada correctamente. Las doce columnas nuevas son nullable; los pedidos históricos no se modificaron.
- Los pedidos nuevos guardan producto, SKU, talle, cliente, dirección, país `AR` y estado `pending`.
- Verificación manual completada: `Producto → Entrega → Supabase`, incluido pedido `pending`.
- Pendiente sin marcar como completada: prueba posterior a Etapa 5 con datos nuevos, pago real, webhook y transición a `paid`.
- Suite automatizada: **61/61 tests**, 1 suite y 0 fallos. Se mantienen las regresiones de pagos, HMAC, webhook, idempotencia, atomicidad y concurrencia.
- Privacidad: no se registran PII ni el body completo; los errores son genéricos.
- ARS 1.000 continúa siendo un precio temporal de prueba, no comercial.
- No existen cotización, costo de envío, proveedor logístico, tracking, sucursales ni estados logísticos. La etapa solo deja preparado el destino.
- Próxima etapa sugerida: cotización de envío, previa investigación de operador, API, credenciales, pruebas, origen, peso/dimensiones reales, modalidades y total autoritativo.

### Cierre de Etapa 3 — variantes de Remera LEMONT (2026-08-22)

- SKUs vigentes: `LEM-REM-001-S`, `LEM-REM-001-M`, `LEM-REM-001-L` y `LEM-REM-001-XL`. Cada SKU identifica un talle; `REMERA-LEMONT-001` fue retirado y se rechaza.
- El frontend ofrece S/M/L/XL sin selección predeterminada. Comprar permanece deshabilitado hasta elegir una variante y el request contiene solo `{ sku, quantity: 1 }`.
- Todos los SKUs tienen `maxQuantity: 1`. No hay selector de cantidad, inventario, reserva ni liberación de stock.
- `002_add_order_product_variant.sql` fue aplicada correctamente: `orders.product_sku` y `orders.product_size` son nullable. Los registros históricos conservaron `NULL`; los pedidos nuevos guardan SKU y talle.
- Se verificaron manualmente los cuatro talles y el flujo productivo completo desde la selección hasta `paid` mediante un pago real.
- El precio actual es **ARS 1.000 temporal para pruebas productivas controladas**. No es precio comercial definitivo. La autoridad permanece en `src/catalog.js`; el frontend solo lo representa.
- Suite automatizada: 1 suite, **55/55 tests**, 0 fallos. Cubre variantes, rechazo del SKU temporal, autoridad monetaria, HMAC, importe, moneda, idempotencia, atomicidad y concurrencia.
- Antes de esta actualización documental, Git fue verificado en `main`, sincronizado con `origin/main`, con `working tree clean` y `git diff --check` correcto. Después del cierre quedan únicamente cambios Markdown sin commit.
- Home, Catálogo y Contacto funcionan con HTML/CSS/JavaScript vanilla; catálogo y filtros se generan con JavaScript, y las tarjetas no comerciales permanecen en `Próximamente`.
- Las imágenes de Stitch siguen siendo URLs temporales y deben reemplazarse por assets propios optimizados en `public/assets/images/`.
- En ese cierre la próxima etapa todavía no estaba decidida. Se conserva como antecedente histórico.

### Pendientes que no cambian

- Rotar antes del lanzamiento público el Access Token y Webhook Secret de Mercado Pago y la credencial privada/service role de Supabase.
- Definir y restaurar el precio comercial definitivo antes del lanzamiento.
- Diseñar el stock por SKU como etapa separada, incluyendo disponibilidad, reserva, concurrencia, liberación por abandono y confirmación después del pago.

El proyecto tiene un flujo completo de pago implementado, endurecido y cubierto con tests. Las tareas T-001 a T-015 están completadas. El 2026-08-22 se reconectaron Supabase y Mercado Pago productivo, se verificó el arranque local y se desplegó la versión endurecida en EasyPanel. Un pago real de ARS 100 confirmó de punta a punta `checkout → pending → pago aprobado → webhook → paid`; la transición se volvió a verificar después del despliegue. En ese cierre la próxima fase era el frontend de LEMONT; ya está implementado, incluido el carrito de T-016.

- **Backend**: Node.js + CommonJS + Express 5. Mercado Pago Checkout Pro. Supabase con `service_role`.
- **Tests**: Jest instalado. Último resultado histórico documentado previo a las correcciones: 79/79. Las cifras anteriores permanecen en la bitácora como hitos históricos.
- **Dependencias**: `npm audit` detectó 2 vulnerabilidades high; `npm audit fix` actualizó solo dependencias transitivas compatibles. Verificación posterior: 0 vulnerabilidades conocidas y tests pasando.
- **Seguridad implementada**: validación de firma webhook (DEC-009), transición atómica (DEC-010), validación de variables al iniciar.
- **Migración SQL**: `supabase/migrations/001_create_orders.sql` aplicada. Tabla `public.orders` verificada con columnas, constraints, índices y RLS activa.
- **Integración completa**: el flujo `pending → paid` fue verificado en producción real con pago real. Causa raíz del webhook 401 identificada y resuelta: la `notification_url` sin `?source_news=webhooks` hacía que Mercado Pago enviara notificaciones IPN en lugar de Webhooks, con firma diferente. Agregar `?source_news=webhooks` resolvió el problema. Ver DEC-018 (resuelta).
- **Deploy productivo activo**: EasyPanel, repositorio `checkout-mp-supabase-template`, rama `main`, dominio `checkout.lemont01.com`. La versión endurecida y DEC-019/T-015 quedaron verificadas en producción. Rotación final de credenciales pendiente antes del lanzamiento público.

Ver resumen compacto para agentes en `docs/CURRENT_CONTEXT.md`.

## Avances detectados

**Base original:**
- Servidor Express y frontend estático implementados.
- Pedido `pending` asociado mediante `external_reference`.
- Preferencia con webhook y tres URLs de retorno.
- Confirmación del pago mediante consulta a la API oficial.
- Validación básica de pedido existente, duplicado e importe.
- `.env` ignorado y `.env.example` disponible como contrato.

**Implementado en sesión 2026-06-24:**
- T-001: validación HMAC-SHA256 de firma webhook con HTTP 401 para firma ausente o inválida.
- T-002: creación de preferencia detenida si Supabase falla.
- T-003: transición `pending → paid` atómica e idempotente.
- T-004: validación de variables de entorno obligatorias al arrancar.
- T-005: suite Jest con 11 tests; `npm test` pasa sin llamadas externas.
- T-006: migración SQL manual versionada para `orders`, con restricciones, índices y RLS habilitada.

**Implementado en sesión 2026-06-25:**
- T-007: estrategia monetaria explícita con comparación normalizada a centavos, validación de moneda y logs genéricos del webhook de pago.
- T-008: antecedente de referencias UUID en Node; DEC-020 trasladó la generación del `external_reference` de pedido a PostgreSQL. Node conserva UUID para `request_id`.
- T-009: backend separado en `src/app.js`, `config.js`, `logger.js`, `payments.js`, `orders.js` y `webhookSignature.js`.
- T-010: logs estructurados JSON con `request_id`, niveles `info`/`warn`/`error`, whitelist de campos y ausencia de payloads sensibles.
- T-011: `GET /webhook` disponible solo con `NODE_ENV !== "production"`; `POST /webhook` se conserva.
- T-012: catálogo seguro en `src/catalog.js`; el backend calcula precio, total y moneda desde SKU y cantidad. (DEC-013)
- T-014: respuesta HTTP 400 por JSON inválido con `Content-Type: application/json; charset=utf-8`.
- Documentación completa: TASKS.md (T-001 a T-014), DECISIONS.md (DEC-009 a DEC-017), CURRENT_CONTEXT.md.

**Implementado en sesión 2026-06-26:**
- T-013: documentación de deploy a staging en EasyPanel con variables por nombre, pasos operativos, checklist de staging (11 ítems), checklist previa a producción real (11 ítems), rollback en 4 niveles y notas de seguridad. (DEC-016)
- Fix operativo de staging: `Dockerfile` con Node.js 22 y `.dockerignore` para excluir `.env`, `.env.*`, `.git`, `node_modules`, logs y temporales. EasyPanel configurado para compilación `Dockerfile` (no Nixpacks).
- Staging activo: Node.js 18 (Nixpacks) reemplazado por `node:22-alpine`; puerto interno corregido a 3003; `SUPABASE_URL` corregida a URL base sin `/rest/v1` ni trailing slash; clave Supabase cambiada a `service_role` JWT.
- Webhook secret verificado: SHA-256 prefix coincide entre EasyPanel y Mercado Pago sandbox. `data.id` lowercase eliminado; el manifiesto HMAC usa valor literal.
- Diagnóstico HMAC: 4 variantes candidatas (`query_literal`, `body_literal`, `query_lower`, `body_lower`) calculadas y logueadas; todas retornan `false` en staging.
- Fingerprints de componentes individuales del manifiesto preparados para próximo deploy (SHA-256 8-char prefix de `queryDataId`, `bodyDataId`, `x-request-id`, `ts`; variantes de formato con y sin `;` final, con y sin `request_id`).
- Diagnóstico de headers proxy: presencia, longitud y SHA-256 prefix de `x-original-request-id`, `x-correlation-id`, `x-request-start`, `x-forwarded-for`, `x-forwarded-host`, `x-forwarded-proto`, `forwarded`, `via`. Sin valores completos en logs.
- Diagnóstico de query string y manifiesto: presencia, longitud y SHA-256 prefix de query string completa y manifiesto final; detección de `x-request-id` duplicados; validez numérica y age de `ts`.
- Diagnóstico con SDK oficial `WebhookSignatureValidator` de `mercadopago` v3.1.0: `official_sdk_validator_available=true`, `official_sdk_validator_matches=false`, `official_sdk_validator_error_name="InvalidWebhookSignatureError"` en webhooks reales sandbox. Solo diagnóstico; la validación principal no cambia.
- Verificación de Traefik/EasyPanel: SHA-256 prefix del `x-request-id` enviado en request controlado coincide con el recibido en logs. Hipótesis de proxy modificando headers descartada.
- Configuración de dominio propio `checkout.lemont01.com` con SSL activo en EasyPanel. `BASE_URL` actualizado. Webhook sandbox de Mercado Pago apuntado al nuevo dominio.
- Simulación desde panel de Webhooks de Mercado Pago: firma válida. Backend entra al flujo completo (`webhook recibido`, `pago detectado en webhook`). Error al consultar pago (esperable para IDs de simulación sin pago real).
- Prueba sin `notification_url` en la preferencia: llegan eventos sin `data.id`, no útiles para confirmar pago. Restaurada `notification_url`. Tests pasan.
- **Corrección `notification_url` con `source_news=webhooks`**: se identificó que la `notification_url` sin el parámetro `?source_news=webhooks` causaba que Mercado Pago enviara notificaciones IPN en lugar de Webhooks. Las notificaciones IPN no usan el mismo algoritmo HMAC-SHA256 de Webhooks, lo que causaba el rechazo sistemático de la firma. Solución: agregar `?source_news=webhooks` a la `notification_url`.
- **Pago productivo real verificado end-to-end**: webhook recibido con firma válida, pago detectado en webhook, pago consultado a la API de Mercado Pago (`Payment.get`), pago aprobado confirmado por API, pedido actualizado de `pending` a `paid` en Supabase. Flujo completo `pending → paid` verificado en producción.

## Problemas resueltos documentados

- Uso de variables de entorno para credenciales.
- URL pública de desarrollo mediante ngrok.
- Separación entre páginas de retorno y confirmación autoritativa.
- Asociación de pagos y pedidos mediante referencia externa.
- Consulta a Mercado Pago en lugar de confiar únicamente en el webhook.
- Tratamiento básico de notificaciones duplicadas y montos diferentes.
- **Staging: Node.js 18 vía Nixpacks**: EasyPanel usaba Node.js 18 por defecto, causando fallos de WebSocket de Supabase. Resuelto: Dockerfile `node:22-alpine` y compilación `Dockerfile` en EasyPanel.
- **Staging: Puerto incorrecto**: el proxy interno de EasyPanel apuntaba al puerto equivocado. Resuelto: dominio configurado al puerto interno 3003.
- **Staging: `SUPABASE_URL` con path o trailing slash**: la URL incluía `/rest/v1` o barra final, causando error `PGRST125`. Resuelto: usar solo URL base (`https://xxxx.supabase.co`) sin path ni barra final.
- **Staging: Tipo de clave Supabase incorrecto**: se intentó usar la clave publishable en lugar de `service_role` JWT. Resuelto: confirmar uso de `service_role` JWT en backend.
- **Staging: `data.id` en lowercase**: el manifiesto HMAC aplicaba `.toLowerCase()` a `data.id`. Resuelto: usar el valor literal de `data.id`.
- **Webhook 401 con `notification_url` (causa raíz)**: la `notification_url` sin `?source_news=webhooks` hacía que Mercado Pago enviara notificaciones de tipo IPN con firma diferente a la de Webhooks. El backend rechazaba la firma IPN como inválida (HTTP 401). Resuelto: agregar `?source_news=webhooks` al parámetro `notification_url` de la preferencia.

## Pendientes principales

- **Rotación obligatoria antes del lanzamiento público**: Access Token y Webhook Secret de Mercado Pago, y credencial privada de Supabase. Las credenciales actuales quedan limitadas a la etapa privada/controlada de desarrollo.
- **Captura completa retirada**: `MP_SUPPORT_CAPTURE_FULL_WEBHOOK` ya no se lee en runtime y no puede activar el registro de la URL ni de headers completos.
- Retirar los demás diagnósticos temporales en `src/webhookSignature.js` y `src/config.js` permanece fuera del alcance de esta tarea.
- **T-015 completada**: `POST /webhook` devuelve 503 para fallos temporales o inesperados y mantiene 200 para éxito y resultados definitivos/idempotentes.

El detalle verificable está en `docs/TASKS.md`.

## Próxima acción recomendada

**Cutover controlado de T-020.** Aplicar migración 005 solo con autorización explícita y ejecutar QA integrado. Antes del lanzamiento público hay que aprobar peso y dimensiones reales; los perfiles actuales son TEMPORAL/QA. DEC-022/T-017, stock, deuda npm y Etapa D quedan fuera de este cierre.

> Codex no debe leer `.env`, exponer secretos, hacer commit ni push sin autorización explícita del usuario.

## Bitácora

### 2026-09-13 — Cierre del Paso 4 y de T-016

- T-016 COMPLETADA; Pasos 1–4 COMPLETADOS; DEC-021 aceptada e implementada.
- Contraste con main: 4105a8d, 72eee3c y 39563b1 (Pasos 1–3).
- Documentación: README.md y docs/REQUIREMENTS.md, DESIGN.md, SKILLS.md, SECURITY.md, DECISIONS.md (solo DEC-021), TASKS.md, PROGRESS.md, CURRENT_CONTEXT.md.
- Verificación real: npm.cmd test, 158/158, 1 suite, 0 fallos; git diff --check correcto; solo Markdown. QA visual/manual del Paso 3 ya aprobado, sin tests DOM agregados.
- Sin modificar src/, public/, tests/, dependencias o migraciones; sin leer .env, servicios reales, commit, push ni deploy.
- Próximo trabajo fuera de T-016: deudas de npm/credenciales, stock, Correo e idempotencia durable requieren alcance y autorización propios.

### 2026-09-13 — Cierre formal del Paso 3 de T-016

- Objetivo: registrar la aprobación del usuario y el cierre real del Paso 3 tras auditoría y QA visual/manual.
- Tipo de sesión: documental. Sin código, tests, migraciones, dependencias, commit ni push.
- Auditoría técnica: APROBADO CON OBSERVACIONES. La observación pendiente era la validación visual/manual en navegador.
- QA visual/manual: realizado y correcto. Paso 3 aprobado.
- Decisiones: D1-A (Agregar al carrito + Comprar ahora); D2-A (no auto-vaciar).
- Estado: DEC-021 ACCEPTED. T-016 EN PROGRESO. Paso 1 COMPLETADO. Paso 2 COMPLETADO. Paso 3 COMPLETADO. Paso 4 PENDIENTE.
- Hechos verificados: carrito frontend; `localStorage` solo SKU + quantity; `carrito.html`; contador por unidades; agregar / talles / incrementar / reducir / eliminar / vaciar; `POST /carrito/resumen`; checkout `items[]`; “Comprar ahora” legacy; cotización informativa solo 1×1; sin auto-vaciar; sin backend, webhook ni migraciones.
- Tests: último resultado comprobado **158/158**.
- Archivos modificados en este cierre documental: `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`.
- Próximo paso registrado: **T-016 Paso 4 — cierre de regresiones y documentación final.** Todavía no implementarlo.

### 2026-09-12 — Cierre formal del Paso 2 de T-016

- Objetivo: registrar la aprobación del usuario y el cierre real del Paso 2 tras la auditoría final.
- Tipo de sesión: documental. Sin código, tests, migraciones, dependencias, commit ni push.
- Auditoría: APROBADO CON OBSERVACIONES. Las observaciones eran únicamente documentales (COMPLETADO prematuro y dos inconsistencias de redacción).
- Estado: DEC-021 ACCEPTED. T-016 EN PROGRESO. Paso 1 COMPLETADO. Paso 2 COMPLETADO. Paso 3 PENDIENTE. Paso 4 PENDIENTE.
- Hechos verificados del Paso 2: contrato multítem `{ items, customer, delivery }`; compatibilidad legacy `{ sku, quantity, customer, delivery }`; rechazo de mezcla; una orden `pending`; N `order_items`; una preferencia de Mercado Pago; N ítems de Mercado Pago; un único `external_reference`; cálculo autoritativo desde el backend; envío no incluido; webhook intacto; sin migraciones.
- Tests: último resultado comprobado **158/158**.
- Fuera de T-016: DEC-022 / T-017 (idempotencia durable); Correo Argentino; stock real.
- Archivos modificados en este cierre documental: `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`.
- Próximo paso registrado: **T-016 Paso 3 — carrito frontend + localStorage.** Todavía no implementarlo.

### 2026-09-12 — Cierre formal del Paso 1 de T-016

- Objetivo: registrar el cierre real del Paso 1 tras implementación, corrección, auditoría y aprobación.
- Tipo de sesión: documental. Sin código, tests, migraciones, dependencias, commit ni push.
- Estado: T-016 EN PROGRESO. Paso 1 COMPLETADO. Pasos 2–4 pendientes.
- Hechos verificados: `maxQuantity: 4` temporal (no es stock); `/cotizar-envio` limitado a `quantity: 1`; dominio autoritativo del carrito; `POST /carrito/resumen` no persiste ni llama a Supabase, Mercado Pago o logística; 50 entradas originales antes de agrupar; SKUs duplicados agrupados; cantidad acumulada validada contra `maxQuantity`; precios del navegador no autoritativos; backend calcula desde su catálogo.
- Tests: último resultado comprobado **129/129**. `git diff --check` pasó.
- El código del Paso 1 ya estaba commiteado y enviado a `main`. No se implementó el Paso 2.
- Fuera de T-016: DEC-022 / T-017 (idempotencia durable); Correo Argentino; webhook; migraciones nuevas; stock real.
- Deuda registrada: 2 vulnerabilidades npm moderate y 2 high informadas durante `npm ci`. No se ejecutó `npm audit fix`. Auditar en una tarea separada.
- Archivos modificados: `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`. DEC-021 permanece aceptada; `docs/DECISIONS.md` no requirió corrección.
- Próximo paso registrado: **T-016 — Paso 2: checkout multítem + Mercado Pago.** Todavía no implementarlo.

### 2026-09-12 — Correcciones autorizadas del Paso 1 de T-016

- Base accidental de Grok conservada después de auditoría de Codex: REQUIERE CORRECCIONES.
- Archivos: `src/shipping.js`, `src/cart.js`, `tests/index.test.js`, `docs/DECISIONS.md`, `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`.
- Envío: solo quantity 1, sin inventar paquetes; catálogo máximo 4 intacto. Tests rechazan 2/4 antes de MiCorreo.
- Tamaño: validación aislada permite 50 y rechaza 51; prueba adicional verifica rechazo antes de leer SKUs. DEC-021 alineada.
- Cobertura: estructuras, cantidades inseguras, suma de duplicados, manipulación monetaria, centavos y legacy cantidad 4 en cuatro SKUs.
- `npm.cmd ci` completado tras reintento por restricciones del sandbox; huellas de archivos versionados idénticas antes/después. package.json y lockfile intactos.
- Verificación: 129/129 tests, 1 suite, 0 fallos; sintaxis y diff sin errores. No se cargó `.env` ni se usaron servicios reales.
- npm reportó 4 vulnerabilidades (2 moderate, 2 high); no se ejecutó audit fix ni se cambiaron dependencias.
- Resultado: Paso 1 EN REVISIÓN, correcciones verificadas y pendientes de aprobación. No avanzar al Paso 2. Sin commit, push ni deploy.

### 2026-09-12 — Implementación accidental del Paso 1 por Grok (antecedente corregido)

- Hecho: Grok implementó el Paso 1 accidentalmente, fuera de su rol de auditor/documentador. La aceptación de DEC-021 no autorizaba esa implementación.
- Archivos de código: `src/catalog.js` (`maxQuantity` temporal 4), `src/cart.js` (nuevo), `src/app.js` (`POST /carrito/resumen`), `tests/index.test.js`.
- El resumen no llama a Supabase ni a Mercado Pago. No crea pedidos ni preferencias.
- Tope de 50 aplicado antes de agrupar, en contradicción con la redacción inicial de DEC-021. El usuario aclaró posteriormente este contrato al autorizar las correcciones; no hubo autorización previa de esta implementación.
- Verificación: `node --check src/cart.js`, `src/catalog.js`, `src/app.js`, `tests/index.test.js`. `npm.cmd test` no se ejecutó: no hay `node_modules` y está prohibido instalar dependencias.
- T-016 permanece en curso. Pasos 2–4 pendientes. Sin commit ni push.

### 2026-09-11 — DEC-021 aceptada; T-016 desbloqueada; DEC-022 propuesta

- Objetivo: registrar las resoluciones del usuario y dejar T-016 lista para el Paso 1, sin programar.
- Tipo de sesión: documental. Sin código, tests, migraciones, commit ni push.
- Resoluciones: `maxQuantity: 4` temporal y no-stock; 50 líneas; compatibilidad legacy; idempotencia durable diferida a DEC-022 / T-017.
- Archivos modificados: `docs/DECISIONS.md`, `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`.
- Estado: DEC-021 aceptada. T-016 pendiente desbloqueada. DEC-022 propuesta. T-017 bloqueada.
- Próximo paso: el usuario autoriza el prompt de Codex para el Paso 1 de T-016.

### 2026-09-11 — Auditoría de preparación del carrito multítem (DEC-021 / T-016)

- Objetivo: verificar el estado real del repositorio y preparar la decisión de carrito sin programar.
- Tipo de sesión: auditoría y documentación. Sin modificación de código, tests, migraciones ni `.env`.
- Archivos revisados: `GROK.md`, `AGENTS.md`, `README.md`, `docs/REQUIREMENTS.md`, `docs/DESIGN.md`, `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/DECISIONS.md`, `docs/SECURITY.md`, `docs/SKILLS.md`, `docs/CURRENT_CONTEXT.md`, `src/app.js`, `src/catalog.js`, `src/orders.js`, `src/payments.js`, `src/checkoutInput.js`, `src/shipping.js`, `src/micorreo.js`, `public/js/checkout.js`, `public/js/producto.js`, `public/js/entrega.js`, `public/js/envio.js`, `public/js/productos.js`, `supabase/migrations/001–004`, `tests/index.test.js`.
- Afirmaciones de Codex confirmadas: existe `order_items`; existe creación atómica pedido+ítems; el checkout actual opera con un SKU; el backend ignora precios del cliente; existe `pending → paid`; no implementar Correo Argentino ahora; T-016 es el siguiente ID; hace falta DEC-021 antes de implementar.
- Correcciones: el contrato vigente no es `{ sku, quantity }` sino `{ sku, quantity, customer, delivery }`; la RPC ya admite N ítems (techo 50) aunque el runtime envía uno; `maxQuantity` actual es 1; no hay UNIQUE de SKU por pedido; no existe carrito ni resumen; no hace falta migración nueva.
- Archivos modificados: `docs/DECISIONS.md` (DEC-021 propuesta), `docs/TASKS.md` (T-016 bloqueada), `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`.
- Resultado: propuesta lista para aprobación del usuario. Estado de auditoría: APROBADO CON OBSERVACIONES.
- Pendientes: el usuario debe decidir si `maxQuantity` permanece en 1 y si el techo comercial de líneas es 50 o menor. Codex no implementa todavía.

### 2026-08-22 — Backend endurecido validado de punta a punta en producción

- Supabase fue reconectado correctamente mediante variables del entorno y se verificó el flujo de persistencia en `orders`.
- Mercado Pago productivo fue reconectado correctamente y el backend local inició con la configuración actual.
- Al iniciar una compra se verificó la creación de un pedido `pending`; si el comprador no completa el pago, el pedido permanece `pending`.
- Checkout Pro productivo fue probado con una cuenta compradora real distinta de la cuenta vendedora.
- Se confirmó una transferencia real de ARS 100.
- Flujo verificado: `checkout → order pending → pago aprobado → webhook → order paid`.
- La versión endurecida fue desplegada en EasyPanel desde `checkout-mp-supabase-template`, rama `main`, dominio `checkout.lemont01.com`.
- Después del despliegue se verificó nuevamente la transición `pending → paid`.
- Resultado: backend de pagos actual validado de punta a punta en producción. DEC-019 y T-015 permanecen vigentes.
- Seguridad pendiente: no se rotaron todavía el Access Token ni el Webhook Secret de Mercado Pago, ni la credencial privada de Supabase. Las credenciales actuales quedan limitadas a esta etapa privada/controlada y deben rotarse antes del lanzamiento público.
- Próxima etapa: frontend de LEMONT con Home, Catálogo, Contacto y Producto/compra, integrado sin cambios innecesarios en el motor de pagos validado.
- Criterios del frontend: indentación consistente, legibilidad humana, HTML semántico, CSS organizado, JavaScript modular, nombres claros, responsabilidades separadas y complejidad mínima.

### 2026-08-21 — Cierre de sesión de endurecimiento

- Captura sensible retirada: `MP_SUPPORT_CAPTURE_FULL_WEBHOOK` no tiene efecto en runtime; no se registran firma completa, `x-request-id` completo ni campos antiguos de captura. Se conservan regresiones para impedir su reactivación.
- Secuencia de pruebas: después de la limpieza de captura se verificaron 39/39 tests; después de T-015, la suite quedó en 50/50.
- Dependencias: `npm audit` detectó 2 vulnerabilidades high; `npm audit fix` actualizó únicamente dependencias transitivas compatibles. La auditoría posterior reportó 0 vulnerabilidades y los tests continuaron pasando.
- DEC-019 registrada e implementada por T-015: 401 para firma ausente/inválida; 200 para éxito y resultados definitivos/idempotentes; 503 para fallos temporales o inesperados de Mercado Pago, Supabase o procesamiento interno.
- T-015 preservó HMAC, transición atómica e idempotencia. No fue necesario modificar `src/orders.js` ni `src/payments.js`.
- Regresiones críticas confirmadas: HMAC, pago aprobado → `paid`, importe incorrecto, moneda incorrecta, pedido ya `paid`, duplicados concurrentes y transición atómica.
- `git diff --check` finalizó correctamente; solo se observaron advertencias informativas LF → CRLF.
- Seguridad pendiente: las credenciales productivas antiguas documentadas como expuestas se consideran comprometidas y deben rotarse antes del próximo despliegue productivo.
- Próxima sesión: reconstruir configuración local desde `.env.example`, reconectar Supabase, verificar `orders`, configurar credenciales nuevas de Mercado Pago y ejecutar una prueba end-to-end controlada antes de conectar el nuevo frontend de LEMONT.
- Esta entrada documenta el estado verificado; no implica que la reconstrucción de `.env`, la rotación, la reconexión ni la nueva prueba end-to-end ya se hayan realizado.

### 2026-08-21 — T-015 completada

- Objetivo: evitar confirmaciones HTTP 200 cuando un fallo temporal o inesperado impide procesar correctamente un webhook de pago.
- Implementación: `src/app.js` responde 503 con cuerpo genérico ante errores de Mercado Pago, errores necesarios de Supabase y excepciones internas inesperadas; conserva 401 y 200 según DEC-019.
- Casos definitivos agregados explícitamente: evento irrelevante, evento firmado sin ID utilizable y pago aprobado sin `external_reference`, todos con 200.
- Seguridad: ninguna respuesta 503 incluye mensajes internos, secretos, IDs de pago, `external_reference`, importes ni monedas; los logs usan categorías seguras.
- Controles preservados: validación HMAC, pago aprobado → `paid`, comparación de importe/moneda, pedido ya pagado, duplicados concurrentes, transición atómica e idempotencia.
- Tests: suite ampliada de 39 a 50; 50/50 pasan sin llamadas externas.
- Verificación: `node --check src/app.js`, `node --check tests/index.test.js`, `npm.cmd test` y `git diff --check`.
- Archivos de código afectados: `src/app.js` y `tests/index.test.js`. `src/orders.js` y `src/payments.js` no fueron modificados.

### 2026-08-21 — DEC-019 aceptada y T-015 desbloqueada

- Objetivo: formalizar la política de respuestas HTTP de `POST /webhook` antes de modificar el comportamiento productivo.
- Contexto: la integración ya procesó pagos reales en producción; el trabajo actual es auditoría y endurecimiento, no preparación inicial de un prototipo exclusivamente sandbox.
- Decisión: 401 para firma ausente/inválida; 200 para procesamiento exitoso y resultados definitivos/idempotentes; 503 para fallos temporales, resultados ambiguos de dependencias o excepciones internas inesperadas.
- Controles preservados: validación HMAC de DEC-009, transición atómica e idempotencia de DEC-010, y respuestas/logs seguros de DEC-017.
- Alcance diferido: no se implementan colas, workers ni persistencia adicional de webhooks; quedan como posible endurecimiento futuro sujeto a decisión separada.
- Tarea: T-015 creada en estado pendiente y desbloqueada, sin cambios en `src/` ni `tests/`.
- Archivos afectados: `docs/DECISIONS.md`, `docs/TASKS.md`, `docs/CURRENT_CONTEXT.md` y `docs/PROGRESS.md`.

### 2026-08-20 — Retirada de `MP_SUPPORT_CAPTURE_FULL_WEBHOOK`

- Objetivo: eliminar exclusivamente la capacidad temporal de registrar la URL y los headers completos del webhook.
- Archivos de código afectados: `src/app.js` y `tests/index.test.js`.
- Eliminado de `src/app.js`: lectura de `MP_SUPPORT_CAPTURE_FULL_WEBHOOK`, helpers dedicados a reconstruir la URL y leer headers completos, emisión del evento de captura y llamada desde `POST /webhook`.
- Pruebas: las pruebas que exigían la captura fueron reemplazadas por regresiones que comprueban que el nombre histórico de la variable no reactiva la captura, que firmas y campos completos no aparecen, y que `request_id` sigue permitido en logs estructurados.
- Verificación: `node --check src/app.js` y `node --check tests/index.test.js` finalizaron sin errores; la búsqueda de runtime no encontró referencias a la captura; `git diff --check` finalizó sin errores. Jest no pudo iniciar porque `node_modules` no está instalado y el comando `jest` no está disponible; no se instalaron dependencias.
- Alcance preservado: no se modificaron la validación HMAC, el comportamiento general del webhook, Mercado Pago, Supabase, migraciones, dependencias ni `package.json`.
- Los registros históricos posteriores conservan el contexto de por qué existió y se utilizó esta captura temporal.

### 2026-06-27 — Cierre formal de fase: integración productiva Mercado Pago + Supabase verificada

- Objetivo: documentar el cierre formal de la fase de integración y consolidar el estado final del proyecto.
- Tipo de sesión: documental. Sin modificación de código. Sin acceso a `.env`.
- Archivos actualizados: `docs/TASKS.md`, `docs/DECISIONS.md`, `docs/SECURITY.md`, `docs/CURRENT_CONTEXT.md`, `docs/PROGRESS.md`.
- Estado final: integración productiva Mercado Pago + Supabase verificada. Flujo `pending → paid` confirmado con pago real. 14/14 tareas completadas. Backlog cerrado.
- Causa raíz final documentada:
  1. Frontend priorizaba `sandbox_init_point` sobre `init_point`: podía enviar el checkout a sandbox aunque se estuviera en producción. Corregido priorizando `init_point`.
  2. `notification_url` sin `?source_news=webhooks`: Mercado Pago enviaba notificaciones IPN en lugar de Webhooks (firmas diferentes). Corregido con `?source_news=webhooks`.
- Seguridad verificada en producción real:
  - Validación de firma HMAC-SHA256 activa: no fue desactivada en ningún momento.
  - Webhooks inválidos siguen respondiendo HTTP 401.
  - `MP_SUPPORT_CAPTURE_FULL_WEBHOOK` fue usada temporalmente como apoyo para soporte técnico externo; debe permanecer desactivada.
- Pendientes documentados:
  - Rotar `MERCADOPAGO_ACCESS_TOKEN` y `MERCADO_PAGO_WEBHOOK_SECRET` productivos expuestos en capturas/chats. Acción inmediata del usuario.
  - Confirmar `MP_SUPPORT_CAPTURE_FULL_WEBHOOK` desactivada en EasyPanel.
  - Autorizar a Codex la limpieza del código temporal de diagnóstico en `src/webhookSignature.js`, `src/app.js` y `src/config.js`.
  - Hacer commit/push de documentación actualizada (solo docs, sin código).
  - Hacer commit/push de la limpieza técnica cuando Codex la ejecute y el usuario lo autorice.
- Sin cambios de código. Sin acceso a `.env`. Sin commit. Sin push.

### 2026-06-26 — Cierre exitoso de integración: flujo pending → paid verificado en producción

- Objetivo: documentar el cierre exitoso de la integración Mercado Pago + Supabase con pago real confirmado en producción.
- Tipo de sesión: documental. Sin modificación de código. Sin acceso a `.env`.
- Archivos actualizados: `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`, `docs/SECURITY.md`, `docs/DECISIONS.md`.
- Causa raíz identificada y resuelta:
  - La `notification_url` de la preferencia sin el parámetro `?source_news=webhooks` hacía que Mercado Pago enviara notificaciones de tipo IPN en lugar de Webhooks.
  - Las notificaciones IPN no usan el mismo algoritmo de firma HMAC-SHA256 de Webhooks configurados en "Tus integraciones". El backend rechazaba correctamente la firma IPN como inválida (HTTP 401).
  - La simulación del panel siempre enviaba Webhooks (firma correcta) porque el panel usa directamente el mecanismo de Webhooks.
  - Solución: agregar `?source_news=webhooks` a la `notification_url` de la preferencia fuerza a Mercado Pago a enviar exclusivamente notificaciones de tipo Webhook con firma HMAC-SHA256 correcta.
- Flujo verificado en producción real:
  1. `POST /crear-preferencia` → preferencia creada con `notification_url` correcta.
  2. Pedido persistido en Supabase como `pending`.
  3. Pago real realizado en Mercado Pago Checkout Pro.
  4. Webhook recibido en `POST /webhook`.
  5. Firma HMAC-SHA256 validada correctamente con `MERCADO_PAGO_WEBHOOK_SECRET` productivo.
  6. Pago detectado en webhook.
  7. Pago consultado a la API de Mercado Pago (`Payment.get`).
  8. Pago aprobado confirmado por la API.
  9. Pedido actualizado de `pending` a `paid` en Supabase.
- Pendientes al cerrar:
  - `MP_SUPPORT_CAPTURE_FULL_WEBHOOK` debe mantenerse desactivado.
  - Rotar credenciales productivas expuestas en capturas/chats.
- DEC-018 marcada como resuelta.
- Sin cambios de código en esta sesión documental. Sin commit. Sin push. Sin acceso a `.env`.

### 2026-06-26 — Respuesta de soporte Mercado Pago: confirmación de comportamiento sandbox y puntos técnicos HMAC

- Objetivo: documentar la respuesta recibida de soporte/consulta técnica de Mercado Pago y actualizar el contexto técnico.
- Tipo de sesión: documental. Sin modificación de código. Sin acceso a `.env`.
- Archivos actualizados: `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`, `docs/DECISIONS.md`.
- Resumen de la respuesta de soporte (puntos relevantes para el proyecto):
  1. El Webhook Secret se genera al configurar Webhooks en "Tus integraciones". Es por aplicación y por modo (pruebas vs productivo).
  2. `notification_url` en la preferencia tiene prioridad sobre la URL configurada en el panel para esa transacción. No es un conflicto, pero `notification_url` manda para esa transacción específica.
  3. **Confirmado**: los pagos de prueba creados con credenciales de prueba no envían notificaciones reales. La vía recomendada para testear recepción de notificaciones en sandbox es la configuración/simulación desde "Tus integraciones".
  4. Para construir la firma HMAC, `data.id` debe tomarse desde los query params; en la documentación se denomina `data.id_url`.
  5. Si falta algún valor del template del manifiesto, debe excluirse antes del cálculo HMAC. No incluirlo como cadena vacía.
  6. Verificar que el secret corresponda al mismo modo utilizado: pruebas o productivo.
  7. No se debe desactivar la validación de firma.
- Conclusión técnica actualizada:
  - El 401 en staging vía `notification_url` con credenciales de prueba puede ser comportamiento esperado del sandbox de Mercado Pago, no un bug de implementación HMAC.
  - La simulación del panel validando correctamente es consistente con lo confirmado por soporte.
  - Se identifican dos puntos técnicos a verificar en `src/webhookSignature.js` antes de cualquier prueba productiva:
    - (a) ¿`data.id` se lee de query params y se denomina `data.id_url` en el template? Nuestros logs indican `signature_data_source="query_data_id"` pero el nombre de variable en el template puede diferir.
    - (b) ¿Los valores faltantes del template se excluyen antes del HMAC o se incluyen como cadena vacía?
  - Estos dos puntos podrían explicar diferencias en el manifiesto si algún campo llega ausente en webhooks reales.
- Estado técnico al cerrar:
  - `notification_url` restaurado.
  - Validación de firma activa. Webhooks inválidos responden 401.
  - SDK oficial solo como diagnóstico; no como fuente de aceptación.
  - DEC-018 actualizada con el nuevo contexto.
- Sin cambios de código. Sin commit. Sin push. Sin acceso a `.env`. Sin secretos en documentación.

### 2026-06-26 — Investigación externa: diferencia entre simulación del panel y notification_url de Checkout Pro

- Objetivo: documentar los hallazgos de una investigación externa sobre el webhook 401 y registrar el nuevo criterio técnico de seguridad de diagnóstico.
- Tipo de sesión: documental. Sin modificación de código. Sin acceso a `.env`.
- Archivos de documentación actualizados: `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`, `docs/SECURITY.md`, `docs/DECISIONS.md`.
- Hechos confirmados del proyecto (no inferidos):
  - El endpoint `POST /webhook` es accesible desde Mercado Pago.
  - El secreto funciona para la simulación del panel (firma válida).
  - El SDK oficial (`WebhookSignatureValidator`) también rechaza firmas reales sandbox.
  - `notification_url` trae `data.id` en webhooks reales sandbox.
  - Sin `notification_url`, no llegan webhooks útiles con `data.id`.
  - Traefik/EasyPanel preserva `x-request-id` en requests externos controlados.
- Hallazgos externos registrados (no todos confirmados por documentación oficial):
  1. Mercado Pago recomienda usar el simulador del panel para testear recepción de notificaciones en sandbox. Los pagos de prueba con credenciales de prueba pueden no generar notificaciones del mismo modo que producción. (Referencia: documentación oficial.)
  2. Mercado Pago distingue entre Webhooks (usan firma/secreto HMAC) e IPN/mecanismos legacy (comportamiento diferente). (Referencia: documentación oficial.)
  3. Existe diferencia entre webhooks configurados desde "Your integrations" en el panel y `notification_url` definido directamente en la preferencia de Checkout Pro. (Referencia: documentación oficial, comportamiento observado.)
  4. La simulación del panel validando correctamente indica: endpoint accesible, secreto válido para el panel, implementación HMAC no rota de forma evidente. (Conclusión propia a partir de observación.)
  5. Que el SDK oficial también rechazace firmas reales sandbox apunta a diferencia de ambiente, modo, credenciales o tipo de notificación, no a un bug de implementación HMAC. (Conclusión propia a partir de observación.)
  6. Evidencia comunitaria secundaria (no verificada como oficial): otros usuarios del SDK Node.js de Mercado Pago reportan diferencias similares entre simulación válida y webhooks reales con `InvalidWebhookSignatureError`. Registrado como evidencia de referencia, no como certeza técnica.
- Estado técnico al cerrar sesión:
  - `notification_url` restaurado en la preferencia.
  - Validación de firma activa. Webhooks inválidos siguen respondiendo 401.
  - SDK oficial se usa solo como diagnóstico; no como fuente de aceptación.
- Criterio de seguridad de diagnóstico confirmado y documentado:
  - Si hace falta diagnóstico adicional sobre `x-signature`, solo se permiten fingerprints seguros: presencia, longitud y SHA-256 prefix corto.
  - Nunca valores completos de: `x-signature`, `v1`, `x-request-id`, `data.id`, secrets ni access tokens.
- Decisión pendiente registrada: DEC-018 (estrategia de resolución del webhook 401).
- Sin cambios de código. Sin commit. Sin push. Sin acceso a `.env`. Sin secretos en documentación.

### 2026-06-26 — Diagnóstico avanzado de webhook 401: nueva hipótesis y cierre de sesión

- Objetivo: continuar el diagnóstico del webhook 401 sandbox con análisis de proxy, dominio propio, SDK oficial y simulación del panel; documentar el cierre de la sesión.
- Tarea relacionada: diagnóstico operativo de staging posterior a T-013.
- Archivos de código afectados (diagnósticos ya en repo): `src/webhookSignature.js`, `src/app.js`, `src/config.js`.
- Archivos de documentación actualizados: `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`, `docs/SECURITY.md`.
- Diagnósticos realizados y evidencia recolectada:
  - Diagnóstico de headers proxy: Traefik/EasyPanel preserva `x-request-id` en requests externos controlados (SHA-256 prefix local coincide con el recibido). Hipótesis de proxy modificando headers descartada.
  - Inspección de Traefik v3.6.7 en EasyPanel: middlewares visibles no incluyen modificación de headers de request. Router HTTPS de la app usa solo `bad-gateway-error-page@file`.
  - Diagnóstico de query string y manifiesto: `has_query_data_id=true`, `has_body_data_id=true`, `query_data_id_length=12`, `body_data_id_length=12`, `manifest_final_length=78`, `signature_data_source="query_data_id"`, `hmac_format_match_name="none"` en webhooks reales sandbox.
  - Diagnóstico con SDK oficial `WebhookSignatureValidator` de `mercadopago` v3.1.0: `official_sdk_validator_available=true`, `official_sdk_validator_matches=false`, `official_sdk_validator_error_name="InvalidWebhookSignatureError"` en webhooks reales sandbox.
  - Simulación desde panel de Webhooks de Mercado Pago: firma válida. Backend entra al flujo completo. Error al consultar pago (esperable para IDs de simulación sin pago real asociado).
  - Dominio propio `checkout.lemont01.com` configurado con SSL en EasyPanel. `BASE_URL` y webhook MP sandbox actualizados. Logs confirmaron `x_forwarded_host_length=21`.
  - Prueba sin `notification_url`: eventos sin `data.id`, no útiles. Restaurada `notification_url`. Tests pasan.
- Conclusión técnica:
  - La infraestructura (Traefik/EasyPanel) y la implementación HMAC no son el problema.
  - El SDK oficial también rechaza las firmas de webhooks reales sandbox: no es un bug de implementación.
  - La diferencia está en el tipo de notificación: Mercado Pago puede usar firma o clave diferente para `notification_url` de preferencia vs el webhook global del panel.
- Riesgos de seguridad detectados:
  - El Access Token de prueba y el Webhook Secret de prueba fueron compartidos en el chat de la sesión. Deben rotarse antes de continuar.
- Pendientes al cerrar sesión:
  - Rotar credenciales de prueba expuestas y actualizar EasyPanel.
  - Decidir camino técnico (Opción A, B o C — ver "Próxima acción recomendada").
  - Retirar diagnósticos temporales antes de producción real.

### 2026-06-26 — Cierre documental de staging y registro de investigación webhook HMAC

- Objetivo: documentar el estado real de staging (activo), registrar los 5 problemas operativos resueltos, registrar el problema pendiente (webhook 401 con todas las variantes HMAC fallando) y preparar la próxima acción para Codex.
- Archivos revisados: `docs/CURRENT_CONTEXT.md`, `docs/PROGRESS.md`, `docs/SECURITY.md`, `docs/SKILLS.md`, `README.md`, `AGENTS.md`.
- Archivos modificados: `docs/CURRENT_CONTEXT.md`, `docs/PROGRESS.md`, `docs/SECURITY.md`, `docs/SKILLS.md`.
- Cambios realizados:
  - `docs/CURRENT_CONTEXT.md`: header actualizado a "staging activo, investigación webhook HMAC en curso"; sección "Tareas pendientes" reemplazada con estado real del webhook 401 y pendiente de limpieza de diagnósticos; línea de deploy actualizada a "activo, webhook 401 en investigación"; "Próximo paso recomendado" reemplazado con instrucción concreta para Codex.
  - `docs/PROGRESS.md`: "Pendiente más urgente" actualizado; "Implementado en sesión 2026-06-26" ampliado con fixes operativos de staging, confirmación de secret, eliminación de lowercase y resultados del diagnóstico HMAC; "Problemas resueltos documentados" ampliado con 5 problemas de staging; "Pendientes principales" y "Próxima acción recomendada" reemplazados con contexto del webhook 401 y próxima tarea Codex.
  - `docs/SECURITY.md`: se agregó subsección sobre diagnóstico temporal en `src/webhookSignature.js` y `src/config.js` con obligación de retiro antes de producción real.
  - `docs/SKILLS.md`: se agregó nota operativa sobre formato correcto de `SUPABASE_URL` (URL base sin `/rest/v1` ni trailing slash).
- Sin cambios de código. Sin commit. Sin push. Sin acceso a `.env`. Sin secretos en documentación.
- Estado al cerrar: staging activo. `POST /webhook` retorna 401. Todas las variantes HMAC candidatas fallan. Secreto confirmado correcto. Próxima acción: Codex agrega fingerprints de componentes individuales del manifiesto.

### 2026-06-26 — Diagnóstico seguro de fingerprints y formatos HMAC

- Objetivo: diagnosticar si la firma webhook falla por componentes del manifiesto (`data.id`, `x-request-id`, `ts`) o por formato exacto, sin exponer valores completos ni aceptar firmas nuevas.
- Tarea relacionada: diagnóstico operativo de staging posterior a T-013.
- Archivos afectados: `src/webhookSignature.js`, `tests/index.test.js`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `src/webhookSignature.js`: agrega fingerprints SHA-256 de 8 caracteres y longitudes de componentes del manifiesto.
  - `src/webhookSignature.js`: agrega candidatos diagnósticos de formato oficial, sin punto y coma final, sin `request-id` y usando `body.data.id`.
  - `tests/index.test.js`: verifica que los candidatos alternativos pueden detectarse mientras el webhook sigue rechazado con HTTP 401.
- Verificaciones:
  - `node --check src/webhookSignature.js`.
  - `npm.cmd test`.
  - `git diff --check`.
  - `git diff`.
- Resultado: diagnóstico temporal listo para redeploy en EasyPanel. No cambia la validación principal.
- Pendientes o riesgos: retirar el diagnóstico temporal cuando se identifique el componente o formato real que causa el mismatch.

### 2026-06-26 — Diagnóstico seguro de variantes HMAC webhook

- Objetivo: identificar qué variante del manifiesto HMAC de Mercado Pago coincide contra `v1` sin aceptar todavía ninguna variante nueva.
- Tarea relacionada: diagnóstico operativo de staging posterior a T-013.
- Archivos afectados: `src/webhookSignature.js`, `tests/index.test.js`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `src/webhookSignature.js`: ante firma inválida, calcula candidatos `query_literal`, `body_literal`, `query_lower` y `body_lower`.
  - `src/webhookSignature.js`: el diagnóstico expone solo booleanos de coincidencia y `hmac_candidate_match_name`.
  - `tests/index.test.js`: cubre ausencia de match, match por `body_literal` y match por lowercase manteniendo respuesta `401`.
- Verificaciones:
  - `node --check src/webhookSignature.js`.
  - `npm.cmd test`.
  - `git diff --check`.
  - `git diff`.
- Resultado: diagnóstico temporal listo para redeploy en EasyPanel. La validación principal no cambia y no se aceptan webhooks inválidos.
- Pendientes o riesgos: revisar el próximo log de EasyPanel y retirar este diagnóstico cuando se confirme la variante real.

### 2026-06-26 — Diagnóstico temporal de secret webhook en startup

- Objetivo: confirmar en staging que EasyPanel carga la `MERCADO_PAGO_WEBHOOK_SECRET` esperada sin exponerla.
- Tarea relacionada: diagnóstico operativo de staging posterior a T-013.
- Archivos afectados: `src/config.js`, `src/logger.js`, `tests/index.test.js`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `src/config.js`: emite en startup `event="diagnostico webhook secret"` con presencia, longitud y prefijo SHA-256 de 8 caracteres de la secret.
  - `src/logger.js`: permite solo los campos seguros `webhook_secret_present`, `webhook_secret_length` y `webhook_secret_sha256_prefix`.
  - `tests/index.test.js`: verifica que el log no contiene la secret ni el hash completo.
- Verificaciones:
  - `node --check src/config.js`.
  - `node --check src/logger.js`.
  - `npm.cmd test`.
  - `git diff --check`.
  - `git diff`.
- Resultado: diagnóstico temporal listo para redeploy en EasyPanel sin cambiar la validación del webhook ni la lógica de pagos.
- Pendientes o riesgos: retirar este diagnóstico temporal cuando se confirme la variable en staging.

### 2026-06-26 — Fix operativo de staging: Dockerfile con Node.js 22

- Objetivo: evitar que EasyPanel/Nixpacks use Node.js 18 y falle con Supabase por falta de soporte nativo de WebSocket.
- Tarea relacionada: deploy staging posterior a T-013.
- Archivos afectados: `Dockerfile`, `.dockerignore`, `README.md`, `docs/SKILLS.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`.
- Cambios realizados:
  - `Dockerfile`: usa `node:22-alpine`, `WORKDIR /app`, `npm ci`, copia el proyecto, expone `3003` y ejecuta `npm start`.
  - `.dockerignore`: excluye `node_modules`, `.env`, `.env.*`, `.git`, logs y temporales; mantiene `.env.example` como plantilla pública mediante `!.env.example`.
  - `docs/SKILLS.md` y `README.md`: documentan que EasyPanel debe usar compilación `Dockerfile`, no Nixpacks.
  - `docs/CURRENT_CONTEXT.md`: registra que staging ahora se construye con Dockerfile Node.js 22.
- Verificaciones:
  - `npm.cmd test`.
  - `git diff --check`.
  - `git diff`.
  - Confirmación de que no hay cambios en `.js`, `.env`, dependencias, `package.json` ni `package-lock.json`.
  - Revisión de `Dockerfile` y `.dockerignore` sin secretos ni valores reales.
- Resultado: configuración Docker lista para redeploy en EasyPanel con Node.js 22.
- Pendientes o riesgos: el usuario debe cambiar EasyPanel de Nixpacks a Dockerfile y hacer redeploy.

### 2026-06-26 — Diagnóstico seguro de Supabase en staging

- Objetivo: distinguir por qué `POST /crear-preferencia` falla al persistir el pedido en Supabase sin exponer secretos ni datos del pedido.
- Tarea relacionada: diagnóstico operativo de staging posterior a T-013.
- Archivos afectados: `src/app.js`, `tests/index.test.js`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `src/app.js`: se agregó categorización segura del error de Supabase en el catch de persistencia de pedido. El log mantiene `event="error al persistir pedido"` y usa `error_type` con categorías como `supabase_result_shape_error`, `supabase_auth_or_rls_error`, `supabase_constraint_error`, `supabase_postgrest_error` o `supabase_error`.
  - `tests/index.test.js`: se agregó aserción para verificar que el log categoriza el error de Supabase sin emitir el mensaje interno simulado.
- Verificaciones:
  - `node --check src/app.js`.
  - `npm.cmd test`.
  - `git diff --check`.
  - `git diff`.
- Resultado: diagnóstico listo para redeploy en EasyPanel. No cambia el contrato HTTP ni la lógica de pagos.
- Pendientes o riesgos: si la categoría sigue siendo genérica, hará falta autorizar un ajuste de logging más específico en `src/logger.js` para incluir campos seguros como `supabase_code` o `supabase_status`.

### 2026-06-26 — Diagnóstico seguro adicional de PostgREST

- Objetivo: conocer el código exacto del error Supabase/PostgREST sin exponer mensaje, detalles, hint, payload, headers ni secretos.
- Tarea relacionada: diagnóstico operativo de staging posterior a T-013.
- Archivos afectados: `src/app.js`, `tests/index.test.js`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `src/app.js`: el log `event="error al persistir pedido"` agrega, si existen, `supabase_code`, `supabase_status`, `supabase_error_name`, `supabase_details_type` y `supabase_hint_type`.
  - `tests/index.test.js`: se verifica que esos campos seguros aparezcan y que no se emitan `error.message`, `error.details` ni `error.hint` completos.
- Verificaciones:
  - `node --check src/app.js`.
  - `npm.cmd test`.
  - `git diff --check`.
  - `git diff`.
- Resultado: diagnóstico listo para redeploy en EasyPanel. No cambia el contrato HTTP ni la lógica de pagos.
- Pendientes o riesgos: revisar el próximo log de EasyPanel y decidir el fix mínimo según `supabase_code`/`supabase_status`.

### 2026-06-26 — Diagnóstico seguro de firma webhook Mercado Pago

- Objetivo: diagnosticar por qué Mercado Pago sandbox llega a `POST /webhook` pero la validación HMAC responde 401.
- Tarea relacionada: diagnóstico operativo de staging posterior a T-013.
- Archivos afectados: `src/webhookSignature.js`, `src/app.js`, `tests/index.test.js`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `src/webhookSignature.js`: se agregó parsing reutilizable de `x-signature` y diagnóstico seguro de fuente de `data.id`, presencia de headers, presencia de `ts`/`v1`, longitud de `v1` y uso de lowercase.
  - `src/app.js`: cuando la firma es inválida, el log `event="firma de webhook invalida"` incluye solo esos metadatos seguros y mantiene HTTP 401.
  - `tests/index.test.js`: se cubre el log seguro de firma inválida y el caso donde `data.id` llega solo en `body.data.id`.
- Verificaciones:
  - `node --check src/webhookSignature.js`.
  - `node --check src/app.js`.
  - `npm.cmd test`.
  - `git diff --check`.
  - `git diff`.
- Resultado: diagnóstico listo para redeploy en EasyPanel. No desactiva ni debilita la validación de firma.
- Pendientes o riesgos: revisar si `has_query_data_id=false` y `has_body_data_id=true`, o si el problema apunta al lowercase del `data.id`.

### 2026-06-26 — Fix de firma webhook Mercado Pago con data.id literal

- Objetivo: alinear el manifiesto HMAC con el contrato oficial de Mercado Pago usando `data.id` literal.
- Tarea relacionada: fix operativo de staging posterior a T-013.
- Archivos afectados: `src/webhookSignature.js`, `tests/index.test.js`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `src/webhookSignature.js`: el manifiesto cambió de `String(dataId).toLowerCase()` a `String(dataId)`.
  - `src/webhookSignature.js`: el diagnóstico seguro reemplazó `uses_lowercase_data_id` por `preserves_literal_data_id`.
  - `tests/index.test.js`: las firmas de prueba se calculan con `data.id` literal por defecto y se agregó una regresión que rechaza una firma calculada con lowercase cuando el request trae otro casing.
- Verificaciones:
  - `node --check src/webhookSignature.js`.
  - `npm.cmd test`.
  - `git diff --check`.
  - `git diff`.
- Resultado: la validación HMAC conserva el rechazo de firmas inválidas y usa el `data.id` literal.
- Pendientes o riesgos: redeploy en EasyPanel y repetir pago sandbox para confirmar que Mercado Pago ya no recibe 401.

### 2026-06-26 — Cierre final del backlog (14/14 tareas)

- Objetivo: verificar consistencia documental del estado final del proyecto y cerrar el backlog T-001 a T-014.
- Archivos revisados: `docs/CURRENT_CONTEXT.md`, `docs/PROGRESS.md`, `docs/TASKS.md`, `docs/DESIGN.md`, `docs/SECURITY.md`, `docs/SKILLS.md`, `README.md`.
- Archivos modificados: `docs/CURRENT_CONTEXT.md`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `docs/CURRENT_CONTEXT.md`: se consolidó DEC-016 en la tabla principal de decisiones aceptadas (estaba en tabla "continuación" separada).
  - `docs/PROGRESS.md`: se agregó "Implementado en sesión 2026-06-26" con T-013 en la sección de avances detectados. Esta entrada de cierre final agregada.
- Inconsistencias detectadas y corregidas:
  - DEC-016 estaba en tabla "continuación" separada en `CURRENT_CONTEXT.md`; ahora está integrada en la tabla principal.
  - T-013 no aparecía en la sección "Avances detectados" de `PROGRESS.md` a pesar de estar en la bitácora; ahora figura bajo su sesión real (2026-06-26).
- Sin inconsistencias en los demás archivos:
  - `docs/TASKS.md`: T-013 marcada como completada con nota de verificación (2026-06-26). T-014 completada. Ninguna tarea incorrectamente pendiente.
  - `docs/DESIGN.md`: T-013/DEC-016 incluida en "Implementado y vigente". Limitaciones estructurales actualizadas.
  - `docs/SECURITY.md`: riesgos mitigados correctamente documentados. Sin frases obsoletas.
  - `docs/SKILLS.md`: sección "Deploy a staging (EasyPanel)" con checklist completa, variables, seguridad y rollback.
  - `README.md`: sección "Deploy a staging" presente. "Base de datos" referencia migración versionada. "Limitaciones actuales" sin frases obsoletas.
- Sin cambios de código. Sin commits. Sin acceso a `.env`.
- Estado al cerrar: 14/14 tareas completadas y documentadas. Backlog T-001 a T-014 cerrado.
- Próximo paso: el usuario ejecuta el deploy real a staging en EasyPanel siguiendo `docs/SKILLS.md` y DEC-016.

### 2026-06-26 — T-013 completada

- Objetivo: dejar preparada y documentada la guía final de deploy a staging en EasyPanel según DEC-016.
- Tarea relacionada: T-013.
- Archivos afectados: `docs/SKILLS.md`, `README.md`, `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`, `docs/DESIGN.md`, `docs/SECURITY.md`.
- Cambios realizados:
  - `docs/SKILLS.md`: se ajustó el comando de prueba de preferencia para usar `{ sku, quantity }`, se eliminó texto obsoleto sobre ausencia de tests, se completó la guía de EasyPanel con variables por nombre, checklist de staging, checklist previa a producción real, notas de seguridad y rollback.
  - `README.md`: se agregó una sección breve de deploy a staging que referencia `docs/SKILLS.md` y DEC-016.
  - `docs/TASKS.md`: T-013 marcada como completada con resultado y verificaciones.
  - `docs/CURRENT_CONTEXT.md`: contexto actualizado a 14/14 tareas completadas y deploy documentado.
  - `docs/DESIGN.md`: se corrigió la limitación obsoleta que indicaba que no había deploy documentado.
  - `docs/SECURITY.md`: se corrigieron riesgos ya mitigados para firma de webhook, pedido interno, condición de carrera y controles operativos.
- Verificaciones:
  - `git diff --check`.
  - `git diff`.
  - Confirmación de que el diff toca solo Markdown permitido.
  - Confirmación de que no hay cambios en `.js`, `.env`, dependencias, `package.json` ni `package-lock.json`.
  - Búsqueda de secretos y valores reales de variables sin hallazgos.
- Resultado: T-013 completada como documentación. No se ejecutó deploy real, no se leyeron secretos, no se modificó código y no hubo commit ni push.
- Pendientes o riesgos: el usuario debe ejecutar staging en EasyPanel, configurar manualmente el webhook sandbox de Mercado Pago y registrar los resultados de la checklist.

### 2026-06-25 — DEC-016 aceptada — estrategia de deploy, staging y rollback definida

- Objetivo: documentar DEC-016 para desbloquear T-013.
- Tareas relacionadas: T-013.
- Archivos revisados: `docs/DECISIONS.md`, `docs/TASKS.md`, `docs/SKILLS.md`, `README.md`, `docs/CURRENT_CONTEXT.md`, `docs/PROGRESS.md`.
- Archivos modificados: `docs/DECISIONS.md`, `docs/TASKS.md`, `docs/SKILLS.md`, `README.md`, `docs/CURRENT_CONTEXT.md`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `docs/DECISIONS.md`: DEC-016 pasó de `pendiente` a `aceptada`. Se documentó la decisión completa: EasyPanel/VPS como plataforma de staging, URL HTTPS gratuita de EasyPanel, `NODE_ENV=production` desde el primer deploy, `MERCADOPAGO_ACCESS_TOKEN` sandbox, mismo proyecto Supabase actual, variables solo en EasyPanel, webhook sandbox a configurar manualmente, checklist de staging (11 ítems), checklist previa a producción real (11 ítems), estrategia de rollback en 4 niveles, alternativas consideradas y qué implementa T-013.
  - `docs/TASKS.md`: T-013 actualizada con instrucciones concretas: actualizar `docs/SKILLS.md` (sección "Deploy") y `README.md` (secciones desactualizadas).
  - `docs/SKILLS.md`: sección "Deploy" reemplazada con pasos concretos de EasyPanel, tabla de variables por nombre, notas de seguridad y rollback resumido.
  - `README.md`: sección "Base de datos" actualizada para referenciar `supabase/migrations/001_create_orders.sql` ya existente. Sección "Limitaciones actuales" corregida: eliminadas referencias a "no hay tests", "no hay migración versionada" y "el webhook no valida su firma" (todo resuelto). Limitaciones reales actualizadas: sin autenticación, sin panel admin, deploy pendiente de ejecución.
  - `docs/CURRENT_CONTEXT.md`: DEC-016 incorporada a la tabla de decisiones aceptadas; T-013 marcada como lista para implementar; "Próximo paso" actualizado.
  - `docs/PROGRESS.md`: esta entrada.
- Decisiones tomadas: DEC-016 aceptada. Staging en EasyPanel/VPS. Sandbox primero. Producción real con checklist obligatoria. Sin dependencias nuevas. Sin cambios en código.
- Sin cambios de código JavaScript. Sin commits. Sin acceso a `.env`.
- Próximos pasos: Codex implementa T-013 actualizando `docs/SKILLS.md` y `README.md`. El usuario ejecuta el deploy a EasyPanel siguiendo la checklist de staging de DEC-016.

### 2026-06-25 — Cierre documental de fase (13/14 tareas)

- Objetivo: verificar consistencia documental del estado real del proyecto tras la finalización de T-012, y dejar el proyecto ordenado antes de resolver DEC-016.
- Archivos revisados: `docs/CURRENT_CONTEXT.md`, `docs/PROGRESS.md`, `docs/TASKS.md`, `docs/DESIGN.md`.
- Archivos modificados: `docs/CURRENT_CONTEXT.md`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `docs/CURRENT_CONTEXT.md`: se consolidaron las dos tablas separadas de "Decisiones técnicas aceptadas" en una sola tabla con DEC-013 integrada junto a las otras cinco decisiones.
  - `docs/PROGRESS.md`: se dividió "Implementado en sesión 2026-06-24" en dos subsecciones (2026-06-24 y 2026-06-25) para que T-007 a T-014 no figuren bajo una fecha incorrecta. Esta entrada de cierre agregada.
- Inconsistencias detectadas y corregidas:
  - DEC-013 estaba en una sección "continuación" separada en `CURRENT_CONTEXT.md`; ahora está en la tabla principal.
  - El encabezado "Implementado en sesión 2026-06-24" incluía T-012 y T-014 completadas el 2026-06-25; ahora están bajo su fecha real.
- Sin inconsistencias en `docs/TASKS.md`: T-012 marcada como completada con nota de verificación (29 tests), T-013 pendiente bloqueada por DEC-016, T-014 completada.
- Sin inconsistencias en `docs/DESIGN.md`: `src/catalog.js` documentado, flujo actualizado, 29 tests.
- Sin cambios de código. Sin commits. Sin acceso a `.env`.
- Estado al cerrar: 13/14 tareas completadas y documentadas. Única tarea pendiente: T-013, bloqueada por DEC-016.
- Próximo paso: el usuario define DEC-016 (proveedor de deploy, entornos, rollback) para desbloquear T-013.

### 2026-06-25 — T-012 completada

- Objetivo: implementar catálogo seguro del lado del backend para que el frontend no pueda decidir ni manipular precio, importe total ni moneda.
- Tarea relacionada: T-012.
- Archivos afectados: `src/catalog.js`, `src/app.js`, `public/app.js`, `tests/index.test.js`, `README.md`, `docs/REQUIREMENTS.md`, `docs/DESIGN.md`, `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`.
- Cambios realizados:
  - `src/catalog.js`: nuevo módulo de catálogo según DEC-013, con SKU `REMERA-LEMONT-001`, `unitPrice: 100`, moneda `ARS`, `maxQuantity: 10` y export `getProduct(sku)`.
  - `src/app.js`: `POST /crear-preferencia` acepta solo `{ sku, quantity }`, valida SKU y cantidad, calcula `total` en backend e ignora `price`, `amount` y `currency` del cliente.
  - `public/app.js`: envía `{ sku: "REMERA-LEMONT-001", quantity: 1 }`.
  - `tests/index.test.js`: se agregaron regresiones para SKU inválido, cantidades inválidas, cantidad válida y manipulación de `amount`, `currency` y `price`.
  - Documentación: se actualizó el contrato de creación de preferencias y el estado de T-012.
- Verificaciones:
  - `node --check src/catalog.js`.
  - `node --check src/app.js`.
  - `npm.cmd test` — 29 tests pasan.
  - `git diff --check`.
  - `git diff`.
- Resultado: T-012 completada sin leer `.env`, sin exponer secretos, sin dependencias nuevas, sin tablas nuevas en Supabase, sin commits, sin push y sin cambios en `POST /webhook`, firma, consulta real a Mercado Pago, transición `pending → paid` ni validación final de importe/moneda del webhook.
- Pendientes o riesgos: T-013 sigue pendiente y requiere DEC-016.

### 2026-06-25 — DEC-013 aceptada — estrategia de catálogo y precios definida

- Objetivo: documentar DEC-013 para desbloquear T-012.
- Tareas relacionadas: T-012.
- Archivos revisados: `docs/DECISIONS.md`, `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`, `docs/SECURITY.md`.
- Archivos modificados: `docs/DECISIONS.md`, `docs/TASKS.md`, `docs/CURRENT_CONTEXT.md`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `docs/DECISIONS.md`: DEC-013 pasó de `pendiente` a `aceptada`. Se documentó la decisión completa: catálogo como módulo `src/catalog.js`, contrato del handler `POST /crear-preferencia` (acepta `{ sku, quantity }`, rechaza importe del cliente), reglas de validación, cálculo de importe en backend, estrategia de migración futura a tabla Supabase y alternativas descartadas.
  - `docs/TASKS.md`: T-012 actualizada con instrucciones concretas para Codex: crear `src/catalog.js`, modificar `src/app.js`, agregar tests de SKU inválido, cantidad fuera de rango y precio calculado correctamente.
  - `docs/CURRENT_CONTEXT.md`: DEC-013 movida a decisiones aceptadas, T-012 marcada como lista para implementar, próximo paso actualizado.
  - `docs/PROGRESS.md`: esta entrada.
- Decisiones tomadas: DEC-013 aceptada. Catálogo en módulo `src/catalog.js`. Sin dependencias nuevas. Sin tabla Supabase adicional en esta etapa.
- Sin cambios de código. Sin commits. Sin acceso a `.env`.
- Próximos pasos: Codex implementa T-012 usando `docs/TASKS.md` (T-012) y `docs/DECISIONS.md` (DEC-013).

### 2026-06-25 — Cierre documental de sesión (12/14 tareas)

- Objetivo: actualizar `docs/CURRENT_CONTEXT.md` y `docs/DESIGN.md` para reflejar el estado real del proyecto tras el cierre de T-011, T-014 y las correcciones de la sesión anterior.
- Archivos revisados: `docs/CURRENT_CONTEXT.md`, `docs/DESIGN.md`, `docs/PROGRESS.md`.
- Archivos modificados: `docs/CURRENT_CONTEXT.md`, `docs/DESIGN.md`.
- Cambios realizados:
  - `docs/CURRENT_CONTEXT.md`: reescritura completa para reflejar 12/14 tareas completadas. T-011 y T-014 incluidas en la sección "P2 — completadas". Tareas pendientes reducidas a T-012 y T-013. Tests corregidos a 22. `GET /webhook` documentado como restringido a no-producción. Commits corregidos (T-001–T-010 y T-014 pusheados; T-011 local sin commit). Próximo paso reenfocado en resolver DEC-013 y DEC-016 antes de programar.
  - `docs/DESIGN.md`: conteo de tests corregido de 18 a 22 en dos lugares (sección "Módulos principales" y bloque de estructura de archivos).
- Decisiones tomadas: ninguna nueva. Todas las correcciones son de sincronización documental.
- Sin cambios de código. Sin commits. Sin acceso a `.env`.
- Estado al cerrar: 12/14 tareas completadas y documentadas. Próximo paso: resolver DEC-013 (T-012) y DEC-016 (T-013).

### 2026-06-25 — T-011 completada

- Objetivo: retirar o restringir `GET /webhook` para que no quede disponible en producción.
- Tarea relacionada: T-011.
- Archivos afectados: `src/app.js`, `tests/index.test.js`, `docs/DESIGN.md`, `docs/SKILLS.md`, `docs/TASKS.md`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `src/app.js`: `GET /webhook` se registra solo cuando `NODE_ENV !== "production"`.
  - `tests/index.test.js`: se agregaron pruebas para `test`, `development` y `production`, confirmando que `POST /webhook` sigue registrado en producción.
  - `docs/DESIGN.md` y `docs/SKILLS.md`: se documentó que el diagnóstico GET solo existe fuera de producción.
  - `docs/TASKS.md` y `docs/PROGRESS.md`: T-011 marcada como completada y verificaciones registradas.
- Verificaciones:
  - `node --check src/app.js`.
  - `npm.cmd test` — 22 tests pasan.
  - `git diff --check`.
  - `git diff`.
- Resultado: T-011 completada sin leer `.env`, sin exponer secretos, sin dependencias nuevas, sin commits, sin push y sin cambios en pagos, validación de firma, Mercado Pago, Supabase ni arquitectura.
- Pendientes o riesgos: T-012 y T-013 siguen pendientes y requieren decisiones.

### 2026-06-25 — T-014 completada

- Objetivo: corregir la codificación UTF-8 del mensaje de error HTTP 400 para JSON inválido.
- Tarea relacionada: T-014.
- Archivos afectados: `src/app.js`, `tests/index.test.js`, `docs/TASKS.md`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `src/app.js`: el middleware de `SyntaxError` para JSON inválido conserva HTTP `400` y `{ error: "JSON inválido" }`, y define `Content-Type: application/json; charset=utf-8`.
  - `tests/index.test.js`: se agregó una regresión que verifica status, body y charset UTF-8.
  - `docs/TASKS.md` y `docs/PROGRESS.md`: T-014 marcada como completada y verificaciones registradas.
- Verificaciones:
  - `node --check src/app.js`.
  - `npm.cmd test` — 19 tests pasan.
  - `git diff --check`.
  - `git diff`.
- Resultado: T-014 completada sin leer `.env`, sin exponer secretos, sin dependencias nuevas, sin commits, sin push y sin cambios en pagos, Mercado Pago, Supabase ni arquitectura.
- Pendientes o riesgos: T-011 sigue pendiente para retirar o restringir `GET /webhook` en producción.

### 2026-06-25 — Cierre documental de T-009

- Objetivo: registrar documentalmente el cierre real de T-009 tras su implementación y commit.
- Archivos revisados: `docs/TASKS.md`, `docs/DESIGN.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`.
- Archivos modificados: `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`.
- Correcciones realizadas:
  - `docs/TASKS.md`: eliminada la nota obsoleta sobre "marcación prematura". "Estructura propuesta" renombrada a "Estructura implementada". "Instrucciones para Codex" reemplazadas por "Verificaciones realizadas" y "Criterios de aceptación cumplidos". Commit referenciado.
  - `docs/PROGRESS.md`: entrada T-009 completada con commit "Separa backend en modulos" y push a `origin/main`. "Próxima acción recomendada" actualizada a 10/14 tareas; T-009 ya no figura como pendiente de commit.
  - `docs/CURRENT_CONTEXT.md`: estado de commits actualizado; T-009 figura como commiteada junto con T-001 a T-006.
- Estado del proyecto al cerrar: 10/14 tareas completadas y commiteadas. T-001–T-010 pusheadas a `origin/main`. T-011, T-012, T-013, T-014 pendientes. **Corrección posterior (misma sesión):** la versión inicial de esta entrada indicaba incorrectamente que T-007, T-008 y T-010 estaban sin commit; en realidad ya tenían sus propios commits ("Implementa validacion segura de importes y moneda", "Mejora identificadores unicos de pedidos", "Implementa logs estructurados seguros").

### 2026-06-25 — T-009 completada

- Objetivo: separar responsabilidades del backend sin cambiar comportamiento HTTP observable.
- Tarea relacionada: T-009.
- Archivos creados: `src/app.js`, `src/config.js`, `src/logger.js`, `src/payments.js`, `src/orders.js`, `src/webhookSignature.js`.
- Archivos modificados: `index.js`, `docs/TASKS.md`, `docs/DESIGN.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`.
- Cambios realizados:
  - `index.js`: reducido a entrypoint mínimo que carga config, importa app y llama a `app.listen`.
  - `src/app.js`: concentra Express, middlewares, rutas y handlers.
  - `src/config.js`: valida y expone variables de entorno.
  - `src/logger.js`: mueve el helper `log()` de DEC-017.
  - `src/payments.js`: encapsula Mercado Pago (`Preference.create`, `Payment.get`).
  - `src/orders.js`: encapsula Supabase, pedidos, comparación de importes y transición `pending → paid`.
  - `src/webhookSignature.js`: encapsula la validación HMAC-SHA256 de Mercado Pago.
- Verificaciones:
  - `node --check index.js` — sin errores de sintaxis.
  - `node --check src/*.js` — sin errores en ningún módulo.
  - `npm.cmd test` — 18 tests pasan.
  - `git diff --check` — sin problemas de espaciado.
  - Búsqueda de `console.*` — solo queda en `src/logger.js`.
  - Búsqueda de secretos — solo nombres de variables/placeholders/documentación, sin valores reales.
- Commit: "Separa backend en modulos" — pusheado a `origin/main`.
- Resultado: T-009 completada. Backend modularizado sin instalar dependencias, sin modificar `package.json`, sin leer `.env`, sin cambiar rutas, respuestas públicas, creación de preferencias, firma webhook, validación de importe/moneda, transición `pending → paid` ni eventos/campos de logs. Repo limpio y sincronizado con `origin/main`.
- Pendientes o riesgos: T-011 sigue pendiente para retirar o restringir `GET /webhook` en producción.

### 2026-06-25 — T-009 corregida a pendiente; estructura de refactor definida

- Objetivo: corregir el estado inconsistente de T-009 y documentar la estructura propuesta para el refactor.
- Problema detectado: T-009 estaba marcada como `completada` en `docs/TASKS.md`, pero los módulos `src/` no existen en el repositorio. `index.js` sigue concentrando toda la lógica.
- Archivos revisados: `docs/TASKS.md`, `docs/DESIGN.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`.
- Archivos modificados: `docs/TASKS.md`, `docs/DESIGN.md`, `docs/CURRENT_CONTEXT.md`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `docs/TASKS.md`: T-009 corregida de `completada` a `pendiente`. Se agregó nota sobre la marcación prematura. Se documentó la estructura propuesta (`src/app.js`, `config.js`, `logger.js`, `payments.js`, `orders.js`, `webhookSignature.js`). Se actualizaron instrucciones para Codex con 8 pasos concretos y criterios de aceptación que incluyen mantener los 18 tests pasando.
  - `docs/DESIGN.md`: se separó la sección "Módulos principales" en estado actual vs estructura propuesta. Se actualizaron "Limitaciones estructurales" e "Implementado y vigente" para reflejar el estado real del proyecto.
  - `docs/CURRENT_CONTEXT.md`: descripción de T-009 actualizada con la estructura de módulos propuesta.
  - `docs/PROGRESS.md`: estado actual y esta entrada.
- Sin cambios de código. Sin commits. Sin acceso a `.env`.
- Próximos pasos: Codex implementa T-009 siguiendo `docs/TASKS.md` (T-009) y la estructura en `docs/DESIGN.md`.

### 2026-06-25 — T-010 completada

- Objetivo: implementar DEC-017 como fuente de verdad para observabilidad segura.
- Tarea relacionada: T-010.
- Archivos afectados: `index.js`, `.env.example`, `tests/index.test.js`, `README.md`, `docs/DESIGN.md`, `docs/SECURITY.md`, `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`.
- Cambios realizados:
  - `index.js`: se agregó `log(level, event, extra)` con salida JSON y whitelist de campos seguros.
  - `index.js`: todos los logs directos del backend fueron reemplazados por el helper; `console.*` solo queda dentro de `log`.
  - `.env.example`: se agregó `LOG_LEVEL=info`.
  - `tests/index.test.js`: se actualizaron aserciones para logs JSON y se verificó ausencia de `x-signature`, importes y `external_reference` en flujos críticos.
  - Documentación: se actualizó el contrato de variables y el estado de T-010.
- Verificaciones:
  - `node --check index.js`.
  - `npm.cmd test` — 18 tests pasan.
  - `Select-String -Path index.js -Pattern "console\\."` — solo encuentra `console.*` dentro del helper.
  - `git diff --check`.
- Resultado: T-010 completada sin instalar dependencias, sin modificar `package.json`, sin leer `.env`, sin commits y sin cambiar creación de preferencias, firma webhook, validación importe/moneda ni transición `pending → paid`.
- Pendientes o riesgos: T-011 sigue pendiente para retirar o restringir `GET /webhook` en producción.

### 2026-06-25 — DEC-017 aceptada — estrategia de observabilidad segura definida

- Objetivo: documentar DEC-017 para desbloquear T-010.
- Tareas relacionadas: T-010.
- Archivos revisados: `docs/DECISIONS.md`, `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`, `docs/SECURITY.md`, `CLAUDE.md`.
- Archivos modificados: `docs/DECISIONS.md`, `docs/TASKS.md`, `docs/CURRENT_CONTEXT.md`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `docs/DECISIONS.md`: DEC-017 pasó de `pendiente` a `aceptada`. Se documentaron los 10 puntos: helper propio `log(level, event, extra)`, formato JSON mínimo, niveles `info`/`warn`/`error`, campos permitidos, campos prohibidos, correlación por `request_id` (usando `x-request-id` de MP o `crypto.randomUUID()`), política de retención (stdout, 30–90 días según proveedor), verbosidad adicional segura con `LOG_LEVEL`, tareas desbloqueadas (T-010) y riesgos de logs inseguros.
  - `docs/TASKS.md`: T-010 actualizada con instrucciones concretas para Codex: crear el helper, reemplazar todos los `console.*`, agregar `LOG_LEVEL` a `.env.example` y tests de ausencia de campos prohibidos.
  - `docs/CURRENT_CONTEXT.md`: DEC-017 movida a decisiones aceptadas, T-010 marcada sin bloqueo, próximo paso actualizado.
  - `docs/PROGRESS.md`: estado actual y esta entrada.
- Decisiones tomadas: DEC-017 aceptada. Sin librería externa. Sin cambios en `package.json`.
- Sin cambios de código. Sin commits. Sin acceso a `.env`.
- Próximos pasos: Codex implementa T-010 usando `docs/TASKS.md` (T-010) y `docs/DECISIONS.md` (DEC-017).

### 2026-06-25 — T-008 completada

- Objetivo: reemplazar referencias basadas solo en timestamp por identificadores robustos bajo concurrencia.
- Tarea relacionada: T-008.
- Archivos afectados: `index.js`, `tests/index.test.js`, `README.md`, `docs/DESIGN.md`, `docs/DECISIONS.md`, `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`.
- Cambios realizados:
  - `index.js`: `externalReference` ahora usa `LEMONT-ORDER-${crypto.randomUUID()}`.
  - `tests/index.test.js`: se agregaron pruebas para prefijo, no dependencia exclusiva de `Date.now()` y dos pedidos en el mismo instante sin repetir `external_reference`.
  - Documentación: se actualizó el estado de T-008, el flujo documentado y el contexto compacto.
- Verificaciones:
  - `node --check index.js`.
  - `npm.cmd test` — 18 tests pasan.
  - `git diff --check`.
- Resultado: T-008 completada sin instalar dependencias, sin leer `.env`, sin commits y sin cambiar Mercado Pago, webhooks, firma, validación de importe/moneda ni transición `pending → paid`.
- Pendientes o riesgos: ninguno específico de T-008.

### 2026-06-25 — T-007 completada

- Objetivo: implementar DEC-011 como fuente de verdad para comparación de importes y validación de moneda.
- Tarea relacionada: T-007.
- Archivos afectados: `index.js`, `tests/index.test.js`, `README.md`, `docs/REQUIREMENTS.md`, `docs/DESIGN.md`, `docs/SECURITY.md`, `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`.
- Cambios realizados:
  - `index.js`: se agregó `importesCoinciden(a, b)` con normalización a centavos usando `Math.round(Number(valor) * 100)`.
  - `index.js`: la transición a `paid` ahora valida `payment.currency_id` contra `order.currency` y usa `importesCoinciden` para el importe.
  - `index.js`: el `POST /webhook` dejó de registrar payloads y campos reales del pago; conserva logs genéricos.
  - `tests/index.test.js`: se agregaron casos para decimal normalizado, importe distinto, moneda distinta, moneda correcta y no exposición de importe/moneda en logs.
- Verificaciones:
  - `node --check index.js`.
  - `npm.cmd test` — 15 tests pasan.
  - `git diff --check`.
- Resultado: T-007 completada sin instalar dependencias, sin leer `.env`, sin commits y sin cambiar creación de preferencias, validación de firma ni la condición atómica `pending → paid`.
- Pendientes o riesgos: quedan logs de diagnóstico fuera de `POST /webhook` para revisar en T-010/T-011.

### 2026-06-25 — DEC-011 aceptada — estrategia monetaria definida

- Objetivo: documentar DEC-011 para desbloquear T-007.
- Tareas relacionadas: T-007.
- Archivos revisados: `docs/DECISIONS.md`, `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/CURRENT_CONTEXT.md`, `docs/SECURITY.md`, `CLAUDE.md`.
- Archivos modificados: `docs/DECISIONS.md`, `docs/TASKS.md`, `docs/CURRENT_CONTEXT.md`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `docs/DECISIONS.md`: DEC-011 pasó de `pendiente` a `aceptada`. Se documentaron los 8 puntos: formato interno (pesos ARS), esquema Supabase sin migración, conversión a Mercado Pago (pesos), función de comparación (`Math.round(a * 100) === Math.round(b * 100)`), validación de moneda (`currency_id` vs `order.currency`), logs genéricos permitidos, tareas desbloqueadas (T-007) y riesgos del punto flotante.
  - `docs/TASKS.md`: T-007 actualizada con instrucciones concretas para Codex: función `importesCoinciden`, reemplazo de comparación actual, validación de moneda y casos de prueba requeridos.
  - `docs/CURRENT_CONTEXT.md`: DEC-011 movida a decisiones aceptadas, T-007 marcada sin bloqueo, próximo paso actualizado.
  - `docs/PROGRESS.md`: esta entrada.
- Decisiones tomadas: DEC-011 aceptada con estrategia sin dependencias nuevas.
- Sin cambios de código. Sin commits. Sin acceso a `.env`.
- Próximos pasos: Codex implementa T-007 usando las instrucciones de `docs/TASKS.md` (T-007) y la decisión en `docs/DECISIONS.md` (DEC-011).

### 2026-06-25 — Migración manual de Supabase aplicada y verificada

- Objetivo: documentar la aplicación y verificación manual de la migración SQL en Supabase.
- Tarea relacionada: T-006 (archivo creado el 2026-06-24, aplicado el 2026-06-25).
- Archivos afectados: solo documentación (PROGRESS.md, CURRENT_CONTEXT.md, TASKS.md).
- Verificaciones realizadas:
  - `git status` limpio antes de aplicar.
  - `npm test` pasa con 11 tests.
  - Migración ejecutada en Supabase SQL Editor: `Success. No rows returned.`
  - Tabla `public.orders` visible en Table Editor (vacía, sin datos reales).
  - Columnas confirmadas: `id`, `external_reference`, `product_name`, `quantity`, `amount`, `currency`, `status`, `mercadopago_payment_id`, `mercadopago_status`, `created_at`, `updated_at`.
  - Constraints confirmados: `external_reference` unique, `amount > 0`, `status` solo `pending` o `paid`.
  - Índices confirmados: `orders_status_idx`, `orders_mercadopago_payment_id_idx`.
  - RLS confirmada mediante consulta a `pg_tables`: `rowsecurity = true`.
  - Sin policies para `anon` ni `authenticated`.
  - Sin pedidos insertados manualmente.
- Resultado: T-006 completamente finalizada (archivo creado + aplicado + verificado).
- Pendientes: ninguno relacionado con T-006. Siguiente decisión recomendada: DEC-011 para desbloquear T-007.

### 2026-06-24 — T-006 completada

- Se creó `supabase/migrations/001_create_orders.sql` con DDL de `public.orders`, restricciones `status in ('pending', 'paid')` y `amount > 0`, índices para `status` y `mercadopago_payment_id`, y RLS habilitada.
- No se crearon policies para `anon` ni `authenticated`; el archivo documenta que `SUPABASE_SERVICE_ROLE_KEY` debe permanecer solo en backend.
- La migración no fue aplicada en ninguna base de datos. El usuario debe revisarla y aplicarla manualmente cuando corresponda.
- Verificación: `git diff --check`.

### 2026-06-24 — Cierre de fase P0 + P1 inicial

- T-001 a T-006 completadas y commiteadas. La primera fase de seguridad, calidad y versionado está cerrada.
- Estado técnico final: validación HMAC-SHA256, transición atómica, tests Jest (11 tests), migración SQL versionada, variables de entorno validadas.
- `docs/CURRENT_CONTEXT.md` actualizado como resumen compacto de cierre.
- Próxima fase sugerida: modo aprendizaje → definir DEC-011 → implementar T-007 (estrategia monetaria).

### 2026-06-24 — Contexto estable consolidado

- Se creó `docs/CURRENT_CONTEXT.md` como resumen compacto para agentes: metodología, estado de tareas, decisiones aceptadas, estado técnico y próximo paso.
- Se actualizaron "Estado actual" y "Avances detectados" en este archivo para reflejar el estado real post T-001 a T-005.

### 2026-06-24 — DEC-012 aceptada

- Estrategia elegida: SQL manual versionado en `supabase/migrations/`, sin Supabase CLI.
- El usuario aplicará el archivo manualmente; Codex no ejecuta comandos de base de datos.
- T-006 queda desbloqueada.

### 2026-06-24 — T-006 alcance definido

- Se documentó el esquema real de `orders` (fuente: README.md), las restricciones a agregar (CHECK status, CHECK amount > 0), los índices recomendados (status, mercadopago_payment_id), la estrategia RLS mínima y las reglas de versionado SQL.
- Se identificó que DEC-012 ya existe en `docs/DECISIONS.md` como decisión pendiente sobre estrategia de versionado; no fue necesario crear DEC-011 (ya ocupada por importes/redondeo).
- Pendiente: el usuario debe confirmar DEC-012 antes de que Codex implemente.

### 2026-06-24 — T-005 completada

- Se agregó Jest como dependencia de desarrollo y el comando reproducible `npm test`.
- Se creó `tests/index.test.js` con mocks de Express, Mercado Pago, Supabase y dotenv para evitar llamadas reales y acceso a `.env`.
- Casos cubiertos: configuración obligatoria, fallo de Supabase antes de crear preferencia, firma ausente, firma inválida, firma válida, pago aprobado con importe correcto e incorrecto, pago no aprobado, pedido inexistente, pedido ya pagado, webhooks concurrentes y transición atómica.
- Verificación: `npm test`, `node --check index.js` y `git diff --check`.

### 2026-06-24 — T-005 alcance definido

- Se definieron los 13 casos de prueba (TC-01 a TC-13), el framework recomendado (Jest, con `node:test` como alternativa sin dependencias), los archivos involucrados, los criterios de aceptación y qué no testear todavía.
- Pendiente: el usuario debe confirmar el framework y autorizar la modificación de `package.json` antes de que Codex implemente.

### 2026-06-24 — T-003 completada

- La transición `pending` → `paid` ahora usa una actualización condicional por referencia y estado; cero filas actualizadas se trata como webhook duplicado idempotente.
- Se preservan los controles de pedido inexistente, pago aprobado e importe coincidente, con logs genéricos en este flujo.
- Verificación: sintaxis correcta y pruebas aisladas de pedido inexistente, ya pagado, importe distinto, pago no aprobado, transición exitosa y dos webhooks concurrentes con una sola actualización efectiva.

### 2026-06-24 — DEC-010 aceptada

- Se definió la estrategia de transición atómica `pending` → `paid`: actualización condicional desde el backend con Supabase, idempotencia por estado, manejo de pedido inexistente, importe diferente y pago no aprobado.
- DEC-010 quedó aceptada y T-003 está desbloqueada para su implementación.

### 2026-06-24 — T-001 completada

- Se implementó la validación oficial HMAC-SHA256 de Mercado Pago antes de procesar el webhook, usando `x-signature`, `x-request-id`, `data.id` y `MERCADO_PAGO_WEBHOOK_SECRET` según DEC-009.
- Las firmas ausentes o inválidas reciben HTTP `401` con una respuesta genérica y únicamente los logs autorizados; una firma válida conserva el flujo existente.
- Verificación: sintaxis correcta y pruebas aisladas de firma ausente, inválida y válida, sin cargar `.env`, realizar llamadas externas ni mostrar datos sensibles.

### 2026-06-24 — DEC-009 definida

- Se definieron la variable `MERCADO_PAGO_WEBHOOK_SECRET`, la respuesta HTTP `401` con mensaje genérico y las restricciones de exposición y logs para firmas ausentes o inválidas.
- DEC-009 quedó definida y T-001 está desbloqueada para su planificación e implementación.

### 2026-06-24 — T-004 completada

- El inicio valida las cuatro variables obligatorias antes de crear clientes externos o aceptar tráfico; los valores ausentes o vacíos detienen el proceso mostrando solo sus nombres.
- Archivos modificados: `index.js`, `docs/TASKS.md` y `docs/PROGRESS.md`.
- Verificación: sintaxis correcta y pruebas aisladas de variable ausente, vacía y configuración completa, sin cargar `.env` ni realizar llamadas externas.

### 2026-06-24 — T-002 completada

- Se detiene `POST /crear-preferencia` si Supabase no puede crear el pedido `pending`; el cliente recibe un error HTTP genérico y Mercado Pago no es llamado.
- Archivos modificados: `index.js`, `docs/TASKS.md` y `docs/PROGRESS.md`.
- Verificación: sintaxis de Node.js y pruebas aisladas en memoria de los flujos fallido y exitoso; sin llamadas externas ni acceso a secretos.

### 2026-06-24 — Enriquecimiento de documentación para Codex

- Objetivo: completar el formato de tareas, formalizar decisiones pendientes y actualizar la bitácora.
- Tipo de sesión: revisión documental y edición de Markdown. Sin ejecución de código, instalación de dependencias ni acceso a secretos.
- Archivos revisados: `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/REQUIREMENTS.md`, `docs/DESIGN.md`, `docs/TASKS.md`, `docs/PROGRESS.md`, `docs/DECISIONS.md`, `docs/SKILLS.md`, `docs/SECURITY.md`.
- Archivos modificados: `docs/TASKS.md`, `docs/DECISIONS.md`, `docs/PROGRESS.md`.
- Cambios realizados:
  - `docs/TASKS.md`: cada tarea (T-001 a T-014) recibió los campos `Estado`, `Prioridad`, `Archivos involucrados`, `Instrucciones para Codex`, `Riesgos` y `Resultado esperado`. Los criterios de aceptación existentes se conservaron sin modificación.
  - `docs/DECISIONS.md`: la lista libre "Decisiones pendientes" fue convertida en nueve entradas formales (DEC-009 a DEC-017), cada una con contexto, opciones a evaluar y estado `pendiente`. Las decisiones vigentes D-001 a D-008 no fueron modificadas.
  - `docs/PROGRESS.md`: se agregó esta entrada de bitácora.
- Inconsistencias detectadas y registradas:
  - Las tareas no tenían los campos requeridos por el formato de `CLAUDE.md`.
  - Las decisiones pendientes existían como lista libre sin estructura DEC-XXX.
  - T-003 referenciaba una decisión en `DECISIONS.md` que no existía formalmente; ahora existe como DEC-010.
- Decisiones tomadas: ninguna decisión de código. Solo formalización de documentación existente.
- Pendientes: las nueve decisiones (DEC-009 a DEC-017) requieren confirmación del usuario antes de que Codex pueda implementar las tareas relacionadas.
- Próximos pasos: ver sección "Próxima acción recomendada".

### 2026-06-24 — Base documental para agentes

- Objetivo: crear contexto estable para agentes sin modificar código.
- Revisión: estructura, README, package.json, backend, frontend, integración de pagos, webhook y persistencia.
- Archivos: `README.md`, `AGENTS.md` y documentos bajo `docs/`.
- Resultado: arquitectura, requisitos, tareas, decisiones, procedimientos y seguridad quedaron documentados.
- Verificación: revisión estática; sin ejecución, instalación, cambios de configuración ni acceso a secretos.

### Plantilla para futuras sesiones

```markdown
### AAAA-MM-DD — Título breve

- Objetivo:
- Tarea relacionada:
- Archivos afectados:
- Cambios realizados:
- Verificaciones:
- Resultado:
- Pendientes o riesgos:
```
