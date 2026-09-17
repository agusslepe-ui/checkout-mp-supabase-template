# Contexto actual del proyecto

## Actualización vigente — producción al 2026-09-17

**DEC-022 ACEPTADA. T-017 EN PROGRESO, CON IDEMPOTENCIA DURABLE ACTIVA EN PRODUCCIÓN. T-020 COMPLETADA Y DEC-025 ACEPTADA. T-021 COMPLETADA Y DEC-026 ACEPTADA.**

Las migraciones 007 y 008 están aplicadas en producción. Se verificaron `checkout_attempts`, la RPC anterior `create_pending_order_with_items` de 26 parámetros, `create_pending_order_with_items_v2` de 27 parámetros, `claim_checkout_attempt`, `SECURITY INVOKER`, `search_path`, RLS y permisos. Los default privileges excesivos de `service_role` se corrigieron manualmente y la 008 aplicada reproduce ese hardening. RPC 26 continúa disponible.

La migración 006 también está aplicada en producción. Las columnas `shipping_agency_*` existen y T-021/DEC-026 están productivas y cerradas.

El runtime T-017 fue desplegado en EasyPanel y usa v2. El QA real confirmó que el mismo intento/intención reutiliza la misma `checkout_attempt`, order y preferencia Mercado Pago; una intención distinta genera un nuevo intento, orden y preferencia; doble clic y retry normal no generaron una orden duplicada. T-017 permanece EN PROGRESO hasta impedir que un attempt `ready` reutilice una preferencia vieja cuando su orden ya está `paid`.

T-020 cerró su paid QA con un pago real y shipping incluido. Tras corregir DNS y HTTPS, Mercado Pago entregó el webhook y la orden pasó de `pending` a `paid`. Esto valida `checkout → shipping incluido → Mercado Pago → pago real → webhook → validación → orders.status=paid`; DEC-025 queda ACEPTADA el 2026-09-17.

Incidencia resuelta: `checkout.lemont01.com` apuntaba a la IP anterior del VPS. Se corrigió al EasyPanel actual, se comprobó el puerto 80 y Traefik regeneró un certificado válido de Let's Encrypt después de un estado inicial no confiable. HTTPS quedó operativo; un `POST /webhook` sin firma llegó a Express y respondió `401 {"error":"Webhook inválido"}`, y la notificación válida posterior fue procesada.

T-021/DEC-026 permanecen cerradas. Continúan pendientes: READY con order ya `paid`; página real de agradecimiento; limpieza segura de carrito/`sessionStorage`; MiCorreo `POST /shipping/import`; stock por SKU; catálogo, imágenes y descripciones dinámicos; perfiles reales; precio comercial; rotación de credenciales expuestas; auditoría npm; y etapas posteriores de dominio/frontend/SEO.

La tienda todavía **NO está lista para lanzamiento comercial**.

## Antecedente T-019 / DEC-024

**T-019 COMPLETADA. DEC-024 ACEPTADA.** Cierre formal 2026-09-15.

Cotización dual items o legacy, resolver común, tope 4 unidades totales, perfiles editables TEMPORAL/QA 1–4 (todos 300/5/25/35), frontend multítem y normalización CP/EP + D/S. Sin selección de agencia ni costo incluido en el pago. Origen CP 5465 — Rodeo, San Juan.

En ese cierre histórico, la suite fue **211/211**, 4 suites. `POST /rates` PROD: `micorreo_rates_ok options=4` (destino QA 5400). Sin `/shipping/import`, sin envío creado, sin cobro. Las medidas actuales **no** están aprobadas para producción. En ese momento el próximo paso era **Etapa C — cobrar el envío** y T-021 todavía estaba solo local; ambos estados fueron superados por los cierres productivos posteriores.

> Resumen compacto para agentes. Última actualización: 2026-09-17. Migraciones 007/008 aplicadas; runtime T-017 desplegado; idempotencia durable activa y QA real satisfactorio; RPC 26 conservada; T-020 cerrada con pago real y DEC-025 aceptada; T-021/DEC-026 cerradas. T-017 sigue en progreso por READY + order `paid`. El estado vigente está en `docs/STATUS.md`.
> Si el chat fue compactado, este archivo es el punto de entrada.
> Metodología: Grok audita y documenta — Codex programa — Usuario aprueba — GitHub guarda.

---

## HISTÓRICO — cortes acumulados del 2026-09-15 y 2026-09-16

> Este bloque conserva el estado de esos cierres y está SUPERADO. No usarlo como estado vigente; prevalece la actualización productiva del 2026-09-17 al inicio del archivo.

### COMPLETADO

- Etapa 5: formulario de cliente y entrega, validación frontend/backend y request `{ sku, quantity, customer, delivery }` sin PII en URL. La migración `003_add_order_customer_delivery.sql` fue aplicada; agregó doce columnas nullable a `orders` sin completar pedidos históricos.
- Etapa 6A: cotización informativa `POST /cotizar-envio` mediante `src/shipping.js` y `src/micorreo.js`, JWT en memoria, timeout, renovación única ante 401 y frontend en `public/js/envio.js`. No suma envío al pedido ni a Mercado Pago.
- Migración `004_create_order_items.sql` aplicada. Existe `public.order_items`, vinculada por FK a `orders.id` con `ON DELETE CASCADE`, y la RPC estricta `public.create_pending_order_with_items(..., p_items jsonb)`.
- El runtime Node crea pedidos nuevos mediante la RPC. Node construye `p_items` desde `src/catalog.js`; PostgreSQL valida, calcula el total, genera `external_reference` y crea atómicamente `orders` + `order_items`.
- Mercado Pago recibe exactamente el `external_reference` devuelto por la RPC. La RPC conserva temporalmente las columnas legacy de producto en `orders` usando el primer item.
- **T-016 Paso 1 COMPLETADO:** dominio autoritativo en `src/cart.js` y `POST /carrito/resumen`. Implementado, corregido, auditado, aprobado y enviado a `main`. Máximo 4 temporal (no es stock). El endpoint no persiste ni cobra.
- **T-016 Paso 2 COMPLETADO:** checkout HTTP multítem con compatibilidad legacy y rechazo explícito de mezcla. Implementado por Codex, auditado (APROBADO CON OBSERVACIONES, solo documentales) y aprobado por el usuario el 2026-09-12. Una orden `pending`, N `order_items`, una preferencia, N ítems de Mercado Pago, un `external_reference`. Cálculo autoritativo en backend; envío no incluido; webhook intacto; sin migraciones. Suite **158/158**.
- **T-016 Paso 3 COMPLETADO:** carrito frontend + `localStorage` (`lemont.cart`, solo SKU + quantity). Página `carrito.html`, contador por unidades, D1-A (Agregar al carrito + Comprar ahora), D2-A (no auto-vaciar), resumen vía `POST /carrito/resumen`, checkout `items[]`. Cotización informativa solo 1 SKU × quantity 1. Auditado (APROBADO CON OBSERVACIONES: QA visual pendiente), QA visual/manual correcto, aprobado el 2026-09-13. Sin backend, webhook ni migraciones. Suite **158/158**.

- **T-016 Paso 4 COMPLETADO:** regresiones 158/158 y documentación alineada con main (2026-09-13). T-016 COMPLETADA; DEC-021 implementada. QA frontend manual, sin tests DOM nuevos.
- **DEC-023 ACEPTADA / T-018 COMPLETADA (2026-09-15):** `ShippingService → ShippingProvider → MiCorreoProvider`. Autenticación interna `authenticate()`, JWT solo en memoria, sin endpoint público. Auditoría: APROBADA CON OBSERVACIONES. Prueba real `POST /token` PROD → `micorreo_auth_ok`. JWT no impreso ni persistido. Suite **178/178** en ese cierre.
- **DEC-024 ACEPTADA / T-019 COMPLETADA (2026-09-15):** cotización informativa multítem (contrato dual, 1–4 unidades totales, perfiles TEMPORAL/QA). Auditoría: APROBADO CON OBSERVACIONES. Prueba real `POST /rates` PROD → `micorreo_rates_ok options=4`. Origen 5465, destino QA 5400. Sin `/shipping/import`, sin envío creado, sin cobro. Suite **211/211**. El envío sigue fuera del total.

### VALIDADO

- La migración 004 y la RPC fueron validadas manualmente en Supabase real: un pedido y su item, total, moneda, estado, columnas legacy, relación y `ON DELETE CASCADE`.
- El runtime local actualizado crea la preferencia, `orders` y `order_items`, y redirige a Checkout Pro.
- El webhook permanece sin cambios: HMAC, validación de importe/moneda, idempotencia y transición atómica `pending → paid` siguen vigentes.
- Último resultado comprobado de tests: **276/276** (T-021 local). T-020 tenía 242/242; T-019 cerró en 211/211; T-018 en 178/178; T-016 en 158/158.
- Incidente QA resuelto: pedidos nuevos aparecieron con `customer_*` y `shipping_*` en `NULL`. Se comprobó una sola RPC activa, firma/permisos correctos y definición/`INSERT` activos correctos. La causa fue una instancia antigua iniciada con `npm start`; tras reiniciar Node quedó cargado el runtime actualizado.

### PENDIENTE

- **DEC-022 ACEPTADA; T-017 EN PROGRESO.** T-017.4 EN EJECUCIÓN: 007 aplicada, hardening manual productivo corregido, 008 preparada/auditada/APROBADA CON OBSERVACIONES; deploy y QA pendientes. Producción sigue en T-021/RPC 26.
- `maxQuantity: 4` está aplicado en `src/catalog.js` como techo **temporal**. **No sustituye stock real.** El stock real será una evolución futura.
- T-021 está implementada localmente; falta auditoría, aplicación controlada de la migración 006 y QA. DEC-026 no está aceptada. El paid QA y cierre de T-020 permanecen separados; DEC-025 tampoco está aceptada.
- Vulnerabilidades npm (2 moderate + 2 high) informadas durante `npm ci`. No se ejecutó `npm audit fix`. Auditarlas en una tarea separada; no forman parte de T-016 Paso 1.
- Correo Argentino: `POST /token` PROD (`micorreo_auth_ok`) y `POST /rates` PROD (`micorreo_rates_ok options=4`) verificados. `/shipping/import` **no** fue llamado. Las medidas `300 g / 5 × 25 × 35 cm` siguen TEMPORAL/QA y **no** están aprobadas para producción.
- Etapa D (crear envío post-pago) permanece pendiente y fuera de T-020.
- Rotar las credenciales privadas documentadas como expuestas antes del lanzamiento público.
- El precio ARS 1.000 sigue siendo temporal de prueba; no es el precio comercial definitivo.

### PRÓXIMO PASO HISTÓRICO — corte 2026-09-15

En el corte del 2026-09-15 el próximo paso era auditar T-021, aplicar la migración 006 y ejecutar QA controlado. Ese plan fue completado posteriormente; las medidas reales de producción continúan pendientes.

**Regla operativa obligatoria:** después de modificar archivos backend/runtime en `src/`, reiniciar el proceso Node antes de realizar pruebas manuales.

---

## Antecedente: Etapa 6A local — cotización informativa MiCorreo

La Etapa 6A implementa `Entrega → Calcular envío → POST /cotizar-envio → validación backend → shipping.js → micorreo.js → JWT → POST /rates → normalización → opciones informativas`. El frontend envía únicamente `sku`, `quantity` y `postalCodeDestination`. El backend aporta autoritativamente `customerId`, CP de origen, peso y dimensiones; el navegador no controla precios de envío, `productType` ni total.

Se agregaron `src/micorreo.js`, `src/shipping.js` y `public/js/envio.js`. `.env.example` declara sin valores `MICORREO_BASE_URL`, `MICORREO_USER`, `MICORREO_PASSWORD`, `MICORREO_CUSTOMER_ID` y `SHIPPING_ORIGIN_POSTAL_CODE`. No hay credenciales MiCorreo reales en el repositorio.

El JWT se obtiene con Basic Auth, se conserva solo en memoria, se reutiliza con margen de expiración, comparte la solicitud en curso, se renueva una sola vez ante 401 y usa timeout. Ningún token, credencial, `customerId`, CP, domicilio, PII, request completo ni respuesta completa se registra en logs.

Las medidas `300 g × 5 × 25 × 35 cm` están marcadas como **TEMPORALES / QA** y no representan el paquete real. Deben sustituirse antes de producción. La cotización no cambia `orders.amount`, Mercado Pago, Supabase, webhook, HMAC, DEC-019, T-015 ni `pending → paid`.

Estado histórico al cierre de Etapa 6A: **IMPLEMENTADA Y TESTEADA LOCALMENTE; PENDIENTE DE CREDENCIALES Y VALIDACIÓN CONTRA MICORREO QA**. Al cierre de esa etapa la suite pasaba 75/75. Ese pendiente quedó superado después: T-018 `POST /token` PROD → `micorreo_auth_ok`; T-019 `POST /rates` PROD → `micorreo_rates_ok options=4`. `/shipping/import` sigue sin prueba real.

### Antecedente: Etapa 5

La Etapa 5 incorpora los datos del cliente y del domicilio antes de iniciar Mercado Pago. El flujo implementado es `Producto → selección de talle → Continuar → entrega.html → datos del cliente y domicilio → validación → POST /crear-preferencia → pedido pending → Checkout Pro → webhook → paid`.

`entrega.html` está implementada y funcional. Requiere nombre, apellido, email, teléfono, provincia, localidad, código postal, calle y número; piso/departamento y referencia de entrega son opcionales. Producto transporta hacia Entrega únicamente `product id`, `sku` y `quantity`, sin PII en la URL. El request de creación de preferencia contiene solo `sku`, `quantity`, `customer` y `delivery`; el backend conserva la autoridad sobre producto, variante, precio, moneda, cantidad máxima, total, estado y `external_reference`.

La migración `supabase/migrations/003_add_order_customer_delivery.sql` fue aplicada correctamente. Sus doce columnas de cliente y destino son nullable, los pedidos históricos no fueron alterados y los pedidos nuevos guardan producto, SKU, talle, cliente, domicilio, `shipping_country_code = AR` y estado `pending`. Se verificó manualmente `Producto → Entrega → Supabase` y la creación del pedido `pending`. La prueba productiva específica posterior a Etapa 5 —datos nuevos → pago real → webhook → `paid`— permanece pendiente.

Al cierre de Etapa 5 la suite pasaba **61/61 tests**, 1 suite y 0 fallos. Esa cifra queda como antecedente; el último resultado histórico documentado previo a las correcciones es 79/79.

### Antecedente: Etapa 3

La Etapa 3 incorporó la Remera LEMONT con variantes inequívocas por talle: `LEM-REM-001-S`, `LEM-REM-001-M`, `LEM-REM-001-L` y `LEM-REM-001-XL`. El SKU temporal `REMERA-LEMONT-001` fue retirado y se rechaza. El frontend exige seleccionar S, M, L o XL antes de habilitar Comprar y envía únicamente `{ sku, quantity: 1 }`; precio, moneda, nombre, talle, importe, referencia y estado no provienen del cliente.

La migración `supabase/migrations/002_add_order_product_variant.sql` fue aplicada y verificada. Agregó `product_sku text` y `product_size text` como columnas nullable, sin completar ni alterar pedidos históricos. Los pedidos nuevos persisten SKU y talle. Se verificaron manualmente las cuatro variantes y un flujo productivo completo `selección de talle → SKU → pending → Checkout Pro → pago real → webhook → paid`.

El precio vigente de la Remera LEMONT es **temporalmente ARS 1.000** para pruebas productivas privadas/controladas. No es el precio comercial definitivo y debe revisarse antes del lanzamiento. `src/catalog.js` sigue siendo la autoridad sobre precio, moneda, nombre y cantidad máxima; en ese cierre todos los SKUs mantenían `maxQuantity: 1`; el vigente es 4 temporal, sin stock real. No existe selector de cantidad, control de inventario ni reserva de stock.

Al cierre de la Etapa 3 la suite pasaba con **55/55 tests**. Esa cifra se conserva como antecedente histórico; el estado actual está indicado arriba.

---

## Antecedente: backend productivo validado

Las tareas T-001 a T-015 están completadas. El 2026-08-22 se reconectaron Supabase y Mercado Pago productivo, el backend local inició correctamente y la versión endurecida fue desplegada desde `checkout-mp-supabase-template`, rama `main`, en `checkout.lemont01.com`. Se verificó con una cuenta compradora real distinta de la vendedora una transferencia de ARS 100 y el flujo completo `checkout → order pending → pago aprobado → webhook → order paid`. Después del despliegue se repitió correctamente la transición `pending → paid`. El backend actual queda validado de punta a punta en producción; DEC-019 y T-015 permanecen vigentes.

---

## Metodología de trabajo

| Rol | Responsabilidad |
|---|---|
| **Claude Code** | Documenta, organiza contexto y prepara tareas para Codex. No modifica código salvo autorización explícita. |
| **Codex** | Implementa cambios de código según las tareas en `docs/TASKS.md`. |
| **Usuario** | Aprueba decisiones técnicas y cambios antes de que se apliquen. |
| **GitHub** | Fuente de verdad del código. |
| **Markdown** | Memoria estable del proyecto. |

---

## Estado de tareas completadas

### P0 — Seguridad e integridad (todas completadas)

| Tarea | Descripción |
|---|---|
| T-001 | Validación de firma webhook HMAC-SHA256 con `MERCADO_PAGO_WEBHOOK_SECRET`. HTTP 401 para firma ausente o inválida. (DEC-009) |
| T-002 | Creación de preferencia detenida si Supabase falla al insertar el pedido. |
| T-003 | Transición `pending → paid` atómica e idempotente con `UPDATE WHERE status = 'pending'`. (DEC-010) |
| T-004 | Validación de las cuatro variables de entorno obligatorias antes de aceptar tráfico. |

### P1 — Calidad y mantenibilidad (todas completadas)

| Tarea | Descripción |
|---|---|
| T-005 | Suite Jest; último resultado histórico documentado: 79/79. Cubre flujos críticos, variantes, cliente/entrega, RPC y cotización simulada sin llamadas externas. |
| T-006 | `supabase/migrations/001_create_orders.sql` con DDL, restricciones, índices y RLS. Aplicada y verificada en Supabase el 2026-06-25. (DEC-012) |
| T-007 | Comparación de importes normalizada a centavos (`Math.round`), validación de moneda contra `order.currency`, logs genéricos. (DEC-011) |
| T-008 | Antecedente: Node generaba identificadores con `crypto.randomUUID()`. Desde DEC-020, PostgreSQL genera el `external_reference` dentro de la RPC atómica. `crypto.randomUUID()` se conserva para `request_id`. |
| T-009 | Backend separado en módulos `src/`: `app.js`, `config.js`, `logger.js`, `payments.js`, `orders.js`, `webhookSignature.js`. |
| T-010 | Logs estructurados JSON con `request_id`, niveles `info`/`warn`/`error`, whitelist de campos y `LOG_LEVEL=info`. (DEC-017) |

### P2 — Operación y producto (todas completadas)

| Tarea | Descripción |
|---|---|
| T-011 | `GET /webhook` registrado solo cuando `NODE_ENV !== "production"`. `POST /webhook` sin cambios. |
| T-012 | Catálogo seguro en `src/catalog.js`; el frontend envía solo `{ sku, quantity }` y el backend calcula precio, total y moneda. (DEC-013) |
| T-013 | Deploy a staging en EasyPanel documentado con variables por nombre, checklists y rollback. (DEC-016) |
| T-014 | Respuesta HTTP 400 para JSON inválido con `Content-Type: application/json; charset=utf-8`. |

---

## Tareas pendientes

No quedan tareas T-001 a T-015 pendientes. T-015 fue completada el 2026-08-21: `POST /webhook` responde 503 ante fallos temporales o inesperados y conserva 200 para resultados exitosos, definitivos o idempotentes.

**T-016 COMPLETADA**, Pasos 1–4 COMPLETADOS. No quedan pasos de T-016 pendientes.

**T-017 EN PROGRESO:** DEC-022 aceptada el 2026-09-16. T-017.1/T-017.2/T-017.3 y T-017.4-A completadas/auditadas; 007/008 aplicadas, runtime desplegado e idempotencia real validada. Falta resolver READY con order ya `paid`. No mezclar este pendiente con T-016.

**Pendiente obligatorio antes del lanzamiento público:** rotar el Access Token y Webhook Secret de Mercado Pago y la credencial privada de Supabase. Las credenciales actuales se usarán solo durante esta etapa privada/controlada de desarrollo y no deben reutilizarse para declarar la tienda lista para clientes reales. Ver `docs/SECURITY.md`.

**Stock pendiente:** no existe control real de inventario por SKU. `maxQuantity: 4` ya está en `src/catalog.js` como techo transitorio y **no sustituye** disponibilidad, reserva concurrente, liberación por abandono ni confirmación tras el pago. Eso requiere una etapa separada.

**Captura completa retirada (2026-08-20):** `MP_SUPPORT_CAPTURE_FULL_WEBHOOK` ya no se lee en runtime y no puede activar el registro de la URL ni de headers completos. Los demás diagnósticos temporales de `src/webhookSignature.js` y `src/config.js` no fueron modificados.

---

## Decisiones técnicas aceptadas

| Decisión | Resumen |
|---|---|
| DEC-009 | Validar firma webhook con `MERCADO_PAGO_WEBHOOK_SECRET`. HTTP 401 + mensaje genérico para firma ausente o inválida. Sin exponer secretos en logs. |
| DEC-010 | Transición `pending → paid` con `UPDATE WHERE status = 'pending'`. Cero filas afectadas = duplicado idempotente. Sin dependencias adicionales. |
| DEC-011 | Comparar importes como enteros en centavos: `Math.round(a * 100) === Math.round(b * 100)`. Validar `currency_id` contra `order.currency`. Logs solo genéricos. Sin dependencias nuevas. |
| DEC-012 | SQL manual versionado en `supabase/migrations/`. Sin Supabase CLI. El usuario aplica el archivo manualmente. |
| DEC-013 | Catálogo como módulo `src/catalog.js`. Catálogo autoritativo. Desde T-016 se envía `{ items, customer, delivery }` o legacy `{ sku, quantity, customer, delivery }`. Backend resuelve precio, moneda y valida cantidad. Sin dependencias nuevas ni tabla Supabase adicional. |
| DEC-016 | Staging en EasyPanel/VPS. URL HTTPS de EasyPanel. `NODE_ENV=production`. MP sandbox. Supabase actual. Variables solo en EasyPanel. Rollback en 4 niveles. Producción real con checklist obligatoria. |
| DEC-017 | Helper `log(level, event, extra)` propio. Formato JSON. Niveles: `info`, `warn`, `error`. Campos fijos + `request_id` por correlación. Lista explícita de campos prohibidos. Sin librería externa. |
| DEC-018 | **Resuelta.** Causa raíz del 401: `notification_url` sin `?source_news=webhooks` hacía que MP enviara IPN en lugar de Webhooks (firma diferente). Fix: agregar `?source_news=webhooks`. Flujo pending → paid verificado en producción real el 2026-06-26. |
| DEC-019 | **Implementada por T-015.** Política HTTP de `POST /webhook`: 401 para firma ausente/inválida; 200 para éxito y resultados definitivos/idempotentes; 503 para fallos temporales o excepciones inesperadas. Conserva HMAC, transición atómica e idempotencia. |
| DEC-020 | `orders` + `order_items` se crean atómicamente mediante RPC estricta; PostgreSQL genera `external_reference`, Node conserva autoridad comercial y Mercado Pago reutiliza exactamente esa referencia. |
| DEC-021 | **Aceptada e implementada por T-016 Pasos 1–4 (cierre 2026-09-13).** Carrito no autoritativo `{ version, items: [{ sku, quantity }] }`; backend agrupa, precifica y alimenta RPC + Mercado Pago; `POST /carrito/resumen`; compatibilidad temporal con `{ sku, quantity, customer, delivery }`; 50 entradas originales antes de agrupar; `maxQuantity: 4` temporal (no es stock); sin migración nueva; webhook sin recálculo de catálogo; Correo Argentino fuera de alcance. |
| DEC-022 | **ACEPTADA (2026-09-16).** Idempotencia durable mediante UUID y `checkout_attempts` UNIQUE. 007/008 aplicadas; hardening productivo verificado; runtime T-017 desplegado e idempotencia activa. RPC 26 permanece disponible. Pendiente: READY con order ya `paid`. |
| DEC-025 | **ACEPTADA (2026-09-17).** T-020 completada y validada mediante paid QA real con shipping incluido y transición `pending → paid`. |
| DEC-026 | **ACEPTADA (2026-09-16).** T-021 completada; migración 006 aplicada y selección autoritativa de agencia productiva. |

---

## HISTÓRICO — estado técnico del corte 2026-09-15

> Las referencias siguientes a T-021 local y migración 006 no aplicada describen exclusivamente el corte del 2026-09-15 y fueron superadas.

- **Backend**: Node.js + CommonJS + Express 5. Módulos separados en `src/`.
- **Pagos**: Mercado Pago Checkout Pro (SDK oficial). Webhook protegido con validación HMAC-SHA256 y confirmación real a la API.
- **Validaciones**: importe normalizado a centavos, moneda validada, transición atómica e idempotente.
- **Identificadores**: PostgreSQL genera `LEMONT-ORDER-<UUID>` dentro de `create_pending_order_with_items`; Node reutiliza exactamente esa referencia en Mercado Pago.
- **Logs**: JSON estructurado por helper propio `log()`, con `request_id`, niveles y lista explícita de campos prohibidos.
- **Base de datos**: Supabase, tablas `orders` y `order_items`; creación atómica mediante RPC con `service_role` solo desde backend. RLS habilitada y sin ejecución pública de la RPC.
- **Migraciones SQL**: 001–005 aplicadas según el handoff de T-021. La 006 agrega snapshot de agencia y reemplaza la firma RPC; está creada localmente y NO aplicada.
- **Datos de entrega**: `003_add_order_customer_delivery.sql` aplicada y verificada; agrega doce columnas nullable sin completar pedidos históricos.
- **Catálogo**: `src/catalog.js` es fuente autoritativa del producto, precio unitario, moneda y cantidad máxima. `maxQuantity: 4` es temporal y no es stock. El cliente no controla importe ni moneda.
- **Carrito:** Paso 1 COMPLETADO — `src/cart.js` y `POST /carrito/resumen`. Paso 2 COMPLETADO — checkout `{ items, customer, delivery }` y legacy. Paso 3 COMPLETADO — `public/carrito.html`, `cartStore` (`lemont.cart`, solo SKU + quantity), contador por unidades, D1-A, D2-A. El frontend no es autoridad de precios.
- **Tests locales**: último resultado comprobado **276/276**, 4 suites, 0 fallos. T-020 tenía 242/242; T-019 cerró en 211/211; T-018 en 178/178; T-016 en 158/158.
- **Envío**: T-020/HOME está desplegado según el handoff. T-021 permite AGENCY Classic/Express con code y snapshot autoritativo solo localmente. Perfiles TEMPORAL/QA. Migración 006 no aplicada.
- **Límite del carrito**: 50 entradas originales antes de agrupar; SKUs duplicados se agrupan; después se valida la cantidad acumulada por SKU contra `maxQuantity`.
- **Dependencias**: npm ci reportó 4 vulnerabilidades (2 moderate, 2 high). No se ejecutó `npm audit fix` ni se modificaron paquetes. Remediación pendiente en una tarea separada; no forma parte de T-016 Paso 1.
- **Diagnóstico**: `GET /webhook` disponible solo fuera de producción (`NODE_ENV !== "production"`). `POST /webhook` disponible en todos los entornos.
- **Deploy**: versión endurecida activa en EasyPanel desde el repositorio `checkout-mp-supabase-template`, rama `main`, dominio `checkout.lemont01.com`. El 2026-08-22 se verificó nuevamente `pending → paid` con Checkout Pro productivo y transferencia real de ARS 100. La captura sensible está retirada. La rotación final de credenciales sigue pendiente antes del lanzamiento público.

---

## Archivos clave del proyecto

| Archivo | Propósito |
|---|---|
| `index.js` | Entrypoint mínimo: carga config, importa app, arranca servidor. |
| `src/app.js` | Express, middlewares, rutas y handlers. Incluye `POST /carrito/resumen`. `GET /webhook` condicionado por `NODE_ENV`. |
| `src/cart.js` | Dominio autoritativo del carrito: parseo, agrupación, validación y cálculo en centavos. |
| `public/carrito.html` | Página del carrito. Resume con `POST /carrito/resumen`. |
| `public/js/cartStore.js` | Persistencia no autoritativa `lemont.cart` (`sku` + `quantity`). |
| `public/js/carrito.js` | UI del carrito: DOM seguro, mutaciones y resumen backend. |
| `src/catalog.js` | Catálogo versionado del servidor y `getProduct(sku)`. `maxQuantity: 4` temporal. |
| `src/config.js` | Validación y export de variables de entorno. |
| `src/logger.js` | Helper `log()` de DEC-017. |
| `src/payments.js` | Integración Mercado Pago: `createPreference`, `Payment.get`. |
| `src/orders.js` | Operaciones Supabase: `createPendingOrder`, `markOrderAsPaid`. Validación importe/moneda. |
| `src/webhookSignature.js` | Validación de firma HMAC-SHA256 de Mercado Pago. |
| `tests/index.test.js` | Suite Jest. Incluye dominio del carrito y `POST /carrito/resumen`. Mocks de MP, Supabase, dotenv y Express. |
| `supabase/migrations/001_create_orders.sql` | Migración SQL versionada: DDL, restricciones, índices y RLS. Aplicada el 2026-06-25. |
| `supabase/migrations/002_add_order_product_variant.sql` | Agrega `product_sku` y `product_size` nullable. Aplicada y verificada sin alterar registros históricos. |
| `supabase/migrations/003_add_order_customer_delivery.sql` | Agrega datos de cliente y destino como columnas nullable. Aplicada y verificada sin alterar registros históricos. |
| `supabase/migrations/004_create_order_items.sql` | Crea `order_items` y la RPC atómica estricta. Aplicada y validada manualmente en Supabase real. |
| `supabase/migrations/005_add_order_shipping_snapshot.sql` | Agrega shipping snapshot y total, y reemplaza la RPC. Aplicada según el handoff de T-021. |
| `supabase/migrations/006_add_order_shipping_agency.sql` | Agrega snapshot autoritativo de agencia. Aplicada en producción; T-021 productiva. |
| `supabase/migrations/007_create_checkout_attempts.sql` | Agrega `checkout_attempts`, RPC v2 y claim. Aplicada en producción. |
| `supabase/migrations/008_harden_checkout_attempts_privileges.sql` | Reproduce el hardening mínimo de `service_role`. Aplicada en producción. |
| `Dockerfile` | Build de staging con Node.js 22; instala con `npm ci`, expone `3003` y ejecuta `npm start`. |
| `.dockerignore` | Excluye `.env`, `.env.*`, `.git`, `node_modules`, logs y temporales del contexto Docker. |
| `.env.example` | Contrato de variables de entorno (sin valores reales). Incluye `LOG_LEVEL=info`. |
| `docs/CURRENT_CONTEXT.md` | Este archivo — resumen compacto para agentes. |
| `docs/TASKS.md` | Detalle de todas las tareas con criterios de aceptación. |
| `docs/DECISIONS.md` | Decisiones técnicas tomadas y pendientes. |
| `docs/PROGRESS.md` | Bitácora y estado histórico. |
| `docs/DESIGN.md` | Arquitectura y flujos. |
| `docs/SECURITY.md` | Controles y riesgos. |
| `AGENTS.md` | Reglas de trabajo para agentes. |
| `CLAUDE.md` | Rol y restricciones de Claude Code. |

---

## Próximo paso detallado

1. Cerrar el hardening de T-017 para impedir que un attempt READY reutilice una preferencia vieja cuando su order asociada ya está `paid`.
2. Mejorar `success.html` y la experiencia real de “Gracias por tu compra”.
3. Definir y validar el cleanup seguro del carrito y `sessionStorage` después del retorno exitoso.
4. Continuar con la Etapa D de MiCorreo: `POST /shipping/import` post-pago.
5. Después, avanzar con catálogo dinámico desde Supabase y stock real por SKU; imágenes y descripciones dinámicas pertenecen a esa evolución.

Antes del lanzamiento comercial también deben reemplazarse los perfiles TEMPORAL/QA, restaurarse el precio comercial, rotarse las credenciales expuestas y completarse la auditoría npm.

El modelo `orders` + `order_items` ya está implementado y no debe volver a tratarse como propuesta futura. El carrito de interfaz del Paso 3 ya existe.

También permanecen posibles, ninguno marcado como completado:

- Mejoras de la página de detalle del producto ya existente.
- Imágenes reales y optimizadas de LEMONT.
- Guía de talles.
- Stock real por SKU.
- Panel administrativo.
- Exportación y reportes.
- Mejora final de Contacto.
- Documentación y guía de estudio completa.

Criterios de implementación:

- Buena indentación y legibilidad humana.
- HTML semántico cuando corresponda.
- CSS organizado.
- JavaScript modular y entendible.
- Nombres claros y responsabilidades separadas.
- Evitar complejidad innecesaria y priorizar mantenimiento por personas.

Antes de declarar la tienda lista para clientes reales se deben rotar las tres credenciales privadas pendientes y volver a verificar el flujo productivo.

> Codex no debe leer `.env`, exponer secretos, hacer commit ni push sin autorización explícita del usuario.

---

## Reglas vigentes para todos los agentes

- No leer ni mostrar `.env`.
- No exponer secretos, tokens, credenciales ni claves en documentación, logs, commits ni mensajes.
- No usar `git add .` sin revisar qué archivos se incluyen.
- No aplicar la migración SQL en ninguna base de datos sin autorización explícita del usuario.
- No hacer commit ni push sin instrucción del usuario.
- GitHub es la fuente de verdad del código.
- Claude Code documenta. Codex programa. Usuario aprueba.
