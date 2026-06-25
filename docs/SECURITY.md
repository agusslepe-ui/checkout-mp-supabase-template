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

### Webhook sin firma

El endpoint acepta eventos sin validar `x-signature`. La consulta posterior a Mercado Pago reduce la posibilidad de falsificar un pago aprobado, pero permite tráfico no autenticado y no sustituye la validación requerida.

### Pago sin pedido interno

Si Supabase falla, el servidor registra el error y continúa creando la preferencia. Puede existir un cobro difícil de conciliar.

### Condición de carrera

La lectura del pedido y la actualización ocurren por separado. Webhooks concurrentes pueden superar simultáneamente la validación de estado.

### Manejo monetario

La comparación de importes del webhook está mitigada por T-007/DEC-011: ambos valores se normalizan a centavos con `Math.round(Number(valor) * 100)` antes de comparar y la moneda se valida contra `order.currency`. Mantener esta regla si se agregan productos o precios con centavos.

### Clave privilegiada de Supabase

La clave `service_role` puede evitar controles de RLS según la configuración. Su exposición o uso excesivo tendría alto impacto.

### Logs detallados

El webhook registra query, cuerpo y numerosos campos del pago. Esto puede almacenar identificadores o datos personales innecesarios.

### Configuración y diagnóstico de desarrollo

No se validan tempranamente todas las variables. `GET /webhook`, logs verbosos y ngrok son útiles localmente, pero deben eliminarse, restringirse o sustituirse en producción.

### Ausencia de controles operativos

No se observan tests automatizados, rate limiting, health checks, monitoreo, política de retención, migraciones ni procedimiento de incidentes o rollback.

## Recomendaciones priorizadas

1. Implementar y probar la validación de firma del webhook.
2. No crear preferencias si no existe el pedido interno.
3. Hacer atómica e idempotente la actualización de pagos.
4. Validar configuración al inicio sin mostrar valores.
5. Adoptar una estrategia monetaria segura.
6. Reducir y estructurar logs con correlación y redacción de datos.
7. Versionar el esquema y revisar restricciones, índices y RLS.
8. Separar entornos y credenciales; usar HTTPS estable en producción.
9. Agregar pruebas sin llamadas ni pagos reales.
10. Definir respuesta a incidentes, rotación, auditoría y retención.

## Respuesta ante exposición

Si aparece un secreto en Git, un log o una conversación:

1. No copiarlo ni volver a publicarlo.
2. Informar al responsable indicando únicamente el nombre de la credencial y el lugar de exposición.
3. Revocar o rotar la credencial desde el proveedor.
4. Revisar accesos y actividad relacionados.
5. Eliminar el valor de los artefactos permitidos sin asumir que eso invalida copias históricas.
6. Registrar el incidente sin incluir el secreto.
