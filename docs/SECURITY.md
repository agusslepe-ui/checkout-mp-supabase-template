# Seguridad

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
- `.env.example` contiene únicamente nombres vacíos. Las credenciales QA solicitadas todavía no fueron recibidas y no existen valores reales en el repositorio.
- Los errores públicos son genéricos y las categorías internas no incluyen datos externos sensibles.
- La suite actual pasa 75/75 e incluye regresiones de ausencia de secretos/PII. El mecanismo de solicitud JWT compartida está implementado; no existe todavía una prueba aislada de concurrencia simultánea.
- La integración de red real contra QA sigue pendiente. No confundir tests con mocks con validación del contrato externo.
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
