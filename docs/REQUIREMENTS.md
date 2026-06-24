# Requisitos

## Objetivo

Proveer una plantilla mínima y comprensible para iniciar pagos de un producto mediante Mercado Pago Checkout Pro, conservar un pedido interno en Supabase y confirmar el resultado del pago desde el backend.

El objetivo comercial definitivo todavía no está documentado. Actualmente el sistema funciona como demostración técnica de una tienda con un solo producto.

## Usuarios

- Comprador: visita la página, inicia el pago y regresa a una pantalla de resultado.
- Operador o desarrollador: configura las integraciones, ejecuta el servidor y revisa pedidos y webhooks.
- Mercado Pago: servicio externo que aloja el checkout y notifica cambios de pago.
- Supabase: servicio externo que conserva el estado interno de los pedidos.

No existe actualmente un usuario administrador dentro de la aplicación ni un sistema de autenticación.

## Problema que resuelve

Evita confirmar un pedido solamente por una redirección del navegador o por datos no verificados de un webhook. El backend consulta el pago a Mercado Pago y relaciona el resultado con un pedido interno mediante `external_reference`.

## Funcionalidades requeridas actuales

- Mostrar el producto de prueba y permitir iniciar el pago.
- Crear una referencia interna por intento de compra.
- Registrar el pedido con estado `pending`.
- Crear una preferencia de Checkout Pro con producto, importe, moneda y URLs necesarias.
- Redirigir al comprador al enlace de checkout recibido.
- Recibir eventos de tipo `payment` en el webhook.
- Consultar el pago real mediante la API de Mercado Pago.
- Ignorar eventos que no correspondan a pagos.
- Actualizar a `paid` solo un pedido existente, no pagado y con importe coincidente.
- Responder a webhooks duplicados sin volver a marcar el pedido.
- Mostrar páginas de retorno para pago aprobado, rechazado o pendiente.
- Rechazar solicitudes con JSON inválido mediante una respuesta `400`.

## Datos de entrada

- Configuración: credencial de Mercado Pago, URL pública, URL de Supabase y clave de servicio.
- Inicio de compra: actualmente no recibe datos del cliente; el producto está definido en el servidor.
- Webhook: tipo de evento y `payment_id`, recibidos en query string o cuerpo JSON.
- API de Mercado Pago: estado, importe, moneda, referencia externa y metadatos del pago.

## Datos de salida

- Preferencia: identificador y URLs de checkout.
- Webhook: confirmación JSON de recepción.
- Pedido en Supabase: referencia, producto, cantidad, importe, moneda, estado e identificadores de Mercado Pago.
- Interfaz: mensajes de preparación, redirección, error y páginas de retorno.
- Logs operativos de desarrollo.

## Restricciones

- El servidor usa el puerto fijo `3003`.
- El producto actual es Remera LEMONT, cantidad 1, importe 100 y moneda ARS.
- La integración requiere una URL pública HTTPS para webhooks y retornos confiables.
- La clave `service_role` de Supabase solo puede usarse en backend.
- La confirmación del pago depende de la disponibilidad de Mercado Pago y Supabase.
- No hay pruebas automatizadas ni contrato de disponibilidad definido.
- No hay migraciones versionadas; el esquema debe verificarse manualmente.

## El sistema no debe

- Confirmar pedidos basándose únicamente en el retorno del navegador.
- Confiar ciegamente en el cuerpo del webhook.
- Exponer secretos al frontend, repositorio, logs o respuestas HTTP.
- Marcar como pagado un pedido inexistente, ya pagado o con importe diferente.
- Permitir que el navegador determine libremente el producto o precio sin validación del servidor.
- Ejecutar pagos reales como parte de pruebas automatizadas ordinarias.
- Tratar las páginas `/success`, `/failure` o `/pending` como fuente autoritativa del estado.

## Requisitos pendientes de definición

- Usuarios y objetivo comercial reales.
- Catálogo, stock, cantidades y precios definitivos.
- Identidad del comprador y autenticación.
- Reembolsos, cancelaciones, expiración y conciliación.
- Estados internos adicionales y reglas de transición.
- Requisitos de disponibilidad, rendimiento, auditoría y retención.
- Política de privacidad y tratamiento de datos personales.
- Entornos de prueba, staging y producción.

