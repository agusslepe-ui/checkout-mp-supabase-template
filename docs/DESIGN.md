# Diseño técnico

## Arquitectura general

La aplicación es un monolito pequeño de Node.js. Express sirve el frontend estático y expone las rutas de API. El backend se comunica directamente con Mercado Pago y Supabase.

```text
Navegador
  |-- archivos estáticos ----------------------> Express
  |-- POST /crear-preferencia ----------------> Express
  |                                               |--> Supabase RPC: crear order + items pending
  |                                               `--> Mercado Pago: crear preferencia
  `---------------- redirección a Checkout Pro ------> Mercado Pago

Mercado Pago -- POST /webhook --> Express
                                   |--> Mercado Pago: consultar payment
                                   `--> Supabase: actualizar order a paid
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
- `public/index.html`: vista del producto.
- `public/app.js`: inicia la preferencia y redirige al checkout.
- `public/styles.css`: presentación visual compartida.
- `public/success.html`, `failure.html`, `pending.html`: páginas de retorno.
- `package.json`: scripts y dependencias de ejecución.
- `.env.example`: contrato de configuración, sin valores reales.
- `tests/index.test.js`: suite Jest con 29 tests.

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
  index.test.js               # Suite Jest actual: 79 tests
```

## Flujo de creación de pago

1. El comprador selecciona S, M, L o XL. Sin variante, Continuar permanece deshabilitado.
2. Producto abre Entrega con `product id`, `sku` y `quantity: 1`, sin PII en la URL.
3. Entrega recopila y valida cliente y domicilio.
4. El frontend envía `POST /crear-preferencia` únicamente con `{ sku, quantity, customer, delivery }`.
5. El servidor resuelve el producto y su talle mediante `getProduct(sku)` y valida los datos de entrada.
6. El servidor valida que `quantity` sea un entero entre 1 y `product.maxQuantity`; los cuatro SKUs actuales tienen máximo 1.
7. El servidor calcula `total = product.unitPrice * quantity` y construye un array `p_items` autoritativo desde `src/catalog.js`.
8. `createPendingOrder` llama `public.create_pending_order_with_items`. PostgreSQL valida, calcula el total, genera `external_reference` y crea atómicamente `orders` + `order_items` con estado `pending`.
9. El servidor crea la preferencia con exactamente el `external_reference` devuelto por la RPC, título de variante, `unit_price`, cantidad y moneda autoritativos, además de `notification_url`, `back_urls` y `auto_return: "approved"`.
10. Devuelve `preference_id`, `init_point` y `sandbox_init_point`; el frontend prioriza `init_point` y conserva `sandbox_init_point` como fallback.

Si falla el alta del pedido en Supabase, la creación de preferencia se detiene y el cliente recibe un error genérico (T-002, completada).

## Flujo del webhook

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
| POST | `/crear-preferencia` | Crear pedido y preferencia de pago |
| POST | `/webhook` | Recibir eventos de Mercado Pago |
| GET | `/webhook` | Diagnóstico temporal, solo con `NODE_ENV !== "production"` |
| GET | `/success` | Retorno visual de pago aprobado |
| GET | `/failure` | Retorno visual de pago rechazado |
| GET | `/pending` | Retorno visual de pago pendiente |

## Persistencia

La tabla `orders` usa `external_reference` como clave de correlación única. El estado inicial es `pending` y el único cambio implementado es a `paid`. `001_create_orders.sql` define la tabla, `002_add_order_product_variant.sql` agrega SKU/talle, `003_add_order_customer_delivery.sql` agrega cliente/destino y `004_create_order_items.sql` agrega `order_items` y la RPC de creación atómica. Las columnas aditivas de pedidos históricos son nullable y no fueron completadas. Los pedidos nuevos guardan cliente, destino y uno o más items; durante la transición, el primer item también completa las columnas legacy de producto en `orders`. La transición `pending → paid` permanece atómica e idempotente mediante `UPDATE WHERE status = 'pending'` (T-003, DEC-010).

## Flujo de compra con entrega

1. Producto selecciona una variante por talle.
2. Producto abre `entrega.html` transportando solo `product id`, `sku` y `quantity`.
3. Entrega recopila nombre, apellido, email, teléfono y domicilio; piso/departamento y referencia son opcionales.
4. El navegador envía únicamente `sku`, `quantity`, `customer` y `delivery`.
5. El backend valida y normaliza antes de consultar Supabase o Mercado Pago.
6. Supabase registra el pedido `pending`; luego Checkout Pro continúa con el flujo existente.

El frontend no controla precio, moneda, total, nombre, talle separado, estado, `external_reference` ni identificadores de Mercado Pago. No existe PII en la URL. La prueba manual hasta Supabase/pending está verificada; la prueba real posterior a Etapa 5 hasta `paid` está pendiente.

## Cotización logística local — Etapa 6A

La Etapa 5 prepara el destino y la Etapa 6A agrega cotización informativa mediante MiCorreo:

```text
Entrega → POST /cotizar-envio → shipping.js → micorreo.js → /token → /rates → opciones normalizadas
```

El request del navegador contiene solo `sku`, `quantity` y `postalCodeDestination`. `src/catalog.js` aporta medidas; configuración aporta `customerId` y CP de origen. `micorreo.js` mantiene JWT únicamente en memoria, comparte una obtención en curso, aplica expiración/timeout y renueva una sola vez ante 401.

La respuesta pública expone `type`, `label` y `price`. Domicilio es informativo y sucursal aclara que su selección está pendiente. No existen `/agencies`, `/shipping/import`, tracking, etiquetas, creación de envío ni estados logísticos. La tarifa no se persiste ni forma parte del total.

Las medidas 300 g / 5 × 25 × 35 cm son temporales de QA y deben reemplazarse por datos reales. La integración no fue validada contra MiCorreo QA porque las credenciales solicitadas todavía no fueron recibidas.

## Modelo `orders` + `order_items` implementado

`orders` conserva identidad, cliente, entrega, total, moneda, estado y correlación de pago. `order_items` conserva snapshots autoritativos de SKU, nombre, talle nullable, cantidad, precio unitario y `line_total` generado. La FK `order_items.order_id → orders.id` usa `ON DELETE CASCADE`.

La RPC `create_pending_order_with_items` recibe datos escalares estrictos y `p_items jsonb` validado: array obligatorio, propiedades permitidas explícitas, tipos y rangos controlados, y rechazo de items vacíos o importes inconsistentes. La suma se calcula en PostgreSQL y debe coincidir con `p_expected_amount`. La compra actual envía un item; el contrato admite múltiples items para una evolución futura, sin que exista carrito todavía.

La RPC usa `SECURITY INVOKER`, `search_path` fijo y ejecución reservada a `service_role`. Navegadores, `anon` y `authenticated` no pueden ejecutarla directamente.

## Variantes y limitaciones comerciales actuales

- Remera LEMONT: SKUs `LEM-REM-001-S`, `LEM-REM-001-M`, `LEM-REM-001-L` y `LEM-REM-001-XL`.
- `REMERA-LEMONT-001` fue retirado y no se acepta.
- Precio vigente: ARS 1.000 temporal para pruebas controladas; debe reemplazarse antes del lanzamiento comercial.
- `src/catalog.js` es la única autoridad sobre precio, moneda, nombre y máximo.
- No existe selector de cantidad ni stock real. La existencia de un SKU no representa disponibilidad.
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
- CommonJS y JavaScript sin framework frontend.
- Configuración sensible mediante variables de entorno.

## Limitaciones estructurales

- Puerto fijo y catálogo versionado en backend; sin fuente administrable externa todavía.
- La ruta `GET /webhook` queda restringida a entornos no productivos.
- No hay manejo explícito de reintentos, timeouts ni rate limits.
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
- Catálogo seguro en `src/catalog.js`; `POST /crear-preferencia` acepta solo `{ sku, quantity }` y calcula precio, total y moneda en backend (T-012, DEC-013).
- Deploy a staging documentado para EasyPanel/VPS con checklists y rollback (T-013, DEC-016).
- Política resiliente 401/200/503 del webhook implementada y validada en producción (T-015, DEC-019).

## Frontend actual de LEMONT

El backend de pagos actual fue validado de punta a punta en producción el 2026-08-22, incluyendo un pago real de ARS 100 y una nueva verificación `pending → paid` después del deploy de la versión endurecida. El frontend debe integrarse con este contrato sin modificar innecesariamente el motor de pagos.

Alcance inicial del frontend:

- Home.
- Catálogo.
- Contacto.
- Producto/compra.

Principios de diseño e implementación:

- HTML semántico cuando corresponda.
- CSS organizado y responsabilidades visuales claras.
- JavaScript modular, entendible y separado por responsabilidad.
- Buena indentación, nombres claros y legibilidad humana.
- Evitar abstracciones o complejidad que no aporten valor al alcance inicial.
- Preservar el contrato seguro `{ sku, quantity, customer, delivery }` de `POST /crear-preferencia`; el frontend no controla precios, moneda ni confirmación de pago.

Home, Catálogo y Contacto están implementados en HTML/CSS/JavaScript vanilla. El catálogo y los filtros se generan con JavaScript, la Remera LEMONT permite seleccionar talle e iniciar el checkout real y las demás tarjetas permanecen en `Próximamente`. Las imágenes externas provenientes de Stitch son temporales y deben sustituirse por assets propios optimizados en `public/assets/images/`.

La rotación de credenciales privadas sigue siendo un requisito previo al lanzamiento público, no un requisito ya completado. Etapa 6A requiere credenciales y validación QA; el modelo `orders`/`order_items` ya está implementado y validado.

## Regla operativa de recarga del runtime

Node no recarga automáticamente los módulos CommonJS del proceso iniciado con `npm start`. Después de modificar archivos backend/runtime en `src/`, se debe reiniciar el proceso Node antes de cualquier prueba manual. El incidente QA de campos `customer_*` y `shipping_*` en `NULL` se debió a una instancia antigua que seguía ejecutando el mecanismo legacy; la función activa en PostgreSQL estaba correcta.
