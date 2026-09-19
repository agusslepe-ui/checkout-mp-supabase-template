# Seguridad

## DEC-027 — controles para reconciliación de `unknown`

- `unknown` nunca se reintenta automáticamente. La ausencia inmediata en MiCorreo no autoriza requeue.
- La verificación manual usa la correlación estable `ext_order_id = orders.external_reference`; su valor no se registra en documentación ni logs ordinarios.
- Si el envío existe, no se repite `/shipping/import`; la RPC local permite `unknown → created`. No inventa `provider_created_at`; `imported_at` representa confirmación local.
- Si una persona confirma que no existe, la segunda RPC local permite exclusivamente `unknown → queued`. Mientras haya duda, permanece `unknown` sin pasar automáticamente a `failed`.
- `shipping:process-once` no es herramienta de reconciliación y nunca debe usarse con ese fin.
- La interfaz local es backend/admin only, no pública, condicional e idempotente desde `unknown`; no puede alterar otros estados, resetear attempts, cambiar correlación o reconstruir snapshots.
- Ambas RPC son `SECURITY INVOKER`, fijan `search_path`, revocan EXECUTE a `PUBLIC`/`anon`/`authenticated` y lo conceden sólo a `service_role`. El CLI exige doble guarda antes de cargar configuración o Supabase.
- La tabla append-only de 011 tiene RLS, cero policies y sólo `SELECT, INSERT` para `service_role`; no concede UPDATE ni DELETE. Registra UUID, order ID interno, códigos controlados, estados, attempt y fecha, sin PII, payload, respuesta provider, token, customerId ni correlación externa.
- Los logs se reconstruyen por allowlist. `no_change` e invocaciones inválidas terminan con exit 1 para exigir revisión humana. La migración no fue aplicada ni validada contra PostgreSQL real.
- Política A: el máximo de 4 limita retries automáticos, no autorizaciones humanas. Requeue preserva `attempt_count` y habilita exactamente un claim adicional; nunca renueva presupuesto ni resetea el contador. Attempt 5 retryable termina por límite; attempt 5 ambiguo vuelve a `unknown` y exige otra confirmación/evento antes de cualquier nueva requeue.
- El reload de schema PostgREST está dentro de 011 inmediatamente antes de commit. No amplía grants ni convierte las RPC en públicas; sólo solicita actualizar el cache tras el futuro cutover.

## T-022.6-C — aislamiento productivo del proceso

- EasyPanel ejecuta web y shipping worker como servicios separados desde el mismo repositorio.
- `Dockerfile` conserva `npm start`; `Dockerfile.worker` no expone puerto y ejecuta sólo `npm run shipping:worker`.
- `SHIPPING_IMPORT_WORKER_ENABLED=true` está configurada únicamente en el servicio worker. Variables y secretos se inyectan externamente y no forman parte de la imagen ni de esta evidencia.
- El despliegue aislado fue validado en producción sin registrar PII, IDs de pago, referencias externas, direcciones, contactos, tokens, customerId o secretos.

## T-022.6-B — aislamiento y límites operativos

- El proceso automático requiere el valor exacto `SHIPPING_IMPORT_WORKER_ENABLED=true`; esta variable y el intervalo no son obligatorios para el servidor web.
- La composición real se carga sólo después de validar guarda e intervalo. No se duplica cliente Supabase, repositorio, servicio o provider.
- Logs allowlisted: estado de proceso, intervalo, outcome, orderId, attemptCount y contador de errores. Nunca error crudo, stack, PII, extOrderId, payload, body, customerId, JWT o claves.
- No hay endpoint HTTP, cron dentro de Express, `setInterval`, loop de drenaje ni expire automático.
- La exclusión local evita overlap; la exclusión entre procesos permanece en DB mediante lock/lease. No se agregan privilegios, tablas, RPC o migraciones.
- Fatal no llama `process.exit` desde core ni durante provider/DB activos: el entrypoint termina sólo tras limpiar el ciclo, y el callback se emite una vez.
- Shutdown bloquea nuevos ciclos y espera como máximo 30 s. Un timeout registra `shutdown_timeout`, no `stopped`, conserva exit 1 y no cancela artificialmente el POST; el transporte mantiene su timeout propio.
- La operación productiva sostenida validó polling de 60 s, múltiples `outcome=idle` y una importación automática HOME Classic que terminó `created` en attempt 1, sin retry ni estados ambiguos.

## T-022.6 — evidencia productiva minimizada

- El cierre registra sólo estados, attempt, limpieza de lease, presencia de timestamps, resultado del provider y dimensiones QA.
- Se excluyen PII del destinatario, IDs de Mercado Pago, referencias de order/provider, direcciones, emails, teléfonos, JWT, customerId, payloads, bodies y secretos.
- La ejecución fue manual, one-shot y con doble guarda. No se habilitó endpoint, scheduler, cron o polling.
- Un resultado `unknown` continúa siendo no repetible manualmente sin reconciliación; el caso validado terminó inequívocamente en `created`.
- La prueba real de Classic no autoriza Express, tracking, labels ni perfiles físicos definitivos.

## T-022.6-A — guardas y salida CLI

- La ejecución manual requiere simultáneamente `--execute` y `SHIPPING_IMPORT_MANUAL_EXECUTION=true`. La variable es opcional para el arranque normal y no forma parte de `npm start`.
- El worker se carga de forma diferida después de ambas guardas; una invocación bloqueada no inicializa configuración, Supabase ni provider.
- La salida se reconstruye con campos permitidos: outcome, orderId, attemptCount y count. Nunca serializa excepciones, resultado completo, PII, extOrderId, payload, body, tokens o claves.
- Errores inesperados muestran sólo `errorType=unexpected_error` y exit 1. No se usa `console.log`, `console.error`, `JSON.stringify(error)` ni stack.
- Durante la carga real del CLI se suprime únicamente el diagnóstico startup de presencia/longitud/hash del secreto webhook; `npm start` conserva su comportamiento histórico.
- No existe endpoint HTTP, scheduler, cron, polling o activación al startup. `process-once` se ejecutó una única vez de forma controlada; `expire-once` no se encadenó.

## T-022.5 — prioridad financiera y privilegios mínimos

- La RPC v2 desplegada es `SECURITY INVOKER`, usa `search_path = pg_catalog, public` y revoca `EXECUTE` a `public`, `anon` y `authenticated`; sólo `service_role` recibe ejecución.
- No se agregan grants de tablas. La RPC retorna sólo `order_id`, estado financiero y `shipping_queued`; no expone PII ni el snapshot.
- El lock y las condiciones de estado quedan en PostgreSQL. La ausencia o anomalía logística no impide registrar un pago válido; tampoco crea snapshots tardíos ni muta trabajos que no estén `not_requested`.
- Migración 010 y paid+queue validados en producción. `/shipping/import` fue validado mediante one-shot controlado y posteriormente mediante worker automático aislado.

## T-022.4 — worker durable consumido por el proceso aislado

- Sólo retorna outcome, order ID y attempt count; nunca snapshot, PII, extOrderId, payload, body o secretos.
- No agrega logs. Los códigos persistidos son allowlisted/cortos (`auth`, `timeout`, `internal_error`, etc.), sin stack ni mensaje externo.
- Normaliza `numeric` sólo con tipo number válido o regex decimal canónica; rechaza exponentes, whitespace, booleanos, null, colecciones, infinidades y negativos.
- Un resultado incierto se marca unknown y nunca retryable. La falla de renovación posterior a POST 401 conserva `previousRequestAttempted` y se trata conservadoramente.
- Un segundo POST 401 también termina unknown: no se presupone ausencia de efectos externos, no se agenda retry y no existe tercera llamada.
- Lease perdido no dispara una segunda transición. Una falla de persistencia deja actuar al recovery de lease existente.
- No hay timer, loop, cron, env nueva, ruta pública, webhook ni activación desde `index.js`.

## T-022.3 — límites de datos y transporte

- `customerId` se toma sólo de configuración backend; nunca de order/frontend y no se registra.
- El payload contiene correlación estable, recipient mínimo, destino requerido y snapshot físico/económico. No inventa tracking, shipment ID, label, cancelación o webhook.
- No se loguean payload/response, PII, domicilio, customerId o JWT. La capa nueva no agrega logs.
- Validaciones permanentes y bloqueo de Express ocurren antes de red. El único retry interno es la renovación ante 401, reutilizando payload/extOrderId.
- Timeout/red/5xx posteriores al POST y 2xx inválido se marcan ambiguos; no se reintentan automáticamente.
- No hay endpoint ni integración automática del worker. El transporte tuvo una única validación real HOME Classic mediante CLI controlado.
- Corrección posterior a auditoría: se eliminaron coerciones de tipos, se valida calendario real, los errores internos no se etiquetan como red y el timeout específico requiere opt-in del import. Token/rates/agencies conservan su error histórico.
- Auditoría independiente: **APROBADO CON OBSERVACIONES**, sin bloqueantes. T-022.4 debe tratar conservadoramente el historial de un POST que respondió 401 si luego falla la renovación, y normalizar `numeric` exclusivamente en el borde de persistencia con una regla explícita.

## T-022.2 — seguridad productiva de la infraestructura logística

- `order_shipping_imports` tiene RLS habilitado y cero policies. La migración 009 revoca explícitamente defaults de `PUBLIC`, `anon`, `authenticated` y `service_role`; luego concede a `service_role` solo SELECT, INSERT y UPDATE sobre las columnas operativas. IDs, correlación, perfil, declared value y `created_at` no son actualizables por ese rol.
- Todas las RPC nuevas son `SECURITY INVOKER`, fijan `search_path = pg_catalog, public`, revocan ejecución amplia y conceden EXECUTE solo a `service_role`.
- El claim usa bloqueo de fila y lease. Toda finalización exige order, estado `processing`, token coincidente y lease vigente; un worker obsoleto no puede escribir. Lease expirado pasa a `unknown` para evitar un retry ciego potencialmente duplicado.
- El snapshot copia PII de entrega solo al devolver un claim backend; la tabla logística persiste exclusivamente correlación, perfil, valor declarado y estado operativo. No expone endpoint público ni datos al navegador.
- La RPC paid+queue evita separar la confirmación financiera de la creación del trabajo. Está conectada al webhook y fue validada con un pago real; Mercado Pago conserva la autoridad financiera.
- La verificación productiva confirmó 009 aplicada, cero policies públicas, denegación a `anon`/`authenticated`, grants columna por columna, EXECUTE exclusivo de `service_role`, claim/lease y rollback transaccional real. No hubo backfill.
- Las orders legacy sin fila logística pueden confirmarse financieramente sin inventar snapshots; requieren tratamiento logístico operativo separado.
- `/shipping/import` fue validado manualmente y después mediante worker automático para Classic. Express y reconciliación de `unknown` quedan bloqueados hasta tareas posteriores; tampoco se declaran tracking, labels o perfiles físicos definitivos.

## Post-pago UX — cleanup frontend no autoritativo

- `/success` elimina únicamente `lemont.cart` y `lemont.checkoutAttempt.v1`; no enumera ni limpia el resto de local/session storage.
- No lee query params, IDs ni PII; no hace requests a backend, Mercado Pago o Supabase y no modifica `orders`. El webhook sigue siendo la autoridad exclusiva del pago.
- Los fallos de storage se contienen por operación para no romper la página ni impedir el segundo intento de cleanup.
- Riesgo aceptado: una navegación manual a `/success` borra carrito/attempt sin verificar pago. El QA productivo confirmó el comportamiento y se acepta en esta etapa; una protección futura mediante flag de `sessionStorage` queda como mejora no bloqueante.
- La implementación fue auditada por Grok, enviada al repositorio, desplegada en EasyPanel y validada manualmente en navegador real el 2026-09-17. Estado: COMPLETADO / DESPLEGADO / VALIDADO EN PRODUCCIÓN.

## T-017 — hardening READY + order `paid` productivo

- Un intento READY cuya order ya está `paid` devuelve 409 `checkout_attempt_already_paid`; no expone ni reutiliza `checkout_url` ni preference id.
- La comprobación usa el snapshot persistido ya cargado y ocurre antes de MiCorreo, creación de order/attempt, claim/recovery y Mercado Pago. No modifica el intento ni la order pagada.
- El frontend elimina solo `lemont.checkoutAttempt.v1`; no borra `lemont.cart`, no redirige y muestra `Esta compra ya fue pagada.`. Los demás conflictos 409 mantienen su tratamiento anterior.
- Verificación local: 380/380 tests, 9 suites, 0 fallos. La corrección fue desplegada y validada después con una `checkout_attempt` real en `ready` y una order `paid`: HTTP 409 controlado, sin nueva order/preference ni mutaciones. T-017 está COMPLETADA / VALIDADA EN PRODUCCIÓN.

## T-017.4 — hallazgo real de default privileges / migración 008

- La migración 007 fue aplicada en producción. RPC 26, RPC v2 y claim fueron verificados con `SECURITY INVOKER`, `search_path` fijo y EXECUTE solo para postgres/`service_role`.
- RLS está habilitada, no existen policies públicas y `anon`/`authenticated` no tienen SELECT sobre `checkout_attempts`.
- Hallazgo: los default privileges efectivos otorgaron a `service_role` DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE y UPDATE de tabla, además de UPDATE sobre todas las columnas. Los tests estáticos no representaban el estado efectivo de producción.
- Corrección manual productiva: tabla solo SELECT/INSERT, sin DELETE/TRUNCATE/TRIGGER/REFERENCES/UPDATE general; UPDATE limitado a `state`, `mercadopago_preference_id`, `checkout_url`, `lease_token`, `lease_expires_at`, `updated_at`; sequence solo USAGE, sin SELECT/UPDATE.
- La migración 008 reproduce este estado mediante REVOKE ALL seguido de grants mínimos. Es idempotente respecto del estado corregido y no toca RPCs, claim, tablas ni constraints.
- La 008 fue AUDITADA / APROBADA CON OBSERVACIONES, pusheada y APLICADA EN PRODUCCIÓN, sin hallazgos críticos. La 007 permaneció intacta.
- Observaciones no bloqueantes: el hash test de 007 depende de LF/CRLF; no hay asserts explícitos de `BEGIN`/`COMMIT`; 008 no necesita `NOTIFY pgrst`; endurece solo `service_role`; y el archivo estaba untracked durante `git diff --check`.
- Suite histórica del hardening de privilegios: **377/377 tests**, 9 suites, 0 fallos. Producción ejecuta runtime T-017 mediante RPC v2; RPC 26 permanece disponible. La idempotencia durable y el caso READY + order `paid` quedaron validados posteriormente.

## T-017.4-A — auditado / APROBADO CON OBSERVACIONES

- La migración 007 no elimina ni redefine `create_pending_order_with_items` de 26 parámetros; esto mantiene operativo el runtime T-021 durante la ventana SQL→deploy.
- `create_pending_order_with_items_v2` contiene el contrato idempotente de 27 parámetros, usa `SECURITY INVOKER`, `search_path = pg_catalog, public` y revoca `EXECUTE` a `PUBLIC`, `anon` y `authenticated`; solo `service_role` recibe ejecución.
- La v2 inserta order, items y attempt en una transacción. La UNIQUE de `checkout_attempt_id` sigue provocando rollback completo y no se oculta con `ON CONFLICT`.
- RLS, privilegios por columna, coherencia de estados/lease y `claim_checkout_attempt` permanecen sin relajación. `markOrderAsPaid`, webhook y HMAC no cambian.
- Rollback compatible: antes del deploy, continuar con T-021/RPC 26; ante fallo del deploy nuevo, restaurar el deployment anterior. No hay comandos destructivos ni rollback SQL automático.
- La RPC 26 solo se retirará mediante una migración futura separada después de estabilidad y QA; no está creada en esta fase.
- Estado histórico previo al cutover: **372/372 tests**, 9 suites, 0 fallos. El estado vigente de 007 y privilegios está documentado en la sección superior.
- Auditoría sin hallazgos críticos: RPC 26 permanece intacta; v2 conserva 27 parámetros con UUID primero; `orders.js` usa exclusivamente v2; claim, RLS y privilegios mínimos continúan seguros.
- Observaciones no bloqueantes históricas: se respetó el orden 007 antes de Node T-017 y el QA real confirmó reutilización del mismo intento, nueva identidad ante cambio de intención y ausencia de duplicado ante doble clic/retry normal. En ese corte todavía quedaba pendiente READY + order `paid`; fue cubierto y corregido en el cierre productivo posterior.
- Orden de seguridad obligatorio: precheck → 007 → esperar/verificar reload PostgREST → comprobar RPC 26/v2/permisos → deploy → smoke QA → idempotency QA → payment QA → cleanup futuro separado.

## T-017.3 — UUID y digest frontend local

- `checkoutAttemptId` se genera únicamente con `crypto.randomUUID()`; no se acepta desde parámetros externos ni se usa `Math.random`.
- El digest usa SHA-256 de una identidad canónica mediante Web Crypto. Solo decide reutilización local; no reemplaza el matching autoritativo backend.
- `sessionStorage` persiste exactamente versión, UUID y digest bajo `lemont.checkoutAttempt.v1`; no contiene nombre, email, teléfono, domicilio, carrito ni notas en claro.
- Ni UUID, digest, PII ni body completo se registran. `intentDigest` nunca se envía al backend.
- Records corruptos/inválidos se descartan. Mismatch elimina solo el attempt; errores temporales lo conservan para recovery.
- Sin Web Crypto no se envía el checkout. No existe retry automático.
- T-017.3 está completada localmente, auditada y APROBADA CON OBSERVACIONES. Verificación final: **369/369 tests**, 9 suites, 0 fallos; `npm test`, sintaxis frontend y `git diff --check` correctos.
- Observaciones históricas de auditoría: normalización rara de espacios, sort de SKU, cobertura nominal de HTTP 500/storage y límites de los tests VM. La reutilización READY + order `paid` fue cerrada mediante QA productivo; la limpieza segura posterior al retorno continúa pendiente fuera de T-017.
- La 007 y la 008 están aplicadas; T-017.3 fue desplegada con el runtime T-017. La idempotencia durable está activa en producción y RPC 26 se conserva.

## T-017.2 / DEC-022 — completada / auditada

- `checkoutAttemptId` es un UUID de idempotencia, no un secreto; el dominio exige formato canónico y normaliza lowercase.
- `checkout_attempts` no duplica cliente, domicilio ni otra PII. RLS está habilitada y no se crean policies para `anon`/`authenticated`.
- Se revoca acceso de `PUBLIC`, `anon` y `authenticated`; `service_role` recibe SELECT/INSERT y UPDATE solo sobre `state`, preference/URL, lease y `updated_at`, además de USAGE de la identity sequence. No recibe DELETE ni UPDATE de `checkout_attempt_id`, `order_id` o `created_at`.
- La RPC v2 ya está productiva y conserva `SECURITY INVOKER`, `search_path` fijo y EXECUTE exclusivo de `service_role`. La RPC 26 permanece temporalmente disponible para rollback.
- La UNIQUE de `checkout_attempt_id` es la barrera durable; solo su constraint exacta convierte `23505` en retry. Otros conflictos no se ocultan.
- El claim es un UPDATE SQL condicional único y usa un lease token generado en backend. Los updates READY/UNKNOWN exigen poseer ese token y limpian la lease; cada transición modifica `updated_at`.
- Retries se validan contra el snapshot persistido y no contra precios actuales. READY no llama dependencias externas. UNKNOWN/lease vencida busca por `external_reference` y nunca elige arbitrariamente entre múltiples preferencias.
- El recovery usa `Preference.search` y completa un resultado mediante `Preference.get({ preferenceId: ... })`; el contrato incorrecto detectado en la auditoría inicial fue corregido antes de la aprobación final.
- Respuestas y logs no exponen PII, lease token, SQL, access token ni respuestas crudas de Mercado Pago. La recuperación devuelve solo id, referencia exacta y URL HTTPS validada.
- Verificación histórica de T-017.2: **345/345 tests**, 8 suites, 0 fallos; mocks solamente. La 007 fue aplicada posteriormente durante T-017.4 y el frontend productivo ahora envía `checkoutAttemptId`.
- T-017.2 y T-017.3 se desplegaron coordinadamente después de 007; la RPC 26 quedó disponible por compatibilidad.
- Observaciones no bloqueantes: fallback de constraint en texto para `23505`; ventana teórica entre lease vencida e indexación de búsqueda; timeout potencialmente compartido del SDK; SKU sin `trim` adicional; claim concurrente sin prueba SQL real. Recovery y concurrencia reales/controlados quedan obligatorios para T-017.4.

## T-021 / DEC-026 — COMPLETADA / ACEPTADA

- Browser envía provincia ISO al endpoint y solo `shippingAgencyCode` al checkout; nunca customerId, price ni snapshot.
- Backend revalida `/rates` y `/agencies` antes de la RPC. Solo ACTIVE y pickup usable; lista vacía es 200.
- Respuesta pública omite manager, email, phone, JWT, customerId, coordenadas, hours y wrapper crudo.
- Logs permitidos: `agency_lookup_ok`, `agency_lookup_failed`, `agency_selection_invalid`; sin code, provincia, CP, cliente ni body.
- Frontend renderiza datos del provider con `createElement`/`textContent` y descarta respuestas tardías con AbortController + revisiones.
- Migración 006 aplicada; snapshot nullable para historia/HOME, completo y coherente para AGENCY. RPC invoker y privilegios restringidos.
- 276/276 tests con red, Supabase y Mercado Pago simulados. Sin `.env`, SQL real ni llamadas externas.

## T-020 / DEC-025 — COMPLETADA / ACEPTADA

- El navegador envía únicamente `shippingOptionId`; precio de envío, subtotal, total, moneda, provider, service, customerId, origen y dimensiones permanecen bajo autoridad del backend.
- Checkout vuelve a resolver el carrito y a consultar `/rates`. Solo home Classic/Express es cobrable. Agency, IDs manipulados y opciones ambiguas no crean órdenes.
- Carritos de 5+ unidades fallan antes de MiCorreo, RPC y Mercado Pago. Fallos de MiCorreo fallan antes de persistir; una opción desaparecida responde 409.
- Node calcula en centavos. La RPC valida `p_items`, calcula `SUM(quantity * unit_price)`, lo compara con `p_products_subtotal` y valida `p_expected_amount = p_products_subtotal + p_shipping_amount` antes de insertar `orders` y `order_items`; no suma filas ya insertadas de `order_items`.
- Mercado Pago recibe productos + un ítem `Envío`, nunca `shipments`. El webhook/HMAC no fue modificado y compara exclusivamente contra `orders.amount` y `orders.currency`.
- La migración 005 mantiene snapshots históricos en null, restringe valores cobrables y conserva RPC `SECURITY INVOKER`, `search_path` fijo y `EXECUTE` solo para `service_role`. Fue aplicada en el despliegue T-020 informado.
- Tests 242/242 con dotenv, Supabase, Mercado Pago y red simulados. No se leyeron secretos ni se hicieron llamadas reales.
- Pago real validado el 2026-09-17: shipping incluido, webhook procesado y orden `pending → paid`. La idempotencia durable T-017 cubre el doble checkout normal y el caso específico READY con order ya `paid`, validado posteriormente con 409 sin efectos secundarios.
- Incidencia de transporte resuelta: DNS apuntaba al VPS anterior y HTTPS presentó inicialmente un certificado no confiable. Tras corregir DNS y regenerar Traefik, Let's Encrypt emitió un certificado válido. Un POST externo sin firma a `/webhook` llegó a Express y fue rechazado correctamente con HTTP 401; la notificación válida posterior de Mercado Pago fue aceptada.
- Riesgos pendientes: perfiles TEMPORAL/QA, credenciales por rotar, falta de stock real y limpieza segura del estado del navegador. Producción comercial bloqueada.

## T-019 / DEC-024 — 2026-09-15 (COMPLETADA / ACEPTADA)

- Cotización dual limitada en backend a 1–4 unidades totales; reutiliza validación/agrupación del carrito. 5+ responde 400 genérico sin MiCorreo.
- Campos del cliente (price, dimensions, customerId, origen, servicio) nunca son autoridad. Perfiles QA validados antes del transporte. No se agregan logs de payloads, wrapper, tokens ni credenciales.
- Normalización solo D/S + CP/EP; campos públicos permitidos y labels controlados. Render de API con textContent/createElement, sin innerHTML; se descartan respuestas tardías tras cambiar CP o carrito.
- Variables opcionales al startup y autenticación/retry de T-018 intactos. Sin cambios a pago, HMAC, webhook, RPC ni migraciones. Sin persistencia de tarifas.
- **211/211 tests** con red mockeada. Sin lectura de `.env` ni llamadas reales. Perfiles TEMPORAL/QA, no dimensiones productivas. CP origen acordado 5465 desde entorno, sin cambio privado.
- Prueba real `POST /rates` PROD: `micorreo_rates_ok options=4`. Origen 5465, destino QA 5400. No se imprimió JWT, password, Basic, Bearer, `customerId` ni respuesta cruda. No se llamó `/shipping/import`. No se creó envío. Envío no cobrado. Perfiles TEMPORAL/QA, no aprobados para producción. Etapa C no implementada.

## T-018 / DEC-023 — 2026-09-14

- Autenticación MiCorreo exportada solo para uso interno: no existe endpoint público de autenticación.
- Variables MiCorreo opcionales al startup; la función comprueba configuración al invocarse, sin registrar valores.
- Token/Basic/user/password/customerId no se muestran en logs ni respuestas HTTP. Los errores de transporte/autenticación se reemplazan por categorías constantes.
- Caché de token solo en memoria, expiración con margen, request en vuelo compartido y retry de tarifas limitado. Concurrencia y timeout cubiertos por tests mockeados.
- Suite completa: 178/178 tests. Los recuentos de secciones anteriores son históricos.
- Prueba real `POST /token` PROD (2026-09-15): `micorreo_auth_ok`. No se imprimió ni persistió JWT, contraseña, Basic Auth ni `customerId`. `/rates` y `/shipping/import` no fueron invocados. Checkout, pagos, webhook y HMAC intactos.

## Estado de seguridad T-016 (2026-09-13)

T-016 COMPLETADA, Pasos 1–4. Las secciones de Etapa 3/5/6A y sus cifras son antecedentes de esos cierres.

- Precio, moneda y total son autoritativos en backend; la RPC genera `external_reference`.
- `maxQuantity: 4` es temporal, no stock ni reserva.
- `lemont.cart` guarda versión 1 y solo SKU + quantity, sin PII. localStorage no es fuente comercial.
- Webhook HMAC + `Payment.get`; importe/moneda se comparan contra el pedido persistido, sin recálculo del catálogo.
- D2-A: vaciado solo manual; preferencia, redirect y `/success` no vacían ni confirman pago.
- DOM seguro en el carrito: datos locales/resumen con `textContent`, no innerHTML.
- Cotización informativa solo 1 SKU × quantity 1, sin envío en el pago.
- Rate limiting e idempotencia durable (DEC-022/T-017) siguen pendientes.
- Deuda npm: 2 moderate + 2 high informadas en T-016 Paso 1; no se ejecutó `npm audit fix`. No se alteran los resultados históricos de 2026-08-21.
- Regresiones: 158/158; frontend validado manualmente, sin tests DOM nuevos.

## Manejo de secretos

- `MERCADOPAGO_ACCESS_TOKEN` y `SUPABASE_SERVICE_ROLE_KEY` son secretos de backend.
- Guardarlos en un gestor de secretos en entornos compartidos o productivos.
- Aplicar privilegio mínimo y separar credenciales de prueba y producción.
- No incluir valores en código, documentación, issues, prompts, logs, capturas ni commits.
- Rotar inmediatamente cualquier credencial que pueda haber sido expuesta.
- No devolver mensajes internos de SDK o base de datos a clientes.

## Reglas para `.env`

- `.env` debe permanecer local e ignorado por Git.
- No abrir ni mostrar `.env` durante revisiones ordinarias.
- `.env.example` debe contener solo nombres y valores vacíos o ficticios.
- Nunca usar variables sensibles en JavaScript servido desde `public/`.
- Las comprobaciones de configuración deben registrar únicamente el nombre ausente.
- Antes de compartir archivos o diagnósticos, comprobar que no incluyan valores interpolados.

## Validaciones importantes

- Validar la firma criptográfica del webhook antes de procesarlo.
- Consultar el pago mediante la API oficial y no confiar solo en el evento.
- Exigir `external_reference` y relacionarla con un pedido existente.
- Confirmar estado aprobado, importe y moneda esperados.
- Hacer atómica e idempotente la transición de estado.
- Validar tipos, presencia y límites de todos los datos de entrada.
- Limitar tamaño de cuerpos JSON y aplicar controles de tasa cuando corresponda.
- Usar HTTPS y una URL estable en producción.
- Mantener producto y precio bajo control del servidor.
- No revelar si una referencia interna sensible existe mediante errores públicos detallados.

## Privacidad de cliente y entrega — Etapa 5

Los datos de cliente y domicilio se usan para preparar el pedido y su futura entrega. Está prohibido registrar nombre, apellido, email, teléfono, provincia, localidad, código postal, calle, número, piso/departamento, referencia o el body completo del checkout. Tampoco deben aparecer en URLs, errores públicos ni mensajes internos expuestos al navegador.

Los errores de validación son genéricos. Una entrada inválida se rechaza antes de consultar Supabase o Mercado Pago. La navegación Producto → Entrega transporta solo `product id`, `sku` y `quantity`. Los pedidos históricos permanecen sin datos inventados porque las columnas de la migración 003 son nullable.

Al cierre de Etapa 5 la suite pasaba **61/61 tests**, incluida una regresión de ausencia de PII. El estado vigente tras Etapa 6A es 75/75.

## Seguridad de cotización MiCorreo — Etapa 6A

- `MICORREO_USER`, `MICORREO_PASSWORD`, JWT y Basic Auth son secretos de backend; nunca se persisten, registran ni envían al navegador.
- Tampoco se registran `customerId`, códigos postales, domicilio, PII, request completo o respuesta completa de Correo Argentino.
- `.env.example` contiene únicamente nombres vacíos. No hay valores reales de MiCorreo en el repositorio.
- Los errores públicos son genéricos y las categorías internas no incluyen datos externos sensibles.
- La suite actual pasa 75/75 e incluye regresiones de ausencia de secretos/PII. El mecanismo de solicitud JWT compartida está implementado; no existe todavía una prueba aislada de concurrencia simultánea.
- T-018 validó `POST /token` PROD (`micorreo_auth_ok`). `/rates` y `/shipping/import` siguen sin prueba real. No confundir tests con mocks con validación de esas rutas.
- Las medidas 300 g / 5 × 25 × 35 cm son temporales de QA y deben reemplazarse antes de producción.

## Riesgos detectados

### Firma del webhook

Mitigado por T-001/DEC-009: el webhook valida `x-signature` y `x-request-id` con `MERCADO_PAGO_WEBHOOK_SECRET` antes de procesar pagos. Mantener el secreto solo en backend y rotarlo si se expone.

**Nota de soporte Mercado Pago (2026-06-26):** los pagos de prueba con credenciales de prueba no envían notificaciones reales firmadas; la vía de prueba recomendada en sandbox es la simulación desde "Tus integraciones". El Webhook Secret es por aplicación y por modo (pruebas vs productivo): usar el secret del modo correcto. Para el manifiesto HMAC, `data.id` proviene de query params (`data.id_url` en la documentación); si falta algún valor del template, debe excluirse antes del cálculo, no incluirse como cadena vacía. No desactivar la validación de firma bajo ninguna circunstancia sin DEC formal previa.

### Pago sin pedido interno

Mitigado por T-002: si Supabase no puede crear el pedido `pending`, el backend no crea la preferencia de Mercado Pago y responde con un error genérico.

### Condición de carrera

Mitigada por T-003/DEC-010: la transición `pending → paid` es condicional e idempotente; webhooks duplicados o concurrentes no vuelven a marcar el pedido.

### Manejo monetario

La comparación de importes del webhook está mitigada por T-007/DEC-011: ambos valores se normalizan a centavos con `Math.round(Number(valor) * 100)` antes de comparar y la moneda se valida contra `order.currency`. Mantener esta regla si se agregan productos o precios con centavos.

### Clave privilegiada de Supabase

La clave `service_role` puede evitar controles de RLS según la configuración. Su exposición o uso excesivo tendría alto impacto.

### Logs detallados

Mitigado por T-010/DEC-017: el backend emite logs JSON mediante `log(level, event, extra)` con campos permitidos y correlación por `request_id`. No se deben registrar headers completos, bodies, payloads de Mercado Pago, firmas, importes, `external_reference` completa ni datos personales.

### Configuración y diagnóstico de desarrollo

`GET /webhook` está restringido a entornos no productivos mediante `NODE_ENV !== "production"`. Los logs verbosos, ngrok y cualquier otro diagnóstico siguen siendo útiles localmente, pero deben eliminarse, restringirse o sustituirse en producción.

### Criterio de diagnóstico seguro de firma webhook

Si en algún diagnóstico futuro se necesita inspeccionar el procesamiento de `x-signature`, aplica el siguiente criterio sin excepción:

**Permitido en logs de diagnóstico:**
- `has_x_signature` — booleano, indica presencia del header.
- `x_signature_length` — entero, longitud en caracteres.
- `x_signature_sha256_prefix` — string de 8 caracteres del SHA-256 del valor completo.
- Mismos tres campos para `v1`, `x-request-id`, `data.id` y `ts`.

**Prohibido en cualquier log o mensaje:**
- Valor completo de `x-signature`.
- Valor completo de `v1` (HMAC calculado).
- Valor completo de `x-request-id`.
- Valor completo de `data.id`.
- Cualquier secret o access token (completo o parcial, salvo el SHA-256 prefix corto del secret en diagnóstico de startup ya documentado).

Este criterio aplica a Codex, a diagnósticos temporales y a cualquier código de diagnóstico futuro. Nunca se relaja en ningún entorno.

### Diagnóstico temporal en staging

Durante la investigación del webhook HMAC 401 en staging, se agregó código de diagnóstico temporal a dos módulos:

- **`src/webhookSignature.js`**: calcula 4 variantes HMAC candidatas (`query_literal`, `body_literal`, `query_lower`, `body_lower`), fingerprints SHA-256 (8-char prefix) de componentes individuales del manifiesto (`queryDataId`, `bodyDataId`, `x-request-id`, `ts`) y variantes de formato de manifiesto. Los logs exponen solo booleanos de coincidencia y nombre de variante; nunca valores completos, secreto, firma ni manifiesto.
- **`src/config.js`**: al arrancar el servicio, emite `event="diagnostico webhook secret"` con presencia, longitud y prefijo SHA-256 de 8 caracteres del secreto. Nunca emite el valor completo.

**Obligación**: este código de diagnóstico temporal debe retirarse antes de avanzar a producción real. No es un riesgo en staging (los valores nunca se exponen), pero aumenta la superficie de logs y debe limpiarse.

### Credenciales de prueba expuestas en sesión de diagnóstico

Durante la sesión de diagnóstico del 2026-06-26, el Access Token de prueba de Mercado Pago y el Webhook Secret de prueba fueron compartidos en el chat de la sesión.

**Scope del riesgo**: solo credenciales de prueba (sandbox). No se expusieron credenciales productivas. Sin embargo, las credenciales compartidas en chat pueden quedar en historial, por lo que la rotación es obligatoria antes de continuar.

**Acciones requeridas antes de continuar con cualquier prueba:**
1. Regenerar el Access Token de prueba en el panel de desarrolladores de Mercado Pago.
2. Regenerar el Webhook Secret de prueba en el panel de Webhooks de Mercado Pago.
3. Actualizar las variables `MERCADOPAGO_ACCESS_TOKEN` y `MERCADO_PAGO_WEBHOOK_SECRET` en EasyPanel con los nuevos valores.
4. Verificar que el staging sigue funcionando después de la rotación.

**No pasar a producción** con credenciales de prueba expuestas. No usar las mismas credenciales que se usaron en la sesión de diagnóstico.

### Credenciales productivas expuestas en capturas/chats

Durante la sesión de cierre del 2026-06-26, el Access Token productivo y el Webhook Secret productivo de Mercado Pago fueron visibles en capturas de pantalla o mensajes del chat de la sesión.

**Scope del riesgo**: credenciales productivas reales. Alcance máximo: cualquier actor que acceda al historial del chat puede usar el Access Token para realizar pagos, reembolsos o consultas en la cuenta real de Mercado Pago del usuario.

**Acción obligatoria antes de continuar en producción:**
1. Revocar y regenerar el Access Token productivo en el panel de desarrolladores de Mercado Pago.
2. Revocar y regenerar el Webhook Secret productivo en "Tus integraciones" de Mercado Pago.
3. Actualizar `MERCADOPAGO_ACCESS_TOKEN` y `MERCADO_PAGO_WEBHOOK_SECRET` en EasyPanel con los nuevos valores.
4. Verificar que el flujo productivo sigue funcionando después de la rotación.

**Estado al 2026-08-22:** la rotación todavía no se realizó. Las credenciales actuales se utilizaron para una verificación productiva privada/controlada y quedan restringidas a esa etapa. No declarar la tienda lista para clientes reales ni realizar el lanzamiento público hasta completar la rotación y volver a verificar el flujo.

La rotación final obligatoria incluye:

1. `MERCADOPAGO_ACCESS_TOKEN`.
2. `MERCADO_PAGO_WEBHOOK_SECRET`.
3. Credencial privada de Supabase usada por el backend.

### Variable de diagnóstico `MP_SUPPORT_CAPTURE_FULL_WEBHOOK`

Durante la investigación del 401 en staging se agregó la variable de entorno `MP_SUPPORT_CAPTURE_FULL_WEBHOOK` como flag de diagnóstico temporal. Esta variable, si se activa, captura el cuerpo completo del webhook recibido, lo que incluye datos sensibles del pago y del comprador.

**Estado (2026-06-27):** la variable fue usada temporalmente como apoyo de diagnóstico para soporte técnico de Mercado Pago bajo condiciones controladas. Permitió capturar el cuerpo completo del webhook para análisis externo. El nombre correcto de la variable es `MP_SUPPORT_CAPTURE_FULL_WEBHOOK` — no confundir con ninguna variante ortográfica incorrecta (como `MP_SUPPORT_CAPTURE_FULL_WEBPACK`).

**Estado (2026-08-20): retirada.** Se eliminó de `src/app.js` la lectura de la variable, la captura de la URL y los headers completos, y la llamada desde `POST /webhook`. Configurar el nombre histórico de la variable ya no activa ningún comportamiento. Una prueba de regresión verifica que no reaparezcan el evento ni los campos de captura, permitiendo a la vez el uso normal de `request_id` en logs estructurados.

Al cierre del 2026-08-21 se confirmó además que no se registran la firma completa, el `x-request-id` completo ni los nombres de campos de la captura retirada. Las pruebas negativas permanecen activas.

### Auditoría de dependencias (2026-08-21)

- `npm audit` detectó 2 vulnerabilidades high.
- `npm audit fix` actualizó únicamente dependencias transitivas compatibles, sin cambio manual de dependencias directas.
- La auditoría posterior reportó 0 vulnerabilidades conocidas.
- La suite continuó pasando después de la actualización, quedó en 50/50 tras T-015 y en 55/55 después de incorporar variantes por talle.

### Estado de seguridad al cierre de Etapa 3 (2026-08-22)

- La autoridad de precio, moneda, nombre y cantidad máxima permanece en `src/catalog.js`; el cliente envía solo SKU y cantidad fija 1.
- Los cuatro SKUs comerciales tienen `maxQuantity: 1`; el SKU temporal anterior se rechaza.
- `product_sku` y `product_size` fueron agregados como columnas nullable, sin alterar pedidos históricos.
- El precio ARS 1.000 es temporal para pruebas privadas/controladas y debe revisarse antes del lanzamiento comercial.
- No hay stock real, reserva ni control de concurrencia de inventario. No interpretar los SKUs como disponibilidad; esta capacidad requiere una etapa separada.
- La rotación del Access Token y Webhook Secret de Mercado Pago y de la credencial privada/service role de Supabase continúa pendiente y es obligatoria antes del lanzamiento público.
- Las URLs de imágenes de Stitch son temporales; deben reemplazarse por assets propios optimizados antes del lanzamiento.

### Ausencia de controles operativos

Persisten pendientes operativos: no hay rate limiting ni health checks dedicados. Tests automatizados, migración versionada, logs estructurados y rollback de staging están documentados o implementados.

### Pendientes de seguridad post-verificación productiva (2026-06-27)

Tras verificar el flujo productivo completo (2026-06-26), se documentaron tres acciones de seguridad:

1. **Rotar `MERCADOPAGO_ACCESS_TOKEN` productivo**: fue visible en capturas/chats de la sesión de verificación. Revocar y regenerar en el panel de desarrolladores de Mercado Pago. Actualizar en EasyPanel.
2. **Rotar `MERCADO_PAGO_WEBHOOK_SECRET` productivo**: fue visible en capturas/chats. Revocar y regenerar en "Tus integraciones" de Mercado Pago. Actualizar en EasyPanel.
3. **Retirar `MP_SUPPORT_CAPTURE_FULL_WEBHOOK`**: completada en código el 2026-08-20; la variable ya no tiene efecto.

No realizar el lanzamiento público hasta rotar las tres credenciales privadas indicadas y verificar nuevamente el flujo productivo. Los diagnósticos temporales restantes de `src/webhookSignature.js` y `src/config.js` no fueron modificados como parte de la retirada de la captura completa.

## Recomendaciones priorizadas

1. Mantener la validación de firma del webhook y rotar secretos ante exposición.
2. Mantener la creación de preferencia bloqueada si no existe pedido interno.
3. Mantener atómica e idempotente la actualización de pagos.
4. Validar configuración al inicio sin mostrar valores.
5. Mantener la estrategia monetaria segura y la validación de moneda.
6. Mantener logs estructurados con correlación y sin campos prohibidos.
7. Mantener el esquema versionado y revisar restricciones, índices y RLS antes de cambios.
8. Separar entornos y credenciales; usar HTTPS estable en staging y producción.
9. Ejecutar pruebas sin llamadas ni pagos reales.
10. Completar staging en EasyPanel, registrar resultados y definir controles operativos adicionales.

## Respuesta ante exposición

Si aparece un secreto en Git, un log o una conversación:

1. No copiarlo ni volver a publicarlo.
2. Informar al responsable indicando únicamente el nombre de la credencial y el lugar de exposición.
3. Revocar o rotar la credencial desde el proveedor.
4. Revisar accesos y actividad relacionados.
5. Eliminar el valor de los artefactos permitidos sin asumir que eso invalida copias históricas.
6. Registrar el incidente sin incluir el secreto.
