# Contexto actual del proyecto

> Resumen compacto para agentes. Última actualización: 2026-08-22 (runtime integrado con `orders` + `order_items`; suite 79/79; MiCorreo pendiente de credenciales).
> Si el chat fue compactado, este archivo es el punto de entrada.
> Metodología: Claude documenta — Codex programa — Usuario aprueba — GitHub guarda.

---

## Estado vigente

### COMPLETADO

- Etapa 5: formulario de cliente y entrega, validación frontend/backend y request `{ sku, quantity, customer, delivery }` sin PII en URL. La migración `003_add_order_customer_delivery.sql` fue aplicada; agregó doce columnas nullable a `orders` sin completar pedidos históricos.
- Etapa 6A: cotización informativa `POST /cotizar-envio` mediante `src/shipping.js` y `src/micorreo.js`, JWT en memoria, timeout, renovación única ante 401 y frontend en `public/js/envio.js`. No suma envío al pedido ni a Mercado Pago.
- Migración `004_create_order_items.sql` aplicada. Existe `public.order_items`, vinculada por FK a `orders.id` con `ON DELETE CASCADE`, y la RPC estricta `public.create_pending_order_with_items(..., p_items jsonb)`.
- El runtime Node crea pedidos nuevos mediante la RPC. Node construye `p_items` desde `src/catalog.js`; PostgreSQL valida, calcula el total, genera `external_reference` y crea atómicamente `orders` + `order_items`.
- Mercado Pago recibe exactamente el `external_reference` devuelto por la RPC. La RPC conserva temporalmente las columnas legacy de producto en `orders` usando el primer item.

### VALIDADO

- La migración 004 y la RPC fueron validadas manualmente en Supabase real: un pedido y su item, total, moneda, estado, columnas legacy, relación y `ON DELETE CASCADE`.
- El runtime local actualizado crea la preferencia, `orders` y `order_items`, y redirige a Checkout Pro.
- El webhook permanece sin cambios: HMAC, validación de importe/moneda, idempotencia y transición atómica `pending → paid` siguen vigentes.
- Suite actual: **79/79 tests**, 1 suite, 0 fallos.
- Incidente QA resuelto: pedidos nuevos aparecieron con `customer_*` y `shipping_*` en `NULL`. Se comprobó una sola RPC activa, firma/permisos correctos y definición/`INSERT` activos correctos. La causa fue una instancia antigua iniciada con `npm start`; tras reiniciar Node quedó cargado el runtime actualizado.

### PENDIENTE

- Correo Argentino: solicitud de credenciales enviada y todavía no recibida. No realizar llamadas reales hasta disponer de accesos. Las medidas `300 g / 5 × 25 × 35 cm` continúan marcadas como temporales de QA y deben reemplazarse antes de producción.
- Rotar las credenciales privadas documentadas como expuestas antes del lanzamiento público.
- El precio ARS 1.000 sigue siendo temporal de prueba; no es el precio comercial definitivo. No hay carrito, stock ni selección de cantidad.

### PRÓXIMO PASO

Cuando Correo Argentino entregue las credenciales, configurar localmente las variables MiCorreo sin documentar valores y validar de forma controlada `CP destino → /cotizar-envio → /token → /rates → opciones`. Hasta entonces no efectuar llamadas reales.

**Regla operativa obligatoria:** después de modificar archivos backend/runtime en `src/`, reiniciar el proceso Node antes de realizar pruebas manuales.

---

## Antecedente: Etapa 6A local — cotización informativa MiCorreo

La Etapa 6A implementa `Entrega → Calcular envío → POST /cotizar-envio → validación backend → shipping.js → micorreo.js → JWT → POST /rates → normalización → opciones informativas`. El frontend envía únicamente `sku`, `quantity` y `postalCodeDestination`. El backend aporta autoritativamente `customerId`, CP de origen, peso y dimensiones; el navegador no controla precios de envío, `productType` ni total.

Se agregaron `src/micorreo.js`, `src/shipping.js` y `public/js/envio.js`. `.env.example` declara sin valores `MICORREO_BASE_URL`, `MICORREO_USER`, `MICORREO_PASSWORD`, `MICORREO_CUSTOMER_ID` y `SHIPPING_ORIGIN_POSTAL_CODE`. No hay credenciales MiCorreo reales en el repositorio.

El JWT se obtiene con Basic Auth, se conserva solo en memoria, se reutiliza con margen de expiración, comparte la solicitud en curso, se renueva una sola vez ante 401 y usa timeout. Ningún token, credencial, `customerId`, CP, domicilio, PII, request completo ni respuesta completa se registra en logs.

Las medidas `300 g × 5 × 25 × 35 cm` están marcadas como **TEMPORALES / QA** y no representan el paquete real. Deben sustituirse antes de producción. La cotización no cambia `orders.amount`, Mercado Pago, Supabase, webhook, HMAC, DEC-019, T-015 ni `pending → paid`.

Estado: **IMPLEMENTADA Y TESTEADA LOCALMENTE; PENDIENTE DE CREDENCIALES Y VALIDACIÓN CONTRA MICORREO QA**. Al cierre de esta etapa la suite pasaba 75/75; el total vigente es 79/79. No hubo llamadas reales a Correo Argentino. Ya se solicitó acceso y se esperan usuario, contraseña, `customerId` y cualquier requisito adicional de QA.

### Antecedente: Etapa 5

La Etapa 5 incorpora los datos del cliente y del domicilio antes de iniciar Mercado Pago. El flujo implementado es `Producto → selección de talle → Continuar → entrega.html → datos del cliente y domicilio → validación → POST /crear-preferencia → pedido pending → Checkout Pro → webhook → paid`.

`entrega.html` está implementada y funcional. Requiere nombre, apellido, email, teléfono, provincia, localidad, código postal, calle y número; piso/departamento y referencia de entrega son opcionales. Producto transporta hacia Entrega únicamente `product id`, `sku` y `quantity`, sin PII en la URL. El request de creación de preferencia contiene solo `sku`, `quantity`, `customer` y `delivery`; el backend conserva la autoridad sobre producto, variante, precio, moneda, cantidad máxima, total, estado y `external_reference`.

La migración `supabase/migrations/003_add_order_customer_delivery.sql` fue aplicada correctamente. Sus doce columnas de cliente y destino son nullable, los pedidos históricos no fueron alterados y los pedidos nuevos guardan producto, SKU, talle, cliente, domicilio, `shipping_country_code = AR` y estado `pending`. Se verificó manualmente `Producto → Entrega → Supabase` y la creación del pedido `pending`. La prueba productiva específica posterior a Etapa 5 —datos nuevos → pago real → webhook → `paid`— permanece pendiente.

Al cierre de Etapa 5 la suite pasaba **61/61 tests**, 1 suite y 0 fallos. Esa cifra queda como antecedente; el total vigente es 79/79.

### Antecedente: Etapa 3

La Etapa 3 incorporó la Remera LEMONT con variantes inequívocas por talle: `LEM-REM-001-S`, `LEM-REM-001-M`, `LEM-REM-001-L` y `LEM-REM-001-XL`. El SKU temporal `REMERA-LEMONT-001` fue retirado y se rechaza. El frontend exige seleccionar S, M, L o XL antes de habilitar Comprar y envía únicamente `{ sku, quantity: 1 }`; precio, moneda, nombre, talle, importe, referencia y estado no provienen del cliente.

La migración `supabase/migrations/002_add_order_product_variant.sql` fue aplicada y verificada. Agregó `product_sku text` y `product_size text` como columnas nullable, sin completar ni alterar pedidos históricos. Los pedidos nuevos persisten SKU y talle. Se verificaron manualmente las cuatro variantes y un flujo productivo completo `selección de talle → SKU → pending → Checkout Pro → pago real → webhook → paid`.

El precio vigente de la Remera LEMONT es **temporalmente ARS 1.000** para pruebas productivas privadas/controladas. No es el precio comercial definitivo y debe revisarse antes del lanzamiento. `src/catalog.js` sigue siendo la autoridad sobre precio, moneda, nombre y cantidad máxima; todos los SKUs mantienen `maxQuantity: 1`. No existe selector de cantidad, control de inventario ni reserva de stock.

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
| T-005 | Suite Jest; la suite actual pasa con 79 tests. Cubre flujos críticos, variantes, cliente/entrega, RPC y cotización simulada sin llamadas externas. |
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

**Pendiente obligatorio antes del lanzamiento público:** rotar el Access Token y Webhook Secret de Mercado Pago y la credencial privada de Supabase. Las credenciales actuales se usarán solo durante esta etapa privada/controlada de desarrollo y no deben reutilizarse para declarar la tienda lista para clientes reales. Ver `docs/SECURITY.md`.

**Stock pendiente:** no existe control real de inventario por SKU. Disponibilidad, reserva concurrente, liberación por abandono y confirmación tras el pago requieren una etapa separada y no están parcial ni totalmente implementadas.

**Captura completa retirada (2026-08-20):** `MP_SUPPORT_CAPTURE_FULL_WEBHOOK` ya no se lee en runtime y no puede activar el registro de la URL ni de headers completos. Los demás diagnósticos temporales de `src/webhookSignature.js` y `src/config.js` no fueron modificados.

---

## Decisiones técnicas aceptadas

| Decisión | Resumen |
|---|---|
| DEC-009 | Validar firma webhook con `MERCADO_PAGO_WEBHOOK_SECRET`. HTTP 401 + mensaje genérico para firma ausente o inválida. Sin exponer secretos en logs. |
| DEC-010 | Transición `pending → paid` con `UPDATE WHERE status = 'pending'`. Cero filas afectadas = duplicado idempotente. Sin dependencias adicionales. |
| DEC-011 | Comparar importes como enteros en centavos: `Math.round(a * 100) === Math.round(b * 100)`. Validar `currency_id` contra `order.currency`. Logs solo genéricos. Sin dependencias nuevas. |
| DEC-012 | SQL manual versionado en `supabase/migrations/`. Sin Supabase CLI. El usuario aplica el archivo manualmente. |
| DEC-013 | Catálogo como módulo `src/catalog.js`. Frontend envía solo `{ sku, quantity }`. Backend resuelve precio, moneda y valida cantidad. Sin dependencias nuevas ni tabla Supabase adicional. |
| DEC-016 | Staging en EasyPanel/VPS. URL HTTPS de EasyPanel. `NODE_ENV=production`. MP sandbox. Supabase actual. Variables solo en EasyPanel. Rollback en 4 niveles. Producción real con checklist obligatoria. |
| DEC-017 | Helper `log(level, event, extra)` propio. Formato JSON. Niveles: `info`, `warn`, `error`. Campos fijos + `request_id` por correlación. Lista explícita de campos prohibidos. Sin librería externa. |
| DEC-018 | **Resuelta.** Causa raíz del 401: `notification_url` sin `?source_news=webhooks` hacía que MP enviara IPN en lugar de Webhooks (firma diferente). Fix: agregar `?source_news=webhooks`. Flujo pending → paid verificado en producción real el 2026-06-26. |
| DEC-019 | **Implementada por T-015.** Política HTTP de `POST /webhook`: 401 para firma ausente/inválida; 200 para éxito y resultados definitivos/idempotentes; 503 para fallos temporales o excepciones inesperadas. Conserva HMAC, transición atómica e idempotencia. |
| DEC-020 | `orders` + `order_items` se crean atómicamente mediante RPC estricta; PostgreSQL genera `external_reference`, Node conserva autoridad comercial y Mercado Pago reutiliza exactamente esa referencia. |

---

## Estado técnico actual

- **Backend**: Node.js + CommonJS + Express 5. Módulos separados en `src/`.
- **Pagos**: Mercado Pago Checkout Pro (SDK oficial). Webhook protegido con validación HMAC-SHA256 y confirmación real a la API.
- **Validaciones**: importe normalizado a centavos, moneda validada, transición atómica e idempotente.
- **Identificadores**: PostgreSQL genera `LEMONT-ORDER-<UUID>` dentro de `create_pending_order_with_items`; Node reutiliza exactamente esa referencia en Mercado Pago.
- **Logs**: JSON estructurado por helper propio `log()`, con `request_id`, niveles y lista explícita de campos prohibidos.
- **Base de datos**: Supabase, tablas `orders` y `order_items`; creación atómica mediante RPC con `service_role` solo desde backend. RLS habilitada y sin ejecución pública de la RPC.
- **Migraciones SQL**: 001–004 aplicadas. La 004 crea `order_items` y la RPC atómica; fue validada manualmente en Supabase real.
- **Datos de entrega**: `003_add_order_customer_delivery.sql` aplicada y verificada; agrega doce columnas nullable sin completar pedidos históricos.
- **Catálogo**: `src/catalog.js` es fuente autoritativa del producto, precio unitario, moneda y cantidad máxima. El cliente no controla importe ni moneda.
- **Tests**: Jest. La suite actual pasa con **79 tests**, 1 suite y 0 fallos. Las integraciones externas están simuladas y no acceden a `.env`.
- **Dependencias**: `npm audit` detectó 2 vulnerabilidades high; `npm audit fix` actualizó únicamente dependencias transitivas compatibles. Estado verificado: **0 vulnerabilidades conocidas**; la suite actual pasa 79/79.
- **Diagnóstico**: `GET /webhook` disponible solo fuera de producción (`NODE_ENV !== "production"`). `POST /webhook` disponible en todos los entornos.
- **Deploy**: versión endurecida activa en EasyPanel desde el repositorio `checkout-mp-supabase-template`, rama `main`, dominio `checkout.lemont01.com`. El 2026-08-22 se verificó nuevamente `pending → paid` con Checkout Pro productivo y transferencia real de ARS 100. La captura sensible está retirada. La rotación final de credenciales sigue pendiente antes del lanzamiento público.

---

## Archivos clave del proyecto

| Archivo | Propósito |
|---|---|
| `index.js` | Entrypoint mínimo: carga config, importa app, arranca servidor. |
| `src/app.js` | Express, middlewares, rutas y handlers. `GET /webhook` condicionado por `NODE_ENV`. |
| `src/catalog.js` | Catálogo versionado del servidor y `getProduct(sku)`. |
| `src/config.js` | Validación y export de variables de entorno. |
| `src/logger.js` | Helper `log()` de DEC-017. |
| `src/payments.js` | Integración Mercado Pago: `createPreference`, `Payment.get`. |
| `src/orders.js` | Operaciones Supabase: `createPendingOrder`, `markOrderAsPaid`. Validación importe/moneda. |
| `src/webhookSignature.js` | Validación de firma HMAC-SHA256 de Mercado Pago. |
| `tests/index.test.js` | Suite Jest con **79 tests**. Mocks de MP, Supabase, dotenv y Express. |
| `supabase/migrations/001_create_orders.sql` | Migración SQL versionada: DDL, restricciones, índices y RLS. Aplicada el 2026-06-25. |
| `supabase/migrations/002_add_order_product_variant.sql` | Agrega `product_sku` y `product_size` nullable. Aplicada y verificada sin alterar registros históricos. |
| `supabase/migrations/003_add_order_customer_delivery.sql` | Agrega datos de cliente y destino como columnas nullable. Aplicada y verificada sin alterar registros históricos. |
| `supabase/migrations/004_create_order_items.sql` | Crea `order_items` y la RPC atómica estricta. Aplicada y validada manualmente en Supabase real. |
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

Esperar las credenciales solicitadas a Correo Argentino. Cuando estén disponibles, configurar localmente las cinco variables MiCorreo y verificar `CP destino → /cotizar-envio → /token → /rates → tarifa QA en LEMONT`, sin registrar valores. El modelo `orders` + `order_items` ya está implementado y no debe volver a tratarse como propuesta futura.

También permanecen posibles, ninguno marcado como completado:

- Página de detalle del producto.
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
