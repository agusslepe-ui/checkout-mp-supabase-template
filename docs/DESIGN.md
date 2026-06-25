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
- `tests/index.test.js`: suite Jest con 22 tests.

## Estructura de archivos backend (implementada — T-009 completada)

```
index.js                      # Entrypoint: carga config, crea app, arranca servidor
src/
  app.js                      # Instancia Express: middlewares, rutas, handlers
  config.js                   # Lee y valida variables de entorno; exporta constantes
  logger.js                   # Helper log(level, event, extra) — DEC-017
  payments.js                 # Crear preferencia, consultar Payment.get — Mercado Pago
  orders.js                   # createPendingOrder, markOrderAsPaid — Supabase
  webhookSignature.js         # Validación HMAC-SHA256 de x-signature — DEC-009
tests/
  index.test.js               # Suite Jest con 22 tests
```

## Flujo de creación de pago

1. El botón del frontend envía `POST /crear-preferencia` sin cuerpo.
2. El servidor define el producto y genera `LEMONT-ORDER-${crypto.randomUUID()}`.
3. `createPendingOrder` inserta un registro en `orders`.
4. El servidor crea la preferencia con `notification_url`, `back_urls` y `auto_return: "approved"`.
5. Devuelve `preference_id`, `init_point` y `sandbox_init_point`.
6. El frontend prefiere `sandbox_init_point` y redirige al comprador.

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
9. El endpoint responde `{ "received": true }` aun cuando la consulta o actualización falle, después de registrar el error.

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

La tabla `orders` usa `external_reference` como clave de correlación única. El estado inicial es `pending` y el único cambio implementado es a `paid`. La migración SQL está versionada en `supabase/migrations/001_create_orders.sql` con restricciones, índices y RLS habilitada (T-006, DEC-012). La transición `pending → paid` es atómica e idempotente mediante `UPDATE WHERE status = 'pending'`; un webhook duplicado recibe cero filas afectadas y se trata como duplicado sin error (T-003, DEC-010).

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

- Puerto, producto y catálogo codificados directamente en backend.
- La ruta `GET /webhook` queda restringida a entornos no productivos.
- No hay manejo explícito de reintentos, timeouts ni rate limits.
- No hay deploy documentado ni infraestructura como código (T-013 pendiente).

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
