# Diseño técnico

## Arquitectura general

La aplicación es un monolito pequeño de Node.js. Express sirve el frontend estático y expone las rutas de API. El backend se comunica directamente con Mercado Pago y Supabase.

```text
Navegador
  |-- archivos estáticos ----------------------> Express
  |-- POST /crear-preferencia ----------------> Express
  |                                               |--> Supabase: crear order pending
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
  index.test.js               # Suite Jest actual: 61 tests
```

## Flujo de creación de pago

1. El comprador selecciona S, M, L o XL. Sin variante, Continuar permanece deshabilitado.
2. Producto abre Entrega con `product id`, `sku` y `quantity: 1`, sin PII en la URL.
3. Entrega recopila y valida cliente y domicilio.
4. El frontend envía `POST /crear-preferencia` únicamente con `{ sku, quantity, customer, delivery }`.
5. El servidor resuelve el producto y su talle mediante `getProduct(sku)` y valida los datos de entrada.
6. El servidor valida que `quantity` sea un entero entre 1 y `product.maxQuantity`; los cuatro SKUs actuales tienen máximo 1.
7. El servidor calcula `total = product.unitPrice * quantity` y genera `LEMONT-ORDER-${crypto.randomUUID()}`.
8. `createPendingOrder` inserta producto, variante, valores autoritativos, cliente y destino con estado `pending`.
9. El servidor crea la preferencia con título de variante, `unit_price`, cantidad y moneda autoritativos, además de `notification_url`, `back_urls` y `auto_return: "approved"`.
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

La tabla `orders` usa `external_reference` como clave de correlación única. El estado inicial es `pending` y el único cambio implementado es a `paid`. `001_create_orders.sql` define la tabla, `002_add_order_product_variant.sql` agrega SKU/talle y `003_add_order_customer_delivery.sql` agrega cliente y destino. Las columnas aditivas son nullable y las migraciones fueron aplicadas sin completar datos históricos. Los pedidos nuevos guardan variante, cliente, dirección y país `AR`. La transición `pending → paid` es atómica e idempotente mediante `UPDATE WHERE status = 'pending'`; un webhook duplicado recibe cero filas afectadas y se trata como duplicado sin error (T-003, DEC-010).

## Flujo de compra con entrega

1. Producto selecciona una variante por talle.
2. Producto abre `entrega.html` transportando solo `product id`, `sku` y `quantity`.
3. Entrega recopila nombre, apellido, email, teléfono y domicilio; piso/departamento y referencia son opcionales.
4. El navegador envía únicamente `sku`, `quantity`, `customer` y `delivery`.
5. El backend valida y normaliza antes de consultar Supabase o Mercado Pago.
6. Supabase registra el pedido `pending`; luego Checkout Pro continúa con el flujo existente.

El frontend no controla precio, moneda, total, nombre, talle separado, estado, `external_reference` ni identificadores de Mercado Pago. No existe PII en la URL. La prueba manual hasta Supabase/pending está verificada; la prueba real posterior a Etapa 5 hasta `paid` está pendiente.

## Preparación logística

La Etapa 5 solo prepara país, provincia, localidad, código postal, calle, número, unidad y referencia. No hay cotización automática, costo, Correo Argentino, Andreani, OCA, tracking, sucursal ni estados logísticos. Peso y dimensiones no están definidos. Una futura etapa separada deberá elegir proveedor/API, origen, credenciales, entorno, modalidades y cómo incorporar el envío al total autoritativo.

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
- Identificadores de pedido con `crypto.randomUUID()` (T-008).
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

La rotación de credenciales privadas sigue siendo un requisito previo al lanzamiento público, no un requisito ya completado. La próxima etapa sugerida es cotización de envío y todavía no está implementada.
