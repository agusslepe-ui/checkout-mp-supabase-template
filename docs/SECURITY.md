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

### Ausencia de controles operativos

Persisten pendientes operativos: no hay rate limiting ni health checks dedicados. Tests automatizados, migración versionada, logs estructurados y rollback de staging están documentados o implementados.

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
