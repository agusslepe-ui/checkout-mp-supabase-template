# Requisitos

## Actualización T-021 — COMPLETADA / DEC-026 ACEPTADA

`POST /sucursales-envio` recibe solo `province` ISO `AR-*`; backend deriva `provinceCode`, agrega `customerId` privado y usa MiCorreo `GET /agencies`. La respuesta pública incluye code, nombre y domicilio normalizados; exige ACTIVE y, cuando existe, `pickupAvailability: true`.

Checkout acepta HOME sin agencia o AGENCY con `shippingAgencyCode`. Para AGENCY recotiza `/rates`, vuelve a listar agencias y persiste exclusivamente el snapshot de la respuesta autoritativa. El total sigue siendo productos + shipping; Mercado Pago y webhook no cambian. La migración 006 está aplicada en producción. Suite histórica de cierre: 276/276.

## Actualización T-020 — COMPLETADA / DEC-025 ACEPTADA

`POST /crear-preferencia` requiere `shippingOptionId` tanto para `items[]` como para legacy. El backend recotiza MiCorreo con el carrito y CP de entrega, acepta solo home Classic/Express, toma la tarifa vigente y persiste subtotal, envío y total. Si la opción desaparece responde 409; fallos de MiCorreo responden 503 sin crear orden; 5+ unidades responden 400 sin cotizar.

Mercado Pago cobra productos + un ítem `Envío`, sin `shipments`. T-020 desplegó HOME y la migración 005; AGENCY seleccionable pertenece a T-021. El paid QA real quedó completado el 2026-09-17 y DEC-025 fue aceptada.

## Actualización T-019 — COMPLETADA (DEC-024 ACEPTADA)

En el cierre histórico de T-019, la cotización informativa admitía contrato dual items[] o sku+quantity y 1–4 unidades totales, con perfiles editables TEMPORAL/QA (300 g / 5 × 25 × 35 cm para cada cantidad). Cantidades totales 5+ se rechazaban sin MiCorreo. CP origen productivo acordado 5465 desde entorno. Domicilio/sucursal y Clásico/Express solo cuando los devolvía MiCorreo; sin elegir agencia, sin persistencia ni envío en el pago. La suite de ese cierre fue 211/211. `POST /rates` PROD verificado (`micorreo_rates_ok options=4`, destino QA 5400). Las medidas actuales **no** están aprobadas para producción. Etapa C estaba pendiente en ese cierre; posteriormente T-020 y T-021 quedaron completadas en producción.

## Objetivo

Proveer una plantilla mínima y comprensible para iniciar pagos de un carrito multítem mediante Mercado Pago Checkout Pro, conservar un pedido interno en Supabase y confirmar el resultado del pago desde el backend.

El objetivo comercial definitivo todavía no está documentado. El sistema permite comprar varias variantes de Remera LEMONT; no se presume una visión comercial adicional. T-016 está COMPLETADA (Pasos 1–4).

## Usuarios

- Comprador: visita la página, inicia el pago y regresa a una pantalla de resultado.
- Operador o desarrollador: configura las integraciones, ejecuta el servidor y revisa pedidos y webhooks.
- Mercado Pago: servicio externo que aloja el checkout y notifica cambios de pago.
- Supabase: servicio externo que conserva el estado interno de los pedidos.

No existe actualmente un usuario administrador dentro de la aplicación ni un sistema de autenticación.

## Problema que resuelve

Evita confirmar un pedido solamente por una redirección del navegador o por datos no verificados de un webhook. El backend consulta el pago a Mercado Pago y relaciona el resultado con un pedido interno mediante `external_reference`.

## Funcionalidades requeridas actuales

- Seleccionar talle, agregar al carrito persistente, editar cantidades y continuar a entrega. “Comprar ahora” conserva la compra legacy sin agregar al carrito.
- Generar la referencia interna dentro de la RPC y reutilizarla exactamente en Mercado Pago.
- Registrar una orden `pending` con N `order_items` y crear una preferencia con N ítems.
- Crear una preferencia de Checkout Pro con producto, importe, moneda y URLs necesarias.
- Redirigir al comprador al enlace de checkout recibido.
- Recibir eventos de tipo `payment` en el webhook.
- Consultar el pago real mediante la API de Mercado Pago.
- Ignorar eventos que no correspondan a pagos.
- Actualizar a `paid` solo un pedido existente, no pagado y con importe y moneda coincidentes.
- Responder a webhooks duplicados sin volver a marcar el pedido.
- Mostrar páginas de retorno para pago aprobado, rechazado o pendiente.
- Rechazar solicitudes con JSON inválido mediante una respuesta `400`.

## Datos de entrada

- Configuración: credencial de Mercado Pago, URL pública, URL de Supabase y clave de servicio.
- Inicio de compra: `{ items: [{ sku, quantity }], customer, delivery, shippingOptionId, shippingAgencyCode? }` o legacy `{ sku, quantity, customer, delivery, shippingOptionId, shippingAgencyCode? }`. Ambos requieren cliente/entrega y opción válida; AGENCY exige un code vigente y HOME ignora cualquier code extra. Mezcla de contratos: HTTP 400 `{ "error": "Carrito inválido" }`.
- Resumen: `POST /carrito/resumen` recibe `{ items }`, valida y devuelve importes del backend sin persistir.
- Carrito local: `lemont.cart`, versión 1, solo SKU y cantidad; sin PII ni datos comerciales.
- Webhook: tipo de evento y `payment_id`, recibidos en query string o cuerpo JSON.
- API de Mercado Pago: estado, importe, moneda, referencia externa y metadatos del pago.

## Datos de salida

- Preferencia: identificador y URLs de checkout.
- Webhook: confirmación JSON de recepción.
- Pedido en Supabase: referencia, items, subtotal de productos, shipping snapshot, total, moneda, estado e identificadores de Mercado Pago.
- Interfaz: mensajes de preparación, redirección, error y páginas de retorno.
- Logs operativos de desarrollo.

## Restricciones

- El servidor usa el puerto fijo `3003`.
- Remera LEMONT: `LEM-REM-001-S`, `LEM-REM-001-M`, `LEM-REM-001-L`, `LEM-REM-001-XL`; ARS 1.000 temporal, `maxQuantity: 4` transitorio (no stock). Máximo 50 entradas originales antes de agrupar.
- Shipping cobrable solo para 1–4 unidades totales y entrega HOME o AGENCY Classic/Express; AGENCY exige sucursal vigente. Perfiles 300 g / 5 × 25 × 35 cm exclusivamente TEMPORAL/QA.
- La integración requiere una URL pública HTTPS para webhooks y retornos confiables.
- La clave `service_role` de Supabase solo puede usarse en backend.
- La confirmación del pago depende de la disponibilidad de Mercado Pago y Supabase.
- Hay 276 tests automatizados en Jest. Frontend vanilla + ES modules con pruebas DOM mínimas aisladas. No hay contrato de disponibilidad definido.
- Las migraciones versionadas 001–008 están aplicadas en producción. La migración 006 y T-021 están productivas; las migraciones 007 y 008 sostienen la idempotencia durable y su hardening de privilegios.

## El sistema no debe

- Confirmar pedidos basándose únicamente en el retorno del navegador.
- Confiar ciegamente en el cuerpo del webhook.
- Exponer secretos al frontend, repositorio, logs o respuestas HTTP.
- Marcar como pagado un pedido inexistente, ya pagado o con importe o moneda diferente.
- Permitir que el navegador o localStorage definan precio, total, moneda, estado o `external_reference`; el backend es autoritativo.
- Ejecutar pagos reales como parte de pruebas automatizadas ordinarias.
- Tratar `/success`, `/failure` o `/pending` como autoridad ni vaciar el carrito al visitarlas. D2-A: solo vaciado manual, nunca al crear preferencia o redirigir.

## Requisitos pendientes de definición

- Usuarios y objetivo comercial reales.
- Catálogo, stock, cantidades y precios definitivos.
- Identidad del comprador y autenticación.
- Reembolsos, cancelaciones, expiración y conciliación.
- Estados internos adicionales y reglas de transición.
- Requisitos de disponibilidad, rendimiento, auditoría y retención.
- Política de privacidad y tratamiento de datos personales.
- Entornos de prueba, staging y producción.
