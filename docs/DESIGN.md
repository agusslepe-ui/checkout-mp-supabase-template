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

- `index.js`: composición completa del backend, clientes externos, persistencia, preferencias, webhook, validaciones, rutas y servidor.
- `public/index.html`: vista del producto.
- `public/app.js`: inicia la preferencia y redirige al checkout.
- `public/styles.css`: presentación visual compartida.
- `public/success.html`, `failure.html`, `pending.html`: páginas de retorno.
- `package.json`: scripts y dependencias de ejecución.
- `.env.example`: contrato de configuración, sin valores reales.

No hay todavía capas separadas para rutas, dominio, servicios o acceso a datos.

## Flujo de creación de pago

1. El botón del frontend envía `POST /crear-preferencia` sin cuerpo.
2. El servidor define el producto y genera `LEMONT-ORDER-${crypto.randomUUID()}`.
3. `createPendingOrder` inserta un registro en `orders`.
4. El servidor crea la preferencia con `notification_url`, `back_urls` y `auto_return: "approved"`.
5. Devuelve `preference_id`, `init_point` y `sandbox_init_point`.
6. El frontend prefiere `sandbox_init_point` y redirige al comprador.

Actualmente, si falla el alta del pedido, el error se registra pero se intenta crear igualmente la preferencia. Esto puede producir un pago sin pedido interno asociado.

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
| GET | `/webhook` | Diagnóstico temporal de desarrollo |
| GET | `/success` | Retorno visual de pago aprobado |
| GET | `/failure` | Retorno visual de pago rechazado |
| GET | `/pending` | Retorno visual de pago pendiente |

## Persistencia

La tabla `orders` usa `external_reference` como clave de correlación única. El estado inicial es `pending` y el único cambio implementado es a `paid`. No se observan migraciones, transacciones, funciones SQL ni políticas RLS versionadas.

La lectura previa y la actualización son operaciones separadas. Dos webhooks concurrentes podrían superar la comprobación antes de que uno actualice el registro.

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

- Puerto, producto y catálogo codificados directamente.
- Comparación monetaria explícita con normalización a centavos y validación de moneda en el webhook.
- Webhook sin validación criptográfica de firma.
- Validación incompleta de configuración al iniciar.
- Logs detallados y ruta `GET /webhook` orientados a desarrollo.
- No hay manejo explícito de reintentos, timeouts, rate limits u observabilidad.
- No hay deploy documentado ni infraestructura como código.
