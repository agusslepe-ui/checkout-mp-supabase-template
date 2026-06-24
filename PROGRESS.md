# Progreso del proyecto

Ultima revision: 2026-06-23

## 1. Resumen del proyecto

Plantilla funcional de una tienda minima que vende una `Remera LEMONT` mediante Mercado Pago Checkout Pro. El backend crea una referencia interna por compra, registra el pedido en Supabase, genera la preferencia y procesa notificaciones de Mercado Pago para confirmar el pago por API antes de actualizar el pedido.

Incluye una interfaz web estatica, rutas de retorno para Checkout Pro y un webhook expuesto en desarrollo mediante ngrok.

## 2. Tecnologias usadas

- Node.js y CommonJS.
- Express 5 para servidor HTTP, API y archivos estaticos.
- SDK oficial `mercadopago` para preferencias y consulta de pagos.
- `@supabase/supabase-js` para persistir y actualizar pedidos.
- `dotenv` para cargar configuracion y secretos desde `.env`.
- HTML, CSS y JavaScript vanilla.
- ngrok para publicar el servidor local.

Dependencias: `express@^5.2.1`, `mercadopago@^3.1.0`, `@supabase/supabase-js@^2.108.2` y `dotenv@^17.4.2`.

## 3. Funcionalidades actuales

- Servidor Express en el puerto `3003` y frontend servido desde `public/`.
- Tarjeta de producto con boton para iniciar Checkout Pro.
- Creacion de preferencias mediante `POST /crear-preferencia`.
- Producto actual: `Remera LEMONT`, cantidad `1`, importe `100`, moneda `ARS`.
- Redireccion a `sandbox_init_point` o, si no existe, `init_point`.
- Paginas HTML para retornos `success`, `failure` y `pending`.
- Referencias internas con formato `LEMONT-ORDER-${Date.now()}`.
- Alta de pedidos `pending` en la tabla `orders` de Supabase.
- Webhook `POST /webhook` compatible con distintas formas de evento de pago.
- Ruta temporal `GET /webhook` para diagnostico.
- Consulta del pago mediante `Payment.get`.
- Validacion de existencia, estado duplicado y coincidencia del monto.
- Actualizacion del pedido a `paid` cuando la API confirma `approved`.
- Manejo global de solicitudes con JSON invalido.

## 4. Flujo de Mercado Pago

1. El usuario abre `http://localhost:3003` y pulsa `Pagar con Mercado Pago`.
2. `public/app.js` envia `POST /crear-preferencia`.
3. El backend genera un `external_reference` unico.
4. Se intenta guardar el pedido como `pending` en Supabase.
5. Se crea una preferencia con producto, referencia, `notification_url`, `back_urls` y `auto_return: "approved"`.
6. El navegador redirige al checkout devuelto por Mercado Pago.
7. Mercado Pago notifica a `POST {BASE_URL}/webhook`.
8. El webhook obtiene el tipo desde `topic` o `type` y el ID desde `id`, `resource` o `data.id`.
9. Los eventos que no son `payment` se ignoran y reciben `{ "received": true }`.
10. Para un evento `payment`, el backend consulta el pago real mediante la API.
11. Solo ante `status === "approved"` intenta actualizar el pedido.
12. Valida `external_reference`, existencia del pedido, estado no pagado y monto coincidente.
13. Si todo pasa, actualiza `status`, `mercadopago_payment_id`, `mercadopago_status` y `updated_at`.

```text
pedido pending -> Mercado Pago -> webhook -> consulta API -> validaciones -> pedido paid
```

## 5. Variables de entorno necesarias

`.env` no debe versionarse. `.env.example` contiene solamente nombres vacios:

```env
MERCADOPAGO_ACCESS_TOKEN=
BASE_URL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

- `MERCADOPAGO_ACCESS_TOKEN`: credencial privada del SDK en backend.
- `BASE_URL`: origen publico HTTPS; en desarrollo suele ser la URL de ngrok sin ruta final.
- `SUPABASE_URL`: URL del proyecto Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: clave privilegiada exclusiva del backend.

`.env` y `node_modules/` estan ignorados por Git.

## 6. Archivos importantes del proyecto

- `index.js`: servidor, clientes, preferencias, webhook, validaciones y rutas.
- `package.json`: scripts y dependencias.
- `package-lock.json`: versiones resueltas.
- `public/index.html`: pantalla principal.
- `public/app.js`: solicitud de preferencia y redireccion.
- `public/styles.css`: estilos.
- `public/success.html`, `failure.html`, `pending.html`: retornos del checkout.
- `.env.example`: contrato de configuracion sin secretos.
- `.gitignore`: exclusion de secretos, dependencias, logs y temporales.
- `README.md`: instalacion, operacion, SQL y reutilizacion.
- `PROGRESS.md`: estado tecnico y siguientes pasos.

## 7. Estado actual del desarrollo

El flujo principal esta implementado de punta a punta:

- Frontend para iniciar compra: implementado.
- Preferencia Checkout Pro y retornos: implementados.
- Webhook publico mediante ngrok: implementado.
- Confirmacion por API: implementada.
- Pedido `pending` y cambio a `paid`: implementados.
- Asociacion por `external_reference`: implementada.
- Control basico de duplicados y monto: implementado.
- Documentacion de instalacion y backup: disponible.

No hay tests automatizados, migraciones versionadas, despliegue de produccion ni panel administrativo.

## 8. Problemas resueltos hasta ahora

- Credenciales seguras con `dotenv` y `.gitignore`.
- Uso de `npm.cmd` cuando PowerShell bloquea `npm.ps1`.
- Rechazo de `localhost` para URLs publicas, resuelto en desarrollo con ngrok.
- Rutas de retorno HTML.
- Recepcion y diagnostico de webhooks.
- Respuesta `400` ante JSON invalido.
- Deteccion flexible del evento y `payment_id`.
- Confirmacion por API en vez de confiar solo en el body del webhook.
- Asociacion pago-pedido mediante `external_reference`.
- Prevencion basica de duplicados y validacion del importe.
- Manejo de pedidos inexistentes y pagos sin referencia.

## 9. Riesgos o cosas delicadas

- `SUPABASE_SERVICE_ROLE_KEY` tiene privilegios elevados y nunca debe llegar al frontend, logs o Git.
- El webhook todavia no valida la firma criptografica de Mercado Pago. Consultar el pago por API reduce el riesgo, pero no reemplaza esa validacion.
- Si guardar el pedido falla, el codigo registra el error pero igualmente intenta crear la preferencia; puede quedar un pago sin pedido asociado.
- La comparacion monetaria usa `Number`; para decimales conviene trabajar en centavos o usar una estrategia decimal explicita.
- La comprobacion de duplicados y el `update` no son atomicos; webhooks simultaneos podrian competir.
- Producto, precio y moneda estan hardcodeados en backend y frontend.
- Una URL gratuita de ngrok puede cambiar; hay que actualizar `BASE_URL` y reiniciar.
- `GET /webhook` y los logs detallados son utiles para desarrollo, pero no ideales para produccion.
- El literal de error de JSON invalido presenta un problema de codificacion en `index.js`; queda documentado, no corregido.
- No hay validacion temprana de todas las variables de entorno.
- No hay tests, migraciones versionadas ni observabilidad estructurada.

## 10. Proximos pasos recomendados

1. Validar `x-signature` y `x-request-id` del webhook.
2. No crear la preferencia si antes no pudo persistirse el pedido.
3. Hacer atomica o condicional la actualizacion de `pending` a `paid`.
4. Mover producto, precio y moneda a una fuente de datos del servidor.
5. Versionar el SQL de Supabase como migracion.
6. Agregar tests para eventos, montos, duplicados y errores de API.
7. Validar variables de entorno al iniciar, sin imprimir secretos.
8. Corregir la codificacion del mensaje de JSON invalido.
9. Retirar `GET /webhook` y reducir logs antes de produccion.
10. Configurar HTTPS estable y credenciales de produccion.
11. Usar identificadores de pedido robustos en vez de depender solo de `Date.now()`.

## 11. Comandos utiles para correr y probar

```powershell
# Instalar dependencias
npm.cmd install

# Iniciar el servidor
npm.cmd run dev

# Publicar el puerto local
ngrok http 3003

# Crear una preferencia sin frontend
curl.exe -X POST http://localhost:3003/crear-preferencia

# Probar la llegada al webhook
curl.exe -X POST "http://localhost:3003/webhook?id=123456789&topic=payment" -H "Content-Type: application/json" -d "{\"resource\":\"123456789\",\"topic\":\"payment\"}"

# Revisar cambios antes de un backup
git status --short
git diff
```

Abrir la tienda y retornos:

```text
http://localhost:3003
http://localhost:3003/success
http://localhost:3003/failure
http://localhost:3003/pending
```

El ID del ejemplo de webhook no representa un pago real; la consulta fallara salvo que se use un `payment_id` valido de la cuenta configurada.
