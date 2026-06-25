# Decisiones técnicas

Este registro distingue decisiones observadas en el código de decisiones todavía pendientes. Las alternativas indicadas como inferidas deben confirmarse antes de rediseñar el sistema.

---

## D-001 Usar Checkout Pro

- Estado: vigente.
- Decisión: redirigir al comprador al checkout alojado por Mercado Pago.
- Motivo inferido: reducir el alcance del frontend y delegar la experiencia de pago al proveedor.
- Alternativas: Checkout API o una integración personalizada.
- Consecuencia: el sistema depende de preferencias, retornos y webhooks de Mercado Pago.

## D-002 Confirmar pagos desde el backend

- Estado: vigente.
- Decisión: consultar `Payment.get` ante un webhook y usar esa respuesta para confirmar el estado.
- Motivo: no confiar únicamente en el cuerpo recibido ni en la redirección del comprador.
- Alternativas: confiar en el evento o el retorno, descartadas por menor integridad.
- Pendiente: añadir validación criptográfica del webhook (ver DEC-009).

## D-003 Correlacionar mediante `external_reference`

- Estado: vigente.
- Decisión: guardar la misma referencia en el pedido y la preferencia.
- Motivo: relacionar el pago externo con el pedido interno sin depender solo del `payment_id`.
- Alternativas: tabla de relaciones por ID de preferencia o pago.
- Pendiente: reemplazar la generación basada solo en tiempo por un identificador robusto (ver T-008).

## D-004 Persistir un pedido antes del checkout

- Estado: vigente.
- Decisión: crear el pedido en estado `pending` antes de crear la preferencia.
- Motivo: disponer de una entidad interna que pueda conciliarse posteriormente.
- Implementación: T-002 completada (2026-06-24). Si la inserción en Supabase falla, el flujo se detiene y Mercado Pago no es llamado.

## D-005 Mantener producto y precio en backend

- Estado: vigente para la demostración.
- Decisión: definir producto, cantidad, importe y moneda en el servidor.
- Motivo: impedir que el navegador sea la fuente autoritativa del importe.
- Alternativas: catálogo en base de datos o servicio de productos.
- Pendiente: elegir una fuente de catálogo real (ver DEC-013).

## D-006 Usar Supabase con clave de servicio

- Estado: vigente.
- Decisión: acceder a `orders` desde el backend con `SUPABASE_SERVICE_ROLE_KEY`.
- Motivo inferido: simplificar el prototipo y mantener la credencial fuera del navegador.
- Alternativas: cliente autenticado con RLS, API propia sobre otra base o funciones de Supabase.
- Consecuencia: una exposición de la clave tiene impacto elevado; deben revisarse permisos y RLS.

## D-007 Servir frontend y API desde Express

- Estado: vigente.
- Decisión: usar un único proceso para archivos estáticos, rutas y webhook.
- Motivo inferido: simplicidad operativa del prototipo.
- Alternativas: frontend y backend desplegados por separado.

## D-008 Usar JavaScript, CommonJS y frontend sin framework

- Estado: vigente.
- Motivo inferido: mantener la plantilla pequeña y con pocas herramientas.
- Alternativas: ES modules, TypeScript o framework frontend.
- Revisión: no necesaria hasta que la complejidad o requisitos de tipado lo justifiquen.

---

## Decisiones pendientes

Las siguientes decisiones se registraron inicialmente como pendientes. Cada una conserva el estado `pendiente` hasta que el usuario la defina y apruebe.

---

## DEC-009 — Estrategia de validación de firma del webhook

**Fecha:** 2026-06-24  
**Estado:** aceptada

### Contexto
El endpoint `/webhook` acepta eventos sin validar la firma criptográfica. La consulta posterior a Mercado Pago reduce el riesgo, pero no sustituye la validación requerida. Mercado Pago provee los headers `x-signature` y `x-request-id` para esta verificación.

### Decisión

- El secreto de validación debe obtenerse exclusivamente de la variable de entorno `MERCADO_PAGO_WEBHOOK_SECRET`.
- Si la firma del webhook es inválida, el servidor debe responder HTTP `401`.
- Si la firma está ausente, el servidor también debe responder HTTP `401`.
- En ambos casos, la respuesta debe ser genérica: `Webhook inválido`.
- No se deben exponer secretos, firmas completas, headers sensibles ni detalles internos en respuestas o logs.
- Los logs solo pueden registrar eventos genéricos como `firma de webhook ausente` o `firma de webhook inválida`.

La implementación debe seguir el algoritmo oficial vigente de Mercado Pago y validar la firma antes de consultar pagos o actualizar pedidos.

### Motivo
Sin validación criptográfica, cualquier cliente puede enviar una notificación falsa que dispare consultas a la API de Mercado Pago o actualizaciones de pedidos. La validación es una precondición de seguridad, no una mejora opcional.

### Alternativas consideradas
- Confiar únicamente en la consulta posterior a `Payment.get` sin validar la firma: reduce el riesgo pero no elimina el procesamiento innecesario ante notificaciones falsas. Descartada.
- Responder HTTP `400` en lugar de `401` para firma inválida o ausente: semánticamente menos preciso; `401` indica falla de autenticación, que es el caso exacto. Descartada.
- Registrar la firma o los headers de autenticación completos para debugging: descartada por política de seguridad. Los logs solo deben registrar eventos genéricos sin valores sensibles.

### Consecuencias
- Relacionada con T-001.
- Requiere agregar `MERCADO_PAGO_WEBHOOK_SECRET` al contrato de configuración (`.env.example`), sin incluir ningún valor real.
- T-001 queda desbloqueada.

---

## DEC-010 — Mecanismo atómico para la transición de estado a pagado

**Fecha:** 2026-06-24  
**Estado:** aceptada

### Contexto
La lectura del pedido y su actualización son operaciones separadas. Dos webhooks concurrentes pueden superar la comprobación de estado antes de que uno de ellos complete la actualización. Mercado Pago puede enviar más de un webhook para el mismo pago.

### Decisión

- La transición a `paid` se ejecuta solo si el estado actual del pedido es `pending`. Si la actualización no afecta ninguna fila, el pedido ya transicionó; el webhook se trata como duplicado idempotente sin interrumpir el flujo.
- Si el pedido no existe, no se crea un pedido nuevo; se registra un log genérico y se responde sin error catastrófico al cliente.
- Si el importe del pago no coincide con el del pedido, no se marca como `paid`.
- Si el estado del pago consultado a Mercado Pago no es `approved`, no se marca como `paid`.
- No se exponen secretos, firmas completas, headers sensibles ni datos internos en logs ni en respuestas al cliente.
- La estrategia se implementa desde el backend usando la API de Supabase; no requiere dependencias adicionales ni funciones SQL personalizadas.

### Motivo
Una actualización no condicional permite que dos webhooks concurrentes lean el estado `pending`, ambos lo superen y ambos ejecuten la transición a `paid`. La condición `WHERE status = 'pending'` convierte la operación en atómica a nivel de fila en Supabase/PostgreSQL: solo uno puede completar la actualización; el otro recibe cero filas afectadas y lo trata como duplicado.

### Alternativas consideradas
- Usar una función SQL de Supabase con lógica transaccional explícita: más control, pero agrega complejidad de infraestructura y requiere permisos adicionales. Descartada para esta etapa.
- Usar un lock a nivel de aplicación (mutex en memoria): no funciona con múltiples instancias del servidor. Descartada.
- Confiar en `payment_id` como única garantía de idempotencia sin condición de estado: no previene la carrera entre dos webhooks antes de la primera actualización. Descartada como garantía única.

### Consecuencias
- Relacionada con T-003.
- La actualización condicional garantiza idempotencia sin dependencias adicionales.
- T-003 queda desbloqueada.

---

## DEC-011 — Representación de importes y reglas de redondeo

**Fecha:** pendiente de definir  
**Estado:** pendiente

### Contexto
La comparación de importes usa `Number`, lo que puede producir errores de precisión con valores decimales. El importe actual es 100 ARS (sin decimales), pero esto puede cambiar si se expande el catálogo.

### Decisión
> Pendiente de confirmar con el usuario.

### Opciones a evaluar
- Comparar importes como enteros en centavos (multiplicar por 100, comparar con igualdad entera). Sin dependencias nuevas.
- Usar una librería de aritmética decimal (`decimal.js` u otra). Requiere autorización para instalar.
- Definir la unidad interna de representación y la regla de redondeo (ej: siempre hacia abajo, siempre hacia arriba, redondeo bancario).

### Consecuencias
- Relacionada con T-007.
- La estrategia elegida debe documentarse aquí y reflejarse en los tests de T-005.

---

## DEC-012 — Esquema versionado de Supabase: restricciones, índices y RLS

**Fecha:** 2026-06-24  
**Estado:** aceptada

### Contexto
El esquema de `orders` existe solo como DDL en el README. No hay migraciones versionadas, índices documentados ni política RLS definida. La clave `service_role` puede evitar controles de RLS según la configuración.

### Decisión

- Usar archivos SQL manuales versionados; no se adopta Supabase CLI en esta etapa.
- El archivo de migración será `supabase/migrations/001_create_orders.sql`.
- Codex crea el archivo SQL en el repositorio; el usuario lo aplica manualmente en Supabase cuando corresponda.
- El archivo debe contener: DDL de `orders`, restricciones de dominio, índices y política RLS mínima.
- El archivo no debe contener: credenciales, API keys, datos reales ni valores de variables de entorno.
- Si el proyecto crece, se puede adoptar Supabase CLI en una decisión futura sin conflicto.

### Motivo
El proyecto es pequeño y controlado. No se requieren herramientas adicionales en esta etapa. Un archivo SQL revisable en el repositorio es suficiente para versionar el esquema y permite que el usuario lo aplique de forma controlada en el momento que elija.

### Alternativas consideradas
- Supabase CLI (`supabase migration new`, `supabase db diff`): más automatizado y genera diffs, pero requiere instalar y configurar la herramienta localmente. Descartada para esta etapa; puede reconsiderarse si el proyecto escala.

### Consecuencias
- Relacionada con T-006.
- Codex puede crear `supabase/migrations/001_create_orders.sql` directamente sin herramientas adicionales.
- El usuario es responsable de revisar y aplicar el archivo en Supabase de forma manual; Codex no ejecuta ningún comando de base de datos.
- No aplicar en base compartida o productiva sin autorización explícita.
- T-006 queda desbloqueada.

---

## DEC-013 — Fuente de catálogo, stock y precios

**Fecha:** pendiente de definir  
**Estado:** pendiente

### Contexto
El producto (Remera LEMONT, 1 unidad, 100 ARS) está hardcodeado en `index.js`. Si el proyecto crece hacia un catálogo real, esta definición debe provenir de una fuente autoritativa y configurable.

### Decisión
> Pendiente de confirmar con el usuario.

### Opciones a evaluar
- Objeto de configuración en código (sin base de datos). Simple pero requiere redeploy para cambiar precios.
- Tabla de productos en Supabase. Flexible pero agrega complejidad.
- Servicio externo de catálogo o CMS. Mayor separación de responsabilidades.

### Consecuencias
- Relacionada con T-012.
- El servidor debe seguir siendo la fuente autoritativa del precio, sin importar la opción elegida.

---

## DEC-014 — Autenticación y autorización de compradores u operadores

**Fecha:** pendiente de definir  
**Estado:** pendiente

### Contexto
No existe autenticación ni usuario administrador. El flujo actual es completamente anónimo para el comprador. Si el proyecto escala, se necesitará identificar compradores o restringir acceso a operadores.

### Decisión
> Pendiente de confirmar con el usuario.

### Opciones a evaluar
- Mantener flujo anónimo (solo para demostración técnica).
- Autenticación de compradores con Supabase Auth.
- Panel administrativo con acceso restringido por rol.
- Autenticación externa (OAuth, magic link, etc.).

### Consecuencias
- El alcance de esta decisión puede afectar el esquema de `orders`, los requisitos y el diseño general.
- No implementar hasta tener definición de usuarios y objetivo comercial real (ver `docs/REQUIREMENTS.md`).

---

## DEC-015 — Reembolsos, cancelaciones, expiración y conciliación

**Fecha:** pendiente de definir  
**Estado:** pendiente

### Contexto
Solo existe la transición `pending → paid`. No hay estados adicionales ni procesos definidos para reembolsos, cancelaciones, pagos expirados o conciliación periódica.

### Decisión
> Pendiente de confirmar con el usuario.

### Opciones a evaluar
- Definir estados adicionales: `refunded`, `cancelled`, `expired`, `failed`.
- Definir reglas de transición entre estados.
- Integrar la API de reembolsos de Mercado Pago.
- Definir proceso de conciliación periódica (reconciliación entre Supabase y Mercado Pago).

### Consecuencias
- Afecta el esquema de la tabla `orders` y el documento de requisitos.
- No implementar hasta definir los casos de negocio reales.

---

## DEC-016 — Proveedor de despliegue, entornos y rollback

**Fecha:** pendiente de definir  
**Estado:** pendiente

### Contexto
No hay configuración de despliegue documentada. La aplicación usa ngrok para desarrollo, pero no tiene infraestructura de producción ni entorno de staging.

### Decisión
> Pendiente de confirmar con el usuario.

### Opciones a evaluar
- Railway, Render, Fly.io, Heroku u otro PaaS.
- VPS propio (mayor control, mayor responsabilidad operativa).
- Definir si hay un entorno de staging separado del de producción.
- Definir el procedimiento de rollback (redeploy de versión anterior, blue-green, etc.).

### Consecuencias
- Relacionada con T-013.
- La URL estable de producción debe usarse en `BASE_URL` y como `notification_url` en las preferencias.
- No ejecutar ningún deploy sin autorización explícita.

---

## DEC-017 — Formato, destino y política de retención de logs

**Fecha:** pendiente de definir  
**Estado:** pendiente

### Contexto
Los logs actuales usan `console.log` con diferentes niveles de detalle, incluyendo campos del webhook y del pago. No hay estructura, correlación ni política de retención definida.

### Decisión
> Pendiente de confirmar con el usuario.

### Opciones a evaluar
- Logs estructurados en JSON con niveles (info, warn, error) y campo de correlación por request.
- Librería de logging (`pino`, `winston` u otra). Requiere autorización para instalar.
- Destino: stdout (y captura por la plataforma de deploy) o servicio externo (Datadog, Logtail, etc.).
- Política de retención: tiempo máximo de retención y campos a redactar (datos personales, referencias internas).

### Consecuencias
- Relacionada con T-010.
- Cualquier log en producción debe cumplir con la política de privacidad que se defina.
